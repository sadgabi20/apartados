// Cron: borrar eventos en espera vencidos (>10 min sin pago) y liberar el hueco.
// Se ejecuta cada minuto (o se llama desde un endpoint) — sin pago, la
// cita pasa a "released" y el evento de Google se borra. resolveGoogle
// devuelve el contexto de Google del negocio de cada cita (o null si el
// negocio aún no conectó su calendario: entonces solo se libera en base
// de datos y el evento en espera, si lo hay, se borra cuando se conecte).
import { deleteEvent } from "@apartados/google-calendar";
import type { AppointmentStore } from "../store";
import type { GoogleCtx } from "./hold";

export async function releaseExpiredHolds(input: {
  store: AppointmentStore;
  resolveGoogle: (businessId: string) => GoogleCtx | null;
  now?: Date;
}): Promise<string[]> {
  const expired = input.store.listExpiredHolds(input.now ?? new Date());
  const released: string[] = [];
  for (const appt of expired) {
    const google = input.resolveGoogle(appt.businessId);
    if (google && appt.googleEventId) {
      try {
        await deleteEvent(google.accessToken, google.calendarId, appt.googleEventId);
      } catch {
        // Si el evento ya no existe en Google, igual liberamos la cita.
      }
    }
    input.store.updateAppointment(appt.id, { status: "released" });
    released.push(appt.id);
  }
  return released;
}
