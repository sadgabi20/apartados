import { z } from "zod";

export const createAppointmentSchema = z.object({
  businessId: z.string(),
  serviceId: z.string(),
  // offset: true — /availability devuelve huecos con -06:00 y la web los
  // manda tal cual; sin esto, .datetime() solo acepta Z y la reserva fallaba.
  startAt: z.string().datetime({ offset: true }),
  customerName: z.string().min(1),
  customerPhone: z.string().min(1),
  // Quién crea la cita: el cliente (autoservicio, hold 10 min) o el
  // negocio (flujo manual por WhatsApp, hold 60 min).
  source: z.enum(["customer", "business"]).optional().default("customer"),
});

export const updateBusinessSchema = z.object({
  agendaVisibility: z.enum(["public", "private"]),
});

// Auth Fase 2 — crear negocio + primer servicio (POST /businesses).
// agendaVisibility es OBLIGATORIA, sin default: al crear un negocio se
// pregunta siempre si la agenda es pública o privada (decisión de Axel §10).
// slug: minúsculas, números y guiones; único (la API responde 409 si existe).
export const createBusinessSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(60),
  agendaVisibility: z.enum(["public", "private"]),
  service: z.object({
    name: z.string().min(1).max(100),
    durationMin: z.number().int().min(15).max(480),
    depositAmount: z.number().int().min(0).max(100000),
  }),
});

export const createChargeSchema = z.object({
  amount: z.number().positive(),
  concept: z.string(),
  expiration: z.literal(600),
  numRef: z.string(), // = Appointment.numRef (numérico, máx. 7 dígitos)
});

export const peyWebhookSchema = z.object({
  type: z.string(),
  amount: z.number(),
  numRef: z.string(),
  transactionId: z.string().optional(),
  codiQrId: z.string().optional(),
  // docs.pey.mx muestra datePaid como unix seconds (p. ej. 1790724818).
  datePaid: z.number().optional(),
  apiKeyId: z.string().optional(),
  concept: z.string().optional(),
});
