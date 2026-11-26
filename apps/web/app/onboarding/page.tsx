// Onboarding de negocio nuevo (auth Fase 2, diseño §6(a)).
// 1) Formulario: nombre, slug (propuesto desde el nombre, editable),
//    primer servicio (nombre, duración, anticipo) y agenda pública o
//    privada — SIEMPRE se pregunta, sin default silencioso (decisión §10).
// 2) Conectar Google Calendar (opcional, saltable; luego desde el dashboard).
// 3) Comparte tu link: /b/[slug] y /negocio/[slug].
// Sin sesión, a /login. La web solo llama a apps/api, nunca a Google directo.
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiErrorMessage } from "../../lib/api-error";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface CreatedBusiness {
  id: string;
  slug: string;
  name: string;
  agendaVisibility: "public" | "private";
}

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function OnboardingContent() {
  const router = useRouter();
  const params = useSearchParams();
  const calendarStatus = params.get("calendar");
  const slugParam = params.get("slug") ?? "";

  const [step, setStep] = useState<"form" | "connect" | "done">("form");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [serviceName, setServiceName] = useState("");
  const [durationMin, setDurationMin] = useState(60);
  const [depositAmount, setDepositAmount] = useState(50);
  const [visibility, setVisibility] = useState<"public" | "private" | "">("");
  const [created, setCreated] = useState<CreatedBusiness | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Sin sesión, a /login. Si se vuelve del callback de calendario, se
  // entra directo al paso final con el negocio ya creado.
  useEffect(() => {
    fetch(`${API}/auth/me`, { credentials: "include" }).then((r) => {
      if (r.status === 401) router.replace("/login?next=/onboarding");
    });
  }, [router]);

  useEffect(() => {
    if (!slugParam) return;
    if (calendarStatus === "connected") {
      fetch(`${API}/businesses/${slugParam}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.business) {
            setCreated(d.business);
            setStep("done");
          }
        })
        .catch(() => undefined);
    }
    if (calendarStatus === "error") {
      fetch(`${API}/businesses/${slugParam}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.business) {
            setCreated(d.business);
            setStep("connect");
            setError("No se pudo conectar el calendario, inténtalo de nuevo.");
          }
        })
        .catch(() => undefined);
    }
  }, [calendarStatus, slugParam]);

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function createBusiness() {
    setError("");
    if (!name.trim() || !slug || !serviceName.trim()) {
      setError("Completa el nombre del negocio, el slug y el primer servicio.");
      return;
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setError("El slug solo puede tener minúsculas, números y guiones.");
      return;
    }
    if (!visibility) {
      setError("Elige si tu agenda es pública o privada.");
      return;
    }
    setSaving(true);
    const res = await fetch(`${API}/businesses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        name: name.trim(),
        slug,
        agendaVisibility: visibility,
        service: {
          name: serviceName.trim(),
          durationMin: Number(durationMin),
          depositAmount: Number(depositAmount),
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      if (res.status === 401) {
        router.replace("/login?next=/onboarding");
        return;
      }
      setError(apiErrorMessage(data, "No se pudo crear el negocio, revisa los datos."));
      return;
    }
    setCreated(data.business);
    setStep("connect");
  }

  const publicUrl = created ? `/b/${created.slug}` : "";
  const connectHref = created
    ? `${API}/google/auth?slug=${created.slug}&redirect=${encodeURIComponent(`/onboarding?slug=${created.slug}`)}`
    : "";

  return (
    <main>
      <h1>Crear tu negocio</h1>

      {step === "form" && (
        <section>
          <p>
            <label>
              Nombre del negocio:{" "}
              <input value={name} onChange={(e) => onNameChange(e.target.value)} />
            </label>
          </p>
          <p>
            <label>
              Slug (así sale en tu link):{" "}
              <input
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
            </label>
            {slug && <span> — tu link será /b/{slug}</span>}
          </p>
          <h2>Primer servicio</h2>
          <p>
            <label>
              Nombre:{" "}
              <input value={serviceName} onChange={(e) => setServiceName(e.target.value)} />
            </label>
          </p>
          <p>
            <label>
              Duración (min):{" "}
              <input
                type="number"
                min={15}
                max={480}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
              />
            </label>{" "}
            <label>
              Anticipo ($ MXN):{" "}
              <input
                type="number"
                min={0}
                value={depositAmount}
                onChange={(e) => setDepositAmount(Number(e.target.value))}
              />
            </label>
          </p>
          <h2>¿Cómo recibes las citas?</h2>
          <p>
            <label>
              <input
                type="radio"
                name="visibility"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
              />{" "}
              Pública — cualquiera ve disponibilidad y reserva en /b/{slug || "tu-negocio"}
            </label>
          </p>
          <p>
            <label>
              <input
                type="radio"
                name="visibility"
                checked={visibility === "private"}
                onChange={() => setVisibility("private")}
              />{" "}
              Privada — nadie ve disponibilidad; tú apartas y mandas el link por WhatsApp
            </label>
          </p>
          {error && <p style={{ color: "red" }}>{error}</p>}
          <p>
            <button onClick={createBusiness} disabled={saving}>
              {saving ? "Creando…" : "Crear negocio"}
            </button>
          </p>
        </section>
      )}

      {step === "connect" && created && (
        <section>
          <h2>{created.name} creado ✓</h2>
          {error && <p style={{ color: "red" }}>{error}</p>}
          <p>
            Conecta tu Google Calendar para que la disponibilidad se cruce con
            tus eventos reales. Sin conectar, se muestran todos los huecos.
          </p>
          <p>
            <a href={connectHref}>Conectar Google Calendar</a>
          </p>
          <p>
            <button onClick={() => setStep("done")}>Saltar por ahora</button>
          </p>
        </section>
      )}

      {step === "done" && created && (
        <section>
          <h2>¡Listo! Comparte tu link</h2>
          {calendarStatus === "connected" && <p>Calendario conectado ✓</p>}
          {created.agendaVisibility === "public" && (
            <p>
              Página pública de reservas:{" "}
              <a href={publicUrl}>{publicUrl}</a>
            </p>
          )}
          {created.agendaVisibility === "private" && (
            <p>
              Tu agenda es privada: aparta citas desde{" "}
              <a href={`/negocio/${created.slug}`}>/negocio/{created.slug}</a> y manda
              el link de confirmación por WhatsApp.
            </p>
          )}
          <p>
            <a href={`/negocio/${created.slug}`}>Gestionar {created.name}</a> ·{" "}
            <a href="/dashboard">Ir al dashboard</a>
          </p>
        </section>
      )}
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingContent />
    </Suspense>
  );
}
