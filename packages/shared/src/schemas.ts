import { z } from "zod";

export const createAppointmentSchema = z.object({
  businessId: z.string(),
  serviceId: z.string(),
  // offset: true — /availability devuelve huecos con -06:00 y la web los
  // manda tal cual; sin esto, .datetime() solo acepta Z y la reserva fallaba.
  startAt: z.string().datetime({ offset: true }),
  customerName: z.string().min(1),
  customerPhone: z.string().min(1),
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
