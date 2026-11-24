-- Auth Fase 3: Business.ownerId pasa a requerido (NOT NULL).
-- Escrito a mano siguiendo el diseño (docs/auth-design.md §4 y §9) y las
-- convenciones de Prisma 5 para PostgreSQL. No se pudo generar con
-- `prisma migrate diff` en este entorno (el CLI no pudo descargar el
-- schema-engine); verificar con `prisma migrate deploy` cuando haya
-- una base de datos disponible, antes de darlo por aplicado.
--
-- PRECONDICIÓN: no debe quedar ningún negocio con ownerId NULL en la
-- base de datos, o el ALTER falla. Hoy la demo (barberia-demo) solo
-- existe en el store en memoria, no en Postgres; si algún negocio sin
-- dueño llegó a la DB, asígnale un dueño por googleSub ANTES de aplicar
-- esta migración (nunca por email a mano sin verificar).
--
-- La FK pasa de ON DELETE SET NULL a ON DELETE RESTRICT: con la columna
-- NOT NULL, borrar un usuario ya no puede dejar el negocio sin dueño;
-- Prisma 5 usa RESTRICT por defecto en relaciones requeridas.

-- AlterTable
ALTER TABLE "Business" DROP CONSTRAINT "Business_ownerId_fkey";

-- AlterTable
ALTER TABLE "Business" ALTER COLUMN "ownerId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
