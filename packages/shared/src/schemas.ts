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

// CLABE (18 dígitos): el dígito 18 es verificador. Pesos 3-7-1 repetidos
// sobre los primeros 17 dígitos; cada producto se toma módulo 10 y el
// verificador es (10 - suma % 10) % 10. Pey también lo valida en su API
// (400 INVALID_CLABE) y además exige que el banco tenga CoDi habilitado,
// pero validar aquí evita un viaje a Pey con una CLABE mal escrita.
// La web usa el mismo algoritmo (apps/web/components/bank-account-section.tsx):
// la web no depende de @apartados/shared, así que va duplicado a propósito.
export function isValidClabe(clabe: string): boolean {
  if (!/^[0-9]{18}$/.test(clabe)) return false;
  const weights = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += (Number(clabe[i]) * weights[i % 3]) % 10;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(clabe[17]);
}

// Cuenta de pagos del negocio (Pey): POST /bank-account en el OpenAPI
// oficial de Pey (CoDi API v2026-10-20, re-confirmado 2026-11-26).
// Campos: alias, name (nombre legal del titular), clabe (18 dígitos),
// entity (BUSINESS = persona moral, PERSON = persona física) y taxId
// opcional (RFC: 12 caracteres moral, 13 física). La CLABE completa se
// manda una vez a Pey y NUNCA se guarda en Apartados: solo se conserva
// el id de Pey + los últimos 4 dígitos (ver PeyBankAccount).
export const registerBankAccountSchema = z.object({
  alias: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  clabe: z
    .string()
    .regex(/^[0-9]{18}$/, "la CLABE debe tener 18 dígitos")
    .refine(isValidClabe, "CLABE inválida: revisa los 18 dígitos"),
  entity: z.enum(["BUSINESS", "PERSON"]),
  taxId: z
    .string()
    .regex(/^[A-Za-z0-9]{12,13}$/, "el RFC debe tener 12 o 13 caracteres")
    .optional(),
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
