-- Cuenta de pagos del negocio en Pey (CoDi): tabla PeyBankAccount (1:1 con Business).
-- Escrito a mano siguiendo el diseño y las convenciones de Prisma 5 para
-- PostgreSQL (mismo estilo que las migraciones anteriores).
--
-- La CLABE completa NUNCA se guarda: solo el id de Pey (ULID) + los
-- últimos 4 dígitos. El registro en Pey se valida con Banxico y su estado
-- (PENDING/PROCESSING/ACTIVE/ERROR) vive en la columna "status".
--
-- Aplicar con `prisma migrate deploy` sobre Supabase DESPUÉS del merge,
-- antes de que la API con este cambio atienda tráfico (las rutas de
-- cuenta de pagos consultan esta tabla; sin ella, GET/POST dan 500).
-- No se pudo aplicar en este PR: la base de Axel no se toca desde aquí.

-- CreateTable
CREATE TABLE "PeyBankAccount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "peyBankAccountId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "clabeLast4" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeyBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PeyBankAccount_businessId_key" ON "PeyBankAccount"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "PeyBankAccount_peyBankAccountId_key" ON "PeyBankAccount"("peyBankAccountId");

-- AddForeignKey
ALTER TABLE "PeyBankAccount" ADD CONSTRAINT "PeyBankAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
