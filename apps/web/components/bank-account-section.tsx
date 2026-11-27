// Sección de cuenta de pagos del negocio (CoDi/Pey).
// Muestra el estado de la cuenta conectada (alias, titular, últimos 4
// dígitos de la CLABE) o el formulario para conectarla. La CLABE completa
// se manda una sola vez a la API y NUNCA se guarda en Apartados ni se
// vuelve a mostrar: aquí solo se ven los últimos 4 dígitos.
// Se usa en el onboarding (paso opcional y saltable) y en /negocio/[slug].
// La web nunca toca Pey directo: solo llama a apps/api.
"use client";

import { useEffect, useState } from "react";
import { apiErrorMessage } from "../lib/api-error";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface BankAccountView {
  alias: string;
  status: "PENDING" | "PROCESSING" | "ACTIVE" | "ERROR";
  holderName: string;
  clabeLast4: string;
  errorMessage: string | null;
}

// Dígito verificador de la CLABE (pesos 3-7-1, módulo 10). Mismo
// algoritmo que @apartados/shared (isValidClabe): la web no depende de
// shared, así que va duplicado a propósito. Solo es un pre-chequeo en
// el formulario; la API y Pey lo vuelven a validar.
function isValidClabe(clabe: string): boolean {
  if (!/^[0-9]{18}$/.test(clabe)) return false;
  const weights = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += (Number(clabe[i]) * weights[i % 3]) % 10;
  }
  return (10 - (sum % 10)) % 10 === Number(clabe[17]);
}

export function bankAccountStatusText(status: BankAccountView["status"]): string {
  if (status === "ACTIVE") return "Conectada ✓";
  if (status === "ERROR") return "No se pudo validar";
  return "En validación con Banxico";
}

export default function BankAccountSection({ slug }: { slug: string }) {
  const [account, setAccount] = useState<BankAccountView | null>(null);
  const [loading, setLoading] = useState(true);
  const [alias, setAlias] = useState("");
  const [holderName, setHolderName] = useState("");
  const [clabe, setClabe] = useState("");
  const [entity, setEntity] = useState<"PERSON" | "BUSINESS">("PERSON");
  const [taxId, setTaxId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/businesses/${slug}/bank-account`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setAccount(data.bankAccount ?? null);
    } catch {
      // Sin conexión a la API: se muestra el formulario igual; el error
      // saldrá al guardar.
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // Solo al montar: el estado se recarga tras guardar, no en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function connect() {
    setError("");
    setSaved(false);
    const cleanClabe = clabe.replace(/\D/g, "");
    if (!alias.trim() || !holderName.trim() || !cleanClabe) {
      setError("Completa el alias, el nombre del titular y la CLABE.");
      return;
    }
    if (!isValidClabe(cleanClabe)) {
      setError("La CLABE no es válida: revisa los 18 dígitos.");
      return;
    }
    if (taxId && !/^[A-Za-z0-9]{12,13}$/.test(taxId.trim())) {
      setError("El RFC debe tener 12 o 13 caracteres.");
      return;
    }
    setSaving(true);
    const res = await fetch(`${API}/businesses/${slug}/bank-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        alias: alias.trim(),
        name: holderName.trim(),
        clabe: cleanClabe,
        entity,
        ...(taxId.trim() ? { taxId: taxId.trim().toUpperCase() } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(apiErrorMessage(data, "No se pudo conectar la cuenta, revisa los datos."));
      return;
    }
    setAccount(data.bankAccount);
    setSaved(true);
  }

  if (loading) return <p>Cargando cuenta de pagos…</p>;

  if (account) {
    return (
      <div>
        <p>
          Cuenta de pagos: <strong>{bankAccountStatusText(account.status)}</strong> —{" "}
          {account.alias} · {account.holderName} · •••• {account.clabeLast4}
        </p>
        {account.status === "ACTIVE" && (
          <p>Los anticipos caen directo en esta cuenta (CoDi, sin comisión).</p>
        )}
        {(account.status === "PENDING" || account.status === "PROCESSING") && (
          <p>
            Pey está validando la cuenta con Banxico. Mientras tanto, los
            anticipos se cobran con la cuenta de Apartados.
          </p>
        )}
        {account.status === "ERROR" && (
          <p style={{ color: "red" }}>
            El registro fue rechazado
            {account.errorMessage ? `: ${account.errorMessage}` : "."} Revisa los
            datos y vuelve a conectarla abajo.
          </p>
        )}
        {account.status === "ERROR" && (
          <p>
            <button onClick={() => setAccount(null)}>Volver a conectar</button>
          </p>
        )}
        {saved && <p>Cuenta conectada ✓</p>}
      </div>
    );
  }

  return (
    <div>
      <p>
        Conecta la cuenta bancaria donde quieres recibir los anticipos. El
        dinero cae directo en tu cuenta por CoDi, sin pasar por Apartados.
        Solo guardamos los últimos 4 dígitos de tu CLABE.
      </p>
      <p>
        <label>
          Alias (para identificarla):{" "}
          <input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="p. ej. BBVA negocio"
          />
        </label>
      </p>
      <p>
        <label>
          Nombre del titular:{" "}
          <input
            value={holderName}
            onChange={(e) => setHolderName(e.target.value)}
            placeholder="Nombre legal o razón social"
          />
        </label>
      </p>
      <p>
        <label>
          CLABE (18 dígitos):{" "}
          <input
            value={clabe}
            onChange={(e) => setClabe(e.target.value.replace(/\D/g, "").slice(0, 18))}
            placeholder="012345678901234567"
            inputMode="numeric"
          />
        </label>
      </p>
      <p>
        <label>
          <input
            type="radio"
            name={`entity-${slug}`}
            checked={entity === "PERSON"}
            onChange={() => setEntity("PERSON")}
          />{" "}
          Persona física
        </label>{" "}
        <label>
          <input
            type="radio"
            name={`entity-${slug}`}
            checked={entity === "BUSINESS"}
            onChange={() => setEntity("BUSINESS")}
          />{" "}
          Persona moral
        </label>
      </p>
      <p>
        <label>
          RFC (opcional):{" "}
          <input
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            placeholder="12 o 13 caracteres"
          />
        </label>
      </p>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <p>
        <button onClick={connect} disabled={saving}>
          {saving ? "Conectando…" : "Conectar cuenta"}
        </button>
      </p>
    </div>
  );
}
