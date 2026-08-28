const twilio = require("twilio");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

const client = new twilio(accountSid, authToken);

const sendSms = async (to, message) => {
  if (!to || !message) {
    throw new Error("Número de teléfono o mensaje faltante");
  }

  try {
    const response = await client.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to,
    });
    return response;
  } catch (error) {
    throw error;
  }
};

module.exports = sendSms;
