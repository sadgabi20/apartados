# CitaSegura — monorepo (Bloque 3 del sábado implementado como borrador)

Turborepo + pnpm + TypeScript. Estructura entregada en el chat el 21 nov 2026,
ahora como archivos reales para no copiarla a mano.

**Estado (21 nov, mañana): el flujo principal está implementado como borrador,
sin probar contra Pey ni Google reales.** Los clientes de Pey y Google Calendar,
los servicios de hold/confirm/release y las rutas de la API están escritos;
falta correrlos con las claves reales. No hay secretos aquí:
copia `.env.example` a `.env` y completa tu API key.

## Regla
`apps/web` nunca toca Pey ni Google directo. Solo llama a `apps/api`.
`apps/api` es la única que crea la cita en espera, genera el QR,
verifica el webhook y mueve el evento en Google de en espera a confirmada.

## Arranque sábado 21 nov — 2 horas
Ver guía completa en `/home/hatch/workspace/citasegura-sabado-21.md`
y plan completo en `/home/hatch/workspace/citasegura-plan.md`.

1. **Pey (30 min):** https://portal.mipey.mx — API key, vincula cuenta,
   QR de prueba `POST https://api.pey.mx/codi/qr` con `amount: 0.01`,
   `expiration: 600`, `numRef: "prueba-001"`. Pey no tiene sandbox:
   pruebas en producción con montos pequeños.
2. **Google Calendar (30 min):** Google Cloud, activa Calendar API,
   ámbitos `calendar.freebusy` + `calendar.events.owned`.
   Conecta un calendario de prueba.
3. **Repo (60 min):** `pnpm install`, luego implementa
   `packages/pey/src/client.ts`, `packages/google-calendar/src/*`
   y `apps/api/src/routes/*`. Meta: reserva → QR $0.01 → pago →
   evento confirmado en Calendar; sin pago en 10 min, se libera solo.
   → Hecho como borrador el 21 nov (ver "Qué se implementó" abajo).
   Para correrlo: `pnpm install && pnpm --filter @citasegura/api dev`
   (puerto 3001) y `pnpm --filter @citasegura/web dev` (puerto 3000).
   La API usa un store en memoria con un negocio demo (`barberia-demo`,
   Corte + barba, $50); la tienda de producción es Prisma/Supabase.

## Qué se implementó (borrador, 21 nov)
- `packages/pey`: `createPeyQr` (POST /codi/qr, 201) y verificación de
  firma del webhook (HMAC-SHA256 v1, falla cerrada).
- `packages/google-calendar`: OAuth (URL + intercambio de código),
  `freeBusy` (falla cerrada si hay errores), `events.insert` (hold),
  `events.patch` (confirmado) y `events.delete` (liberar).
- `apps/api`: `GET /availability`, `POST /bookings`, `POST /payments`,
  `POST /webhooks/pey` (cuerpo crudo para la firma), `GET /google/auth`
  y `/google/callback`, `POST /release-expired` + intervalo cada minuto.
- `apps/web`: página de reserva `/b/[slug]` (elige hora → QR → polling
  del estado) y landing mínima.

## ⚠️ Sin verificar antes de la demo
- **Firma del webhook de Pey:** docs.pey.mx (21 nov) solo muestra la
  cabecera `webhook-signature: v1,…`, sin algoritmo ni material firmado.
  El código prueba HMAC-SHA256 sobre el cuerpo crudo (y `t.cuerpo` si
  trae `t=`). Confírmalo con el primer webhook real o en el portal;
  si falla, el pago no se confirma.
- **Respuesta del QR de Pey:** los docs no muestran sus campos. La web
  muestra `qr` / `qrText` / `image` / `url` si vienen, o el JSON entero.
- **Google:** falta conectar un calendario real (OAuth) y refrescar el
  token cuando expire; el store en memoria se pierde al reiniciar la API
  (cámbialo por Prisma antes de la demo con un negocio real).

## Decisión por defecto
Nicho: **barbería**. Anticipo demo: **$50 MXN**.
Cámbiala con una palabra — el flujo no cambia para dentista, taller,
uñas o tatuaje.

## Alineación pitch ↔ demo
El pitch de 3 minutos decía $100 en la demo. Si confirmas $50,
cambia esa línea por:
> "elijo corte y barba, elijo las 11, y pago 50 pesos de anticipo."

La prueba técnica se hace con $0.01 MXN; $50 es solo el monto que se enseña.

## Fechas
Hackatón México 2026: 14 nov–12 dic 2026. Entrega: 12 dic.
Ganadores: 14 dic.
Ojo: viernes 27 nov tienes "Pagar NU TDC" todo el día — deja ese día ligero.
