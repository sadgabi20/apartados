// GET /businesses/:slug — negocio con su visibilidad de agenda (público,
// solo campos de exhibición: nunca ownerId, email, calendarId ni tokens).
// POST /businesses — crear negocio + primer servicio (Fase 2, onboarding).
// Protegido: ownerId = usuario de la sesión. El slug debe ser único y con
// formato ^[a-z0-9-]+$; la visibilidad es obligatoria, sin default
// silencioso (decisión de Axel §10).
// PATCH /businesses/:slug { agendaVisibility: "public" | "private" } —
// cambia pública/privada. Protegido (Fase 1): solo el dueño del negocio.
// barberia-demo se reclama en el login de su dueño (Fase 3,
// DEMO_OWNER_GOOGLE_SUB); hasta entonces su PATCH da 403 para todos.
import type { FastifyInstance } from "fastify";
import { createBusinessSchema, updateBusinessSchema } from "@apartados/shared";
import { requireAuth, requireBusinessOwner } from "../middleware/auth";
import type { AppointmentStore, BusinessRecord } from "../store";

function publicBusiness(business: BusinessRecord) {
  return {
    id: business.id,
    slug: business.slug,
    name: business.name,
    agendaVisibility: business.agendaVisibility,
  };
}

export function businessRoutes(app: FastifyInstance, store: AppointmentStore) {
  app.get("/businesses/:slug", async (req, reply) => {
    const business = await store.getBusinessBySlug((req.params as { slug: string }).slug);
    if (!business) return reply.status(404).send({ error: "Negocio no encontrado" });
    return { business: publicBusiness(business) };
  });

  app.post("/businesses", { preHandler: requireAuth(store) }, async (req, reply) => {
    const parsed = createBusinessSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { name, slug, agendaVisibility, service } = parsed.data;
    if (await store.getBusinessBySlug(slug)) {
      return reply.status(409).send({ error: "Ese slug ya está en uso, elige otro" });
    }
    const business = await store.createBusiness({
      slug,
      name,
      agendaVisibility,
      ownerId: req.user!.id,
      calendarId: null,
      googleAccessToken: null,
      googleRefreshToken: null,
    });
    const createdService = await store.createService({
      businessId: business.id,
      name: service.name,
      durationMin: service.durationMin,
      depositAmount: service.depositAmount,
    });
    return reply.status(201).send({
      business: publicBusiness(business),
      service: createdService,
    });
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
      await store.saveBusiness(updated);
      return { business: publicBusiness(updated) };
    },
  );
}
