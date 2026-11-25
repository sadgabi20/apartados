// apps/api — Node + Fastify, fuente de verdad.
// Regla: apps/web nunca toca Pey ni Google directo. Solo llama a apps/api.
// La api es la única que crea la cita en espera, genera el QR,
// verifica el webhook y mueve el evento en Google de en espera a confirmada.
//
// Store: con DATABASE_URL configurado, Prisma + Supabase/Postgres
// (store-prisma.ts): los datos sobreviven a reinicios y redeploys.
// Sin DATABASE_URL, store en memoria (dev local): se pierde al reiniciar.
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createMemoryStore } from "./store";
import type { AppointmentStore } from "./store";
import { authRoutes } from "./routes/auth";
import { availabilityRoutes } from "./routes/availability";
import { bookingRoutes } from "./routes/bookings";
import { businessRoutes } from "./routes/businesses";
import { paymentRoutes } from "./routes/payments";
import { peyWebhookRoutes } from "./routes/webhooks/pey";
import { googleRoutes } from "./routes/google";
import { releaseExpiredHolds } from "./services/release-expired";

const app = Fastify({ logger: true });

async function createStore(): Promise<AppointmentStore> {
  if (!process.env.DATABASE_URL) {
    app.log.warn(
      "DATABASE_URL no configurado: store en memoria (citas, sesiones y calendario se pierden al reiniciar). En prod, pon DATABASE_URL en Render (ver docs/deploy-render.md).",
    );
    return createMemoryStore();
  }
  // Import dinámico: sin DATABASE_URL la API no necesita el cliente
  // Prisma generado (ni el query engine de Prisma).
  const { PrismaClient } = await import("@apartados/db");
  const { createPrismaStore } = await import("./store-prisma");
  const prisma = new PrismaClient();
  // createPrismaStore conecta y corre el seed; si la base no responde,
  // el error sube y el proceso falla rápido (mejor que arrancar en
  // memoria sin avisar y perder datos en prod).
  return createPrismaStore(prisma);
}

async function main() {
  const store = await createStore();
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
  async function resolveGoogle(businessId: string) {
    const business = await store.getBusiness(businessId);
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
