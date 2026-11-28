// Apartar hueco y liberar si no paga. holdMinutes: 10 por defecto
// (autoservicio) o 60 cuando la cita la crea el negocio (flujo manual
// por WhatsApp: el cliente no está delante en ese momento).
// Al elegir hueco: re-consultar freeBusy, crear evento en espera en
// Google + registrar la cita en hold. El cobro Pey se crea aparte
// (routes/payments.ts) con numRef = cita-numRef (7 dígitos).
// Si Google aún no está conectado (google = null), la cita se aparta
// solo en base de datos y googleEventId queda null: así el sábado puede
// avanzar el flujo de Pey aunque el OAuth de Google se atore.
import { getFreeBusy, overlaps, createHoldEvent, type RefreshAccessToken } from "@apartados/google-calendar";
import type { AppointmentRecord, AppointmentStore } from "../store";

export interface GoogleCtx {
  accessToken: string;
  calendarId: string;
  // Renovar el access token si una llamada da 401 (dura 1 hora).
  // Lo construye googleCtxForBusiness (services/google-auth.ts).
  refreshAccessToken?: RefreshAccessToken;
}

// Una cita guardada bloquea el hueco [startAt, endAt) si está en hold
// vigente o confirmada. released/cancelled nunca bloquean; un hold
// vencido tampoco (lo libera release-expired, pero aunque el cron no
// haya corrido todavía, el hueco ya no es suyo: expiresAt manda).
// El solape es de intervalo semiabierto: una cita que termina a las
// 11:00 no bloquea el hueco de las 11:00.
export function appointmentBlocksSlot(
  a: AppointmentRecord,
  startAt: string,
  endAt: string,
  now: Date = new Date(),
): boolean {
  if (a.status !== "hold" && a.status !== "confirmed") return false;
  if (a.status === "hold" && new Date(a.expiresAt).getTime() <= now.getTime()) return false;
  const s = new Date(startAt).getTime();
  const e = new Date(endAt).getTime();
  return s < new Date(a.endAt).getTime() && e > new Date(a.startAt).getTime();
}

// ¿Alguna cita guardada del negocio solapa [startAt, endAt)?
// Respaldo en base de datos para cuando no hay freeBusy que consultar
// (o como segunda barrera cuando sí lo hay).
export async function hasStoredOverlap(
  store: AppointmentStore,
  businessId: string,
  startAt: string,
  endAt: string,
  now: Date = new Date(),
): Promise<boolean> {
  const list = await store.listAppointmentsByBusiness(businessId);
  return list.some((a) => appointmentBlocksSlot(a, startAt, endAt, now));
}

export async function createHold(input: {
  store: AppointmentStore;
  google: GoogleCtx | null;
  businessId: string;
  serviceId: string;
  serviceName: string;
  durationMin: number;
  depositAmount: number;
  startAt: string; // ISO
  customerName: string;
  customerPhone: string;
  holdMinutes?: number;
}): Promise<AppointmentRecord> {
  const start = new Date(input.startAt);
  const end = new Date(start.getTime() + input.durationMin * 60_000);
  // Normalizar a ISO Z: la reserva puede llegar con -06:00 (de
  // /availability) o con Z; se guarda siempre en el mismo formato.
  const startAt = start.toISOString();
  const endAt = end.toISOString();

  // Respaldo en base de datos, con o sin Google: dos citas del mismo
  // negocio no pueden solaparse. Sin Google no hay freeBusy que
  // consultar; con Google, esto cubre huecos apartados sin evento
  // (p. ej. creados mientras el calendario estaba desconectado).
  // Mismo error que el camino de Google (la ruta responde 409).
  if (await hasStoredOverlap(input.store, input.businessId, startAt, endAt)) {
    throw new Error("SLOT_TAKEN");
  }

  let googleEventId: string | null = null;
  if (input.google) {
    const busy = await getFreeBusy(
      input.google.accessToken,
      input.google.calendarId,
      startAt,
      endAt,
      { refreshAccessToken: input.google.refreshAccessToken },
    );
    if (overlaps(busy, startAt, endAt)) {
      throw new Error("SLOT_TAKEN");
    }
    googleEventId = await createHoldEvent(
      input.google.accessToken,
      input.google.calendarId,
      {
        startAt,
        endAt,
        serviceName: input.serviceName,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
      },
      { refreshAccessToken: input.google.refreshAccessToken },
    );
  }

  const expiresAt = new Date(
    Date.now() + (input.holdMinutes ?? 10) * 60_000,
  ).toISOString();
  return await input.store.createAppointment({
    businessId: input.businessId,
    serviceId: input.serviceId,
    startAt,
    endAt,
    status: "hold",
    depositAmount: input.depositAmount,
    googleEventId,
    peyQrId: null,
    transactionId: null,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    expiresAt,
  });
}
