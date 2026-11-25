// OAuth Google Calendar. Ámbitos mínimos:
// - https://www.googleapis.com/auth/calendar.freebusy
// - https://www.googleapis.com/auth/calendar.events.owned
// No pedir el ámbito amplio `calendar`: es sensible y requiere revisión.
import { googleOAuthBaseUrl, timedFetch } from "./timeout";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned",
];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function buildGoogleAuthUrl(
  config: GoogleOAuthConfig,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline", // para guardar refresh_token
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
  const res = await timedFetch(
    `${googleOAuthBaseUrl()}/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    },
    "OAuth",
  );
  if (!res.ok) {
    throw new Error(`Google OAuth failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokens;
}

export function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string,
): Promise<GoogleTokens> {
  return tokenRequest({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
}

export function refreshGoogleToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
): Promise<GoogleTokens> {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
}
