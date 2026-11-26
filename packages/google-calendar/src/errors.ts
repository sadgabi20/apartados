// Errores tipados de la API de Google (Calendar + OAuth).
// GoogleApiError conserva el mensaje que ya se logueaba
// ("Google freeBusy failed: 401 ...") y añade el status HTTP para
// que quien llama pueda distinguir un 401 (token caducado) de otros
// fallos sin parsear texto.
// GoogleAuthExpiredError significa que el access token caducó Y no se
// pudo renovar: sin refresh token, descifrado imposible o refresh
// rechazado por Google (invalid_grant). El dueño debe reconectar el
// calendario; no es un error transitorio.
export class GoogleApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

export class GoogleAuthExpiredError extends Error {
  readonly code = "google_auth_expired" as const;
  constructor() {
    super(
      "El calendario del negocio necesita reconectarse: el acceso de Google caducó y no se pudo renovar.",
    );
    this.name = "GoogleAuthExpiredError";
  }
}
