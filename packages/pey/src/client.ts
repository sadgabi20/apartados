// Cliente Pey, aislado. Verificado en docs.pey.mx el 21 nov 2026.
// Crear cobro: POST https://api.pey.mx/codi/qr  (201 = creado)
// No hay sandbox todavía: pruebas en producción con montos pequeños ($0.01 MXN).
// La forma exacta de la respuesta del QR no está documentada en la
// página principal de docs.pey.mx: se devuelve el JSON tal cual y la
// web muestra los campos que traiga (qr / qrText / image / url).
//
// Timeout: POST /codi/qr tarda ~3 minutos en responder en las pruebas
// reales (21 nov 2026), así que el timeout tiene que ser MAYOR que eso:
// 240 s por defecto (PEY_TIMEOUT_MS). Un timeout corto (p. ej. 30 s)
// rompería la creación del QR siempre. Si se agota, se lanza
// PeyTimeoutError y la cita sigue en hold para reintentar el pago.
export interface CreatePeyQrInput {
  amount: number;
  concept: string;
  expiration: 600;
  numRef: string; // = Appointment.numRef (numérico, máx. 7 dígitos)
}

export type PeyQrResponse = Record<string, unknown> & {
  codiQrId?: string;
  qr?: string;
  qrText?: string;
  qr_text?: string;
  image?: string;
  url?: string;
};

const PEY_API_BASE_URL =
  process.env.PEY_API_BASE_URL ?? "https://api.pey.mx";

export const DEFAULT_PEY_TIMEOUT_MS = 240_000;

/** Timeout para crear el QR (ms), configurable por env. */
export function peyTimeoutMs(): number {
  const raw = Number(process.env.PEY_TIMEOUT_MS ?? DEFAULT_PEY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PEY_TIMEOUT_MS;
}

/** Pey no respondió dentro del timeout: la cita sigue en hold. */
export class PeyTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(
      `Pey tardó más de ${Math.round(timeoutMs / 1000)} s en responder al crear el QR`,
    );
    this.name = "PeyTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  );
}

export async function createPeyQr(
  input: CreatePeyQrInput,
  apiKey: string = process.env.PEY_API_KEY ?? "",
  options?: { timeoutMs?: number },
): Promise<PeyQrResponse> {
  if (!apiKey) throw new Error("PEY_API_KEY no configurada");
  if (!(input.amount > 0)) throw new Error("amount debe ser > 0");
  const timeoutMs = options?.timeoutMs ?? peyTimeoutMs();
  let res: Response;
  try {
    res = await fetch(`${PEY_API_BASE_URL}/codi/qr`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isTimeoutError(err)) throw new PeyTimeoutError(timeoutMs);
    throw err;
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Pey QR failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as PeyQrResponse;
}

/** Devuelve lo que la web debe mostrar/escanear, si la respuesta lo trae. */
export function extractQrPayload(qr: PeyQrResponse): string | null {
  for (const key of ["qr", "qrText", "qr_text", "image", "url"]) {
    const value = qr[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}
