// POST /webhooks/pey — verificar firma v1 antes de confirmar nada.
// Flujo: webhook pagado -> confirm.ts mueve el evento de Google a confirmado.
// Idempotencia: si el webhook llega dos veces, no duplicar la confirmación.
// La firma se verifica sobre el cuerpo CRUDO (req.rawBody): nunca sobre
// el JSON re-serializado, o la firma no cuadra.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyPeyWebhookSignature } from "@apartados/pey";
import { GoogleAuthExpiredError } from "@apartados/google-calendar";
import { peyWebhookSchema } from "@apartados/shared";
import { confirmAppointment } from "../../services/confirm";
import { googleCtxForBusiness } from "../../services/google-auth";
import type { AppointmentStore } from "../../store";

type RawBodyRequest = FastifyRequest & { rawBody?: string };

export function peyWebhookRoutes(app: FastifyInstance, store: AppointmentStore) {
  app.post("/webhooks/pey", async (req, reply) => {
    const rawBody = (req as RawBodyRequest).rawBody ?? "";
    const signature = req.headers["webhook-signature"] as string | undefined;
    const webhookId = req.headers["webhook-id"] as string | undefined;
    const webhookTimestamp = req.headers["webhook-timestamp"] as
      | string
      | undefined;
    if (
      !verifyPeyWebhookSignature(
        signature,
        rawBody,
        undefined,
        webhookId,
        webhookTimestamp,
      )
    ) {
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
    const appointment = await store.getAppointmentByNumRef(event.numRef);
    if (!appointment) return reply.status(404).send({ error: "Cita no encontrada" });
    if (event.amount !== appointment.depositAmount) {
      app.log.warn(
        `Monto del webhook (${event.amount}) distinto al anticipo (${appointment.depositAmount})`,
      );
      return reply.status(400).send({ error: "Monto distinto al anticipo" });
    }
    const business = await store.getBusiness(appointment.businessId);
    const service = await store.getService(appointment.serviceId);
    const google = business ? googleCtxForBusiness(store, business) : null;
    let confirmed;
    try {
      confirmed = await confirmAppointment({
        store,
        google,
        appointment,
        serviceName: service?.name ?? "Servicio",
        transactionId: event.transactionId ?? "",
      });
    } catch (err) {
      // El pago YA entró: si el calendario no se pudo renovar, la cita
      // se confirma igual en base de datos (el evento queda en espera
      // en Google y el hueco sigue bloqueado por él). No se contesta
      // 500: Pey reintentaría el webhook y fallaría igual hasta agotar
      // sus reintentos, y el cliente pagado se quedaría sin cita.
      if (!(err instanceof GoogleAuthExpiredError)) throw err;
      app.log.warn(
        `Webhook Pey ${event.transactionId}: pago registrado pero el calendario no se pudo actualizar (token caducado, negocio ${business?.slug} debe reconectar)`,
      );
      confirmed = await store.updateAppointment(appointment.id, {
        status: "confirmed",
        transactionId: event.transactionId ?? "",
      });
      return { ok: true, appointment: confirmed, calendar: "auth-expired" };
    }
    return { ok: true, appointment: confirmed };
  });
}
