const { DateTime } = require("luxon");

const MADRID_TIME_ZONE = "Europe/Madrid";
const BRAND = {
  dark: "#064e3b",
  green: "#059669",
  pale: "#ecfdf5",
  ink: "#16302a",
  muted: "#64748b",
  border: "#dce7e3",
  background: "#f3f7f5",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normaliseName(value) {
  const name = String(value ?? "").trim();

  if (!name) {
    return "";
  }

  return name.split(/\s+/)[0].slice(0, 80);
}

function capitalise(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function formatDuration(minutes) {
  const safeMinutes = Number(minutes);

  if (!Number.isInteger(safeMinutes) || safeMinutes <= 0) {
    return "Duración no especificada";
  }

  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  const hourLabel = hours === 1 ? "1 hora" : `${hours} horas`;

  if (!hours) {
    return `${remainingMinutes} min`;
  }

  if (!remainingMinutes) {
    return hourLabel;
  }

  return `${hourLabel} y ${remainingMinutes} min`;
}

function getDateDetails(date, durationMinutes) {
  const parsedDate =
    date instanceof Date
      ? DateTime.fromJSDate(date, { zone: MADRID_TIME_ZONE })
      : DateTime.fromISO(String(date), { zone: MADRID_TIME_ZONE });

  if (!parsedDate.isValid) {
    throw new TypeError("Appointment email requires a valid date");
  }

  const localDate = parsedDate.setLocale("es");
  const safeDuration =
    Number.isInteger(Number(durationMinutes)) && Number(durationMinutes) > 0
      ? Number(durationMinutes)
      : 0;
  const endDate = localDate.plus({ minutes: safeDuration });

  return {
    day: localDate.toFormat("dd"),
    month: localDate.toFormat("LLL").replace(".", "").toUpperCase(),
    weekday: capitalise(localDate.toFormat("cccc")),
    longDate: capitalise(
      localDate.toFormat("cccc, d 'de' LLLL 'de' yyyy")
    ),
    shortDate: localDate.toFormat("d 'de' LLLL"),
    time: localDate.toFormat("HH:mm"),
    timeRange: safeDuration
      ? `${localDate.toFormat("HH:mm")}–${endDate.toFormat("HH:mm")}`
      : localDate.toFormat("HH:mm"),
  };
}

function preheader(text) {
  return `<div style="display:none;font-size:1px;color:${BRAND.background};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(
    text
  )}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>`;
}

function dateCard(details, durationMinutes, label = "TU CITA") {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;background:${BRAND.pale};border:1px solid #c9ecdf;border-radius:14px;">
      <tr>
        <td class="date-icon-cell" width="112" valign="middle" style="padding:22px 0 22px 24px;">
          <table role="presentation" width="82" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;background:#ffffff;border:1px solid #b8decf;border-radius:12px;text-align:center;">
            <tr><td style="padding:9px 8px 2px;color:${BRAND.green};font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.6px;line-height:16px;">${escapeHtml(
              details.month
            )}</td></tr>
            <tr><td style="padding:0 8px 8px;color:${BRAND.dark};font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;line-height:35px;">${escapeHtml(
              details.day
            )}</td></tr>
          </table>
        </td>
        <td class="date-copy-cell" valign="middle" style="padding:22px 24px 22px 10px;">
          <div style="color:${BRAND.green};font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.6px;line-height:16px;">${escapeHtml(
            label
          )}</div>
          <div style="padding-top:5px;color:${BRAND.ink};font-family:Arial,sans-serif;font-size:19px;font-weight:700;line-height:27px;">${escapeHtml(
            details.weekday
          )}, ${escapeHtml(details.shortDate)}</div>
          <div style="padding-top:3px;color:${BRAND.ink};font-family:Arial,sans-serif;font-size:16px;line-height:24px;">${escapeHtml(
            details.timeRange
          )} <span style="color:${BRAND.muted};">· ${escapeHtml(
              formatDuration(durationMinutes)
            )}</span></div>
        </td>
      </tr>
    </table>`;
}

function previousDateRow(details) {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;margin-top:12px;background:#f8faf9;border:1px solid ${BRAND.border};border-radius:12px;">
      <tr>
        <td style="padding:14px 18px;color:${BRAND.muted};font-family:Arial,sans-serif;font-size:13px;line-height:20px;">
          <span style="font-weight:700;color:#475569;">Cita anterior</span><br>
          <span style="text-decoration:line-through;">${escapeHtml(
            details.longDate
          )} · ${escapeHtml(details.time)}</span>
        </td>
      </tr>
    </table>`;
}

function emailShell({ preheaderText, status, title, greeting, intro, content }) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(title)}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-shell { width: 100% !important; }
      .email-card { border-radius: 0 !important; }
      .mobile-pad { padding-left: 22px !important; padding-right: 22px !important; }
      .date-icon-cell { width: 92px !important; padding-left: 16px !important; }
      .date-copy-cell { padding-right: 14px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${BRAND.background};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  ${preheader(preheaderText)}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:${BRAND.background};">
    <tr>
      <td align="center" style="padding:34px 12px;">
        <table role="presentation" class="email-shell email-card" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;border-collapse:separate;background:#ffffff;border:1px solid ${BRAND.border};border-radius:18px;overflow:hidden;box-shadow:0 10px 34px rgba(6,78,59,.08);">
          <tr>
            <td class="mobile-pad" style="padding:24px 36px;background:${BRAND.dark};">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td valign="middle" style="color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:27px;font-weight:700;letter-spacing:1px;line-height:32px;">TECA</td>
                  <td valign="middle" align="right" style="color:#a7f3d0;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;line-height:15px;">CENTRO DE OSTEOPATÍA</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="mobile-pad" style="padding:38px 36px 34px;">
              <div style="display:inline-block;padding:6px 10px;background:${BRAND.pale};border-radius:999px;color:${BRAND.green};font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;line-height:16px;">${escapeHtml(
                status
              )}</div>
              <h1 style="margin:18px 0 0;color:${BRAND.ink};font-family:Georgia,'Times New Roman',serif;font-size:31px;font-weight:700;line-height:39px;">${escapeHtml(
                title
              )}</h1>
              <p style="margin:18px 0 0;color:#334b45;font-family:Arial,sans-serif;font-size:16px;line-height:26px;">${escapeHtml(
                greeting
              )}</p>
              <p style="margin:8px 0 26px;color:#526761;font-family:Arial,sans-serif;font-size:15px;line-height:24px;">${escapeHtml(
                intro
              )}</p>
              ${content}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:26px;border-collapse:collapse;">
                <tr><td style="padding-top:22px;border-top:1px solid ${BRAND.border};color:#526761;font-family:Arial,sans-serif;font-size:14px;line-height:23px;">Si necesitas cambiar la cita, ponte en contacto con el centro.</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="mobile-pad" style="padding:20px 36px;background:#f8faf9;border-top:1px solid ${BRAND.border};color:${BRAND.muted};font-family:Arial,sans-serif;font-size:12px;line-height:19px;">
              <strong style="color:#475569;">Centro de Osteopatía TECA</strong><br>
              Este correo contiene información sobre tu cita.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildAppointmentCreatedEmail({ customerName, startDate, durationMinutes }) {
  const details = getDateDetails(startDate, durationMinutes);
  const firstName = normaliseName(customerName);
  const greeting = firstName ? `Hola, ${firstName}.` : "Hola.";
  const subject = `Tu cita en TECA · ${details.shortDate}, ${details.time}`;

  return {
    subject,
    text: [
      greeting,
      "",
      "Tu cita está confirmada.",
      `Fecha: ${details.longDate}`,
      `Hora: ${details.timeRange}`,
      `Duración: ${formatDuration(durationMinutes)}`,
      "",
      "Si necesitas cambiar la cita, ponte en contacto con el centro.",
      "",
      "Centro de Osteopatía TECA",
    ].join("\n"),
    html: emailShell({
      preheaderText: `Cita confirmada para el ${details.shortDate} a las ${details.time}.`,
      status: "CITA CONFIRMADA",
      title: "Tu cita está confirmada",
      greeting,
      intro: "Te esperamos en el centro en la fecha y hora indicadas.",
      content: dateCard(details, durationMinutes),
    }),
  };
}

function buildAppointmentRescheduledEmail({
  customerName,
  previousDate,
  startDate,
  durationMinutes,
}) {
  const previousDetails = getDateDetails(previousDate, durationMinutes);
  const details = getDateDetails(startDate, durationMinutes);
  const firstName = normaliseName(customerName);
  const greeting = firstName ? `Hola, ${firstName}.` : "Hola.";
  const subject = `Tu cita en TECA ha cambiado · ${details.shortDate}, ${details.time}`;

  return {
    subject,
    text: [
      greeting,
      "",
      "Hemos reprogramado tu cita.",
      `Nueva fecha: ${details.longDate}`,
      `Nueva hora: ${details.timeRange}`,
      `Duración: ${formatDuration(durationMinutes)}`,
      `Cita anterior: ${previousDetails.longDate} · ${previousDetails.time}`,
      "",
      "Si necesitas cambiar la cita, ponte en contacto con el centro.",
      "",
      "Centro de Osteopatía TECA",
    ].join("\n"),
    html: emailShell({
      preheaderText: `Nueva fecha: ${details.shortDate} a las ${details.time}.`,
      status: "CITA REPROGRAMADA",
      title: "Hemos actualizado tu cita",
      greeting,
      intro: "Esta es la nueva fecha y hora de tu cita.",
      content: `${dateCard(
        details,
        durationMinutes,
        "NUEVA FECHA"
      )}${previousDateRow(previousDetails)}`,
    }),
  };
}

module.exports = {
  buildAppointmentCreatedEmail,
  buildAppointmentRescheduledEmail,
};
