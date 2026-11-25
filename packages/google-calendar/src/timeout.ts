// Timeout acotado para los fetch a Google (Calendar API y OAuth).
// Sin esto, un fetch colgado deja colgada la petición de la API que lo
// llamó. Google responde rápido en condiciones normales, así que 30 s
// bastan (GOOGLE_TIMEOUT_MS). Pey es el lento, no Google: su timeout
// vive aparte en @apartados/pey (240 s por defecto).
export const DEFAULT_GOOGLE_TIMEOUT_MS = 30_000;

/** Timeout para las llamadas a Google (ms), configurable por env. */
export function googleTimeoutMs(): number {
  const raw = Number(process.env.GOOGLE_TIMEOUT_MS ?? DEFAULT_GOOGLE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GOOGLE_TIMEOUT_MS;
}

/** Base de la Calendar API. GOOGLE_API_BASE_URL solo existe para
 * pruebas locales (apuntar a un servidor falso); en prod es googleapis. */
export function googleApiBaseUrl(): string {
  return process.env.GOOGLE_API_BASE_URL ?? "https://www.googleapis.com";
}

/** Base del token endpoint de OAuth. GOOGLE_OAUTH_BASE_URL solo existe
 * para pruebas locales; en prod es oauth2.googleapis.com. */
export function googleOAuthBaseUrl(): string {
  return process.env.GOOGLE_OAUTH_BASE_URL ?? "https://oauth2.googleapis.com";
}

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  );
}

/**
 * fetch con AbortSignal acotado. En timeout lanza Error con mensaje
 * claro (no el TimeoutError crudo del runtime) para que las rutas lo
 * puedan mostrar o loguear sin más traducción.
 */
export async function timedFetch(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  const timeoutMs = googleTimeoutMs();
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error(
        `Google ${label} tardó más de ${Math.round(timeoutMs / 1000)} s en responder`,
      );
    }
    throw err;
  }
}
