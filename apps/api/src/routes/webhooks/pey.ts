// POST /webhooks/pey — verificar firma v1 antes de confirmar nada.
// Flujo: webhook pagado -> confirm.ts mueve el evento de Google a confirmado.
// Idempotencia: si el webhook llega dos veces, no duplicar la confirmación.
// La firma se verifica sobre el cuerpo CRUDO (req.rawBody): nunca sobre
// el JSON re-serializado, o la firma no cuadra.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyPeyWebhookSignature } from "@apartados/pey";
import { peyWebhookSchema } from "@apartados/shared";
import { confirmAppointment } from "../../services/confirm";
import type { AppointmentStore } from "../../store";

type RawBodyRequest = FastifyRequest & { rawBody?: string };

export function peyWebhookRoutes(app: FastifyInstance, store: AppointmentStore) {
  app.post("/webhooks/pey", async (req, reply) => {
    const rawBody = (req as RawBodyRequest).rawBody ?? "";
    const signature = req.headers["webhook-signature"] as string | undefined;
    if (!verifyPeyWebhookSignature(signature, rawBody)) {
      app.log.warn("Webhook Pey con firma inválida o sin secreto configurado");
      return reply.status(401).send({ error: "Firma inválida" });
    }
    const parsed = peyWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const event = parsed.data;
    if (event.type !== "codi.qr.payment_received") {
      return { ok: true, ignored: event.type };
    }
    const appointment = store.getAppointment(event.numRef);
    if (!appointment) return reply.status(404).send({ error: "Cita no encontrada" });
    if (event.amount !== appointment.depositAmount) {
      app.log.warn(
        `Monto del webhook (${event.amount}) distinto al anticipo (${appointment.depositAmount})`,
      );
      return reply.status(400).send({ error: "Monto distinto al anticipo" });
    }
    const business = store.getBusiness(appointment.businessId);
    const service = store.getService(appointment.serviceId);
    const google =
      business?.googleAccessToken && business.calendarId
        ? { accessToken: business.googleAccessToken, calendarId: business.calendarId }
        : null;
    const confirmed = await confirmAppointment({
      store,
      google,
      appointment,
      serviceName: service?.name ?? "Servicio",
      transactionId: event.transactionId ?? "",
    });
    return { ok: true, appointment: confirmed };
  });
}
