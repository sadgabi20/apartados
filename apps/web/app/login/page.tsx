// Login de dueños de negocio (auth Fase 1): un solo botón,
// "Continuar con Google". Solo Google, nada de magic link.
// El cliente final NO tiene login: entra por su link /confirmar/[id].
// ?next=<ruta> — a dónde volver tras el login (p. ej. /negocio/<slug>).
// ?error=state|google — el callback de la API redirige aquí si falla.
"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function LoginContent() {
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const error = params.get("error");
  const returnTo = next.startsWith("/") && !next.startsWith("//") ? next : "";
  const href = returnTo
    ? `${API}/auth/google?returnTo=${encodeURIComponent(returnTo)}`
    : `${API}/auth/google`;

  return (
    <main>
      <h1>Entrar — Apartados</h1>
      <p>Solo para dueños de negocio. Los clientes entran con su link de confirmación.</p>
      {error === "google" && (
        <p style={{ color: "red" }}>No se pudo completar el login con Google, inténtalo de nuevo.</p>
      )}
      {error === "state" && (
        <p style={{ color: "red" }}>La sesión de login expiró o no es válida, inténtalo de nuevo.</p>
      )}
      <p>
        <a href={href}>Continuar con Google</a>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
