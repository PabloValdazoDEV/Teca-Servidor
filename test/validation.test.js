const test = require("node:test");
const assert = require("node:assert/strict");
const { isStrongPassword } = require("../utils/accountValidation");
const {
  CustomerValidationError,
  normalizeCustomerInput,
} = require("../utils/customerValidation");

test("strong passwords require 8 characters instead of 12", () => {
  assert.equal(isStrongPassword("Aa1!aaaa"), true);
  assert.equal(isStrongPassword("Aa1!aaa"), false);
});

test("a customer can be created with only a full name", () => {
  const normalized = normalizeCustomerInput({ fullName: "  Ana Pérez  " });

  assert.equal(normalized.customer.fullName, "Ana Pérez");
  assert.equal(normalized.customer.dateBirth, null);
  assert.equal(normalized.customer.emailAddress, null);
  assert.equal(normalized.customer.preferredCommunication, null);
  assert.deepEqual(normalized.phones, []);
});

test("optional customer contact data is validated when supplied", () => {
  assert.throws(
    () =>
      normalizeCustomerInput({
        fullName: "Ana Pérez",
        emailAddress: "correo-no-valido",
      }),
    CustomerValidationError
  );

  assert.throws(
    () =>
      normalizeCustomerInput({
        fullName: "Ana Pérez",
        preferredCommunication: "EMAIL",
      }),
    /Añade un email/
  );
});

test("the first phone becomes the communication phone when none is selected", () => {
  const normalized = normalizeCustomerInput({
    fullName: "Ana Pérez",
    PhoneNumber: [{ countryCode: "+34", phoneNumber: "600123123" }],
  });

  assert.equal(normalized.phones[0].phoneNumber, 600123123n);
  assert.equal(normalized.phones[0].isCommunicationPhone, true);
});
