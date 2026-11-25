// Sesiones opacas (auth Fase 1, diseño §5).
// - Token aleatorio de 256 bits; en el store solo vive su SHA-256.
// - Cookie httpOnly `apartados_session`, solo el token, nada de datos
//   de usuario ni tokens de Google.
// - Expiración: 30 días deslizante, máximo absoluto 90 días desde el login.
// - Rotación: si lastUsedAt tiene más de 24 h, se genera un token nuevo y
//   se invalida el anterior. El token viejo pasa a dar 401 (sesión no
//   encontrada). Sin tombstones: la detección de robo por reuso del token
//   rotado queda para después (ver PR).
// - Las sesiones en memoria se pierden al reiniciar la API, igual que hoy
//   se pierden las citas. Aceptable para la demo; la DB Prisma las
//   persistirá cuando el store se sustituya.
import { createHash, randomBytes } from "node:crypto";
import type { AppointmentStore, SessionRecord, UserRecord } from "../store";

export const SESSION_COOKIE = "apartados_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
export const SESSION_MAX_MS = 90 * 24 * 60 * 60 * 1000; // 90 días, absoluto
export const SESSION_ROTATE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 h

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

export function sessionCookieHeader(token: string, maxAgeSeconds: number): string {
  // Prod (web en Vercel, API en otro dominio): cross-site, hace falta
  // SameSite=None; Secure. Dev (localhost:3000 → localhost:3001, mismo
  // site): Lax sin Secure.
  const attrs = isProd()
    ? "HttpOnly; Path=/; SameSite=None; Secure"
    : "HttpOnly; Path=/; SameSite=Lax";
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAgeSeconds}; ${attrs}`;
}

export function clearSessionCookieHeader(): string {
  const attrs = isProd()
    ? "HttpOnly; Path=/; SameSite=None; Secure"
    : "HttpOnly; Path=/; SameSite=Lax";
  return `${SESSION_COOKIE}=; Max-Age=0; ${attrs}`;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (name && !(name in out)) out[name] = decodeURIComponent(value);
  }
  return out;
}

export interface ResolvedSession {
  user: UserRecord;
  session: SessionRecord;
  /** Nuevo token si la sesión rotó; la API debe reemitir la cookie. */
  rotatedToken: string | null;
  /** Segundos hasta expiresAt (para el Max-Age de la cookie reemitida). */
  maxAgeSeconds: number;
}

export async function createSession(
  store: AppointmentStore,
  userId: string,
  userAgent: string | null,
): Promise<{ session: SessionRecord; token: string }> {
  const token = newSessionToken();
  const now = Date.now();
  const session = await store.createSession({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    lastUsedAt: new Date(now).toISOString(),
    userAgent,
  });
  return { session, token };
}

/**
 * Valida el token de la cookie. Devuelve null si no hay sesión, expiró
 * o fue revocada. Rota el token si lastUsedAt tiene más de 24 h.
 */
export async function resolveSession(
  store: AppointmentStore,
  token: string | undefined,
): Promise<ResolvedSession | null> {
  if (!token) return null;
  const session = await store.getSessionByTokenHash(hashToken(token));
  if (!session) return null;
  const now = Date.now();
  if (new Date(session.expiresAt).getTime() <= now) {
    await store.deleteSession(session.id);
    return null;
  }
  const user = await store.getUserById(session.userId);
  if (!user) {
    await store.deleteSession(session.id);
    return null;
  }
  const lastUsed = new Date(session.lastUsedAt).getTime();
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((new Date(session.expiresAt).getTime() - now) / 1000),
  );
  if (now - lastUsed <= SESSION_ROTATE_AFTER_MS) {
    return { user, session, rotatedToken: null, maxAgeSeconds };
  }
  // Rotación: token nuevo, expiración deslizante con tope absoluto de 90 días.
  const absoluteMax = new Date(session.createdAt).getTime() + SESSION_MAX_MS;
  const newExpiresAt = Math.min(now + SESSION_TTL_MS, absoluteMax);
  if (newExpiresAt <= now) {
    await store.deleteSession(session.id);
    return null;
  }
  const newToken = newSessionToken();
  const rotated = await store.updateSession(session.id, {
    tokenHash: hashToken(newToken),
    expiresAt: new Date(newExpiresAt).toISOString(),
    lastUsedAt: new Date(now).toISOString(),
  });
  if (!rotated) return null;
  return {
    user,
    session: rotated,
    rotatedToken: newToken,
    maxAgeSeconds: Math.floor((newExpiresAt - now) / 1000),
  };
}
