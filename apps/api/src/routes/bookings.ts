// POST /bookings — crea la cita en espera (hold).
// source=customer: autoservicio, hold 10 min. source=business: flujo
// manual por WhatsApp (el negocio pone los datos del cliente), hold 60
// min. En agenda privada solo el negocio puede crear citas (403 si no).
// El QR NO se genera aquí: se genera bajo demanda en POST /payments
// cuando el cliente abre /confirmar/[id] y toca pagar, para que los
// 600 s de expiración del QR de Pey no se gasten en WhatsApp.
// GET /appointments/:id — consulta estado (la web lo usa para polling);
// devuelve también negocio y servicio para la página de confirmación.
import type { FastifyInstance } from "fastify";
import { createAppointmentSchema } from "@apartados/shared";
import { GoogleAuthExpiredError } from "@apartados/google-calendar";
import { createHold } from "../services/hold";
import { googleCtxForBusiness } from "../services/google-auth";
import { isOriginAllowed, resolveOptionalAuth } from "../middleware/auth";
import type { AppointmentStore } from "../store";

export function bookingRoutes(app: FastifyInstance, store: AppointmentStore) {
  app.post("/bookings", { preHandler: resolveOptionalAuth(store) }, async (req, reply) => {
    const parsed = createAppointmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { businessId, serviceId, startAt, customerName, customerPhone, source } =
      parsed.data;
    const business = await store.getBusiness(businessId);
    const service = await store.getService(serviceId);
    if (!business || !service) {
      return reply.status(404).send({ error: "Negocio o servicio no encontrado" });
    }
    if (source === "business") {
      // Cita manual (Fase 2): solo el dueño del businessId puede crearla.
      // El body no autoriza: lo decide la sesión. Sin sesión del dueño,
      // 403 aunque la agenda sea pública.
      if (!req.user || business.ownerId !== req.user.id) {
        return reply.status(403).send({
          error: "Solo el dueño del negocio puede apartar citas manuales",
        });
      }
      // Mutación autenticada: segunda barrera anti-CSRF además de SameSite.
      if (!isOriginAllowed(req)) {
        return reply.status(403).send({ error: "Origen no permitido" });
      }
    }
    if (business.agendaVisibility === "private" && source !== "business") {
      return reply.status(403).send({
        error: "Agenda privada: solo el negocio puede apartar citas",
        visibility: "private",
      });
    }
    const google = googleCtxForBusiness(store, business);
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
        holdMinutes: source === "business" ? 60 : 10,
      });
      return reply.status(201).send({ appointment });
    } catch (err) {
      if ((err as Error).message === "SLOT_TAKEN") {
        return reply.status(409).send({ error: "Esa hora ya está ocupada, elige otra" });
      }
      if (err instanceof GoogleAuthExpiredError) {
        return reply.status(503).send({
          error:
            "El calendario del negocio necesita reconectarse: el acceso de Google caducó. Pídele al negocio que vuelva a conectar su Google Calendar.",
          code: "google_auth_expired",
        });
      }
      throw err;
    }
  });

  app.get("/appointments/:id", async (req, reply) => {
    const appointment = await store.getAppointment((req.params as { id: string }).id);
    if (!appointment) return reply.status(404).send({ error: "Cita no encontrada" });
    const business = await store.getBusiness(appointment.businessId);
    const service = await store.getService(appointment.serviceId);
    return {
      appointment,
      business: business
        ? {
            id: business.id,
            slug: business.slug,
            name: business.name,
            agendaVisibility: business.agendaVisibility,
          }
        : null,
      service: service
        ? {
            id: service.id,
            name: service.name,
            durationMin: service.durationMin,
            depositAmount: service.depositAmount,
          }
        : null,
    };
  });
}
