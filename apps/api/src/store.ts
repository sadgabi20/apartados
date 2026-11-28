// Store de Apartados: la interfaz que usan rutas y servicios.
// Hay dos implementaciones con el mismo contrato:
//   - Memoria (createMemoryStore, este archivo): dev local sin base.
//     Se pierde al reiniciar, igual que antes.
//   - Prisma + Supabase/Postgres (store-prisma.ts): producción, cuando
//     DATABASE_URL está configurado. Los datos sobreviven a reinicios.
// La interfaz es ASÍNCRONA en ambas: la de Prisma habla con la base por
// red y la de memoria resuelve promesas al instante, así las rutas no
// distinguen qué store hay detrás (todo con await).
// Los servicios solo usan esta interfaz: nunca tocan Prisma directo.
export type AppointmentStatus = "hold" | "confirmed" | "released" | "cancelled";

export type AgendaVisibility = "public" | "private";

export interface BusinessRecord {
  id: string;
  slug: string;
  name: string;
  agendaVisibility: AgendaVisibility;
  // Dueño del negocio (id interno de User). null = sin dueño todavía:
  // la barbería demo nace sin dueño en el seed de memoria y se reclama
  // en el primer login del googleSub configurado en DEMO_OWNER_GOOGLE_SUB
  // (Fase 3, services/demo-owner.ts). Mientras no tenga dueño, sus
  // endpoints protegidos dan 403 para todo el mundo.
  // En Prisma (store-prisma.ts) ownerId es NOT NULL desde la Fase 3:
  // el seed de base crea la demo solo cuando ya existe su dueño.
  ownerId: string | null;
  calendarId: string | null;
  googleAccessToken: string | null;
  // Refresh token CIFRADO en reposo (AES-256-GCM, formato "v1:..." — ver
  // services/token-crypto.ts). Nunca en claro, nunca en logs ni en
  // respuestas. Antes de usarlo hay que descifrarlo.
  googleRefreshToken: string | null;
}

// Auth Fase 1 — espejo de los modelos User/Session de Prisma.
// La sesión guarda solo el SHA-256 del token; el token en claro solo
// existe en la cookie httpOnly del navegador.
export interface UserRecord {
  id: string;
  googleSub: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  lastUsedAt: string;
  userAgent: string | null;
  createdAt: string;
}

export interface ServiceRecord {
  id: string;
  businessId: string;
  name: string;
  durationMin: number;
  depositAmount: number; // MXN
}

export interface AppointmentRecord {
  id: string;
  businessId: string;
  serviceId: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  depositAmount: number;
  // Referencia numérica para Pey: hasta 7 dígitos, única por cita.
  // Pey rechaza el UUID (400 "Numeric reference must be up to 7 dígitos").
  numRef: string;
  googleEventId: string | null;
  peyQrId: string | null;
  transactionId: string | null;
  customerName: string;
  customerPhone: string;
  expiresAt: string;
  createdAt: string;
}

// Cuenta de pagos del negocio en Pey (CoDi). Una por negocio.
// La CLABE completa NUNCA se guarda en Apartados: se manda una vez a
// Pey y solo se conservan el id de Pey + los últimos 4 dígitos.
// Solo las cuentas ACTIVE pueden recibir pagos (el QR se crea con su
// bankAccountId); PENDING/PROCESSING = en validación con Banxico.
export type PeyBankAccountStatus = "PENDING" | "PROCESSING" | "ACTIVE" | "ERROR";

export interface PeyBankAccountRecord {
  id: string;
  businessId: string;
  peyBankAccountId: string; // ULID que devuelve Pey: el bankAccountId del QR
  alias: string;
  status: PeyBankAccountStatus;
  holderName: string;
  clabeLast4: string; // últimos 4 dígitos de la CLABE, solo para mostrar
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentStore {
  getBusinessBySlug(slug: string): Promise<BusinessRecord | undefined>;
  getBusiness(id: string): Promise<BusinessRecord | undefined>;
  saveBusiness(b: BusinessRecord): Promise<void>;
  // Cuenta de pagos Pey (CoDi): una por negocio. saveBankAccount hace
  // upsert por businessId (re-registrar reemplaza la cuenta anterior).
  getBankAccount(businessId: string): Promise<PeyBankAccountRecord | undefined>;
  saveBankAccount(a: Omit<PeyBankAccountRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<PeyBankAccountRecord>;
  // Auth Fase 2: crear negocio (con ownerId de la sesión) y servicios.
  createBusiness(b: Omit<BusinessRecord, "id"> & { id?: string }): Promise<BusinessRecord>;
  createService(s: Omit<ServiceRecord, "id"> & { id?: string }): Promise<ServiceRecord>;
  listBusinessesByOwner(ownerId: string): Promise<BusinessRecord[]>;
  getService(id: string): Promise<ServiceRecord | undefined>;
  listServices(businessId: string): Promise<ServiceRecord[]>;
  createAppointment(a: Omit<AppointmentRecord, "id" | "createdAt" | "numRef"> & { id?: string; numRef?: string }): Promise<AppointmentRecord>;
  getAppointment(id: string): Promise<AppointmentRecord | undefined>;
  getAppointmentByNumRef(numRef: string): Promise<AppointmentRecord | undefined>;
  updateAppointment(id: string, patch: Partial<AppointmentRecord>): Promise<AppointmentRecord | undefined>;
  listExpiredHolds(now: Date): Promise<AppointmentRecord[]>;
  // Citas de un negocio (para el respaldo anti-doble-reserva sin Google:
  // createHold y /availability revisan solapes en base de datos cuando
  // no hay freeBusy que consultar).
  listAppointmentsByBusiness(businessId: string): Promise<AppointmentRecord[]>;
  // Auth Fase 1: upsert por googleSub (la identidad es el sub, no el email).
  upsertUserByGoogleSub(u: Omit<UserRecord, "id" | "createdAt" | "updatedAt">): Promise<UserRecord>;
  getUserById(id: string): Promise<UserRecord | undefined>;
  createSession(s: Omit<SessionRecord, "id" | "createdAt">): Promise<SessionRecord>;
  getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined>;
  updateSession(id: string, patch: Partial<SessionRecord>): Promise<SessionRecord | undefined>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsByUserId(userId: string): Promise<void>;
}

export function createMemoryStore(): AppointmentStore {
  const businesses = new Map<string, BusinessRecord>();
  const services = new Map<string, ServiceRecord>();
  const appointments = new Map<string, AppointmentRecord>();
  const users = new Map<string, UserRecord>();
  const sessions = new Map<string, SessionRecord>();
  // Cuenta de pagos Pey por negocio (1:1, clave = businessId).
  const bankAccounts = new Map<string, PeyBankAccountRecord>();
  // Pey exige numRef numérico de hasta 7 dígitos: secuencial por cita.
  let nextNumRef = 1000000;

  // Negocio demo por defecto: barbería, anticipo $50 (decisión por defecto
  // del sábado 21 nov; se cambia con una palabra). Nace sin dueño y se
  // reclama en el login del googleSub de DEMO_OWNER_GOOGLE_SUB (Fase 3,
  // services/demo-owner.ts): el seed no puede asignar dueño porque el id
  // interno del usuario solo existe después de su primer login.
  const business: BusinessRecord = {
    id: "biz-barberia-demo",
    slug: "barberia-demo",
    name: "Barbería Demo",
    agendaVisibility: "public",
    ownerId: null,
    calendarId: process.env.GOOGLE_TEST_CALENDAR_ID ?? null,
    googleAccessToken: process.env.GOOGLE_TEST_ACCESS_TOKEN ?? null,
    googleRefreshToken: null,
  };
  businesses.set(business.id, business);
  const service: ServiceRecord = {
    id: "svc-corte-barba",
    businessId: business.id,
    name: "Corte + barba",
    durationMin: 60,
    depositAmount: Number(process.env.DEMO_DEPOSIT_MXN ?? 50),
  };
  services.set(service.id, service);

  return {
    getBusinessBySlug: async (slug) =>
      [...businesses.values()].find((b) => b.slug === slug),
    getBusiness: async (id) => businesses.get(id),
    saveBusiness: async (b) => {
      businesses.set(b.id, b);
    },
    getBankAccount: async (businessId) => bankAccounts.get(businessId),
    saveBankAccount: async (a) => {
      const now = new Date().toISOString();
      const existing = bankAccounts.get(a.businessId);
      const rec: PeyBankAccountRecord = {
        ...a,
        id: a.id ?? existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      bankAccounts.set(a.businessId, rec);
      return rec;
    },
    createBusiness: async (b) => {
      const rec: BusinessRecord = { ...b, id: b.id ?? crypto.randomUUID() };
      businesses.set(rec.id, rec);
      return rec;
    },
    createService: async (s) => {
      const rec: ServiceRecord = { ...s, id: s.id ?? crypto.randomUUID() };
      services.set(rec.id, rec);
      return rec;
    },
    listBusinessesByOwner: async (ownerId) =>
      [...businesses.values()].filter((b) => b.ownerId === ownerId),
    upsertUserByGoogleSub: async (u) => {
      const now = new Date().toISOString();
      const existing = [...users.values()].find((x) => x.googleSub === u.googleSub);
      if (existing) {
        // El email puede cambiar en Google; el sub no. Se actualiza el
        // perfil, nunca se crea un segundo usuario.
        const next = { ...existing, email: u.email, name: u.name, avatarUrl: u.avatarUrl, updatedAt: now };
        users.set(next.id, next);
        return next;
      }
      const rec: UserRecord = { ...u, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      users.set(rec.id, rec);
      return rec;
    },
    getUserById: async (id) => users.get(id),
    createSession: async (s) => {
      const rec: SessionRecord = { ...s, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
      sessions.set(rec.id, rec);
      return rec;
    },
    getSessionByTokenHash: async (tokenHash) =>
      [...sessions.values()].find((s) => s.tokenHash === tokenHash),
    updateSession: async (id, patch) => {
      const rec = sessions.get(id);
      if (!rec) return undefined;
      const next = { ...rec, ...patch };
      sessions.set(id, next);
      return next;
    },
    deleteSession: async (id) => {
      sessions.delete(id);
    },
    deleteSessionsByUserId: async (userId) => {
      for (const s of [...sessions.values()]) {
        if (s.userId === userId) sessions.delete(s.id);
      }
    },
    getService: async (id) => services.get(id),
    listServices: async (businessId) =>
      [...services.values()].filter((s) => s.businessId === businessId),
    createAppointment: async (a) => {
      const rec: AppointmentRecord = {
        ...a,
        id: a.id ?? crypto.randomUUID(),
        numRef: a.numRef ?? String(++nextNumRef),
        createdAt: new Date().toISOString(),
      };
      appointments.set(rec.id, rec);
      return rec;
    },
    getAppointment: async (id) => appointments.get(id),
    getAppointmentByNumRef: async (numRef) =>
      [...appointments.values()].find((a) => a.numRef === numRef),
    updateAppointment: async (id, patch) => {
      const rec = appointments.get(id);
      if (!rec) return undefined;
      const next = { ...rec, ...patch };
      appointments.set(id, next);
      return next;
    },
    listExpiredHolds: async (now) =>
      [...appointments.values()].filter(
        (a) => a.status === "hold" && new Date(a.expiresAt) <= now,
      ),
    listAppointmentsByBusiness: async (businessId) =>
      [...appointments.values()].filter((a) => a.businessId === businessId),
  };
}
