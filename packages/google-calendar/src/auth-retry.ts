// Reintento con refresh del access token.
// Google da access tokens de 1 hora: la primera llamada con un token
// caducado da 401. Si el llamador aporta cómo renovarlo, se pide un
// token nuevo y la llamada se reintenta UNA sola vez. Si no hay cómo
// renovar, el refresh falla o el reintento también da 401, se lanza
// GoogleAuthExpiredError (el dueño debe reconectar el calendario).
// Un 401 en el reintento no se vuelve a refrescar: evita bucles y
// dobles escrituras en Google.
import { GoogleApiError, GoogleAuthExpiredError } from "./errors";

/**
 * Renueva el access token. Recibe el token que falló: si otro request
 * ya lo renovó, puede devolver el guardado sin llamar a Google.
 * null = no se puede renovar (sin refresh token, descifrado imposible
 * o refresh revocado). Un fallo transitorio del endpoint de OAuth
 * (timeout, red) se propaga como error: no se disfraza de "caducado".
 */
export type RefreshAccessToken = (failedToken: string) => Promise<string | null>;

function isUnauthorized(err: unknown): boolean {
  return err instanceof GoogleApiError && err.status === 401;
}

export async function withGoogleAuthRetry<T>(
  accessToken: string,
  refresh: RefreshAccessToken | undefined,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(accessToken);
  } catch (err) {
    if (!isUnauthorized(err) || !refresh) throw err;
    let fresh: string | null;
    try {
      fresh = await refresh(accessToken);
    } catch (refreshErr) {
      // El endpoint de OAuth rechazó el refresh token (invalid_grant):
      // está revocado o caducó (en Testing, los refresh tokens caducan
      // a los 7 días). Cualquier otro fallo se propaga tal cual.
      if (
        refreshErr instanceof Error &&
        refreshErr.message.includes("invalid_grant")
      ) {
        throw new GoogleAuthExpiredError();
      }
      throw refreshErr;
    }
    if (!fresh) throw new GoogleAuthExpiredError();
    try {
      return await fn(fresh);
    } catch (err2) {
      if (isUnauthorized(err2)) throw new GoogleAuthExpiredError();
      throw err2;
    }
  }
}
