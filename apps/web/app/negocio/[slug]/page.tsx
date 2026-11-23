// Página del negocio: toggle de agenda pública/privada + crear cita
// manual para un cliente y mandarle el link de confirmación/pago.
// La web NUNCA toca Pey ni Google directo: solo llama a apps/api.
// El QR NO se genera aquí: se genera cuando el cliente abre
// /confirmar/[id] y toca pagar (el QR de Pey expira en 600 s).
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface Service {
  id: string;
  name: string;
  durationMin: number;
  depositAmount: number;
}
interface Business {
  id: string;
  slug: string;
  name: string;
  agendaVisibility: "public" | "private";
}
interface Appointment {
  id: string;
  status: string;
  startAt: string;
  depositAmount: number;
  expiresAt: string;
}

export default function BusinessPage() {
  const params = useParams();
  const slug = params.slug as string;
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [business, setBusiness] = useState<Business | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`${API}/businesses/${slug}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.business) setBusiness(d.business);
        if (d.error) setError(d.error);
      })
      .catch(() => setError("No se pudo contactar a la API (¿corre en :3001?)"));
  }, [slug]);

  useEffect(() => {
    if (!business) return;
    fetch(`${API}/availability?slug=${slug}&date=${date}&actor=business`)
      .then((r) => r.json())
      .then((d) => {
        setService(d.service ?? null);
        setSlots(d.slots ?? []);
        if (d.error) setError(d.error);
      })
      .catch(() => setError("No se pudo contactar a la API (¿corre en :3001?)"));
  }, [date, slug, business]);

  async function toggleVisibility(next: "public" | "private") {
    setError("");
    const res = await fetch(`${API}/businesses/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agendaVisibility: next }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "No se pudo cambiar la visibilidad.");
      return;
    }
    setBusiness(data.business);
  }

  async function createManual(startAt: string) {
    setError("");
    setCopied(false);
    if (!business || !service || !name || !phone) {
      setError("Escribe el nombre y teléfono del cliente antes de elegir hora.");
      return;
    }
    const res = await fetch(`${API}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId: business.id,
        serviceId: service.id,
        startAt,
        customerName: name,
        customerPhone: phone,
        source: "business",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "No se pudo apartar la hora.");
      return;
    }
    setAppointment(data.appointment);
  }

  const confirmUrl = appointment
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/confirmar/${appointment.id}`
    : "";
  const waText = appointment && service && business
    ? `Hola ${name}, te aparto tu cita en ${business.name}: ${service.name}, ${appointment.startAt.slice(0, 10)} a las ${appointment.startAt.slice(11, 16)}. Confirma y paga tu anticipo de $${appointment.depositAmount} MXN aquí: ${confirmUrl}`
    : "";
  const waUrl = `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(waText)}`;

  return (
    <main>
      <h1>Negocio — {business?.name ?? slug}</h1>
      {business && (
        <section>
          <p>
            Agenda: <strong>{business.agendaVisibility === "public" ? "Pública" : "Privada"}</strong>{" "}
            {business.agendaVisibility === "public"
              ? "(cualquiera ve disponibilidad y reserva en /b/" + slug + ")"
              : "(nadie ve disponibilidad; tú apartas y mandas el link)"}
          </p>
          <p>
            <button
              onClick={() =>
                toggleVisibility(business.agendaVisibility === "public" ? "private" : "public")
              }
            >
              {business.agendaVisibility === "public"
                ? "Hacer agenda privada"
                : "Hacer agenda pública"}
            </button>
          </p>
        </section>
      )}
      <section>
        <h2>Apartar cita para un cliente</h2>
        {service && (
          <p>
            {service.name} · {service.durationMin} min · anticipo ${service.depositAmount} MXN
          </p>
        )}
        <label>
          Fecha:{" "}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <p>
          <input
            placeholder="Nombre del cliente"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            placeholder="Teléfono del cliente"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </p>
        {error && <p style={{ color: "red" }}>{error}</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {slots.map((s) => (
            <button key={s} onClick={() => createManual(s)}>
              {s.slice(11, 16)}
            </button>
          ))}
        </div>
      </section>
      {appointment && (
        <section>
          <h2>Cita apartada — mándale este link al cliente</h2>
          <p>
            {appointment.startAt} · anticipo ${appointment.depositAmount} MXN · el cliente tiene
            60 minutos para confirmar y pagar.
          </p>
          <p style={{ wordBreak: "break-all" }}>{confirmUrl}</p>
          <p>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(confirmUrl).then(() => setCopied(true));
              }}
            >
              Copiar link
            </button>{" "}
            <a href={waUrl} target="_blank" rel="noreferrer">
              Mandar por WhatsApp
            </a>
          </p>
          {copied && <p>Link copiado.</p>}
        </section>
      )}
    </main>
  );
}
