// Cliente Pey, aislado. Verificado en docs.pey.mx el 21 nov 2026.
// Crear cobro: POST https://api.pey.mx/codi/qr  (201 = creado)
// No hay sandbox todavía: pruebas en producción con montos pequeños ($0.01 MXN).
// La forma exacta de la respuesta del QR no está documentada en la
// página principal de docs.pey.mx: se devuelve el JSON tal cual y la
// web muestra los campos que traiga (qr / qrText / image / url).
export interface CreatePeyQrInput {
  amount: number;
  concept: string;
  expiration: 600;
  numRef: string; // = Appointment.id
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

export async function createPeyQr(
  input: CreatePeyQrInput,
  apiKey: string = process.env.PEY_API_KEY ?? "",
): Promise<PeyQrResponse> {
  if (!apiKey) throw new Error("PEY_API_KEY no configurada");
  if (!(input.amount > 0)) throw new Error("amount debe ser > 0");
  const res = await fetch(`${PEY_API_BASE_URL}/codi/qr`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
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
