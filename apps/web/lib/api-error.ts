// Normaliza cualquier error que devuelva apps/api a un string legible
// para mostrar en la UI. Sin esto, un error de validación llegaba crudo
// al estado y React tronaba con "Objects are not valid as a React child"
// (página en blanco).
//
// Formas reales que devuelve el API (verificadas en apps/api/src/routes):
// - string: { error: "Negocio no encontrado" } — la mayoría de rutas.
// - Zod flatten(): POST /bookings, POST/PATCH /businesses y POST
//   /payments contestan 400 con { error: { formErrors: string[],
//   fieldErrors: { campo: string[] } } } cuando un campo es inválido.
// - Zod issues: [{ path: [...], message: "..." }] (por si algún día se
//   devuelve el error sin aplanar).
// - Fastify por defecto: { statusCode, error: "Bad Request",
//   message: "..." } — ahí el detalle vive en `message`, no en `error`.
// - Cualquier otra cosa (array, objeto anidado, null): fallback.
//
// La función SIEMPRE devuelve un string, así que el estado `error` de
// las páginas (useState<string>) nunca puede guardar un objeto.

const MAX_MESSAGE_LENGTH = 300;

// Etiquetas en español para los campos que valida Zod en el API.
const FIELD_LABELS: Record<string, string> = {
  customerName: "nombre",
  customerPhone: "teléfono",
  startAt: "hora",
  businessId: "negocio",
  serviceId: "servicio",
  source: "origen",
  name: "nombre",
  slug: "slug",
  agendaVisibility: "visibilidad",
  durationMin: "duración",
  depositAmount: "anticipo",
  amount: "monto",
  concept: "concepto",
  expiration: "expiración",
  numRef: "referencia",
  alias: "alias",
  clabe: "CLABE",
  entity: "tipo de persona",
  taxId: "RFC",
};

// Zod habla inglés; se traducen los mensajes más comunes para que el
// usuario entienda qué campo está mal. Lo que no calce se deja tal cual.
const ZOD_TRANSLATIONS: [RegExp, string][] = [
  [/string must contain at least 1 character/i, "no puede estar vacío"],
  [/string must contain at least (\d+) character/i, "debe tener al menos $1 caracteres"],
  [/invalid datetime/i, "fecha y hora no válidas"],
  [/invalid enum value/i, "valor no válido"],
  [/invalid/i, "no válido"],
  [/required/i, "es obligatorio"],
  [/expected number, received/i, "debe ser un número"],
  [/expected string, received/i, "debe ser texto"],
  [/number must be greater than or equal to (\d+)/i, "debe ser mayor o igual a $1"],
  [/number must be less than or equal to (\d+)/i, "debe ser menor o igual a $1"],
];

function translateZodMessage(message: string): string {
  for (const [pattern, replacement] of ZOD_TRANSLATIONS) {
    if (pattern.test(message)) return message.replace(pattern, replacement);
  }
  return message;
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_LENGTH);
}

function labelFor(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

// Extrae mensajes legibles de cualquier valor, en orden de preferencia.
// Devuelve una lista (vacía si no hay nada legible).
function extract(value: unknown, depth = 0): string[] {
  if (value == null || depth > 3) return [];
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extract(item, depth + 1));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;

    // Zod flatten(): { formErrors: string[], fieldErrors: { campo: string[] } }
    if (Array.isArray(obj.formErrors) || (obj.fieldErrors != null && typeof obj.fieldErrors === "object")) {
      const parts: string[] = [];
      if (Array.isArray(obj.formErrors)) {
        parts.push(...extract(obj.formErrors, depth + 1));
      }
      const fieldErrors = (obj.fieldErrors ?? {}) as Record<string, unknown>;
      for (const [field, messages] of Object.entries(fieldErrors)) {
        const fieldMessages = extract(messages, depth + 1).map(translateZodMessage);
        if (fieldMessages.length > 0) {
          parts.push(`${labelFor(field)}: ${fieldMessages.join(", ")}`);
        }
      }
      if (parts.length > 0) return parts;
    }

    // Zod sin aplanar: { issues: [{ path: [...], message: "..." }] }
    if (Array.isArray(obj.issues)) {
      const parts: string[] = [];
      for (const issue of obj.issues) {
        if (issue != null && typeof issue === "object") {
          const record = issue as Record<string, unknown>;
          const path = Array.isArray(record.path) ? record.path.join(".") : "";
          const message = typeof record.message === "string" ? record.message : "";
          if (message) {
            const translated = translateZodMessage(message);
            parts.push(path ? `${labelFor(path)}: ${translated}` : translated);
          }
        }
      }
      if (parts.length > 0) return parts;
    }

    // Fastify por defecto pone el detalle en `message` y un rótulo
    // genérico ("Bad Request") en `error`: se prefiere `message`.
    if (typeof obj.message === "string" && obj.message.trim()) {
      return [obj.message.trim()];
    }

    // Forma habitual del API: { error: "..." } o { error: <objeto> }.
    if (obj.error !== undefined) {
      const fromError = extract(obj.error, depth + 1);
      if (fromError.length > 0) return fromError;
    }

    // Último recurso: cualquier string dentro del objeto.
    return Object.values(obj).flatMap((item) => extract(item, depth + 1));
  }
  return [];
}

// Convierte el cuerpo JSON de una respuesta del API (o su campo `error`)
// en un mensaje legible. Nunca devuelve otra cosa que un string.
export function apiErrorMessage(payload: unknown, fallback: string): string {
  const parts = extract(payload);
  if (parts.length === 0) return fallback;
  return clean(parts.join("; "));
}
