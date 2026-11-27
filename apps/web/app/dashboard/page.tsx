// Dashboard del dueño (auth Fase 2, diseño §6(b) y §10).
// Layout persistente con selector rápido de negocio (OwnerNav, arriba) —
// NO una lista de negocios; la gestión vive en el menú de ajustes.
// Sin sesión, a /login. Sin negocios, invita a crear el primero.
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import OwnerNav from "../../components/owner-nav";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface MeBusiness {
  id: string;
  slug: string;
  name: string;
  agendaVisibility: "public" | "private";
  calendarConnected: boolean;
  // Cuenta de pagos (CoDi): "none" = sin conectar, "pending" = en
  // validación con Banxico, "active" = recibe directo, "error" = rechazada.
  paymentAccountStatus: "none" | "pending" | "active" | "error";
}

interface Me {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null };
  businesses: MeBusiness[];
}

function DashboardContent() {
  const router = useRouter();
  const params = useSearchParams();
  const slugParam = params.get("slug") ?? "";
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/auth/me`, { credentials: "include" })
      .then((r) => {
        if (r.status === 401) {
          router.replace("/login?next=/dashboard");
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d) setMe(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [router]);

  if (loading) {
    return <main><OwnerNav /><p>Cargando…</p></main>;
  }
  if (!me) {
    return (
      <main>
        <OwnerNav />
        <p>No se pudo contactar a la API (¿corre en :3001?).</p>
      </main>
    );
  }

  const active =
    me.businesses.find((b) => b.slug === slugParam) ?? me.businesses[0] ?? null;

  return (
    <main>
      <OwnerNav currentSlug={active?.slug} />
      <h1>Hola, {me.user.name ?? me.user.email}</h1>
      {!active && (
        <section>
          <p>Aún no tienes negocios.</p>
          <p>
            <a href="/onboarding">Crear mi primer negocio</a>
          </p>
        </section>
      )}
      {active && (
        <section>
          <h2>{active.name}</h2>
          <p>
            Agenda:{" "}
            <strong>{active.agendaVisibility === "public" ? "Pública" : "Privada"}</strong>{" "}
            {active.agendaVisibility === "public"
              ? "(cualquiera reserva en /b/" + active.slug + ")"
              : "(solo tú apartas y mandas el link)"}
          </p>
          <p>
            Calendario:{" "}
            {active.calendarConnected ? (
              <strong>Conectado ✓</strong>
            ) : (
              <>
                No conectado —{" "}
                <a href={`${API}/google/auth?slug=${active.slug}`}>Conectar Google Calendar</a>
              </>
            )}
          </p>
          <p>
            Cuenta de pagos:{" "}
            {active.paymentAccountStatus === "active" ? (
              <strong>Conectada ✓</strong>
            ) : active.paymentAccountStatus === "pending" ? (
              <>En validación con Banxico</>
            ) : active.paymentAccountStatus === "error" ? (
              <>
                No se pudo validar —{" "}
                <a href={`/negocio/${active.slug}`}>revisar en el negocio</a>
              </>
            ) : (
              <>
                Sin conectar: los anticipos se cobran con la cuenta de
                Apartados —{" "}
                <a href={`/negocio/${active.slug}`}>conectar mi CLABE</a>
              </>
            )}
          </p>
          <p>
            <a href={`/negocio/${active.slug}`}>Gestionar este negocio</a>{" "}
            {active.agendaVisibility === "public" && (
              <>
                · <a href={`/b/${active.slug}`}>Ver página pública</a>
              </>
            )}
          </p>
        </section>
      )}
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}
