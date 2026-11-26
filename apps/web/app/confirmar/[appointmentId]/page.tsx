// Página de confirmación para el cliente (flujo manual por WhatsApp).
// El cliente no llena formularios: solo ve el resumen y paga.
// La web NUNCA toca Pey ni Google directo: solo llama a apps/api.
// El QR se genera bajo demanda al tocar "Confirmar y pagar" (el QR de
// Pey expira en 600 s, así no se gasta mientras el link está en WhatsApp).
// El payload se muestra como imagen escaneable (components/qr-code.tsx);
// si Pey no trae un campo conocido, no se inventa un QR con el JSON: se
// muestra el error y se reintenta.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import QrCodeImage from "../../../components/qr-code";
import { apiErrorMessage } from "../../../lib/api-error";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Guard client-side para el QR: la API acota la creación del QR a
// PEY_TIMEOUT_MS (240 s por defecto), así que el error acotado de la API
// llega primero en el caso normal. Este guard es un poco mayor (270 s)
// y solo rescata la UI si la API misma se cuelga: sin él, el botón se
// quedaría en "Generando QR…" para siempre.
const WEB_QR_TIMEOUT_MS = 270_000;

interface Appointment {
  id: string;
  status: string;
  startAt: string;
  depositAmount: number;
  expiresAt: string;
  customerName: string;
  customerPhone: string;
}
interface Business {
  name: string;
  slug: string;
}
interface Service {
  name: string;
  durationMin: number;
  depositAmount: number;
}

export default function ConfirmPage() {
  const params = useParams();
  const appointmentId = params.appointmentId as string;
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${API}/appointments/${appointmentId}`);
    const data = await res.json();
    if (!res.ok) {
      setNotFound(true);
      setError(apiErrorMessage(data, "Cita no encontrada"));
      return;
    }
    setAppointment(data.appointment);
    setBusiness(data.business ?? null);
    setService(data.service ?? null);
  }, [appointmentId]);

  useEffect(() => {
    load().catch(() => setError("No se pudo contactar a la API (¿corre en :3001?)"));
  }, [load]);

  useEffect(() => {
    if (!appointment || appointment.status !== "hold") return;
    const t = setInterval(() => {
      fetch(`${API}/appointments/${appointment.id}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.appointment?.status !== "hold") {
            setAppointment(d.appointment);
            clearInterval(t);
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [appointment]);

  async function pay() {
    if (!appointment) return;
    setError("");
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_QR_TIMEOUT_MS);
    try {
      const res = await fetch(`${API}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: appointment.id }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(apiErrorMessage(data, "No se pudo generar el QR."));
        return;
      }
      setAppointment(data.appointment);
      // Si Pey no devolvió un payload legible, no se inventa un QR con el
      // JSON crudo (un banco no lo podría cobrar): se muestra el error y
      // queda el botón para reintentar.
      if (typeof data.qrPayload === "string" && data.qrPayload.length > 0) {
        setQrPayload(data.qrPayload);
      } else {
        setError("Pey no devolvió un QR legible. Inténtalo de nuevo.");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError(
          "La generación del QR tardó demasiado. Tu cita sigue apartada, inténtalo de nuevo.",
        );
      } else {
        setError("No se pudo contactar a la API (¿corre en :3001?)");
      }
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  if (notFound) {
    return (
      <main>
        <h1>Link no válido</h1>
        <p>Esta cita no existe. Pídele otro link al negocio.</p>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </main>
    );
  }
  if (!appointment) return <main><p>Cargando tu cita…</p></main>;

  const expired =
    appointment.status === "released" ||
    (appointment.status === "hold" && new Date(appointment.expiresAt) <= new Date());

  return (
    <main>
      <h1>{business?.name ?? "Tu cita"}</h1>
      {appointment.status === "confirmed" ? (
        <>
          <h2>✅ Cita confirmada</h2>
          <p>¡Listo! Tu cita está confirmada. Nos vemos ahí.</p>
        </>
      ) : expired ? (
        <>
          <h2>Este link expiró</h2>
          <p>El tiempo para confirmar y pagar se acabó y la hora se liberó. Pídele otro link al negocio.</p>
        </>
      ) : (
        <>
          <h2>Confirma tu cita</h2>
          <p>
            Hola {appointment.customerName}, tienes apartada esta cita:
          </p>
        </>
      )}
      <p>
        {service?.name ?? "Servicio"} · {service?.durationMin ?? ""} min
        <br />
        {appointment.startAt}
        <br />
        Anticipo: ${appointment.depositAmount} MXN
      </p>
      {appointment.status === "hold" && !expired && !qrPayload && (
        <>
          <button onClick={pay} disabled={loading}>
            {loading ? "Generando QR…" : "Confirmar y pagar"}
          </button>
          {loading && (
            <p>
              Tu hora sigue apartada mientras se genera el QR. Puede tardar
              unos minutos, no cierres la página.
            </p>
          )}
        </>
      )}
      {error && <p style={{ color: "red" }}>{error}</p>}
      {appointment.status === "hold" && !expired && qrPayload && (
        <section>
          <h2>Paga tu anticipo</h2>
          <QrCodeImage payload={qrPayload} />
          <p>Escanea el QR con tu app bancaria (CoDi). Tienes 10 minutos para pagar este QR.</p>
        </section>
      )}
    </main>
  );
}
