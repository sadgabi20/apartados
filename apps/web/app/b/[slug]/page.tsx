// Página pública de reserva: servicio -> hora -> pago.
// La web NUNCA toca Pey ni Google directo: solo llama a apps/api.
// Si la agenda es privada, no muestra disponibilidad ni formulario:
// solo el negocio puede apartar huecos (desde /negocio/[slug]) y mandar
// el link de confirmación. Nota: la forma exacta de la respuesta del QR
// de Pey no está documentada en docs.pey.mx; la página muestra el campo
// que traiga (qr / qrText / image / url) y, si no hay ninguno, el JSON.
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

export default function BookingPage() {
  const params = useParams();
  const slug = params.slug as string;
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [business, setBusiness] = useState<Business | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [google, setGoogle] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  // Mientras se genera el QR, la hora YA está apartada: se muestra el
  // hold y el "Generando QR…" en vez de dejar la UI colgada sin feedback.
  // Pey tarda ~3 min en responder en pruebas reales; la API acota la
  // espera a PEY_TIMEOUT_MS (240 s por defecto) y la cita sigue en hold
  // para reintentar si el QR falla.
  const [qrLoading, setQrLoading] = useState(false);

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
    if (!business || business.agendaVisibility === "private") return;
    fetch(`${API}/availability?slug=${slug}&date=${date}`)
      .then((r) => r.json())
      .then((d) => {
        setService(d.service ?? null);
        setSlots(d.slots ?? []);
        setGoogle(d.google ?? "");
        if (d.error) setError(d.error);
      })
      .catch(() => setError("No se pudo contactar a la API (¿corre en :3001?)"));
  }, [date, slug, business]);

  useEffect(() => {
    if (!appointment || appointment.status !== "hold") return;
    const t = setInterval(() => {
      fetch(`${API}/appointments/${appointment.id}`)
        .then((r) => r.json())
        .then((d) => {
          setStatus(d.appointment?.status ?? "");
          if (d.appointment?.status !== "hold") {
            setAppointment(d.appointment);
            clearInterval(t);
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [appointment]);

  // Pide el QR de una cita que ya está en hold. Si falla (timeout de
  // Pey o error), la cita sigue apartada y se puede reintentar: no se
  // borra el appointment del estado, a diferencia de antes, que dejaba
  // una reserva muerta sin forma de pagarla.
  async function requestQr(appointmentId: string, testAmount?: number) {
    setError("");
    setQrLoading(true);
    try {
      const pRes = await fetch(`${API}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentId,
          ...(testAmount ? { amount: testAmount } : {}),
        }),
      });
      const pData = await pRes.json();
      if (!pRes.ok) {
        setError(
          typeof pData.error === "string"
            ? pData.error
            : "No se pudo generar el QR.",
        );
        return;
      }
      setAppointment(pData.appointment);
      setStatus("hold");
      setQrPayload(pData.qrPayload ?? JSON.stringify(pData.qr));
    } catch {
      setError("No se pudo contactar a la API (¿corre en :3001?)");
    } finally {
      setQrLoading(false);
    }
  }

  async function reserve(startAt: string, testAmount?: number) {
    setError("");
    if (!business || !service || !name || !phone) {
      setError("Escribe tu nombre y teléfono antes de elegir hora.");
      return;
    }
    const bRes = await fetch(`${API}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId: business.id,
        serviceId: service.id,
        startAt,
        customerName: name,
        customerPhone: phone,
        source: "customer",
      }),
    });
    const bData = await bRes.json();
    if (!bRes.ok) {
      setError(bData.error ?? "No se pudo apartar la hora.");
      return;
    }
    // La hora ya está apartada: guardarla ANTES de pedir el QR para que
    // se vea mientras Pey tarda, y para que sobreviva si el QR falla.
    setAppointment(bData.appointment);
    setStatus("hold");
    await requestQr(bData.appointment.id, testAmount);
  }

  if (business?.agendaVisibility === "private") {
    return (
      <main>
        <h1>Reserva — {business.name}</h1>
        <p>
          Esta agenda es privada. Para apartar tu cita, contacta directamente al
          negocio por WhatsApp o teléfono y te mandarán tu link de confirmación y pago.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Reserva — {slug}</h1>
      {service && (
        <p>
          {service.name} · {service.durationMin} min · anticipo ${service.depositAmount} MXN
          {google === "not-configured" && " · (Google Calendar aún no conectado: huecos sin filtrar)"}
        </p>
      )}
      <label>
        Fecha:{" "}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <p>
        <input placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Tu teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </p>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {slots.map((s) => (
          <button key={s} onClick={() => reserve(s)} disabled={qrLoading}>
            {s.slice(11, 16)}
          </button>
        ))}
      </div>
      {appointment && (
        <section>
          <h2>
            {status === "confirmed"
              ? "✅ Cita confirmada"
              : status === "released"
                ? "La hora se liberó (no llegó el pago en 10 min)"
                : "Paga tu anticipo antes de que se libere la hora"}
          </h2>
          <p>
            {appointment.startAt} · anticipo ${appointment.depositAmount} MXN
          </p>
          {status === "hold" && !qrPayload && qrLoading && (
            <p>
              Tu hora está apartada… Generando QR… Esto puede tardar unos
              minutos, no cierres la página.
            </p>
          )}
          {status === "hold" && !qrPayload && !qrLoading && (
            <p>
              <button onClick={() => requestQr(appointment.id)}>
                Reintentar pago
              </button>
            </p>
          )}
          {status === "hold" && qrPayload && (
            <>
              {qrPayload.startsWith("http") || qrPayload.startsWith("data:image") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrPayload} alt="QR CoDi para pagar el anticipo" width={240} />
              ) : (
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{qrPayload}</pre>
              )}
              <p>Escanea el QR con tu app bancaria (CoDi). Tienes 10 minutos.</p>
            </>
          )}
        </section>
      )}
    </main>
  );
}
