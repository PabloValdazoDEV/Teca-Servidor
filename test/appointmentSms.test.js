const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAppointmentCreatedSms,
  buildAppointmentRescheduledSms,
  deliverAppointmentSms,
  getCommunicationPhone,
} = require("../services/appointmentSms");

function smsCustomer(overrides = {}) {
  return {
    fullName: "María García",
    preferredCommunication: "SMS",
    phones: [
      {
        countryCode: "+34",
        phoneNumber: 601709360n,
        isCommunicationPhone: true,
      },
    ],
    ...overrides,
  };
}

test("appointment SMS text is generated on the server in Madrid time", () => {
  const startDate = new Date("2026-09-02T08:00:00.000Z");

  assert.equal(
    buildAppointmentCreatedSms({ customerName: "María García", startDate }),
    "TECA: Hola, Maria. Cita confirmada para el 02/09/2026 a las 10:00."
  );
  assert.equal(
    buildAppointmentRescheduledSms({ customerName: "María García", startDate }),
    "TECA: Hola, Maria. Cita reprogramada para el 02/09/2026 a las 10:00."
  );
});

test("communication phone is converted to E.164", () => {
  assert.equal(getCommunicationPhone(smsCustomer()), "+34601709360");
});

test("SMS delivery uses the preferred communication phone", async () => {
  const calls = [];
  const result = await deliverAppointmentSms({
    customer: smsCustomer(),
    message: "Mensaje de prueba",
    enabled: true,
    sender: async (to, message) => {
      calls.push({ to, message });
      return { sid: "SM_TEST" };
    },
  });

  assert.deepEqual(calls, [
    { to: "+34601709360", message: "Mensaje de prueba" },
  ]);
  assert.deepEqual(result, { status: "sent", messageId: "SM_TEST" });
});

test("SMS is not sent when it is not the patient's preferred channel", async () => {
  let called = false;
  const result = await deliverAppointmentSms({
    customer: smsCustomer({ preferredCommunication: "PHONE" }),
    message: "Mensaje de prueba",
    enabled: true,
    sender: async () => {
      called = true;
    },
  });

  assert.equal(called, false);
  assert.deepEqual(result, { status: "skipped", reason: "SMS_NOT_PREFERRED" });
});

test("a Twilio failure does not escape the appointment notification flow", async () => {
  const result = await deliverAppointmentSms({
    customer: smsCustomer(),
    message: "Mensaje de prueba",
    enabled: true,
    sender: async () => {
      const error = new Error("Twilio rejected the message");
      error.code = 21211;
      throw error;
    },
    logger: { error() {} },
  });

  assert.deepEqual(result, { status: "failed", reason: 21211 });
});
