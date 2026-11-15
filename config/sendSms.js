const twilio = require("twilio");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

let client;

// SMS desactivados de momento por decisión de la clínica: este interruptor manda
// sobre TWILIO_ENABLED, así que ningún entorno puede enviarlos por error.
// Para reactivarlos: pon SMS_TEMPORARILY_DISABLED a false y TWILIO_ENABLED=true.
const SMS_TEMPORARILY_DISABLED = true;

const isEnabled = () => !SMS_TEMPORARILY_DISABLED && process.env.TWILIO_ENABLED === "true";

const getClient = () => {
  if (!accountSid || !authToken || !twilioPhoneNumber) {
    const error = new Error("La configuración de Twilio está incompleta");
    error.code = "TWILIO_NOT_CONFIGURED";
    throw error;
  }
  client ||= new twilio(accountSid, authToken);
  return client;
};

const sendSms = async (to, message) => {
  if (!isEnabled()) {
    const error = new Error("Los envíos mediante Twilio están desactivados");
    error.code = "TWILIO_DISABLED";
    throw error;
  }
  if (!to || !message) {
    throw new Error("Número de teléfono o mensaje faltante");
  }

  return getClient().messages.create({
    body: message,
    from: twilioPhoneNumber,
    to,
  });
};

sendSms.isEnabled = isEnabled;
module.exports = sendSms;
