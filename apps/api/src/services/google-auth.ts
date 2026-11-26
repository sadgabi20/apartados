// Refresh automático del access token de Google Calendar.
// El access token dura 1 hora: sin esto, cada llamada a Google con
// el token caducado daba 401 y la API contestaba 500 ("Internal
// Server Error" en la web), aunque el refresh token siguiera guardado
// y cifrado. La función refreshGoogleToken existía pero nadie la
// llamaba.
// Uso: googleCtxForBusiness construye el GoogleCtx con el refresh ya
// conectado; las llamadas de @apartados/google-calendar lo invocan
// solo si la primera llamada da 401, y reintentan una sola vez.
// El refresh token NUNCA sale de aquí en claro: se descifra, se usa
// y se vuelve a cifrar si Google rota uno nuevo. Si el refresh falla
// (revocado o caducado — en modo Testing, 7 días), el llamador recibe
// GoogleAuthExpiredError y debe decirle al dueño que reconecte.
import {
  refreshGoogleToken,
  type GoogleOAuthConfig,
  type RefreshAccessToken,
} from "@apartados/google-calendar";
import { decryptRefreshToken, encryptRefreshToken } from "./token-crypto";
import type { AppointmentStore, BusinessRecord } from "../store";
import type { GoogleCtx } from "./hold";

export function googleOAuthConfig(): GoogleOAuthConfig {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3001/google/callback",
  };
}

/**
 * Renueva el access token del negocio y lo persiste. Recibe el token
 * que falló con 401:
 * - Si el negocio ya tiene otro token guardado (otro request lo
 *   renovó primero), lo devuelve sin llamar a Google.
 * - Si no hay refresh token o no se puede descifrar, devuelve null:
 *   el dueño debe reconectar el calendario.
 * - Si Google rechaza el refresh (invalid_grant), el error se
 *   propaga: el reintentador lo traduce a GoogleAuthExpiredError.
 * El token nuevo (y el refresh nuevo si Google rotó uno) se guarda
 * con saveBusiness, así funciona con Prisma y con memoria. Si el
 * guardado falla, el token nuevo se devuelve igual para esta llamada;
 * la próxima volverá a intentar el refresh.
 */
export function makeRefreshAccessToken(
  store: AppointmentStore,
  businessId: string,
): RefreshAccessToken {
  return async (failedToken) => {
    const business = await store.getBusiness(businessId);
    if (!business) return null;
    if (business.googleAccessToken && business.googleAccessToken !== failedToken) {
      return business.googleAccessToken;
    }
    const plain = decryptRefreshToken(business.googleRefreshToken);
    if (!plain) return null;
    const tokens = await refreshGoogleToken(googleOAuthConfig(), plain);
    let encryptedRefresh = business.googleRefreshToken;
    if (tokens.refresh_token) {
      try {
        encryptedRefresh = encryptRefreshToken(tokens.refresh_token);
      } catch {
        // Sin clave de cifrado no se puede guardar el refresh nuevo;
        // se conserva el anterior y se devuelve el access token nuevo.
      }
    }
    try {
      await store.saveBusiness({
        ...business,
        googleAccessToken: tokens.access_token,
        googleRefreshToken: encryptedRefresh,
      });
    } catch {
      // El token nuevo sirve para esta llamada aunque no quedara
      // persistido; la próxima llamada volverá a intentar el refresh.
    }
    return tokens.access_token;
  };
}

/** Contexto de Google de un negocio, con el refresh ya conectado. */
export function googleCtxForBusiness(
  store: AppointmentStore,
  business: BusinessRecord,
): GoogleCtx | null {
  if (!business.googleAccessToken || !business.calendarId) return null;
  return {
    accessToken: business.googleAccessToken,
    calendarId: business.calendarId,
    refreshAccessToken: makeRefreshAccessToken(store, business.id),
  };
}
