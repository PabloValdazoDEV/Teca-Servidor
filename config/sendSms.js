const twilio = require("twilio");

// Variables de entorno (configura esto correctamente)
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

const client = new twilio(accountSid, authToken);

const sendSms = async (to, message) => {
  console.log("Enviando SMS a:", to);
  console.log("Mensaje:", message);
  if (!to || !message) {
    throw new Error("Número de teléfono o mensaje faltante");
  }

  try {
    const response = await client.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to,
    });
    console.log("Message sent:", response.sid);
    return response;
  } catch (error) {
    console.error("Error sending SMS:", error);
    throw error;
  }
};

module.exports = sendSms;
