// Store en memoria para el arranque del sábado — SOLO demo local.
// La tienda de producción es Prisma + Supabase/Postgres
// (packages/db/schema.prisma). Cuando DATABASE_URL esté lista, este
// módulo se sustituye por el cliente Prisma sin tocar las rutas:
// los servicios solo usan esta interfaz.
export type AppointmentStatus = "hold" | "confirmed" | "released" | "cancelled";

export interface BusinessRecord {
  id: string;
  slug: string;
  name: string;
  calendarId: string | null;
  googleAccessToken: string | null;
  googleRefreshToken: string | null;
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
  getService(id: string): ServiceRecord | undefined;
  listServices(businessId: string): ServiceRecord[];
  createAppointment(a: Omit<AppointmentRecord, "id" | "createdAt"> & { id?: string }): AppointmentRecord;
  getAppointment(id: string): AppointmentRecord | undefined;
  updateAppointment(id: string, patch: Partial<AppointmentRecord>): AppointmentRecord | undefined;
  listExpiredHolds(now: Date): AppointmentRecord[];
}

export function createMemoryStore(): AppointmentStore {
  const businesses = new Map<string, BusinessRecord>();
  const services = new Map<string, ServiceRecord>();
  const appointments = new Map<string, AppointmentRecord>();

  // Negocio demo por defecto: barbería, anticipo $50 (decisión por defecto
  // del sábado 21 nov; se cambia con una palabra).
  const business: BusinessRecord = {
    id: "biz-barberia-demo",
    slug: "barberia-demo",
    name: "Barbería Demo",
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
    getService: (id) => services.get(id),
    listServices: (businessId) =>
      [...services.values()].filter((s) => s.businessId === businessId),
    createAppointment: (a) => {
      const rec: AppointmentRecord = {
        ...a,
        id: a.id ?? crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      appointments.set(rec.id, rec);
      return rec;
    },
    getAppointment: (id) => appointments.get(id),
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
