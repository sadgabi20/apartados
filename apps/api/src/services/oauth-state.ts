// State anti-CSRF de OAuth (auth Fase 1, diseño §8).
// state = base64url({ nonce, returnTo, exp }) + "." + base64url(HMAC-SHA256(secret, payload))
// Un solo uso: su valor se compara con la cookie httpOnly `oauth_state` y
// la cookie se limpia en el callback. Expira en 10 minutos.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_STATE_COOKIE = "oauth_state";
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 min

export interface OAuthStatePayload {
  nonce: string;
  returnTo: string;
  exp: number; // epoch ms
}

function getSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET ?? "";
  if (!secret) throw new Error("OAUTH_STATE_SECRET no configurado");
  return secret;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function signState(payload: OAuthStatePayload): string {
  const data = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", getSecret()).update(data).digest();
  return `${data}.${sig.toString("base64url")}`;
}

export function createOAuthState(returnTo: string): { state: string; payload: OAuthStatePayload } {
  const payload: OAuthStatePayload = {
    nonce: randomBytes(16).toString("hex"),
    returnTo,
    exp: Date.now() + OAUTH_STATE_TTL_MS,
  };
  return { state: signState(payload), payload };
}

export function verifyOAuthState(state: string | undefined): OAuthStatePayload | null {
  if (!state) return null;
  const [data, sig] = state.split(".");
  if (!data || !sig) return null;
  let expected: Buffer;
  try {
    expected = createHmac("sha256", getSecret()).update(data).digest();
  } catch {
    return null;
  }
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as OAuthStatePayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload.nonce !== "string" || typeof payload.returnTo !== "string") {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
  return payload;
}

export function oauthStateCookieHeader(state: string): string {
  const attrs =
    process.env.NODE_ENV === "production"
      ? "HttpOnly; Path=/; SameSite=None; Secure"
      : "HttpOnly; Path=/; SameSite=Lax";
  return `${OAUTH_STATE_COOKIE}=${state}; Max-Age=600; ${attrs}`;
}

export function clearOAuthStateCookieHeader(): string {
  const attrs =
    process.env.NODE_ENV === "production"
      ? "HttpOnly; Path=/; SameSite=None; Secure"
      : "HttpOnly; Path=/; SameSite=Lax";
  return `${OAUTH_STATE_COOKIE}=; Max-Age=0; ${attrs}`;
}

/** Solo rutas relativas internas ("/negocio/x", "/dashboard"); nunca URLs externas. */
export function isSafeReturnTo(value: string | undefined): value is string {
  return !!value && value.startsWith("/") && !value.startsWith("//");
}
