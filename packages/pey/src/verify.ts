// Verificar webhook Pey antes de confirmar nada.
//
// Pey usa Standard Webhooks (docs.pey.mx, revisado 21 nov 2026):
// https://docs.pey.mx/docs/webhooks/introduction
// https://docs.pey.mx/docs/tutorials/getting-started/set-up-webhooks
//
// Cabeceras:
// - webhook-id: clave de idempotencia
// - webhook-timestamp: unix seconds al enviar
// - webhook-signature: una o varias firmas separadas por espacio,
//   cada una `v1,<firma en base64>`
//
// Firma:
//   contenido firmado = "<webhook-id>.<webhook-timestamp>.<cuerpo crudo>"
//   clave = base64-decode(secreto sin el prefijo `whsec_`)
//   firma = base64(HMAC-SHA256(clave, contenido firmado))
//
// La verificación se hace sobre el cuerpo CRUDO (string sin procesar),
// nunca sobre el JSON re-serializado. Tolerancia de 5 minutos contra
// replay. Si la verificación falla, el pago NO se confirma: falla cerrado.
// No confiar solo en numRef.
import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyPeyWebhookSignature(
  signatureHeader: string | null | undefined,
  rawBody: string,
  secret: string = process.env.PEY_WEBHOOK_SECRET ?? "",
  webhookId?: string | null,
  webhookTimestamp?: string | null,
): boolean {
  if (!secret || !signatureHeader || !webhookId || !webhookTimestamp) {
    return false;
  }
  if (!/^\d+$/.test(webhookTimestamp)) return false;
  // Protección contra replay: 5 minutos de tolerancia.
  if (Math.abs(Date.now() / 1000 - Number(webhookTimestamp)) > 300) {
    return false;
  }
  const keyBase64 = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;
  let key: Buffer;
  try {
    key = Buffer.from(keyBase64, "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", key)
    .update(signedContent, "utf8")
    .digest();
  // Puede haber varias firmas v1 separadas por espacio (rotación).
  const signatures = signatureHeader
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .map((part) => part.slice(3));
  return signatures.some((sig) => {
    let received: Buffer;
    try {
      received = Buffer.from(sig, "base64");
    } catch {
      return false;
    }
    return safeEqual(expected, received);
  });
}
