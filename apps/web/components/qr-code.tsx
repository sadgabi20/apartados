// QR de pago CoDi como imagen escaneable (SVG).
// Pey devuelve el payload como texto (o, a veces, una URL/imagen): el
// texto crudo no se puede escanear desde el celular, así que aquí se
// renderiza como QR con react-qr-code (sin dependencias, solo SVG).
// Ojo: react-qr-code NO incluye quiet zone en el SVG (los módulos
// empiezan en la coordenada 0), por eso el contenedor blanco con padding:
// sin ese margen los lectores no detectan el código. Nivel "M" para que
// aguante reflejos y ángulos al escanear desde la pantalla del celular.
"use client";

import QRCode from "react-qr-code";

export default function QrCodeImage({ payload }: { payload: string }) {
  if (payload.startsWith("http") || payload.startsWith("data:image")) {
    // Pey devolvió una imagen/URL: se muestra tal cual.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={payload} alt="QR CoDi para pagar el anticipo" width={264} />;
  }
  return (
    <div
      role="img"
      aria-label="QR CoDi para pagar el anticipo"
      style={{
        background: "#ffffff",
        padding: 16,
        display: "inline-block",
        lineHeight: 0,
      }}
    >
      <QRCode
        value={payload}
        size={256}
        level="M"
        bgColor="#FFFFFF"
        fgColor="#000000"
        title="QR CoDi para pagar el anticipo"
      />
    </div>
  );
}
