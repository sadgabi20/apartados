# Desplegar la API en Render (plan gratis)

> Estado: la API corre con `pnpm --filter @apartados/api start` (`tsx
> src/index.ts`, sin build) y escucha en `0.0.0.0:$PORT`. La web en Vercel
> apunta a la URL pública que salga de aquí con `NEXT_PUBLIC_API_URL`.

## Qué deja listo este PR

- `apps/api/src/index.ts`: lee `PORT ?? API_PORT ?? 3001` y hace bind a
  `0.0.0.0` (Render inyecta `PORT` y exige `0.0.0.0`; sin esto el servicio
  nunca recibe tráfico).
- `apps/api/package.json`: script `start` (`tsx src/index.ts`) y `tsx`
  movido de `devDependencies` a `dependencies`, porque con
  `NODE_ENV=production` pnpm no instala devDependencies y el start fallaría.
  No hay build real: `tsc` no hace nada en este repo (no hay tsconfig en la
  API) y `tsx` corre el TypeScript directo.
- `render.yaml`: Blueprint con el servicio web (plan free, región Oregon, la
  más cercana a México), build `pnpm install --frozen-lockfile`, start
  `pnpm --filter @apartados/api start`, health check en `/health`. Sin
  `corepack enable`: en Render falla con `EROFS` porque intenta crear el
  symlink de pnpm en `/usr/bin` (solo lectura); el runtime Node de Render
  ya trae pnpm.
- `.node-version`: `24.22.1` (la versión default actual de Render y la del
  entorno de desarrollo).

## Paso 1 — Cuenta de Render

1. Entra a https://render.com y crea la cuenta con **Sign in with GitHub**
   (tu cuenta `sadgabi20`). Nadie más puede crearla por ti y la contraseña
   no se comparte por chat.
2. Autoriza el acceso al repo `sadgabi20/apartados` cuando Render lo pida.

## Paso 2 — Crear el servicio (Blueprint)

1. En el dashboard: **New > Blueprint**.
2. Conecta el repo `sadgabi20/apartados`, rama `main`.
3. Render lee `render.yaml` y muestra el servicio `apartados-api`. Revisa
   que diga: Runtime `Node`, Plan `Free`, Build Command `pnpm install
   --frozen-lockfile`, Start Command `pnpm --filter @apartados/api start`,
   Health Check Path `/health`.
4. Si prefieres crearlo a mano en vez de Blueprint: **New > Web Service**,
   mismo repo y rama, con exactamente esos valores.

## Paso 3 — Variables de entorno

En el dashboard del servicio, **Environment**, pon estas variables. Los
valores salen de tu `.env` local (el archivo con secretos, que se copia
como archivo como siempre, nunca se pegan secretos en chat ni en el repo).

| Variable | Valor |
|---|---|
| `PEY_API_KEY` | Tu llave de Pey (la misma del `.env` local) |
| `PEY_WEBHOOK_SECRET` | Déjala vacía por ahora: el secreto del webhook aún no existe, se crea cuando actives CoDi (ver abajo) |
| `GOOGLE_CLIENT_ID` | El de GCP, proyecto Apartados |
| `GOOGLE_CLIENT_SECRET` | El de GCP |
| `GOOGLE_REDIRECT_URI` | `https://<tu-api>.onrender.com/google/callback` (la URL que te dé Render en el paso 4; hay que añadirla también en GCP, ver "Después del deploy") |
| `CORS_ORIGINS` | `https://apartados-one.vercel.app` (ya viene en `render.yaml`) |
| `NODE_ENV` | `production` (ya viene en `render.yaml`) |

Cuando el PR #3 (auth Fase 1) esté mergeado, añade también estas tres:

| Variable | Valor |
|---|---|
| `WEB_URL` | `https://apartados-one.vercel.app` |
| `AUTH_GOOGLE_REDIRECT_URI` | `https://<tu-api>.onrender.com/auth/google/callback` |
| `OAUTH_STATE_SECRET` | Generado con `openssl rand -hex 32`, distinto por entorno |

## Paso 4 — Deploy y URL pública

1. Dale a **Create Web Service** / **Apply**. Render hace el build y el
   deploy (tarda unos minutos la primera vez).
2. Copia la URL pública del servicio, algo como
   `https://apartados-api-xxxx.onrender.com`.
3. Verifica en el navegador: `https://<tu-api>.onrender.com/health` debe
   responder `{"ok":true}`.

## Paso 5 — Conectar la web de Vercel

1. En Vercel, proyecto `apartados`: **Settings > Environment Variables**,
   añade `NEXT_PUBLIC_API_URL=https://<tu-api>.onrender.com` (la URL del
   paso 4, sin `/` al final).
2. **Redeploy** (las variables `NEXT_PUBLIC_*` se fijan en el build, no
   basta con guardarlas).
3. Verifica en producción: `https://apartados-one.vercel.app/b/barberia-demo`
   debe mostrar los 8 horarios (10:00–17:00) en vez del error rojo
   "No se pudo contactar a la API".

## Después del deploy

- **Google Cloud**: en el cliente OAuth "Apartados Web", añade a las URIs de
  redirección autorizadas `https://<tu-api>.onrender.com/google/callback`
  (y cuando exista, `/auth/google/callback`). Hoy solo está
  `http://localhost:3001/google/callback`.
- **Webhook de Pey**: la URL será `https://<tu-api>.onrender.com/webhooks/pey`.
  No se crea el secreto todavía: eso espera a que actives CoDi en tu cuenta
  BBVA, como ya estaba acordado.
- **Prevenir el arranque en frío**: en plan gratis el servicio se duerme
  tras 15 min sin uso y tarda ~1 min en despertar. Antes de la demo, abre
  `https://<tu-api>.onrender.com/health` y espera a que responda; así la
  primera reserva no se come el hold de 10 min esperando a que despierte.

## Limitaciones del plan gratis (sin exagerar)

- **Se duerme tras 15 minutos sin tráfico** y tarda ~1 min en despertar.
  Afecta a la demo de 3 minutos si la primera petición llega en frío, y a
  los holds de 10 minutos por la misma razón. El truco del punto anterior lo
  mitiga.
- **El store es en memoria**: cada reinicio o redeploy borra las citas y
  (cuando llegue el auth) las sesiones. Ya estaba aceptado para la demo.
- **750 horas gratis al mes**: un solo servicio 24/7 son ~720 h, así que
  alcanza para el hackatón (cierra el 12 dic 2026).
- **Sin pre-deploy commands en plan gratis**: cuando haya base de datos y
  migraciones de Prisma, el `prisma migrate deploy` tendrá que correrse a
  mano o con un plan de pago. Hoy no hay DB conectada, así que no bloquea.
