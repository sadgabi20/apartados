// Fase 3 — dueño real de barberia-demo (diseño docs/auth-design.md §9).
// La identidad es el googleSub, nunca el email.
//
// El problema práctico: el seed no puede crear la barbería con dueño.
// El ownerId del negocio es el id interno del User, y ese id solo existe
// después del primer login (el upsert crea el User por googleSub). Además
// el store es en memoria y se resetea en cada reinicio/redeploy, así que
// ningún id guardado sobreviviría de todas formas.
//
// La solución: el dueño se configura con su googleSub (estable, no
// cambia) en DEMO_OWNER_GOOGLE_SUB, y la reclamación ocurre en el login
// (routes/auth.ts, después del upsert), de forma idempotente:
//   - Si el googleSub del que entra coincide con el configurado Y la
//     demo sigue sin dueño, se le asigna (ownerId = su id interno).
//   - Si la demo ya tiene dueño, no se toca (ni siquiera si el
//     configurado es otro: el dueño actual manda).
//   - Si la variable no está puesta o no coincide, no pasa nada: la demo
//     sigue sin dueño y sus endpoints protegidos dan 403 para todos.
// Como la reclamación corre en cada login, sobrevive a reinicios: basta
// con que la variable esté en Render; Axel solo tiene que volver a entrar
// una vez después de ponerla.
import type { AppointmentStore } from "../store";

export const DEMO_BUSINESS_SLUG = "barberia-demo";

/** googleSub del dueño de la demo, desde env (vacío = sin reclamar). */
export function demoOwnerGoogleSub(): string | null {
  const sub = (process.env.DEMO_OWNER_GOOGLE_SUB ?? "").trim();
  return sub || null;
}

/**
 * Reclama la barbería demo para el usuario que acaba de loguearse.
 * Devuelve true solo si esta llamada asignó el dueño.
 */
export function claimDemoBusiness(
  store: AppointmentStore,
  googleSub: string,
  userId: string,
): boolean {
  const configured = demoOwnerGoogleSub();
  if (!configured || configured !== googleSub) return false;
  const demo = store.getBusinessBySlug(DEMO_BUSINESS_SLUG);
  if (!demo || demo.ownerId) return false;
  store.saveBusiness({ ...demo, ownerId: userId });
  return true;
}
