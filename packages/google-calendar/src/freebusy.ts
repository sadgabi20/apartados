// POST https://www.googleapis.com/calendar/v3/freeBusy
// Ventana + lista de calendarios -> intervalos busy por calendario.
// freeBusy es una foto, no una reserva atómica: volver a consultar justo
// antes de events.insert y, si ya está ocupado, no generar el cobro.
// Si freeBusy devuelve errors para un calendario, fallar cerrado.
export interface BusyInterval {
  start: string;
  end: string;
}

interface FreeBusyResponse {
  calendars?: Record<
    string,
    { busy?: BusyInterval[]; errors?: Array<{ domain: string; reason: string }> }
  >;
}

import { googleApiBaseUrl, timedFetch } from "./timeout";

export async function getFreeBusy(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<BusyInterval[]> {
  const res = await timedFetch(
    `${googleApiBaseUrl()}/calendar/v3/freeBusy`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: [{ id: calendarId }],
      }),
    },
    "freeBusy",
  );
  if (!res.ok) {
    throw new Error(`Google freeBusy failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as FreeBusyResponse;
  const calendar = data.calendars?.[calendarId];
  if (!calendar) throw new Error(`freeBusy sin datos para ${calendarId}`);
  if (calendar.errors?.length) {
    // Fallar cerrado: un calendario con error no se muestra como libre.
    throw new Error(
      `freeBusy error en ${calendarId}: ${calendar.errors.map((e) => e.reason).join(", ")}`,
    );
  }
  return calendar.busy ?? [];
}

export function overlaps(
  busy: BusyInterval[],
  start: string,
  end: string,
): boolean {
  // Comparar como fechas, no como texto: los intervalos pueden venir con
  // zonas distintas ("-06:00" vs "Z") y la comparación lexicográfica falla.
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return busy.some(
    (b) => s < new Date(b.end).getTime() && e > new Date(b.start).getTime(),
  );
}
