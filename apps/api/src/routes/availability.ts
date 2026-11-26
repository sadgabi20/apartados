// GET /availability?slug=barberia-demo&date=2026-11-21
// Huecos de 1 h entre 10:00 y 18:00 (hora de Ciudad de México), menos lo
// ocupado según freeBusy. Sin Google conectado, devuelve todos los huecos
// con google: "not-configured" (no se inventa disponibilidad).
// Agenda privada: solo el dueño (sesión) ve los huecos. El query param
// ?actor=business YA NO autoriza por sí solo (Fase 2): antes cualquiera
// podía pasarlo y saltarse la agenda privada; ahora lo decide la sesión
// y el param se ignora.
import type { FastifyInstance } from "fastify";
import { getFreeBusy, GoogleAuthExpiredError, overlaps } from "@apartados/google-calendar";
import { resolveOptionalAuth } from "../middleware/auth";
import { makeRefreshAccessToken } from "../services/google-auth";
import type { AppointmentStore } from "../store";

export function availabilityRoutes(app: FastifyInstance, store: AppointmentStore) {
  app.get("/availability", { preHandler: resolveOptionalAuth(store) }, async (req, reply) => {
    const { slug, date } = req.query as {
      slug?: string;
      date?: string;
    };
    if (!slug || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({ error: "slug y date=YYYY-MM-DD requeridos" });
    }
    const business = await store.getBusinessBySlug(slug);
    if (!business) return reply.status(404).send({ error: "Negocio no encontrado" });
    const isOwner = !!req.user && business.ownerId === req.user.id;
    if (business.agendaVisibility === "private" && !isOwner) {
      return reply.status(403).send({
        error: "Agenda privada: contacta al negocio para apartar tu cita",
        visibility: "private",
      });
    }
    const services = await store.listServices(business.id);
    if (services.length === 0) return reply.status(404).send({ error: "Sin servicios" });
    const service = services[0];

    const slots: string[] = [];
    for (let h = 10; h < 18; h++) {
      slots.push(`${date}T${String(h).padStart(2, "0")}:00:00-06:00`);
    }

    if (!business.googleAccessToken || !business.calendarId) {
      return {
        business: business.slug,
        visibility: business.agendaVisibility,
        service,
        date,
        google: "not-configured",
        slots,
      };
    }
    let busy;
    try {
      busy = await getFreeBusy(
        business.googleAccessToken,
        business.calendarId,
        `${date}T00:00:00-06:00`,
        `${date}T23:59:59-06:00`,
        { refreshAccessToken: makeRefreshAccessToken(store, business.id) },
      );
    } catch (err) {
      // El access token caducó y el refresh no pudo renovarlo: error
      // claro de reconexión (503), no un 500 genérico. La web lo
      // muestra tal cual en vez de "Internal Server Error".
      if (err instanceof GoogleAuthExpiredError) {
        return reply.status(503).send({
          error:
            "El calendario del negocio necesita reconectarse: el acceso de Google caducó. Pídele al negocio que vuelva a conectar su Google Calendar.",
          code: "google_auth_expired",
          google: "auth-expired",
        });
      }
      throw err;
    }
    const free = slots.filter((start) => {
      const end = new Date(new Date(start).getTime() + service.durationMin * 60_000).toISOString();
      return !overlaps(busy, start, end);
    });
    return {
      business: business.slug,
      visibility: business.agendaVisibility,
      service,
      date,
      google: "connected",
      slots: free,
    };
  });
}
