// events.insert / delete / patch — Google Calendar API v3
// Al elegir hueco: crear de inmediato un evento en espera, así freeBusy
// ya lo ve ocupado. Webhook pagado -> evento a confirmado.
// Sin pago en 10 min -> borrar el evento y liberar el hueco.
import { googleApiBaseUrl, timedFetch } from "./timeout";
import { GoogleApiError } from "./errors";
import { withGoogleAuthRetry, type RefreshAccessToken } from "./auth-retry";

const BASE = `${googleApiBaseUrl()}/calendar/v3/calendars`;

async function googleFetch(
  accessToken: string,
  path: string,
  method: string,
  body?: unknown,
  refreshAccessToken?: RefreshAccessToken,
): Promise<Record<string, unknown>> {
  return withGoogleAuthRetry(accessToken, refreshAccessToken, async (token) => {
    const res = await timedFetch(
      `${BASE}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      `Calendar ${method}`,
    );
    if (!res.ok) {
      throw new GoogleApiError(
        res.status,
        `Google Calendar ${method} failed: ${res.status} ${await res.text()}`,
      );
    }
    if (res.status === 204) return {};
    return (await res.json()) as Record<string, unknown>;
  });
}

export interface HoldEventInput {
  startAt: string; // ISO con zona, p. ej. 2026-11-21T11:00:00-06:00
  endAt: string;
  serviceName: string;
  customerName: string;
  customerPhone: string;
}

export async function createHoldEvent(
  accessToken: string,
  calendarId: string,
  input: HoldEventInput,
  opts?: { refreshAccessToken?: RefreshAccessToken },
): Promise<string> {
  const event = await googleFetch(
    accessToken,
    `/${encodeURIComponent(calendarId)}/events`,
    "POST",
    {
      summary: `Cita en espera de anticipo — ${input.serviceName}`,
      description:
        `Cliente: ${input.customerName} (${input.customerPhone}). ` +
        `Anticipo pendiente: si no se paga en 10 minutos, la hora se libera sola.`,
      start: { dateTime: input.startAt },
      end: { dateTime: input.endAt },
      status: "tentative",
    },
    opts?.refreshAccessToken,
  );
  if (typeof event.id !== "string") throw new Error("events.insert sin id");
  return event.id;
}

export async function confirmEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  input: { serviceName: string; customerName: string; depositAmount: number },
  opts?: { refreshAccessToken?: RefreshAccessToken },
): Promise<void> {
  await googleFetch(
    accessToken,
    `/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    "PATCH",
    {
      summary: `Cita confirmada — ${input.serviceName} — ${input.customerName}`,
      description: `Anticipo pagado con CoDi: $${input.depositAmount} MXN.`,
      status: "confirmed",
    },
    opts?.refreshAccessToken,
  );
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  opts?: { refreshAccessToken?: RefreshAccessToken },
): Promise<void> {
  await googleFetch(
    accessToken,
    `/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    "DELETE",
    undefined,
    opts?.refreshAccessToken,
  );
}
