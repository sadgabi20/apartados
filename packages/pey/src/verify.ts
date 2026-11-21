// Verificar webhook Pey antes de confirmar nada.
// Cabecera: webhook-signature: v1,…
// Body: type "codi.qr.payment_received", amount, numRef, transactionId,
// codiQrId, datePaid (unix seconds, p. ej. 1790724818, según docs.pey.mx).
//
// ⚠️ NO VERIFICADO contra la documentación de Pey: la página principal de
// docs.pey.mx (revisada 21 nov 2026) solo muestra el nombre y el formato
// `v1,…` de la cabecera, sin publicar el algoritmo ni el material firmado.
// Esto implementa la convención más común (HMAC-SHA256, estilo Stripe):
//   v1 = HMAC-SHA256(secreto, cuerpo crudo)
// y, si la cabecera trae `t=<unix>`, también prueba
//   v1 = HMAC-SHA256(secreto, "<t>.<cuerpo crudo>")
// Antes de la demo, confirma con el primer webhook real cuál de las dos
// formas usa Pey (o cuál es el secreto en portal.mipey.mx). Si la
// verificación falla, el pago NO se confirma: falla cerrado.
// No confiar solo en numRef.
import { createHmac, timingSafeEqual } from "node:crypto";

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function safeEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "utf8");
  const b = Buffer.from(bHex, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyPeyWebhookSignature(
  signatureHeader: string | null | undefined,
  rawBody: string,
  secret: string = process.env.PEY_WEBHOOK_SECRET ?? "",
): boolean {
  if (!secret || !signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader
      .split(",")
      .map((p) => p.trim().split("=", 2))
      .filter(([k, v]) => k && v),
  );
  const received = parts["v1"];
  if (!received) return false;
  if (safeEqual(hmacHex(secret, rawBody), received)) return true;
  const t = parts["t"];
  if (t && /^\d+$/.test(t)) {
    // Protección básica contra replay: 5 minutos de tolerancia.
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
    if (safeEqual(hmacHex(secret, `${t}.${rawBody}`), received)) return true;
  }
  return false;
}
