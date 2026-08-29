const test = require("node:test");
const assert = require("node:assert/strict");
const appointmentCommunications = require("../config/appointmentCommunications");

test("appointment communications require explicit activation", (context) => {
  const previousValue = process.env.APPOINTMENT_COMMUNICATIONS_ENABLED;
  context.after(() => {
    if (previousValue === undefined) {
      delete process.env.APPOINTMENT_COMMUNICATIONS_ENABLED;
    } else {
      process.env.APPOINTMENT_COMMUNICATIONS_ENABLED = previousValue;
    }
  });

  process.env.APPOINTMENT_COMMUNICATIONS_ENABLED = "false";
  assert.equal(appointmentCommunications.isEnabled(), false);

  process.env.APPOINTMENT_COMMUNICATIONS_ENABLED = "true";
  assert.equal(appointmentCommunications.isEnabled(), true);

  process.env.APPOINTMENT_COMMUNICATIONS_ENABLED = "TRUE";
  assert.equal(appointmentCommunications.isEnabled(), false);
});

test("past appointments never trigger automatic communications", () => {
  const now = new Date("2026-08-30T10:00:00.000Z");

  assert.equal(
    appointmentCommunications.shouldSendFor(
      new Date("2026-08-30T09:59:59.999Z"),
      now
    ),
    false
  );
  assert.equal(appointmentCommunications.shouldSendFor(now, now), true);
  assert.equal(
    appointmentCommunications.shouldSendFor(
      new Date("2026-08-30T10:00:00.001Z"),
      now
    ),
    true
  );
  assert.equal(appointmentCommunications.shouldSendFor("fecha-inválida", now), false);
});
