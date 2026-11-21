// GET /availability?slug=barberia-demo&date=2026-11-21
// Huecos de 1 h entre 10:00 y 18:00 (hora de Ciudad de México), menos lo
// ocupado según freeBusy. Sin Google conectado, devuelve todos los huecos
// con google: "not-configured" (no se inventa disponibilidad).
import type { FastifyInstance } from "fastify";
import { getFreeBusy, overlaps } from "@citasegura/google-calendar";
import type { AppointmentStore } from "../store";

export function availabilityRoutes(app: FastifyInstance, store: AppointmentStore) {
  app.get("/availability", async (req, reply) => {
    const { slug, date } = req.query as { slug?: string; date?: string };
    if (!slug || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({ error: "slug y date=YYYY-MM-DD requeridos" });
    }
    const business = store.getBusinessBySlug(slug);
    if (!business) return reply.status(404).send({ error: "Negocio no encontrado" });
    const services = store.listServices(business.id);
    if (services.length === 0) return reply.status(404).send({ error: "Sin servicios" });
    const service = services[0];

    const slots: string[] = [];
    for (let h = 10; h < 18; h++) {
      slots.push(`${date}T${String(h).padStart(2, "0")}:00:00-06:00`);
    }

    if (!business.googleAccessToken || !business.calendarId) {
      return { business: business.slug, service, date, google: "not-configured", slots };
    }
    const busy = await getFreeBusy(
      business.googleAccessToken,
      business.calendarId,
      `${date}T00:00:00-06:00`,
      `${date}T23:59:59-06:00`,
    );
    const free = slots.filter((start) => {
      const end = new Date(new Date(start).getTime() + service.durationMin * 60_000).toISOString();
      return !overlaps(busy, start, end);
    });
    return { business: business.slug, service, date, google: "connected", slots: free };
  });
}
