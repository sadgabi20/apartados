// GET /businesses/:slug — negocio con su visibilidad de agenda.
// PATCH /businesses/:slug { agendaVisibility: "public" | "private" } —
// cambia pública/privada. Sin auth todavía (demo): el toggle vive en
// /negocio/[slug] y cualquier visita a esa página puede cambiarlo;
// cuando haya login de negocio, este endpoint debe exigirlo.
import type { FastifyInstance } from "fastify";
import { updateBusinessSchema } from "@apartados/shared";
import type { AppointmentStore } from "../store";

export function businessRoutes(app: FastifyInstance, store: AppointmentStore) {
  app.get("/businesses/:slug", async (req, reply) => {
    const business = store.getBusinessBySlug((req.params as { slug: string }).slug);
    if (!business) return reply.status(404).send({ error: "Negocio no encontrado" });
    return {
      business: {
        id: business.id,
        slug: business.slug,
        name: business.name,
        agendaVisibility: business.agendaVisibility,
      },
    };
  });

  app.patch("/businesses/:slug", async (req, reply) => {
    const parsed = updateBusinessSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const business = store.getBusinessBySlug((req.params as { slug: string }).slug);
    if (!business) return reply.status(404).send({ error: "Negocio no encontrado" });
    const updated = { ...business, agendaVisibility: parsed.data.agendaVisibility };
    store.saveBusiness(updated);
    return {
      business: {
        id: updated.id,
        slug: updated.slug,
        name: updated.name,
        agendaVisibility: updated.agendaVisibility,
      },
    };
  });
}
