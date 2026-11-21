# Apartados

**El anticipo que confirma la cita.**

Apartados es para negocios de servicios —barberías, dentistas, talleres, estudios de uñas o tatuaje— que pierden dinero cuando un cliente reserva y no llega. Con Apartados, la cita solo queda confirmada cuando el cliente paga un anticipo con CoDi, sin comisión. Esa hora ya no se vende dos veces.

## Cómo funciona

1. **El negocio conecta su Google Calendar.** No aprende otra agenda: su calendario ya es la agenda. Define sus servicios, duración y anticipo.
2. **El cliente elige servicio y hora en un link.** Paga el anticipo con un QR de CoDi desde su app bancaria.
3. **La cita queda bloqueada.** Al confirmarse el pago, la hora se aparta en Google Calendar. Si el cliente no paga en 10 minutos, la hora se libera sola y vuelve a estar disponible.

## Demo

Reserva demo en `/b/barberia-demo`: corte + barba, 60 minutos, anticipo de $50 MXN.

## Para correrlo en local

```bash
pnpm install
cp .env.example .env
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:3001

Completa en `.env` tu API key de Pey y las credenciales de Google Cloud para conectar un calendario real.

## Estructura

Monorepo con Turborepo + pnpm + TypeScript:

- `apps/web` — Next.js: reserva pública, panel del negocio y alta.
- `apps/api` — Node + Fastify: disponibilidad, reservas, pagos y webhooks.
- `packages/pey` — Cliente de Pey / CoDi.
- `packages/google-calendar` — Cliente de Google Calendar.
- `packages/db` — Prisma + Postgres.
- `packages/shared`, `packages/ui`, `packages/config` — Tipos, componentes y configuración compartida.

La web nunca habla directo con Pey ni con Google: solo llama a la API, que es la única que crea la cita, genera el QR y confirma el pago.

## Hackatón México 2026

Apartados participa en Hackatón México 2026, con integración de Pey / CoDi. Dominio: apartados.app
