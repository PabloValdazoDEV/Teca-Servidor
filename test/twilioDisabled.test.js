const test = require("node:test");
const assert = require("node:assert/strict");
const sendSms = require("../config/sendSms");

test("Twilio delivery is blocked when TWILIO_ENABLED is false", async (context) => {
  const previousValue = process.env.TWILIO_ENABLED;
  process.env.TWILIO_ENABLED = "false";
  context.after(() => {
    if (previousValue === undefined) delete process.env.TWILIO_ENABLED;
    else process.env.TWILIO_ENABLED = previousValue;
  });

  await assert.rejects(
    sendSms("+34600123123", "Mensaje de prueba"),
    (error) => error.code === "TWILIO_DISABLED"
  );
});

test("los SMS quedan desactivados aunque TWILIO_ENABLED sea true", async (context) => {
  const previousValue = process.env.TWILIO_ENABLED;
  process.env.TWILIO_ENABLED = "true";
  context.after(() => {
    if (previousValue === undefined) delete process.env.TWILIO_ENABLED;
    else process.env.TWILIO_ENABLED = previousValue;
  });

  assert.equal(sendSms.isEnabled(), false);
  await assert.rejects(sendSms("+34600123123", "Mensaje de prueba"), (error) => error.code === "TWILIO_DISABLED");
});
