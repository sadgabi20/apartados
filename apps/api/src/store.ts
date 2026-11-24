// Store en memoria para el arranque del sábado — SOLO demo local.
// La tienda de producción es Prisma + Supabase/Postgres
// (packages/db/schema.prisma). Cuando DATABASE_URL esté lista, este
// módulo se sustituye por el cliente Prisma sin tocar las rutas:
// los servicios solo usan esta interfaz.
export type AppointmentStatus = "hold" | "confirmed" | "released" | "cancelled";

export type AgendaVisibility = "public" | "private";

export interface BusinessRecord {
  id: string;
  slug: string;
  name: string;
  agendaVisibility: AgendaVisibility;
  // Dueño del negocio (googleSub de User). null = sin dueño (seed
  // barberia-demo hasta la Fase 3): nadie puede administrarlo.
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
  // Pey rechaza el UUID (400 "Numeric reference must be up to 7 digits").
  numRef: string;
  googleEventId: string | null;
  peyQrId: string | null;
  transactionId: string | null;
  customerName: string;
  customerPhone: string;
  expiresAt: string;
  createdAt: string;
}

export interface AppointmentStore {
  getBusinessBySlug(slug: string): BusinessRecord | undefined;
  getBusiness(id: string): BusinessRecord | undefined;
  saveBusiness(b: BusinessRecord): void;
  // Auth Fase 2: crear negocio (con ownerId de la sesión) y servicios.
  createBusiness(b: Omit<BusinessRecord, "id">): BusinessRecord;
  createService(s: Omit<ServiceRecord, "id">): ServiceRecord;
  listBusinessesByOwner(ownerId: string): BusinessRecord[];
  getService(id: string): ServiceRecord | undefined;
  listServices(businessId: string): ServiceRecord[];
  createAppointment(a: Omit<AppointmentRecord, "id" | "createdAt" | "numRef"> & { id?: string; numRef?: string }): AppointmentRecord;
  getAppointment(id: string): AppointmentRecord | undefined;
  getAppointmentByNumRef(numRef: string): AppointmentRecord | undefined;
  updateAppointment(id: string, patch: Partial<AppointmentRecord>): AppointmentRecord | undefined;
  listExpiredHolds(now: Date): AppointmentRecord[];
  // Auth Fase 1: upsert por googleSub (la identidad es el sub, no el email).
  upsertUserByGoogleSub(u: Omit<UserRecord, "id" | "createdAt" | "updatedAt">): UserRecord;
  getUserById(id: string): UserRecord | undefined;
  createSession(s: Omit<SessionRecord, "id" | "createdAt">): SessionRecord;
  getSessionByTokenHash(tokenHash: string): SessionRecord | undefined;
  updateSession(id: string, patch: Partial<SessionRecord>): SessionRecord | undefined;
  deleteSession(id: string): void;
  deleteSessionsByUserId(userId: string): void;
}

export function createMemoryStore(): AppointmentStore {
  const businesses = new Map<string, BusinessRecord>();
  const services = new Map<string, ServiceRecord>();
  const appointments = new Map<string, AppointmentRecord>();
  const users = new Map<string, UserRecord>();
  const sessions = new Map<string, SessionRecord>();
  // Pey exige numRef numérico de hasta 7 dígitos: secuencial por cita.
  let nextNumRef = 1000000;

  // Negocio demo por defecto: barbería, anticipo $50 (decisión por defecto
  // del sábado 21 nov; se cambia con una palabra). Sin dueño hasta la
  // Fase 3 (ownerId null): sus endpoints protegidos dan 403 para todos.
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
    getBusinessBySlug: (slug) =>
      [...businesses.values()].find((b) => b.slug === slug),
    getBusiness: (id) => businesses.get(id),
    saveBusiness: (b) => {
      businesses.set(b.id, b);
    },
    createBusiness: (b) => {
      const rec: BusinessRecord = { ...b, id: crypto.randomUUID() };
      businesses.set(rec.id, rec);
      return rec;
    },
    createService: (s) => {
      const rec: ServiceRecord = { ...s, id: crypto.randomUUID() };
      services.set(rec.id, rec);
      return rec;
    },
    listBusinessesByOwner: (ownerId) =>
      [...businesses.values()].filter((b) => b.ownerId === ownerId),
    upsertUserByGoogleSub: (u) => {
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
    getUserById: (id) => users.get(id),
    createSession: (s) => {
      const rec: SessionRecord = { ...s, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
      sessions.set(rec.id, rec);
      return rec;
    },
    getSessionByTokenHash: (tokenHash) =>
      [...sessions.values()].find((s) => s.tokenHash === tokenHash),
    updateSession: (id, patch) => {
      const rec = sessions.get(id);
      if (!rec) return undefined;
      const next = { ...rec, ...patch };
      sessions.set(id, next);
      return next;
    },
    deleteSession: (id) => {
      sessions.delete(id);
    },
    deleteSessionsByUserId: (userId) => {
      for (const s of [...sessions.values()]) {
        if (s.userId === userId) sessions.delete(s.id);
      }
    },
    getService: (id) => services.get(id),
    listServices: (businessId) =>
      [...services.values()].filter((s) => s.businessId === businessId),
    createAppointment: (a) => {
      const rec: AppointmentRecord = {
        ...a,
        id: a.id ?? crypto.randomUUID(),
        numRef: a.numRef ?? String(++nextNumRef),
        createdAt: new Date().toISOString(),
      };
      appointments.set(rec.id, rec);
      return rec;
    },
    getAppointment: (id) => appointments.get(id),
    getAppointmentByNumRef: (numRef) =>
      [...appointments.values()].find((a) => a.numRef === numRef),
    updateAppointment: (id, patch) => {
      const rec = appointments.get(id);
      if (!rec) return undefined;
      const next = { ...rec, ...patch };
      appointments.set(id, next);
      return next;
    },
    listExpiredHolds: (now) =>
      [...appointments.values()].filter(
        (a) => a.status === "hold" && new Date(a.expiresAt) <= now,
      ),
  };
}
