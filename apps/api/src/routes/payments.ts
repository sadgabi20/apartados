// POST /payments — genera el QR Pey del anticipo.
// numRef = Appointment.numRef (7 dígitos): es lo que une pago y hueco.
// amount opcional: para la prueba técnica con $0.01 MXN (Pey no tiene
// sandbox). Si se pasa, el anticipo de la cita se actualiza a ese monto
// para que el webhook lo pueda conciliar.
//
// Si el QR falla (Pey 400, timeout), la cita SIGUE en hold y se puede
// reintentar el pago de esa misma cita: el error trae `code`
// ("pey_timeout" | "pey_error") y la cita, para que la web la siga
// mostrando y ofrezca reintentar en vez de dejar una reserva muerta.
// El QR tarda ~3 min en llegar en pruebas reales, así que el timeout
// de Pey es de 240 s por defecto (PEY_TIMEOUT_MS, ver @apartados/pey).
//
// El hold puede vencer mientras se genera el QR (10 min autoservicio):
// si al terminar la cita ya no está en hold, se devuelve 409
// "hold_expired" y NO se muestra un QR de una hora ya liberada.
import type { FastifyInstance } from "fastify";
import { createPeyQr, extractQrPayload, PeyTimeoutError } from "@apartados/pey";
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
      req.log.error(err);
      // ¿La hora se liberó mientras Pey tardaba? Entonces el error no es
      // de Pey: la cita ya no existe como hold y no hay nada que reintentar.
      const fresh = await store.getAppointment(appointment.id);
      if (fresh?.status !== "hold") {
        return reply.status(409).send({
          error: "La hora se liberó mientras se generaba el QR. Aparta otra hora.",
          code: "hold_expired",
        });
      }
      if (err instanceof PeyTimeoutError) {
        return reply.status(503).send({
          error: `Pey tardó demasiado en responder al crear el QR (timeout ${Math.round(err.timeoutMs / 1000)} s). Tu cita sigue apartada, inténtalo de nuevo.`,
          code: "pey_timeout",
          appointment: fresh,
        });
      }
      // Falta de configuración o fallo de Pey: 503 con mensaje visible en la
      // web, no un 500 genérico (la cita sigue en hold y se libera sola).
      const message = err instanceof Error ? err.message : "Error al generar el QR";
      return reply.status(503).send({
        error: `No se pudo generar el QR de pago: ${message}`,
        code: "pey_error",
        appointment: fresh,
      });
    }
    // El QR llegó, pero ¿la hora sigue apartada? Si venció mientras Pey
    // respondía, no se muestra un QR de una hora ya liberada.
    const fresh = await store.getAppointment(appointment.id);
    if (fresh?.status !== "hold") {
      return reply.status(409).send({
        error: "La hora se liberó mientras se generaba el QR. Aparta otra hora.",
        code: "hold_expired",
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
