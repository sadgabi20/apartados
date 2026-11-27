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
  // Cuenta de Pey que recibe el CoDi. Sin él, el cobro cae en la cuenta
  // ligada a la API key (la de Apartados). Con él, cae directo en la
  // cuenta del negocio (POST /bank-account, ver registerBankAccount).
  bankAccountId?: string;
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

// ---------------------------------------------------------------------------
// Cuentas bancarias (CoDi): POST /bank-account y GET /bank-account/{id}.
// OpenAPI oficial de Pey, CoDi API v2026-10-20, re-confirmado 2026-11-26.
// Cada negocio registra su CLABE una vez; cada QR se crea con su
// bankAccountId y el dinero cae directo en su cuenta, sin pasar por
// Apartados. Solo las cuentas ACTIVE pueden recibir pagos. La CLABE
// completa se manda una sola vez aquí y NUNCA se guarda en Apartados.
// ---------------------------------------------------------------------------

export const DEFAULT_PEY_BANK_ACCOUNT_TIMEOUT_MS = 30_000;

/** Timeout para registrar/consultar la cuenta bancaria (ms). A diferencia
 *  del QR (que tarda ~3 min), el registro es una llamada rápida: 30 s
 *  bastan y un Pey colgado no deja colgada la API. */
export function peyBankAccountTimeoutMs(): number {
  const raw = Number(
    process.env.PEY_BANK_ACCOUNT_TIMEOUT_MS ?? DEFAULT_PEY_BANK_ACCOUNT_TIMEOUT_MS,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PEY_BANK_ACCOUNT_TIMEOUT_MS;
}

export type PeyBankAccountEntity = "BUSINESS" | "PERSON";

export interface RegisterBankAccountInput {
  alias: string; // nombre corto para identificar la cuenta
  name: string; // nombre legal del titular (persona o razón social)
  clabe: string; // 18 dígitos, dígito verificador válido, banco con CoDi
  entity: PeyBankAccountEntity; // BUSINESS = persona moral, PERSON = persona física
  taxId?: string; // RFC opcional: 12 caracteres moral, 13 física
}

export type PeyBankAccountStatus = "PENDING" | "PROCESSING" | "ACTIVE" | "ERROR";

export interface PeyBankAccountResponse {
  id: string; // ULID de Pey: es el bankAccountId que va en el QR
  alias?: string;
  name?: string;
  clabe?: string;
  entity?: PeyBankAccountEntity;
  taxId?: string;
  codiStatus?: PeyBankAccountStatus;
  errorMessage?: string; // solo cuando codiStatus es ERROR
  dateCreated?: number;
}

/** Pey rechazó la operación de cuenta bancaria: lleva el status HTTP para
 *  que la ruta decida (400 = datos inválidos, resto = fallo de Pey). */
export class PeyBankAccountError extends Error {
  readonly status: number;
  readonly peyType: string | null;
  constructor(status: number, message: string, peyType: string | null = null) {
    super(message);
    this.name = "PeyBankAccountError";
    this.status = status;
    this.peyType = peyType;
  }
}

function peyErrorMessage(status: number, text: string): { message: string; type: string | null } {
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; type?: string };
    };
    if (typeof parsed.error?.message === "string" && parsed.error.message.length > 0) {
      return { message: parsed.error.message, type: parsed.error.type ?? null };
    }
  } catch {
    // El cuerpo no es JSON: se usa el texto tal cual, acotado.
  }
  return { message: text.slice(0, 300) || `Pey respondió ${status}`, type: null };
}

async function peyBankAccountRequest(
  path: string,
  init: { method: "POST" | "GET"; body?: unknown },
  apiKey: string,
  timeoutMs: number,
): Promise<PeyBankAccountResponse> {
  if (!apiKey) throw new Error("PEY_API_KEY no configurada");
  let res: Response;
  try {
    res = await fetch(`${PEY_API_BASE_URL}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new PeyBankAccountError(
        503,
        `Pey tardó más de ${Math.round(timeoutMs / 1000)} s en responder`,
      );
    }
    throw err;
  }
  const text = await res.text();
  if (!res.ok) {
    const { message, type } = peyErrorMessage(res.status, text);
    throw new PeyBankAccountError(res.status, message, type);
  }
  return JSON.parse(text) as PeyBankAccountResponse;
}

/** Registra la CLABE de un negocio en Pey. Devuelve el id (ULID) y el
 *  estado inicial (PENDING: recibido, aún no enviado a Banxico). */
export async function registerBankAccount(
  input: RegisterBankAccountInput,
  apiKey: string = process.env.PEY_API_KEY ?? "",
  options?: { timeoutMs?: number },
): Promise<PeyBankAccountResponse> {
  return peyBankAccountRequest(
    "/bank-account",
    { method: "POST", body: input },
    apiKey,
    options?.timeoutMs ?? peyBankAccountTimeoutMs(),
  );
}

/** Consulta el estado actual de una cuenta en Pey (PENDING → PROCESSING →
 *  ACTIVE | ERROR). Se usa al leer, para refrescar el estado guardado. */
export async function getBankAccount(
  id: string,
  apiKey: string = process.env.PEY_API_KEY ?? "",
  options?: { timeoutMs?: number },
): Promise<PeyBankAccountResponse> {
  return peyBankAccountRequest(
    `/bank-account/${encodeURIComponent(id)}`,
    { method: "GET" },
    apiKey,
    options?.timeoutMs ?? peyBankAccountTimeoutMs(),
  );
}
