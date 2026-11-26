// Cuenta de pagos del negocio en Pey (CoDi).
// POST /businesses/:slug/bank-account — registra la CLABE del negocio
// en Pey (una vez) y guarda solo el id de Pey + los últimos 4 dígitos.
// GET /businesses/:slug/bank-account — estado de la cuenta; si no está
// final (PENDING/PROCESSING) se refresca en Pey al leer, sin webhook
// nuevo: el OpenAPI de Pey no define webhooks para cuentas y el estado
// solo se consulta cuando el dueño lo mira.
// Solo el dueño del negocio (sesión + propiedad, como el PATCH). La
// CLABE completa NUNCA se guarda en Apartados ni se devuelve en ninguna
// respuesta: solo alias, estado, titular y últimos 4 dígitos.
import type { FastifyInstance } from "fastify";
import { getBankAccount, PeyBankAccountError, registerBankAccount } from "@apartados/pey";
import { registerBankAccountSchema } from "@apartados/shared";
import { requireAuth, requireBusinessOwner } from "../middleware/auth";
import type {
  AppointmentStore,
  PeyBankAccountRecord,
  PeyBankAccountStatus,
} from "../store";

// Vista segura de la cuenta: jamás incluye la CLABE completa ni el id
// interno de Pey (el negocio no lo necesita: el QR lo crea la API).
export function bankAccountView(a: PeyBankAccountRecord) {
  return {
    alias: a.alias,
    status: a.status,
    holderName: a.holderName,
    clabeLast4: a.clabeLast4,
    errorMessage: a.errorMessage,
  };
}

// ACTIVE y ERROR son finales: ya no cambian. PENDING/PROCESSING se
// refrescan en Pey al leer.
const FINAL_STATUSES: PeyBankAccountStatus[] = ["ACTIVE", "ERROR"];

export function bankAccountRoutes(app: FastifyInstance, store: AppointmentStore) {
  app.post(
    "/businesses/:slug/bank-account",
    { preHandler: [requireAuth(store), requireBusinessOwner(store)] },
    async (req, reply) => {
      const parsed = registerBankAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const business = req.business!;
      let registered;
      try {
        registered = await registerBankAccount(parsed.data);
      } catch (err) {
        // El error de Pey nunca trae la CLABE: solo status + mensaje.
        req.log.error({ err }, "Pey bank-account registration failed");
        if (err instanceof PeyBankAccountError && err.status === 400) {
          // Datos que Pey rechaza (p. ej. banco sin CoDi habilitado):
          // es un error del formulario, no un fallo del servidor.
          return reply.status(400).send({
            error: `Pey no aceptó esa cuenta: ${err.message}`,
            code: "pey_bank_account_invalid",
          });
        }
        const message = err instanceof Error ? err.message : "Error al registrar la cuenta";
        return reply.status(503).send({
          error: `No se pudo registrar la cuenta en Pey: ${message}`,
          code: "pey_bank_account_error",
        });
      }
      const saved = await store.saveBankAccount({
        businessId: business.id,
        peyBankAccountId: registered.id,
        alias: parsed.data.alias,
        status: (registered.codiStatus ?? "PENDING") as PeyBankAccountStatus,
        holderName: parsed.data.name,
        clabeLast4: parsed.data.clabe.slice(-4),
        errorMessage: registered.errorMessage ?? null,
      });
      return reply.status(201).send({ bankAccount: bankAccountView(saved) });
    },
  );

  app.get(
    "/businesses/:slug/bank-account",
    { preHandler: [requireAuth(store), requireBusinessOwner(store)] },
    async (req) => {
      const business = req.business!;
      const stored = await store.getBankAccount(business.id);
      if (!stored) return { bankAccount: null };
      if (!FINAL_STATUSES.includes(stored.status)) {
        try {
          const fresh = await getBankAccount(stored.peyBankAccountId);
          const status = (fresh.codiStatus ?? stored.status) as PeyBankAccountStatus;
          const errorMessage = fresh.errorMessage ?? null;
          if (status !== stored.status || errorMessage !== stored.errorMessage) {
            const updated = await store.saveBankAccount({
              ...stored,
              status,
              errorMessage,
            });
            return { bankAccount: bankAccountView(updated) };
          }
        } catch (err) {
          // Pey no responde: se sirve el estado guardado, sin 500.
          req.log.warn({ err }, "Pey bank-account status refresh failed, serving stored status");
        }
      }
      return { bankAccount: bankAccountView(stored) };
    },
  );
}
