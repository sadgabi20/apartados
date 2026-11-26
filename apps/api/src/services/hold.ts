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
