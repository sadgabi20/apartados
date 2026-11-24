// Navegación persistente del dueño (auth Fase 2, diseño §6(b) y §10).
// NO es una lista de negocios: es un selector rápido para cambiar de
// negocio, y la gestión (crear otro negocio) vive en el menú de ajustes.
// Se usa en /dashboard y en /negocio/[slug]. La web NUNCA toca Pey ni
// Google directo: solo llama a apps/api.
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface MeBusiness {
  id: string;
  slug: string;
  name: string;
  agendaVisibility: "public" | "private";
  calendarConnected: boolean;
}

interface Me {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null };
  businesses: MeBusiness[];
}

export default function OwnerNav({ currentSlug }: { currentSlug?: string }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    fetch(`${API}/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setMe(d);
      })
      .catch(() => undefined);
  }, []);

  async function logout() {
    await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" }).catch(
      () => undefined,
    );
    router.replace("/");
  }

  const selected = currentSlug ?? me?.businesses[0]?.slug ?? "";

  return (
    <header
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
        marginBottom: 16,
      }}
    >
      <a href="/dashboard" style={{ fontWeight: 700 }}>
        Apartados
      </a>
      {me && me.businesses.length > 0 && (
        <label>
          Negocio:{" "}
          <select value={selected} onChange={(e) => router.push(`/negocio/${e.target.value}`)}>
            {me.businesses.map((b) => (
              <option key={b.id} value={b.slug}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <span style={{ flex: 1 }} />
      <div>
        <button onClick={() => setSettingsOpen((v) => !v)}>Ajustes</button>
        {settingsOpen && (
          <div style={{ border: "1px solid #ccc", padding: 8, marginTop: 4 }}>
            {me && <p>{me.user.name ?? me.user.email}</p>}
            <p>
              <a href="/onboarding">Crear otro negocio</a>
            </p>
            <p>
              <button onClick={logout}>Cerrar sesión</button>
            </p>
          </div>
        )}
      </div>
    </header>
  );
}
