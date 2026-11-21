// POST /bookings — crea la cita en espera (hold 10 min).
// GET /appointments/:id — consulta estado (la web lo usa para polling).
import type { FastifyInstance } from "fastify";
import { createAppointmentSchema } from "@apartados/shared";
import { createHold } from "../services/hold";
import type { AppointmentStore } from "../store";

export function bookingRoutes(app: FastifyInstance, store: AppointmentStore) {
  app.post("/bookings", async (req, reply) => {
    const parsed = createAppointmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { businessId, serviceId, startAt, customerName, customerPhone } = parsed.data;
    const business = store.getBusiness(businessId);
    const service = store.getService(serviceId);
    if (!business || !service) {
      return reply.status(404).send({ error: "Negocio o servicio no encontrado" });
    }
    const google =
      business.googleAccessToken && business.calendarId
        ? { accessToken: business.googleAccessToken, calendarId: business.calendarId }
        : null;
    try {
      const appointment = await createHold({
        store,
        google,
        businessId,
        serviceId,
        serviceName: service.name,
        durationMin: service.durationMin,
        depositAmount: service.depositAmount,
        startAt,
        customerName,
        customerPhone,
      });
      return reply.status(201).send({ appointment });
    } catch (err) {
      if ((err as Error).message === "SLOT_TAKEN") {
        return reply.status(409).send({ error: "Esa hora ya está ocupada, elige otra" });
      }
      throw err;
    }
  });

  app.get("/appointments/:id", async (req, reply) => {
    const appointment = store.getAppointment((req.params as { id: string }).id);
    if (!appointment) return reply.status(404).send({ error: "Cita no encontrada" });
    return { appointment };
  });
}
