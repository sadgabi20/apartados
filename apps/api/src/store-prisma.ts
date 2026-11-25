// Store Prisma + Supabase/Postgres (producción).
// Mismo contrato que el store en memoria (store.ts): rutas y servicios
// no distinguen qué store hay detrás.
//
// Mapeo de modelos (packages/db/prisma/schema.prisma):
// - BusinessRecord ↔ Business + su GoogleAccount (tabla aparte, 1:1):
//   calendarId/accessToken/refreshToken del record viven en GoogleAccount.
//   En BusinessRecord esos campos son null cuando no hay cuenta conectada.
// - User/Session/Service/Appointment/Payment: 1:1 con sus modelos.
//   (Payment no tiene métodos propios en la interfaz: el webhook solo
//   lee la cita por numRef y confirma; los pagos se crean en el flujo
//   de Pey, no en el store.)
// - Fechas: Prisma usa Date, los records usan strings ISO.
//
// Seed (ensureSeed, corre al crear el store):
// - Business.ownerId es NOT NULL desde la Fase 3, así que la demo NO
//   puede nacer sin dueño en la base como nacía en memoria. La solución:
//   si DEMO_OWNER_GOOGLE_SUB está configurado, el seed crea (o reusa)
//   un usuario "fantasma" con ese googleSub y email
//   demo-owner-<googleSub>@apartados.local, y crea barberia-demo con
//   ese dueño + su servicio. En el primer login real, el upsert por
//   googleSub encuentra ese mismo usuario (mismo id) y actualiza su
//   email/nombre/avatar a los reales: el dueño ya es Axel desde el
//   arranque y el reclamo de Fase 3 queda como red de seguridad.
// - Si la variable no está puesta o el usuario dueño aún no existe (no
//   ha entrado nunca), la demo NO se crea todavía: la crea el reclamo
//   en el login (services/demo-owner.ts, rama "demo no existe").
// - Si la variable cambia después de sembrar y el dueño actual es un
//   fantasma (email @apartados.local, nunca entró), el seed reasigna
//   la demo al fantasma del nuevo googleSub. Un dueño REAL nunca se
//   reasigna por cambiar la variable (diseño Fase 3: el dueño actual
//   manda).
import { PrismaClient } from "@apartados/db";
import type {
  PrismaAppointment,
  PrismaBusiness,
  PrismaGoogleAccount,
  PrismaService,
  PrismaSession,
  PrismaUser,
} from "@apartados/db";
import { demoOwnerGoogleSub, DEMO_BUSINESS_ID, DEMO_BUSINESS_SLUG } from "./services/demo-owner";
import type {
  AgendaVisibility,
  AppointmentRecord,
  AppointmentStatus,
  AppointmentStore,
  BusinessRecord,
  ServiceRecord,
  SessionRecord,
  UserRecord,
} from "./store";

type BusinessWithGoogle = PrismaBusiness & {
  googleAccount: PrismaGoogleAccount | null;
};

/** Email del usuario fantasma del seed: marca inequívoca de "sin login real". */
const PLACEHOLDER_EMAIL_DOMAIN = "@apartados.local";
function placeholderEmail(googleSub: string): string {
  return `demo-owner-${googleSub}${PLACEHOLDER_EMAIL_DOMAIN}`;
}
function isPlaceholderUser(user: PrismaUser): boolean {
  return user.email.endsWith(PLACEHOLDER_EMAIL_DOMAIN);
}

function toBusinessRecord(b: BusinessWithGoogle): BusinessRecord {
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    agendaVisibility: b.agendaVisibility as AgendaVisibility,
    ownerId: b.ownerId,
    calendarId: b.googleAccount?.calendarId ?? null,
    googleAccessToken: b.googleAccount?.accessToken ?? null,
    googleRefreshToken: b.googleAccount?.refreshToken ?? null,
  };
}

function toServiceRecord(s: PrismaService): ServiceRecord {
  return {
    id: s.id,
    businessId: s.businessId,
    name: s.name,
    durationMin: s.durationMin,
    depositAmount: s.depositAmount,
  };
}

function toAppointmentRecord(a: PrismaAppointment): AppointmentRecord {
  return {
    id: a.id,
    businessId: a.businessId,
    serviceId: a.serviceId,
    startAt: a.startAt.toISOString(),
    endAt: a.endAt.toISOString(),
    status: a.status as AppointmentStatus,
    depositAmount: a.depositAmount,
    numRef: a.numRef,
    googleEventId: a.googleEventId,
    peyQrId: a.peyQrId,
    transactionId: a.transactionId,
    customerName: a.customerName ?? "",
    customerPhone: a.customerPhone ?? "",
    expiresAt: a.expiresAt.toISOString(),
    createdAt: a.createdAt.toISOString(),
  };
}

function toUserRecord(u: PrismaUser): UserRecord {
  return {
    id: u.id,
    googleSub: u.googleSub,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

function toSessionRecord(s: PrismaSession): SessionRecord {
  return {
    id: s.id,
    userId: s.userId,
    tokenHash: s.tokenHash,
    expiresAt: s.expiresAt.toISOString(),
    lastUsedAt: s.lastUsedAt.toISOString(),
    userAgent: s.userAgent,
    createdAt: s.createdAt.toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === "P2002";
}
function isNotFound(err: unknown): boolean {
  return (err as { code?: string }).code === "P2025";
}

const BUSINESS_INCLUDE = { googleAccount: true } as const;

/**
 * Seed de la demo en base. Idempotente; se puede correr en cada arranque.
 * Ver el comentario del encabezado para el porqué del usuario fantasma.
 */
export async function ensureSeed(prisma: PrismaClient): Promise<void> {
  const configuredSub = demoOwnerGoogleSub();
  let owner: PrismaUser | null = null;
  if (configuredSub) {
    owner = await prisma.user.findUnique({ where: { googleSub: configuredSub } });
    if (!owner) {
      owner = await prisma.user.create({
        data: {
          googleSub: configuredSub,
          email: placeholderEmail(configuredSub),
          name: "Dueño demo",
          avatarUrl: null,
        },
      });
    }
  }

  const demo = await prisma.business.findUnique({
    where: { slug: DEMO_BUSINESS_SLUG },
    include: BUSINESS_INCLUDE,
  });
  if (!demo) {
    // Sin dueño configurado (o sin usuario todavía): no se crea. La crea
    // el reclamo en el primer login del googleSub configurado.
    if (!owner) return;
    await prisma.business.create({
      data: {
        id: DEMO_BUSINESS_ID,
        slug: DEMO_BUSINESS_SLUG,
        name: "Barbería Demo",
        agendaVisibility: "public",
        ownerId: owner.id,
        services: {
          create: {
            id: "svc-corte-barba",
            name: "Corte + barba",
            durationMin: 60,
            depositAmount: Number(process.env.DEMO_DEPOSIT_MXN ?? 50),
          },
        },
        ...(process.env.GOOGLE_TEST_CALENDAR_ID
          ? {
              googleAccount: {
                create: {
                  calendarId: process.env.GOOGLE_TEST_CALENDAR_ID,
                  accessToken: process.env.GOOGLE_TEST_ACCESS_TOKEN ?? null,
                },
              },
            }
          : {}),
      },
    });
    return;
  }

  // La demo ya existe: solo se reasigna si su dueño actual es un
  // fantasma del seed y la variable ahora apunta a otro googleSub.
  // Un dueño real nunca se toca.
  if (configuredSub && owner) {
    const currentOwner = await prisma.user.findUnique({ where: { id: demo.ownerId } });
    if (
      currentOwner &&
      isPlaceholderUser(currentOwner) &&
      currentOwner.googleSub !== configuredSub
    ) {
      await prisma.business.update({
        where: { id: demo.id },
        data: { ownerId: owner.id },
      });
    }
  }
}

export async function createPrismaStore(prisma: PrismaClient): Promise<AppointmentStore> {
  await prisma.$connect();
  await ensureSeed(prisma);

  const store: AppointmentStore = {
    getBusinessBySlug: async (slug) => {
      const b = await prisma.business.findUnique({
        where: { slug },
        include: BUSINESS_INCLUDE,
      });
      return b ? toBusinessRecord(b) : undefined;
    },
    getBusiness: async (id) => {
      const b = await prisma.business.findUnique({
        where: { id },
        include: BUSINESS_INCLUDE,
      });
      return b ? toBusinessRecord(b) : undefined;
    },
    saveBusiness: async (b) => {
      await prisma.business.update({
        where: { id: b.id },
        data: {
          slug: b.slug,
          name: b.name,
          agendaVisibility: b.agendaVisibility,
          // ownerId null nunca se guarda: en Prisma es NOT NULL desde
          // Fase 3 y ningún llamador limpia el dueño (el reclamo solo
          // lo asigna). Si llega null, se conserva el dueño actual.
          ...(b.ownerId ? { ownerId: b.ownerId } : {}),
        },
      });
      const hasGoogle =
        b.calendarId !== null || b.googleAccessToken !== null || b.googleRefreshToken !== null;
      if (hasGoogle) {
        await prisma.googleAccount.upsert({
          where: { businessId: b.id },
          create: {
            businessId: b.id,
            calendarId: b.calendarId ?? "primary",
            accessToken: b.googleAccessToken,
            refreshToken: b.googleRefreshToken,
          },
          update: {
            calendarId: b.calendarId ?? "primary",
            accessToken: b.googleAccessToken,
            refreshToken: b.googleRefreshToken,
          },
        });
      } else {
        await prisma.googleAccount.deleteMany({ where: { businessId: b.id } });
      }
    },
    createBusiness: async (b) => {
      if (!b.ownerId) {
        throw new Error("createBusiness requiere ownerId (NOT NULL desde Fase 3)");
      }
      const created = await prisma.business.create({
        data: {
          ...(b.id ? { id: b.id } : {}),
          slug: b.slug,
          name: b.name,
          agendaVisibility: b.agendaVisibility,
          ownerId: b.ownerId,
        },
        include: BUSINESS_INCLUDE,
      });
      return toBusinessRecord(created);
    },
    createService: async (s) => {
      const created = await prisma.service.create({
        data: {
          ...(s.id ? { id: s.id } : {}),
          businessId: s.businessId,
          name: s.name,
          durationMin: s.durationMin,
          depositAmount: s.depositAmount,
        },
      });
      return toServiceRecord(created);
    },
    listBusinessesByOwner: async (ownerId) => {
      const list = await prisma.business.findMany({
        where: { ownerId },
        include: BUSINESS_INCLUDE,
      });
      return list.map(toBusinessRecord);
    },
    getService: async (id) => {
      const s = await prisma.service.findUnique({ where: { id } });
      return s ? toServiceRecord(s) : undefined;
    },
    listServices: async (businessId) => {
      const list = await prisma.service.findMany({ where: { businessId } });
      return list.map(toServiceRecord);
    },
    createAppointment: async (a) => {
      // numRef secuencial de 7 dígitos (Pey lo exige numérico). Se calcula
      // como max+1; si dos reservas chocan en el unique, se reintenta.
      if (a.numRef) {
        const created = await prisma.appointment.create({
          data: {
            ...(a.id ? { id: a.id } : {}),
            businessId: a.businessId,
            serviceId: a.serviceId,
            startAt: new Date(a.startAt),
            endAt: new Date(a.endAt),
            status: a.status,
            depositAmount: a.depositAmount,
            numRef: a.numRef,
            googleEventId: a.googleEventId,
            peyQrId: a.peyQrId,
            transactionId: a.transactionId,
            customerName: a.customerName,
            customerPhone: a.customerPhone,
            expiresAt: new Date(a.expiresAt),
          },
        });
        return toAppointmentRecord(created);
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const max = await prisma.appointment.aggregate({ _max: { numRef: true } });
        const nextNumRef = max._max.numRef
          ? String(Number.parseInt(max._max.numRef, 10) + 1)
          : "1000001";
        try {
          const created = await prisma.appointment.create({
            data: {
              ...(a.id ? { id: a.id } : {}),
              businessId: a.businessId,
              serviceId: a.serviceId,
              startAt: new Date(a.startAt),
              endAt: new Date(a.endAt),
              status: a.status,
              depositAmount: a.depositAmount,
              numRef: nextNumRef,
              googleEventId: a.googleEventId,
              peyQrId: a.peyQrId,
              transactionId: a.transactionId,
              customerName: a.customerName,
              customerPhone: a.customerPhone,
              expiresAt: new Date(a.expiresAt),
            },
          });
          return toAppointmentRecord(created);
        } catch (err) {
          if (isUniqueViolation(err) && attempt < 4) continue;
          throw err;
        }
      }
      throw new Error("No se pudo asignar numRef tras varios intentos");
    },
    getAppointment: async (id) => {
      const a = await prisma.appointment.findUnique({ where: { id } });
      return a ? toAppointmentRecord(a) : undefined;
    },
    getAppointmentByNumRef: async (numRef) => {
      const a = await prisma.appointment.findUnique({ where: { numRef } });
      return a ? toAppointmentRecord(a) : undefined;
    },
    updateAppointment: async (id, patch) => {
      const data: Record<string, unknown> = {};
      if (patch.status !== undefined) data.status = patch.status;
      if (patch.depositAmount !== undefined) data.depositAmount = patch.depositAmount;
      if (patch.googleEventId !== undefined) data.googleEventId = patch.googleEventId;
      if (patch.peyQrId !== undefined) data.peyQrId = patch.peyQrId;
      if (patch.transactionId !== undefined) data.transactionId = patch.transactionId;
      if (patch.startAt !== undefined) data.startAt = new Date(patch.startAt);
      if (patch.endAt !== undefined) data.endAt = new Date(patch.endAt);
      if (patch.expiresAt !== undefined) data.expiresAt = new Date(patch.expiresAt);
      try {
        const updated = await prisma.appointment.update({ where: { id }, data });
        return toAppointmentRecord(updated);
      } catch (err) {
        if (isNotFound(err)) return undefined;
        throw err;
      }
    },
    listExpiredHolds: async (now) => {
      const list = await prisma.appointment.findMany({
        where: { status: "hold", expiresAt: { lte: now } },
      });
      return list.map(toAppointmentRecord);
    },
    upsertUserByGoogleSub: async (u) => {
      const user = await prisma.user.upsert({
        where: { googleSub: u.googleSub },
        update: { email: u.email, name: u.name, avatarUrl: u.avatarUrl },
        create: {
          googleSub: u.googleSub,
          email: u.email,
          name: u.name,
          avatarUrl: u.avatarUrl,
        },
      });
      return toUserRecord(user);
    },
    getUserById: async (id) => {
      const u = await prisma.user.findUnique({ where: { id } });
      return u ? toUserRecord(u) : undefined;
    },
    createSession: async (s) => {
      const created = await prisma.session.create({
        data: {
          userId: s.userId,
          tokenHash: s.tokenHash,
          expiresAt: new Date(s.expiresAt),
          lastUsedAt: new Date(s.lastUsedAt),
          userAgent: s.userAgent,
        },
      });
      return toSessionRecord(created);
    },
    getSessionByTokenHash: async (tokenHash) => {
      const s = await prisma.session.findUnique({ where: { tokenHash } });
      return s ? toSessionRecord(s) : undefined;
    },
    updateSession: async (id, patch) => {
      const data: Record<string, unknown> = {};
      if (patch.tokenHash !== undefined) data.tokenHash = patch.tokenHash;
      if (patch.expiresAt !== undefined) data.expiresAt = new Date(patch.expiresAt);
      if (patch.lastUsedAt !== undefined) data.lastUsedAt = new Date(patch.lastUsedAt);
      if (patch.userAgent !== undefined) data.userAgent = patch.userAgent;
      try {
        const updated = await prisma.session.update({ where: { id }, data });
        return toSessionRecord(updated);
      } catch (err) {
        if (isNotFound(err)) return undefined;
        throw err;
      }
    },
    deleteSession: async (id) => {
      await prisma.session.deleteMany({ where: { id } });
    },
    deleteSessionsByUserId: async (userId) => {
      await prisma.session.deleteMany({ where: { userId } });
    },
  };

  return store;
}
