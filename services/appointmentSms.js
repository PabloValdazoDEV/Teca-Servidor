const { DateTime } = require("luxon");
const sendSms = require("../config/sendSms");

const MADRID_TIME_ZONE = "Europe/Madrid";
const E164_PHONE = /^\+[1-9]\d{7,14}$/;

function normaliseFirstName(value) {
  const firstName = String(value ?? "").trim().split(/\s+/)[0] || "";

  return firstName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z'-]/g, "")
    .slice(0, 30);
}

function formatAppointmentDate(date) {
  const parsedDate =
    date instanceof Date
      ? DateTime.fromJSDate(date, { zone: MADRID_TIME_ZONE })
      : DateTime.fromISO(String(date), { zone: MADRID_TIME_ZONE });

  if (!parsedDate.isValid) {
    throw new TypeError("Appointment SMS requires a valid date");
  }

  return parsedDate.toFormat("dd/LL/yyyy 'a las' HH:mm");
}

function buildGreeting(customerName) {
  const firstName = normaliseFirstName(customerName);
  return firstName ? `Hola, ${firstName}. ` : "";
}

function buildAppointmentCreatedSms({ customerName, startDate }) {
  return `TECA: ${buildGreeting(customerName)}Cita confirmada para el ${formatAppointmentDate(
    startDate
  )}.`;
}

function buildAppointmentRescheduledSms({ customerName, startDate }) {
  return `TECA: ${buildGreeting(customerName)}Cita reprogramada para el ${formatAppointmentDate(
    startDate
  )}.`;
}

function getCommunicationPhone(customer) {
  const phone = customer?.phones?.find(
    (candidate) =>
      candidate.isCommunicationPhone === true && candidate.phoneNumber != null
  );

  if (!phone) {
    return null;
  }

  const countryCode = String(phone.countryCode || "+34").replace(/\D/g, "");
  const phoneNumber = String(phone.phoneNumber).replace(/\D/g, "");
  const recipient = `+${countryCode}${phoneNumber}`;

  return E164_PHONE.test(recipient) ? recipient : null;
}

async function deliverAppointmentSms({
  customer,
  message,
  sender = sendSms,
  enabled = sendSms.isEnabled(),
  logger = console,
}) {
  if (customer?.preferredCommunication !== "SMS") {
    return { status: "skipped", reason: "SMS_NOT_PREFERRED" };
  }

  if (!enabled) {
    return { status: "skipped", reason: "TWILIO_DISABLED" };
  }

  const recipient = getCommunicationPhone(customer);
  if (!recipient) {
    return { status: "skipped", reason: "NO_VALID_COMMUNICATION_PHONE" };
  }

  try {
    const result = await sender(recipient, message);
    return { status: "sent", messageId: result?.sid || null };
  } catch (error) {
    logger.error("SMS delivery failed", error?.code || "UNKNOWN_ERROR");
    return { status: "failed", reason: error?.code || "SMS_DELIVERY_FAILED" };
  }
}

module.exports = {
  buildAppointmentCreatedSms,
  buildAppointmentRescheduledSms,
  deliverAppointmentSms,
  getCommunicationPhone,
};
