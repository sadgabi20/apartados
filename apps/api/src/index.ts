// apps/api — Node + Fastify, fuente de verdad.
// Regla: apps/web nunca toca Pey ni Google directo. Solo llama a apps/api.
// La api es la única que crea la cita en espera, genera el QR,
// verifica el webhook y mueve el evento en Google de en espera a confirmada.
import Fastify from "fastify";
import { createMemoryStore } from "./store";
import { availabilityRoutes } from "./routes/availability";
import { bookingRoutes } from "./routes/bookings";
import { paymentRoutes } from "./routes/payments";
import { peyWebhookRoutes } from "./routes/webhooks/pey";
import { googleRoutes } from "./routes/google";
import { releaseExpiredHolds } from "./services/release-expired";

const app = Fastify({ logger: true });
const store = createMemoryStore();

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
availabilityRoutes(app, store);
bookingRoutes(app, store);
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

const port = Number(process.env.API_PORT ?? 3001);
app.listen({ port }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
