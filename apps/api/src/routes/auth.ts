// Auth Fase 1 — "Entrar con Google" (diseño docs/auth-design.md §6-§7).
// Solo el dueño del negocio se autentica; el cliente final NO tiene login.
// Scopes de login: SOLO openid email profile (nada de calendario aquí;
// eso es Fase 2, con su propio flujo y redirect).
// Sesión opaca en DB + cookie httpOnly, sin JWT (ver services/session.ts).
import { OAuth2Client } from "google-auth-library";
import type { FastifyInstance } from "fastify";
import type { AppointmentStore } from "../store";
import { requireAuth } from "../middleware/auth";
import {
  clearSessionCookieHeader,
  createSession,
  sessionCookieHeader,
  SESSION_TTL_MS,
} from "../services/session";
import {
  clearOAuthStateCookieHeader,
  createOAuthState,
  isSafeReturnTo,
  oauthStateCookieHeader,
  OAUTH_STATE_COOKIE,
  verifyOAuthState,
} from "../services/oauth-state";
import { parseCookies } from "../services/session";

const LOGIN_SCOPES = ["openid", "email", "profile"];

// Rate limit mínimo anti-abuso en el login (diseño §8): 10 intentos por
// IP cada 10 minutos, en memoria. No es anti-ataque serio; basta para el demo.
const loginAttempts = new Map<string, number[]>();
function loginRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - 10 * 60 * 1000;
  const attempts = (loginAttempts.get(ip) ?? []).filter((t) => t > windowStart);
  attempts.push(now);
  loginAttempts.set(ip, attempts);
  return attempts.length > 10;
}

function authConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.AUTH_GOOGLE_REDIRECT_URI ?? "http://localhost:3001/auth/google/callback",
    webUrl: process.env.WEB_URL ?? "http://localhost:3000",
  };
}

export function authRoutes(app: FastifyInstance, store: AppointmentStore) {
  // GET /auth/google?returnTo=/negocio/barberia-demo — redirige a Google.
  app.get("/auth/google", async (req, reply) => {
    const config = authConfig();
    if (!config.clientId || !config.clientSecret) {
      return reply.status(500).send({ error: "GOOGLE_CLIENT_ID/SECRET no configurados" });
    }
    if (loginRateLimited(req.ip)) {
      return reply.status(429).send({ error: "Demasiados intentos, prueba en unos minutos" });
    }
    const { returnTo } = req.query as { returnTo?: string };
    // "" = sin preferencia: el callback elige el destino (primer negocio o /).
    const safeReturnTo = isSafeReturnTo(returnTo) ? returnTo : "";
    let state: string;
    try {
      state = createOAuthState(safeReturnTo).state;
    } catch {
      return reply.status(500).send({ error: "OAUTH_STATE_SECRET no configurado" });
    }
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: LOGIN_SCOPES.join(" "),
      prompt: "select_account", // el dueño puede tener cuenta personal y de negocio
      state,
    });
    reply.header("Set-Cookie", oauthStateCookieHeader(state));
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  // GET /auth/google/callback?code=...&state=... — crea la sesión y vuelve a la web.
  app.get("/auth/google/callback", async (req, reply) => {
    const config = authConfig();
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) {
      return reply.status(400).send({ error: "code y state requeridos" });
    }
    if (loginRateLimited(req.ip)) {
      return reply.status(429).send({ error: "Demasiados intentos, prueba en unos minutos" });
    }
    const payload = verifyOAuthState(state);
    const cookies = parseCookies(req.headers.cookie);
    // State inválido o distinto de la cookie → posible CSRF. Se limpia la
    // cookie y se vuelve al login sin dar detalles al navegador.
    if (!payload || cookies[OAUTH_STATE_COOKIE] !== state) {
      reply.header("Set-Cookie", clearOAuthStateCookieHeader());
      return reply.redirect(`${config.webUrl}/login?error=state`);
    }
    // Un solo uso: la cookie se limpia aquí, en todos los caminos.
    const clearState = clearOAuthStateCookieHeader();

    // Intercambio code → tokens (id_token incluido por el scope openid).
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      req.log.error({ status: tokenRes.status }, "Google token exchange failed");
      reply.header("Set-Cookie", clearState);
      return reply.redirect(`${config.webUrl}/login?error=google`);
    }
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) {
      reply.header("Set-Cookie", clearState);
      return reply.redirect(`${config.webUrl}/login?error=google`);
    }
    // Verificación del id_token: firma contra JWKS de Google, iss, aud y exp.
    let sub: string;
    let email: string;
    let name: string | null;
    let avatarUrl: string | null;
    try {
      const client = new OAuth2Client();
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.clientId,
      });
      const p = ticket.getPayload();
      if (!p?.sub || !p.email) throw new Error("id_token sin sub/email");
      sub = p.sub;
      email = p.email;
      name = p.name ?? null;
      avatarUrl = p.picture ?? null;
    } catch (err) {
      req.log.error({ err }, "id_token verification failed");
      reply.header("Set-Cookie", clearState);
      return reply.redirect(`${config.webUrl}/login?error=google`);
    }

    const user = store.upsertUserByGoogleSub({ googleSub: sub, email, name, avatarUrl });
    const { token } = createSession(store, user.id, req.headers["user-agent"] ?? null);
    const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
    const target = isSafeReturnTo(payload.returnTo) && payload.returnTo !== ""
      ? payload.returnTo
      : (() => {
          // Sin destino pedido: al dashboard si ya tiene negocios, o al
          // onboarding si es nuevo (Fase 2: ahí crea su primer negocio).
          const mine = store.listBusinessesByOwner(user.id);
          return mine.length > 0 ? "/dashboard" : "/onboarding";
        })();
    reply.header("Set-Cookie", [clearState, sessionCookieHeader(token, maxAgeSeconds)]);
    return reply.redirect(`${config.webUrl}${target}`);
  });

  // GET /auth/me — quién soy + mis negocios. 401 sin sesión.
  app.get("/auth/me", { preHandler: requireAuth(store) }, async (req) => {
    const user = req.user!;
    const businesses = store.listBusinessesByOwner(user.id).map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      agendaVisibility: b.agendaVisibility,
      calendarConnected: !!b.googleAccessToken && !!b.calendarId,
    }));
    return {
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
      businesses,
    };
  });

  // POST /auth/logout — borra la sesión y limpia la cookie.
  app.post("/auth/logout", { preHandler: requireAuth(store) }, async (req, reply) => {
    if (req.session) store.deleteSession(req.session.id);
    reply.header("Set-Cookie", clearSessionCookieHeader());
    return { ok: true };
  });
}
