// GET /businesses/:slug — negocio con su visibilidad de agenda (público,
// solo campos de exhibición: nunca ownerId, email, calendarId ni tokens).
// PATCH /businesses/:slug { agendaVisibility: "public" | "private" } —
// cambia pública/privada. Protegido (Fase 1): solo el dueño del negocio.
// barberia-demo no tiene dueño hasta la Fase 3, así que su PATCH da 403
// para todo el mundo hasta entonces.
import type { FastifyInstance } from "fastify";
import { updateBusinessSchema } from "@apartados/shared";
import { requireAuth, requireBusinessOwner } from "../middleware/auth";
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

  app.patch(
    "/businesses/:slug",
    { preHandler: [requireAuth(store), requireBusinessOwner(store)] },
    async (req, reply) => {
      const parsed = updateBusinessSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      // requireBusinessOwner ya cargó el negocio y verificó la propiedad.
      const business = req.business!;
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
    },
  );
}
