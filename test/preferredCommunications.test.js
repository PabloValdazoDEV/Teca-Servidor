const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getEnabledChannels,
} = require("../config/preferredCommunications");
const {
  normalizeCustomerInput,
} = require("../utils/customerValidation");

test("preferred communication channels are selected from a comma-separated setting", () => {
  assert.deepEqual(getEnabledChannels("PHONE, EMAIL"), ["PHONE", "EMAIL"]);
  assert.deepEqual(getEnabledChannels("sms,PHONE,SMS,invalid"), ["SMS", "PHONE"]);
  assert.deepEqual(getEnabledChannels(""), []);
});

test("a disabled preferred communication cannot be assigned to a new patient", () => {
  assert.throws(
    () =>
      normalizeCustomerInput(
        {
          fullName: "Ana Pérez",
          preferredCommunication: "SMS",
          PhoneNumber: [{ phoneNumber: "600123123" }],
        },
        { enabledPreferredCommunications: new Set(["PHONE", "EMAIL"]) }
      ),
    /está desactivado/
  );
});
