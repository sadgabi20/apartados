// Google OAuth — conectar el calendario del negocio (Fase 2).
// GET /google/auth?slug=barberia-demo[&redirect=/onboarding?slug=x] ->
// redirige a Google. Protegido: solo el dueño del negocio (401 sin sesión,
// 403 si no es suyo). El `state` es un payload firmado { slug, userId,
// nonce, redirect, exp } (HMAC, un solo uso, 10 min, comparado con la
// cookie httpOnly oauth_state): adiós al `state=slug` en claro, que
// permitía conectar el calendario de un atacante a un negocio ajeno.
// GET /google/callback?code=...&state=... -> guarda tokens y calendario.
// El refresh_token se guarda CIFRADO (AES-256-GCM, token-crypto.ts);
// sin GOOGLE_TOKEN_ENCRYPTION_KEY el callback falla a propósito
// (fail-closed) en vez de guardar el token en claro. Al terminar, 302 a
// la web (WEB_URL + redirect, con ?calendar=connected|error); JSON solo
// como fallback si no hay WEB_URL configurada.
import type { FastifyInstance, FastifyReply } from "fastify";
import { buildGoogleAuthUrl, exchangeGoogleCode } from "@apartados/google-calendar";
import type { AppointmentStore } from "../store";
import { requireAuth, requireBusinessOwnerForQuery } from "../middleware/auth";
import {
  clearOAuthStateCookieHeader,
  createCalendarOAuthState,
  isSafeReturnTo,
  oauthStateCookieHeader,
  OAUTH_STATE_COOKIE,
  verifyCalendarOAuthState,
} from "../services/oauth-state";
import { parseCookies } from "../services/session";
import { encryptRefreshToken } from "../services/token-crypto";
import { googleOAuthConfig } from "../services/google-auth";

function oauthConfig() {
  return {
    ...googleOAuthConfig(),
    webUrl: process.env.WEB_URL ?? "",
  };
}

/** Fin del callback: 302 a la web con ?calendar=<status>, o JSON sin WEB_URL. */
function finishCalendarCallback(
  reply: FastifyReply,
  webUrl: string,
  clearState: string,
  redirectBase: string,
  status: "connected" | "error",
  businessSlug?: string,
) {
  const sep = redirectBase.includes("?") ? "&" : "?";
  const target = `${redirectBase}${sep}calendar=${status}`;
  reply.header("Set-Cookie", clearState);
  if (webUrl) {
    return reply.redirect(`${webUrl}${target}`);
  }
  return reply.send({ ok: status === "connected", business: businessSlug, calendar: status });
}

export function googleRoutes(app: FastifyInstance, store: AppointmentStore) {
  app.get(
    "/google/auth",
    { preHandler: [requireAuth(store), requireBusinessOwnerForQuery(store)] },
    async (req, reply) => {
      const business = req.business!;
      const config = oauthConfig();
      if (!config.clientId || !config.clientSecret) {
        return reply.status(500).send({ error: "GOOGLE_CLIENT_ID/SECRET no configurados" });
      }
      const { redirect } = req.query as { redirect?: string };
      const safeRedirect = isSafeReturnTo(redirect)
        ? redirect!
        : `/negocio/${business.slug}`;
      let state: string;
      try {
        state = createCalendarOAuthState({
          slug: business.slug,
          userId: req.user!.id,
          redirect: safeRedirect,
        }).state;
      } catch {
        return reply.status(500).send({ error: "OAUTH_STATE_SECRET no configurado" });
      }
      reply.header("Set-Cookie", oauthStateCookieHeader(state));
      return reply.redirect(buildGoogleAuthUrl(config, state));
    },
  );

  app.get("/google/callback", async (req, reply) => {
    const config = oauthConfig();
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) return reply.status(400).send({ error: "code y state requeridos" });
    const payload = verifyCalendarOAuthState(state);
    const cookies = parseCookies(req.headers.cookie);
    // State inválido, manipulado, expirado o distinto de la cookie:
    // posible CSRF. No se puede confiar en el slug, así que 400 sin redirect.
    if (!payload || cookies[OAUTH_STATE_COOKIE] !== state) {
      return reply.status(400).send({ error: "state inválido o expirado" });
    }
    // Un solo uso: la cookie se limpia aquí, en todos los caminos.
    const clearState = clearOAuthStateCookieHeader();
    const business = await store.getBusinessBySlug(payload.slug);
    if (!business) {
      reply.header("Set-Cookie", clearState);
      return reply.status(404).send({ error: "Negocio no encontrado" });
    }
    // Defensa en profundidad: el state firmado ya ata slug+userId, pero si
    // el negocio cambió de dueño entre el inicio y el callback, no se conecta.
    if (business.ownerId !== payload.userId) {
      reply.header("Set-Cookie", clearState);
      return reply.status(403).send({ error: "Este negocio no es tuyo" });
    }
    let tokens: { access_token: string; refresh_token?: string };
    try {
      tokens = await exchangeGoogleCode(oauthConfig(), code);
    } catch (err) {
      req.log.error({ err }, "Google calendar token exchange failed");
      return finishCalendarCallback(reply, config.webUrl, clearState, payload.redirect, "error", business.slug);
    }
    let encryptedRefresh: string | null;
    try {
      encryptedRefresh = tokens.refresh_token
        ? encryptRefreshToken(tokens.refresh_token)
        : business.googleRefreshToken;
    } catch {
      // Fail-closed: sin clave de cifrado no se guarda el refresh en claro.
      req.log.error("GOOGLE_TOKEN_ENCRYPTION_KEY no configurado; no se guarda el refresh_token");
      return finishCalendarCallback(reply, config.webUrl, clearState, payload.redirect, "error", business.slug);
    }
    await store.saveBusiness({
      ...business,
      calendarId: process.env.GOOGLE_TEST_CALENDAR_ID ?? "primary",
      googleAccessToken: tokens.access_token,
      googleRefreshToken: encryptedRefresh,
    });
    return finishCalendarCallback(reply, config.webUrl, clearState, payload.redirect, "connected", business.slug);
  });
}
