// Webhook -> evento de Google a confirmado.
// Idempotente: si la cita ya está confirmada (webhook duplicado), no se
// vuelve a tocar Google ni se duplica nada; se devuelve la cita tal cual.
import { confirmEvent } from "@apartados/google-calendar";
import type { AppointmentRecord, AppointmentStore } from "../store";
import type { GoogleCtx } from "./hold";

export async function confirmAppointment(input: {
  store: AppointmentStore;
  google: GoogleCtx | null;
  appointment: AppointmentRecord;
  serviceName: string;
  transactionId: string;
}): Promise<AppointmentRecord> {
  const { store, appointment } = input;
  if (appointment.status === "confirmed") return appointment;
  if (appointment.status !== "hold") {
    throw new Error(`No se puede confirmar una cita en estado ${appointment.status}`);
  }
  if (input.google && appointment.googleEventId) {
    await confirmEvent(
      input.google.accessToken,
      input.google.calendarId,
      appointment.googleEventId,
      {
        serviceName: input.serviceName,
        customerName: appointment.customerName,
        depositAmount: appointment.depositAmount,
      },
      { refreshAccessToken: input.google.refreshAccessToken },
    );
  }
  const updated = await store.updateAppointment(appointment.id, {
    status: "confirmed",
    transactionId: input.transactionId,
  });
  return updated as AppointmentRecord;
}
