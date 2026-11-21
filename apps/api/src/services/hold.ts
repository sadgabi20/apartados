// Apartar hueco 10 min, liberar si no paga.
// Al elegir hueco: re-consultar freeBusy, crear evento en espera en
// Google + registrar la cita en hold. El cobro Pey se crea aparte
// (routes/payments.ts) con numRef = cita-id.
// Si Google aún no está conectado (google = null), la cita se aparta
// solo en base de datos y googleEventId queda null: así el sábado puede
// avanzar el flujo de Pey aunque el OAuth de Google se atore.
import { getFreeBusy, overlaps, createHoldEvent } from "@apartados/google-calendar";
import type { AppointmentRecord, AppointmentStore } from "../store";

export interface GoogleCtx {
  accessToken: string;
  calendarId: string;
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
    );
  }

  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  return input.store.createAppointment({
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
