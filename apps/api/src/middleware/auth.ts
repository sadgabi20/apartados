// Middleware de auth (Fase 1, diseño §7).
// La API es la que decide: cada endpoint de negocio verifica sesión +
// propiedad en Fastify. La web solo refleja el 401/403 con una redirección.
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppointmentStore, BusinessRecord, SessionRecord, UserRecord } from "../store";
import {
  clearSessionCookieHeader,
  parseCookies,
  resolveSession,
  SESSION_COOKIE,
  sessionCookieHeader,
} from "../services/session";

declare module "fastify" {
  interface FastifyRequest {
    user?: UserRecord;
    session?: SessionRecord;
    business?: BusinessRecord;
  }
}

function corsOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * En mutaciones autenticadas, segunda barrera además de SameSite: si el
 * navegador manda Origin y no está en la allowlist, se rechaza. Sin Origin
 * (curl, server-to-server) se permite: el chequeo es anti-CSRF de navegador.
 */
function originAllowed(req: FastifyRequest): boolean {
  if (req.method !== "POST" && req.method !== "PATCH" && req.method !== "DELETE") return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  return corsOrigins().includes(origin);
}

export function requireAuth(store: AppointmentStore) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const cookies = parseCookies(req.headers.cookie);
    const resolved = resolveSession(store, cookies[SESSION_COOKIE]);
    if (!resolved) {
      reply.header("Set-Cookie", clearSessionCookieHeader());
      await reply.status(401).send({ error: "No autenticado" });
      return;
    }
    if (resolved.rotatedToken) {
      reply.header("Set-Cookie", sessionCookieHeader(resolved.rotatedToken, resolved.maxAgeSeconds));
    }
    if (!originAllowed(req)) {
      await reply.status(403).send({ error: "Origen no permitido" });
      return;
    }
    req.user = resolved.user;
    req.session = resolved.session;
  };
}

export function requireBusinessOwner(store: AppointmentStore) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const slug = (req.params as { slug?: string }).slug;
    const business = slug ? store.getBusinessBySlug(slug) : undefined;
    if (!business) {
      await reply.status(404).send({ error: "Negocio no encontrado" });
      return;
    }
    // ownerId null (seed sin dueño) nunca coincide con nadie → 403 para
    // todo el mundo hasta la Fase 3, que asigna barberia-demo a Axel.
    if (!req.user || business.ownerId !== req.user.id) {
      await reply.status(403).send({ error: "Este negocio no es tuyo" });
      return;
    }
    req.business = business;
  };
}
