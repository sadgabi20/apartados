// Google OAuth — conectar el calendario del negocio.
// GET /google/auth?slug=barberia-demo -> redirige a Google.
// GET /google/callback?code=...&state=<slug> -> guarda tokens y calendario.
import type { FastifyInstance } from "fastify";
import { buildGoogleAuthUrl, exchangeGoogleCode } from "@apartados/google-calendar";
import type { AppointmentStore } from "../store";

function oauthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3001/google/callback",
  };
}

export function googleRoutes(app: FastifyInstance, store: AppointmentStore) {
  app.get("/google/auth", async (req, reply) => {
    const { slug } = req.query as { slug?: string };
    const business = slug ? store.getBusinessBySlug(slug) : undefined;
    if (!business) return reply.status(404).send({ error: "Negocio no encontrado" });
    const config = oauthConfig();
    if (!config.clientId || !config.clientSecret) {
      return reply.status(500).send({ error: "GOOGLE_CLIENT_ID/SECRET no configurados" });
    }
    return reply.redirect(buildGoogleAuthUrl(config, business.slug));
  });

  app.get("/google/callback", async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) return reply.status(400).send({ error: "code y state requeridos" });
    const business = store.getBusinessBySlug(state);
    if (!business) return reply.status(404).send({ error: "Negocio no encontrado" });
    const tokens = await exchangeGoogleCode(oauthConfig(), code);
    store.saveBusiness({
      ...business,
      calendarId: process.env.GOOGLE_TEST_CALENDAR_ID ?? "primary",
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token ?? business.googleRefreshToken,
    });
    return { ok: true, business: business.slug, calendarId: "primary" };
  });
}
