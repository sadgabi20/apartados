# Diseño de auth — Apartados

> Estado: diseño. Fase 1 implementada y mergeada (PR #3). Fase 2 implementada en este PR. Fecha: 2026-11-23.
> Contexto: PR #2 (agenda pública/privada + flujo manual por WhatsApp) ya está
> mergeado. Hoy no existe auth de ningún tipo: `PATCH /businesses/:slug` y
> `POST /bookings` con `source='business'` los puede llamar cualquiera, y las
> carpetas `apps/web/app/dashboard/` y `apps/web/app/onboarding/` están vacías.
> Lo único con OAuth es Google Calendar (`apps/api/src/routes/google.ts`).

## 1. Principios y alcance

- **Se autentica solo el dueño del negocio.** Un negocio = una persona (o cuenta
  de Google) que lo administra. Sin auth no hay dashboard, ni onboarding, ni
  toggle de agenda, ni citas manuales.
- **El cliente final NO tiene login.** Nunca. El cliente solo abre el link que
  le mandaron por WhatsApp: `/confirmar/[appointmentId]`. El UUID de la cita es
  el token: es impredecible (128 bits) y caduca con el hold (10 o 60 min). Pedirle
  cuenta al cliente mataría el flujo de microempresa.
- **La API es la que decide, no la web.** Esconder un botón en la web no protege
  nada: cada endpoint de negocio verifica sesión + propiedad en Fastify. La web
  solo refleja el 401/403 con una redirección.
- **No inventar identidad.** El negocio ya necesita una cuenta de Google para su
  calendario. Esa misma identidad verificada (email + `sub` de Google) es el
  login. Nada de passwords propios que haya que guardar, hashear, resetear y
  que puedan filtrarse a 19 días del cierre del hackatón (12 dic 2026).
- **Mínimo privilegio.** El login solo prueba quién eres. Ver el calendario,
  crear eventos o cobrar son permisos separados que se piden aparte, cuando
  hacen falta.

### Qué queda protegido y qué sigue público

| Recurso | Después de auth |
|---|---|
| `PATCH /businesses/:slug` (toggle pública/privada) | Solo el dueño de ese negocio (401 sin sesión, 403 si no es suyo) |
| `POST /bookings` con `source='business'` (cita manual) | Solo el dueño del `businessId` |
| `GET /availability?actor=business` | Solo el dueño. Hoy `actor=business` es un query param que cualquiera puede pasar: eso es un bypass de la agenda privada, no una protección. Con auth, el actor lo determina la sesión, no el query param (se mantiene el param por compatibilidad, pero se ignora sin sesión válida) |
| `GET /google/auth?slug=` (conectar calendario) | Solo el dueño de ese negocio |
| `POST /businesses` (crear negocio) y servicios | Solo con sesión |
| Páginas `/negocio/[slug]`, `/dashboard`, `/onboarding` | Requieren sesión; sin ella, redirect a `/login` |
| `GET /availability` (pública), `POST /bookings` `source='customer'` | Públicos, como hoy |
| `GET /appointments/:id`, `POST /payments` | Públicos, como hoy: el cliente los usa desde `/confirmar` sin login. El UUID es el token. No se les añaden datos sensibles nuevos |
| `GET /businesses/:slug` | Público, pero solo campos de exhibición: `id`, `slug`, `name`, `agendaVisibility`. Nunca email del dueño, ni `calendarId`, ni tokens |
| `POST /webhooks/pey`, `GET /health` | Públicos, como hoy (el webhook se verifica por firma, no por sesión) |

## 2. Opción recomendada: "Entrar con Google" reutilizando el OAuth existente

### Por qué

- Cero contraseñas nuevas. El dueño ya tiene Google (su calendario vive ahí).
- Identidad verificada por Google: `sub` (estable, no cambia) + `email` + nombre
  + foto, todo en el `id_token` firmado. No hay registro manual que falsificar.
- Reutiliza infraestructura que ya existe y ya funciona: cliente OAuth
  "Apartados Web" en GCP (ID `146574216650-a5cqtglvb5reqjp3kupic6o3raarg4n8`),
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` ya en `.env`, consent screen ya
  creado, y el código de intercambio de `code` por tokens
  (`packages/google-calendar/src/oauth.ts`).
- Es el flujo que un jurado de hackatón entiende en 5 segundos: un botón,
  una pantalla de Google, dentro.

### Scope extra necesario

El login necesita solo OpenID Connect, que **no** es lo mismo que el acceso al
calendario:

```
openid email profile
```

Son scopes no sensibles de OIDC: no requieren verificación extra de Google más
allá de la que ya tiene la app. Los scopes de calendario actuales se quedan
exactamente como están:

```
https://www.googleapis.com/auth/calendar.freebusy
https://www.googleapis.com/auth/calendar.events.owned
```

### ¿Un solo flujo con todos los scopes, o login separado y luego calendario?

**Recomendado: dos pasos, un mismo cliente OAuth, dos redirects distintos.**

1. **Login** — `GET /auth/google` → scopes `openid email profile` **solamente**,
   redirect a `/auth/google/callback`. Devuelve `id_token` → identidad. No pide
   calendario.
2. **Conectar calendario** — el actual `GET /google/auth?slug=` → scopes de
   calendario **solamente**, redirect a `/google/callback`, pero ahora exigiendo
   sesión + propiedad del negocio. Devuelve `access_token` + `refresh_token` →
   se guardan en `GoogleAccount` del negocio.

Justificación:

- El login ocurre **antes** de que exista un negocio (un usuario nuevo no tiene
  `slug` todavía), así que no hay a qué atar el calendario en ese momento. Un
  mega-flujo con todos los scopes a la vez no puede funcionar para el registro.
- Pedir calendario en el login asusta y sobra: un dueño que solo quiere ver su
  dashboard no debería tener que autorizar acceso a su agenda antes de saber
  siquiera si le gusta el producto. Permiso cuando hace falta (consentimiento
  incremental de Google): el segundo consent solo aparece al conectar el
  calendario, que es justo cuando tiene sentido.
- Desconectar / reconectar el calendario no toca la sesión de login, y viceversa.
  Con un solo flujo, revocar el calendario te sacaría de la cuenta.
- Misma app OAuth en GCP, solo hay que añadir una segunda redirect URI en la
  consola (ver §7). No hace falta un segundo cliente.

### Detalle que hay que corregir sí o sí al tocar este código

Hoy `/google/auth` usa `state = <slug>` en texto plano y `/google/callback` lo
usa tal cual para saber a qué negocio guardar los tokens. Eso no tiene
protección CSRF: un link malicioso podría conectar el calendario de un atacante
a un negocio ajeno. Con auth, el `state` pasa a ser un payload firmado
(`{ slug, userId, nonce, exp }`, HMAC con secreto de entorno, un solo uso,
10 min) y se verifica contra una cookie `oauth_state` httpOnly. Este cambio va
en la fase 2 (§8), no se puede dejar el `state=slug` conviviendo con sesiones.

## 3. Alternativas descartadas

| Alternativa | Por qué no (para este hackatón) |
|---|---|
| Email + password propio | Hay que hashear (argon2/bcrypt), guardar, validar, reset por email, proteger contra fuerza bruta y filtrado. Es el camino con más código y más riesgo de hacerlo mal, para un login que Google ya resuelve. |
| Magic link por email | Sin proveedor de email configurado (no hay SMTP / Resend / SES en el repo). Hay que montar envío, plantillas, expiración de links y manejo de spam. Para el demo, "te mando un link al correo" es más fricción que "Entrar con Google". Queda como posible fase post-hackatón si Axel lo pide. |
| Login por teléfono / WhatsApp (OTP por SMS) | Cuesta dinero por SMS, hay que integrar un proveedor (Twilio / WhatsApp Business), y el OTP por WhatsApp no es un login estándar: el número no prueba propiedad del negocio. El teléfono del dueño sí se puede pedir como dato de contacto, pero no como identidad. |
| Auth0 / Clerk / Supabase Auth | Servicios correctos, pero añaden dependencia externa, otra consola, otras env vars y otro modelo mental a 19 días del cierre. Google directo ya está a medio montar; no compensa. Si después se migra a Supabase (la DB prevista es Supabase/Postgres), reevaluar Supabase Auth entonces, no ahora. |

## 4. Modelo de datos

### Prisma (`packages/db/schema.prisma`)

```prisma
model User {
  id         String    @id @default(cuid())
  googleSub  String    @unique // "sub" del id_token: identidad estable, nunca cambia
  email      String    @unique // solo para mostrar y contactar; NUNCA es la clave de identidad
  name       String?
  avatarUrl  String?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  sessions   Session[]
  businesses Business[]
}

model Session {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String   @unique // SHA-256 del token; el token en claro solo existe en la cookie
  expiresAt  DateTime
  lastUsedAt DateTime @default(now())
  userAgent  String?
  createdAt  DateTime @default(now())

  @@index([userId])
}

model Business {
  id               String   @id @default(cuid())
  slug             String   @unique
  name             String
  agendaVisibility String   @default("public")
  ownerId          String?  // nullable solo durante la migración (fase 3 lo vuelve requerido)
  owner            User?    @relation(fields: [ownerId], references: [id])
  services         Service[]
  appointments     Appointment[]
  googleAccount    GoogleAccount?
  createdAt        DateTime @default(now())

  @@index([ownerId])
}
```

Reglas:

- **Un dueño puede tener N negocios; un negocio tiene un dueño.** El modelo es
  1:N desde el inicio. La UI no es una lista: es un layout persistente con
  selector para cambiar de negocio rápidamente, y la gestión de negocios vive
  en ajustes (decisión de Axel 2026-11-23). Hacerlo 1:1 ahora obligaría a migrar
  el esquema cuando el segundo negocio aparezca.
- **La identidad es `googleSub`, no el email.** El email de Google puede cambiar;
  el `sub` no. Si un usuario cambia su email en Google, se actualiza el campo
  `email` en el login (upsert por `googleSub`), nunca se crea un segundo usuario.
- **`barberia-demo` queda sin dueño al principio** (`ownerId = null`). Es el seed
  de la demo y hoy nadie lo reclama. La fase 3 lo asigna a la cuenta real de
  Axel; hasta entonces, sus endpoints protegidos devuelven 401/403 para todo el
  mundo (incluido Axel sin sesión). No se le inventa un dueño falso en el seed.
- **`GoogleAccount` no cambia de forma**: sigue siendo 1:1 con `Business` y
  guardando los tokens de calendario **por negocio**, no por usuario. El acceso
  a esos tokens pasa por la comprobación de propiedad del negocio, no por
  quién es el usuario en abstracto.
- **Store en memoria** (`apps/api/src/store.ts`): añadir `UserRecord`,
  `SessionRecord` y los métodos `getUserByGoogleSub`, `createUser`,
  `getUserById`, `getSessionByTokenHash`, `createSession`, `deleteSession`,
  `listBusinessesByOwner`. Misma interfaz que Prisma expondrá después, para que
  las rutas no cambien cuando se sustituya el store. Limitación conocida: las
  sesiones en memoria se pierden al reiniciar la API (igual que hoy se pierden
  las citas). Aceptable para la demo; la fase 1 debe documentarlo, no esconderlo.

### Qué NO se guarda

- Nunca la contraseña de nadie (no existe).
- Nunca tokens de Google en la cookie ni en `localStorage` (ver §5).
- Nunca el `refresh_token` de calendario en logs ni en respuestas de la API.
  `GET /businesses/:slug` ya hoy no lo devuelve; que siga así.

## 5. Sesiones

### Estrategia elegida: sesión opaca en DB + cookie httpOnly

- Al loguear, la API genera un token aleatorio de 256 bits (`crypto.randomBytes(32)`),
  guarda **solo su SHA-256** en `Session.tokenHash` con `expiresAt`, y lo pone en
  la cookie `apartados_session`. El token en claro solo existe en esa cookie.
- La cookie: `HttpOnly; Secure` en producción; `SameSite=None; Secure` en
  producción (la web vive en Vercel y la API en otro dominio: es cross-site y
  con `Lax` el navegador no la mandaría en los `fetch`), `SameSite=Lax` en dev
  (`localhost:3000` → `localhost:3001` son mismo sitio, puertos distintos no
  cambian el site). `Path=/`, sin `Domain` explícito. `Max-Age` = vida de la sesión.
- La cookie guarda **solo el token de sesión**. Nada de datos de usuario, nada
  de tokens de Google, nada de `ownerId`. Quien quiera saber quién eres llama a
  `GET /auth/me` y la API resuelve el token contra la DB.

### Por qué opaca y no JWT

- **Revocación real.** Logout = borrar la fila. Un JWT seguiría siendo válido
  hasta caducar salvo que se monte una lista de revocación, que es una DB
  disfrazada de stateless.
- Sin secretos de firma que rotar, sin PII dentro del token, vida controlada
  desde el servidor. El beneficio "stateless" del JWT no compensa a esta escala:
  resolver la sesión es una búsqueda por índice único por request.
- Coste: una query por request autenticado. Despreciable aquí.

### Vida, renovación y logout

- **Expiración:** 30 días, deslizante, con máximo absoluto de 90 días desde el
  login (para que una sesión no viva eternamente por uso continuo).
- **Renovación (rotación):** si la sesión se usa y su `lastUsedAt` tiene más de
  24 h, se genera un token nuevo, se invalida el anterior y se reemite la cookie.
  Así un token robado deja de valer en cuanto el dueño legítimo vuelve a usar
  la app (y el uso del token viejo con una sesión ya rotada es señal de robo:
  se invalidan todas las sesiones de ese usuario).
- **Logout:** `POST /auth/logout` borra la fila y limpia la cookie
  (`Max-Age=0`). Cerrar el navegador no basta: la cookie persiste 30 días por
  diseño.
- **Fijación de sesión:** el token se genera **después** de verificar el
  `id_token` de Google, nunca se acepta un token propuesto por el cliente.

### Cómo la web la envía a la API (CORS con credenciales)

Hoy `apps/api` usa `@fastify/cors` con `origin: CORS_ORIGINS` y sin
`credentials`. Con cookies hace falta:

```ts
await app.register(cors, {
  origin: corsOrigins,      // lista explícita, nunca "*"
  credentials: true,        // permite cookies cross-origin
});
```

Y cada `fetch` de la web a la API con auth lleva `credentials: "include"`.
Los `fetch` públicos (`/availability`, `/bookings` de cliente, `/confirmar`)
siguen sin credenciales. `CORS_ORIGINS` en prod debe listar la URL de Vercel
(y la del preview del PR, si se quiere probar auth ahí).

## 6. Flujos paso a paso

### (a) Onboarding de negocio nuevo

1. El dueño entra a la landing → botón **"Entrar con Google"** → `GET /auth/google?returnTo=/onboarding`.
2. Google: elige cuenta, consiente `openid email profile` → callback en la API.
3. La API verifica el `id_token`, hace upsert de `User` por `googleSub`, crea
   `Session`, pone la cookie y redirige (302) a la web: `/onboarding`.
4. `/onboarding` (vacío hoy, se construye en fase 2) pide, en un solo formulario:
   nombre del negocio, `slug` (se propone desde el nombre, editable, validado
   `^[a-z0-9-]+$`, único), primer servicio (nombre, duración, anticipo $MXN) y
   **cómo recibe citas**: pública (cualquiera reserva en `/b/[slug]`) o privada
   (solo por WhatsApp, él aparta y manda el link). No hay default silencioso:
   se elige explícitamente. `POST /businesses` crea negocio + servicio con
   `ownerId = usuario de la sesión`.
5. Paso **"Conecta tu Google Calendar"** (opcional, se puede saltar y hacerlo
   luego desde el dashboard): botón → `GET /google/auth?slug=<slug>` → consent
   de calendario → callback → vuelve a `/onboarding` con `?calendar=connected`
   y el badge "Calendario conectado". Sin conectar, la disponibilidad no se
   filtra por `freeBusy` (comportamiento actual: `google: "not-configured"`).
6. Pantalla final: **"Comparte tu link"** — muestra `/b/[slug]` (si pública) y el
   acceso a `/negocio/[slug]` para apartar por WhatsApp. Fin del onboarding →
   `/dashboard`.

### (b) Login de negocio existente

1. `/login` (página nueva, un botón: "Continuar con Google") → `GET /auth/google?returnTo=<destino>`.
2. Callback → sesión → 302 al `returnTo` (validado: solo rutas relativas
   internas, nunca una URL externa — si no, `/dashboard`).
3. `/dashboard` (vacío hoy) carga `GET /auth/me` → saluda por nombre y muestra
   el layout persistente con el selector de negocio (visibilidad y estado de
   calendario del negocio activo). Cambiar de negocio en el selector →
   `/negocio/[slug]` (gestión) y link a `/b/[slug]` (vista pública).

### (c) Logout

Botón en dashboard / negocio → `POST /auth/logout` (con credenciales) → la API
borra la sesión y limpia la cookie → la web redirige a `/` (landing). La sesión
borrada no se puede reutilizar: cualquier request posterior con esa cookie da 401.

### (d) Acceso sin auth

- **Web:** `/negocio/[slug]`, `/dashboard` y `/onboarding` son client components
  que al montar llaman a `GET /auth/me` con `credentials: "include"`. Si da 401,
  `router.replace("/login?next=<ruta actual>")`. Nunca se muestra el toggle ni
  el form manual sin sesión.
- **API:** cualquier endpoint protegido sin cookie válida o con sesión expirada
  / revocada responde `401 { error: "No autenticado" }` (sin distinguir si la
  sesión no existe o expiró). No redirige: la API no sabe de páginas, la web
  decide la redirección.

### (e) Dueño intentando ver/editar un negocio que no es suyo

- `PATCH /businesses/:slug`, `POST /bookings` `source='business'` con ese
  `businessId`, `GET /google/auth?slug=` y `GET /availability?actor=business`
  con ese negocio: la API carga el negocio, compara `business.ownerId` con el
  `user.id` de la sesión y responde `403 { error: "Este negocio no es tuyo" }`.
- Negocio inexistente: `404`, igual que hoy. No se filtra por 403 si no existe
  (no se revela si un slug existe o no a través del código de error de
  propiedad; el 404 ya es público vía `GET /businesses/:slug` de todas formas).
- En la web, un 403 en `/negocio/[slug]` muestra "Este negocio pertenece a otra
  cuenta. ¿Entraste con el Google correcto?" con botón de logout y de login con
  otra cuenta. Nunca se muestra el contenido del negocio ajeno.

## 7. Endpoints nuevos / modificados

Nuevos (`apps/api/src/routes/auth.ts`):

| Endpoint | Método | Auth | Qué hace |
|---|---|---|---|
| `/auth/google?returnTo=/dashboard` | GET | No | Genera `state` firmado (nonce, `returnTo`, expira 10 min), lo guarda en cookie `oauth_state` httpOnly y redirige a Google con `openid email profile` |
| `/auth/google/callback?code&state` | GET | No | Verifica `state` (firma + cookie + un solo uso), intercambia `code`, verifica el `id_token` (firma, `iss`, `aud=GOOGLE_CLIENT_ID`, `exp`), upsert de `User` por `googleSub`, crea `Session`, pone cookie, 302 a la web (`WEB_URL + returnTo`) |
| `/auth/me` | GET | Sí | `{ user: { id, email, name, avatarUrl }, businesses: [{ id, slug, name, agendaVisibility, calendarConnected: boolean }] }`. 401 sin sesión |
| `/auth/logout` | POST | Sí | Borra la sesión, limpia la cookie. 200 `{ ok: true }` |
| `/businesses` | POST | Sí | Crea negocio (+ primer servicio en el body) con `ownerId` de la sesión. Valida slug único y formato. 201 |

Modificados:

| Endpoint | Cambio |
|---|---|
| `PATCH /businesses/:slug` | `preHandler: requireAuth + requireBusinessOwner`. 401 / 403 como en §6(e). Sin cambio de body ni respuesta |
| `POST /bookings` | Si `source='business'`: `requireAuth` + el `businessId` debe pertenecer al usuario. Si no, 403 (además del 403 actual por agenda privada sin `source='business'`) |
| `GET /availability?actor=business` | `actor=business` solo vale con sesión del dueño; sin ella, se trata como cliente (403 si privada, slots si pública). El param deja de ser la autorización |
| `GET /google/auth?slug=` | `requireAuth + requireBusinessOwner`. `state` pasa de slug en claro a payload firmado (§2) |
| `GET /google/callback` | Acepta el `state` firmado; al terminar, 302 a la web (`/negocio/[slug]?calendar=connected`) en vez de JSON, para no dejar al dueño en una página de API. Mantener el JSON solo como fallback si no hay `WEB_URL` |
| `GET /businesses/:slug` | Sin cambio de auth (público), pero revisar que nunca devuelva `ownerId`, email, `calendarId` ni tokens (hoy ya no lo hace) |

Middleware (`apps/api/src/middleware/auth.ts`, nuevo):

- `requireAuth(request, reply)`: lee la cookie, hashea el token, busca la sesión
  vigente, carga el usuario y lo deja en `request.user`. Sin sesión → 401.
  Con sesión expirada → 401 y limpia la cookie.
- `requireBusinessOwner(slugParam)`: carga el negocio, 404 si no existe,
  403 si `ownerId !== request.user.id`. Ojo: `ownerId = null` (seed sin dueño)
  nunca coincide con nadie → 403 para todos hasta la fase 3.

### Env vars nuevas

```
# Redirect del login (distinto del de calendario, que ya existe)
AUTH_GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
# A dónde vuelve la web tras el login (Vercel en prod)
WEB_URL=http://localhost:3000
# Secreto para firmar el state de OAuth (32+ bytes aleatorios, distinto por entorno)
OAUTH_STATE_SECRET=<redacted>
# Cifrado del refresh_token de calendario en reposo (AES-256-GCM, 32 bytes en base64)
GOOGLE_TOKEN_ENCRYPTION_KEY=<redacted>
```

Reutilizadas sin cambio: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI` (calendario), `CORS_ORIGINS` (ahora con credenciales).
No hace falta un segundo cliente OAuth: en la consola de GCP se añade la
redirect URI de login a la lista del cliente "Apartados Web" (hoy solo tiene
`http://localhost:3001/google/callback`; en prod habrá que añadir las dos URLs
de producción).

## 8. Seguridad

- **`state` anti-CSRF en OAuth:** aleatorio por intento, firmado (HMAC) con
  `OAUTH_STATE_SECRET`, expira en 10 min, un solo uso, y su valor se compara
  con la cookie `oauth_state` httpOnly. Sin `state` válido no se intercambia el
  `code` por nada.
- **Verificación del `id_token`:** verificar firma contra las JWKS de Google
  (librería `google-auth-library`, `OAuth2Client.verifyIdToken`), `iss` =
  `https://accounts.google.com`, `aud` = nuestro `GOOGLE_CLIENT_ID`, `exp` vigente.
  No aceptar nunca el `email` de un parámetro o de un token sin verificar. No
  usar el endpoint `tokeninfo` con el token en query de forma rutinaria.
- **Nada de tokens de Google en la cookie.** La cookie de sesión es opaca y no
  contiene ni `access_token` ni `refresh_token` de calendario. Esos viven solo
  en servidor (DB / store).
- **Refresh token de calendario cifrado en reposo:** AES-256-GCM con
  `GOOGLE_TOKEN_ENCRYPTION_KEY` (32 bytes, en env, nunca en el repo). El
  `access_token` (corta vida) puede ir en claro en DB; el `refresh_token` (larga
  vida, equivale a acceso permanente al calendario) no. Además: nunca en logs,
  nunca en respuestas, y rotación si se sospecha filtración.
- **Rate limit básico en login:** `@fastify/rate-limit` (o equivalente simple)
  en `/auth/google` y `/auth/google/callback`: p. ej. 10 intentos por IP cada
  10 min. Es anti-abuso, no anti-ataque serio; suficiente para el demo.
- **CSRF en mutaciones con cookie:** además de `SameSite`, comprobar `Origin` /
  `Referer` contra la allowlist de `CORS_ORIGINS` en `POST` / `PATCH` / `DELETE`
  autenticados. Con `SameSite=None` en prod, la cookie se manda cross-site por
  diseño, así que el chequeo de origen es la segunda barrera.
- **Qué NO hacer:**
  - No guardar passwords (no existen) y no inventar un login propio "por si acaso".
  - No guardar JWT / tokens en `localStorage` o `sessionStorage` (los lee cualquier
    script; la cookie httpOnly no).
  - No poner tokens en URLs (salvo el `code` de OAuth, de un solo uso y que
    Google ya diseña así). Los links de `/confirmar` ya llevan un UUID en la URL:
    eso está bien porque es el token de la cita, no una credencial de cuenta.
  - No confiar en el email como identidad (ver §4: la clave es `googleSub`).
  - No loguear cookies, `code`, `id_token` ni tokens. Los logs de Fastify ya
    registran URLs: asegurarse de que el callback no deje el `code` en un log
    de acceso que se comparta.
- **Consent screen en Testing:** hoy solo el usuario de prueba
  (`aaxelaltamirano@gmail.com`) puede loguearse. Para la demo del hackatón hay
  que añadir como test users las cuentas que vayan a entrar, o publicar la app.
  Los scopes `openid/email/profile` no son sensibles; los de calendario
  (`freebusy`, `events.owned`) sí pueden requerir verificación al publicar.
  No prometer fecha de verificación: fuera del alcance del hackatón.

## 9. Plan de implementación por fases (PRs pequeños)

### Fase 1 — Login + `me` + protección de PATCH

- Prisma: `User` + `Session`, `Business.ownerId` nullable. Migración.
- Store en memoria: espejo (`UserRecord`, `SessionRecord`).
- Nuevos: `routes/auth.ts` (`/auth/google`, `/auth/google/callback`,
  `/auth/me`, `/auth/logout`), `middleware/auth.ts`, `WEB_URL`,
  `AUTH_GOOGLE_REDIRECT_URI`, `OAUTH_STATE_SECRET` en `.env.example`.
- CORS con `credentials: true` + `credentials: "include"` en los fetch con auth.
- `PATCH /businesses/:slug` con `requireAuth + requireBusinessOwner`.
- Web: `/login` (un botón) + redirección a `/login` desde `/negocio/[slug]`
  cuando `/auth/me` da 401.
- **Verificar:** entrar con la cuenta de Axel (test user) → `/auth/me` devuelve
  usuario y `businesses: []`; sin cookie → 401; PATCH con otra cuenta / sin
  sesión → 401/403; logout invalida la sesión (reusar la cookie vieja → 401);
  `tsc` + `next build` en verde.

### Fase 2 — Onboarding + dashboard + calendario detrás de auth

- `POST /businesses` (crear negocio + primer servicio) y `/onboarding`.
- `/dashboard` (layout persistente + selector de negocio; gestión en ajustes) y `/negocio/[slug]` ya con sesión.
- `GET /google/auth` con sesión + propiedad, `state` firmado (adiós `state=slug`),
  callback con 302 a la web.
- `POST /bookings` `source='business'` y `GET /availability?actor=business`
  con propiedad real (el query param deja de autorizar).
- Cifrado del `refresh_token` en reposo (`GOOGLE_TOKEN_ENCRYPTION_KEY`).
- **Verificar:** flujo completo de §6(a) de punta a punta con una cuenta de
  prueba; conectar calendario y ver evento en Google; un dueño B no puede
  apartar ni cambiar la agenda del negocio de A (403 en API y en web); la
  agenda privada sigue bloqueando al cliente sin sesión.

### Fase 3 — Migración de `barberia-demo` a un dueño real

- Script / paso manual documentado: asignar `ownerId` de `barberia-demo` a la
  cuenta de Axel (por `googleSub`, nunca por email a mano en un SQL sin verificar).
- `ownerId` pasa a requerido en Prisma (migración) una vez que no quedan negocios
  sin dueño. Quitar el seed sin dueño.
- Limpieza: borrar el bypass `actor=business` sin sesión si quedara algún resto,
  y revisar que `GET /businesses/:slug` no filtre datos del dueño.
- **Verificar:** `barberia-demo` solo la administra Axel; el resto del flujo
  (reserva pública, manual, confirmar, webhook) sigue igual; demo del pitch
  (3 min) ensayada con la cuenta real.

## 10. Decisiones de Axel (2026-11-23)

1. **Solo Google.** Nada de magic link, ni ahora ni como plan inmediato. El login
   es únicamente "Entrar con Google".
2. **Sin lista de negocios en el dashboard.** El modelo sigue siendo 1:N (un
   dueño, varios negocios), pero la UI no es una lista: es un layout persistente
   con un selector para cambiar de negocio rápidamente, y la gestión de los
   negocios (crear, editar, eliminar) se hace desde un menú de ajustes.
3. **Sí, `aaxelaltamirano@gmail.com` es la dueña de `barberia-demo`** (fase 3 la
   asigna por `googleSub`). Y al crear un negocio **se pregunta siempre** si la
   agenda es pública o privada: no hay default silencioso.
