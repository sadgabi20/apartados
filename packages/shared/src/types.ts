export type AppointmentStatus = "hold" | "confirmed" | "released" | "cancelled";

export interface Appointment {
  id: string;
  businessId: string;
  serviceId: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  depositAmount: number;
  numRef: string; // = id de la cita, referencia Pey
  googleEventId?: string | null;
  peyQrId?: string | null;
  transactionId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
}

export interface Service {
  id: string;
  businessId: string;
  name: string;
  durationMin: number;
  depositAmount: number;
}

export interface Business {
  id: string;
  slug: string;
  name: string;
}
