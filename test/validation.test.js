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

test("phone calls can be applied as the default preferred communication", () => {
  const normalized = normalizeCustomerInput(
    { fullName: "Ana Pérez" },
    {
      enabledPreferredCommunications: new Set(["PHONE", "EMAIL"]),
      defaultPreferredCommunication: "PHONE",
    }
  );

  assert.equal(normalized.customer.preferredCommunication, "PHONE");
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

test("a selected legacy phone annotation can be used for calls", () => {
  const normalized = normalizeCustomerInput({
    fullName: "Paciente histórico",
    preferredCommunication: "PHONE",
    PhoneNumber: [{
      kind: "MOBILE",
      label: "Móvil",
      rawValue: "601709360/ MIGUEL",
      isCommunicationPhone: true,
    }],
  });

  assert.equal(normalized.phones[0].phoneNumber, 601709360n);
  assert.equal(normalized.phones[0].rawValue, "601709360/ MIGUEL");
  assert.equal(normalized.phones[0].isCommunicationPhone, true);
});

test("a displayed international prefix is not duplicated when saving", () => {
  const normalized = normalizeCustomerInput({
    fullName: "Paciente histórico",
    preferredCommunication: "PHONE",
    PhoneNumber: [{ rawValue: "+34 600 123 123", isCommunicationPhone: true }],
  });

  assert.equal(normalized.phones[0].countryCode, "+34");
  assert.equal(normalized.phones[0].phoneNumber, 600123123n);
});
