// Cifrado del refresh_token de calendario en reposo (auth Fase 2, diseño §8).
// AES-256-GCM con GOOGLE_TOKEN_ENCRYPTION_KEY (32 bytes en base64, en env,
// nunca en el repo). Formato guardado: "v1:" + base64url(iv 12B || tag 16B || ciphertext).
// El access_token (corta vida) puede ir en claro; el refresh_token (larga
// vida, equivale a acceso permanente al calendario) nunca va en claro,
// nunca en logs y nunca en respuestas de la API.
// Fail-closed: sin clave válida no se cifra ni se guarda nada. Un valor
// guardado antes de la Fase 2 (en claro, sin prefijo "v1:") o cifrado con
// otra clave se trata como ausente: el dueño reconecta el calendario y
// el token nuevo queda cifrado. No hay migración de datos: el store en
// memoria se pierde al reiniciar y la columna de Prisma sigue siendo
// String (el valor cifrado es texto).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "v1:";
const KEY_ENV = "GOOGLE_TOKEN_ENCRYPTION_KEY";

function getKey(): Buffer | null {
  const raw = process.env[KEY_ENV] ?? "";
  if (!raw) return null;
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  return key.length === 32 ? key : null;
}

export function isTokenCryptoConfigured(): boolean {
  return getKey() !== null;
}

export function encryptRefreshToken(plain: string): string {
  const key = getKey();
  if (!key) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY no configurado o inválido (32 bytes base64)",
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptRefreshToken(stored: string | null): string | null {
  if (!stored || !stored.startsWith(PREFIX)) return null;
  const key = getKey();
  if (!key) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(stored.slice(PREFIX.length), "base64url");
  } catch {
    return null;
  }
  if (buf.length < 12 + 16 + 1) return null;
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null; // clave distinta o dato manipulado
  }
}
