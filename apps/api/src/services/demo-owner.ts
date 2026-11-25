// Fase 3 — dueño real de barberia-demo (diseño docs/auth-design.md §9).
// La identidad es el googleSub, nunca el email.
//
// El problema práctico: el seed no puede crear la barbería con dueño.
// El ownerId del negocio es el id interno del User, y ese id solo existe
// después del primer login (el upsert crea el User por googleSub). Además
// el store en memoria se resetea en cada reinicio/redeploy, así que
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
//
// Con el store Prisma la demo NO puede nacer sin dueño (ownerId NOT NULL
// desde la Fase 3), así que hay un caso más: si la demo no existe
// todavía en la base (el seed solo la crea cuando el dueño ya existe),
// el reclamo la crea aquí mismo, con su servicio, a nombre del usuario
// que entra. El seed de Prisma (store-prisma.ts ensureSeed) cubre el
// caso contrario: si el dueño ya existe en base, la demo ya está creada
// al arrancar (con un usuario fantasma si aún no entró nunca).
import type { AppointmentStore } from "../store";

export const DEMO_BUSINESS_SLUG = "barberia-demo";

/** Id fijo de la demo en base: el seed y el reclamo lo usan igual. */
export const DEMO_BUSINESS_ID = "biz-barberia-demo";

/** googleSub del dueño de la demo, desde env (vacío = sin reclamar). */
export function demoOwnerGoogleSub(): string | null {
  const sub = (process.env.DEMO_OWNER_GOOGLE_SUB ?? "").trim();
  return sub || null;
}

/**
 * Reclama la barbería demo para el usuario que acaba de loguearse.
 * Devuelve true solo si esta llamada asignó (o creó) el dueño.
 */
export async function claimDemoBusiness(
  store: AppointmentStore,
  googleSub: string,
  userId: string,
): Promise<boolean> {
  const configured = demoOwnerGoogleSub();
  if (!configured || configured !== googleSub) return false;
  const demo = await store.getBusinessBySlug(DEMO_BUSINESS_SLUG);
  if (!demo) {
    // La demo no existe en este store (Prisma sin seed previo): se crea
    // aquí, ya con su dueño, junto con su servicio de siempre. El id es
    // el mismo que fija el seed (DEMO_BUSINESS_ID), no un azar: así la
    // demo tiene el mismo id nazca por donde nazca.
    const business = await store.createBusiness({
      id: DEMO_BUSINESS_ID,
      slug: DEMO_BUSINESS_SLUG,
      name: "Barbería Demo",
      agendaVisibility: "public",
      ownerId: userId,
      calendarId: process.env.GOOGLE_TEST_CALENDAR_ID ?? null,
      googleAccessToken: process.env.GOOGLE_TEST_ACCESS_TOKEN ?? null,
      googleRefreshToken: null,
    });
    await store.createService({
      // Mismo id fijo que el seed: el servicio de la demo es siempre este.
      id: "svc-corte-barba",
      businessId: business.id,
      name: "Corte + barba",
      durationMin: 60,
      depositAmount: Number(process.env.DEMO_DEPOSIT_MXN ?? 50),
    });
    return true;
  }
  if (demo.ownerId) return false;
  await store.saveBusiness({ ...demo, ownerId: userId });
  return true;
}
