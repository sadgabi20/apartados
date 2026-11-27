// Punto de entrada del paquete @apartados/db: re-exporta el cliente
// Prisma generado (prisma generate, ver package.json postinstall).
// La API importa PrismaClient desde aquí, nunca desde "@prisma/client"
// directamente: así el cliente generado vive en un solo lugar y la API
// no necesita su propia dependencia de @prisma/client.
//
// Generación: `pnpm --filter @apartados/db generate` (o postinstall).
// En Render, el postinstall corre durante el build y descarga el
// query engine; en local, si el generate no se ha corrido, importar
// este módulo falla con un error claro de Prisma.
export { PrismaClient } from "@prisma/client";
export type {
  Appointment as PrismaAppointment,
  Business as PrismaBusiness,
  GoogleAccount as PrismaGoogleAccount,
  PeyBankAccount as PrismaPeyBankAccount,
  Service as PrismaService,
  Session as PrismaSession,
  User as PrismaUser,
} from "@prisma/client";
