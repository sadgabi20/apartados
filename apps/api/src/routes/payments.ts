// POST /payments — genera el QR Pey del anticipo.
// numRef = Appointment.numRef (7 dígitos): es lo que une pago y hueco.
// amount opcional: para la prueba técnica con $0.01 MXN (Pey no tiene
// sandbox). Si se pasa, el anticipo de la cita se actualiza a ese monto
// para que el webhook lo pueda conciliar.
import type { FastifyInstance } from "fastify";
import { createPeyQr, extractQrPayload } from "@apartados/pey";
import { createChargeSchema } from "@apartados/shared";
import type { AppointmentStore } from "../store";

export function paymentRoutes(app: FastifyInstance, store: AppointmentStore) {
  app.post("/payments", async (req, reply) => {
    const body = req.body as { appointmentId?: string; amount?: number };
    if (!body?.appointmentId) {
      return reply.status(400).send({ error: "appointmentId requerido" });
    }
    const appointment = await store.getAppointment(body.appointmentId);
    if (!appointment) return reply.status(404).send({ error: "Cita no encontrada" });
    if (appointment.status !== "hold") {
      return reply.status(409).send({ error: `La cita está ${appointment.status}, no en espera` });
    }
    const amount = body.amount ?? appointment.depositAmount;
    const parsed = createChargeSchema.safeParse({
      amount,
      concept: `Anticipo cita ${appointment.startAt}`,
      expiration: 600,
      numRef: appointment.numRef,
    });
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    let qr;
    try {
      qr = await createPeyQr(parsed.data);
    } catch (err) {
      // Falta de configuración o fallo de Pey: 503 con mensaje visible en la
      // web, no un 500 genérico (la cita sigue en hold y se libera sola).
      req.log.error(err);
      const message = err instanceof Error ? err.message : "Error al generar el QR";
      return reply.status(503).send({
        error: `No se pudo generar el QR de pago: ${message}`,
      });
    }
    const updated = await store.updateAppointment(appointment.id, {
      depositAmount: amount,
      peyQrId: typeof qr.codiQrId === "string" ? qr.codiQrId : null,
    });
    return reply.status(201).send({
      appointment: updated,
      qr,
      qrPayload: extractQrPayload(qr),
    });
  });
}
