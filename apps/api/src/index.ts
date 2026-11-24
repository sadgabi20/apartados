// apps/api — Node + Fastify, fuente de verdad.
// Regla: apps/web nunca toca Pey ni Google directo. Solo llama a apps/api.
// La api es la única que crea la cita en espera, genera el QR,
// verifica el webhook y mueve el evento en Google de en espera a confirmada.
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createMemoryStore } from "./store";
import { authRoutes } from "./routes/auth";
import { availabilityRoutes } from "./routes/availability";
import { bookingRoutes } from "./routes/bookings";
import { businessRoutes } from "./routes/businesses";
import { paymentRoutes } from "./routes/payments";
import { peyWebhookRoutes } from "./routes/webhooks/pey";
import { googleRoutes } from "./routes/google";
import { releaseExpiredHolds } from "./services/release-expired";

const app = Fastify({ logger: true });
const store = createMemoryStore();

async function main() {
  // CORS: la web (otro origen/puerto) llama a esta API desde el navegador.
  // Sin esto el navegador bloquea todos los fetch y el preflight OPTIONS
  // da 404. Orígenes permitidos por env, separados por coma; por defecto
  // solo el dev local. En prod, poner la URL de la web (p. ej. Vercel).
  // El register se espera antes de definir rutas para que sus hooks
  // apliquen a todas (sin top-level await: este proyecto corre como CJS).
  const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  // credentials: true — la cookie de sesión (httpOnly) tiene que viajar
  // cross-origin en prod (web en Vercel, API en otro dominio). Orígenes
  // explícitos, nunca "*".
  await app.register(cors, { origin: corsOrigins, credentials: true });

  // El webhook de Pey se verifica sobre el cuerpo crudo: guardarlo antes
  // de parsear. Sin esto, la firma nunca cuadra.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.get("/health", async () => ({ ok: true }));
  authRoutes(app, store);
  availabilityRoutes(app, store);
  bookingRoutes(app, store);
  businessRoutes(app, store);
  paymentRoutes(app, store);
  peyWebhookRoutes(app, store);
  googleRoutes(app, store);

  // Liberar holds vencidos: endpoint para cron + intervalo en proceso.
  function resolveGoogle(businessId: string) {
    const business = store.getBusiness(businessId);
    return business?.googleAccessToken && business.calendarId
      ? { accessToken: business.googleAccessToken, calendarId: business.calendarId }
      : null;
  }
  app.post("/release-expired", async () => {
    const released = await releaseExpiredHolds({ store, resolveGoogle });
    return { released };
  });
  setInterval(() => {
    void releaseExpiredHolds({ store, resolveGoogle }).catch((err) =>
      app.log.error(err),
    );
  }, 60_000).unref();

  // Puerto y host para producción (Render): Render inyecta PORT y exige
  // escuchar en 0.0.0.0; si no, el servicio nunca recibe tráfico y Render
  // lo marca como fallido. En local sigue valiendo API_PORT (default 3001).
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
