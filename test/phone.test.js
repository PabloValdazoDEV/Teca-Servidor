const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePhoneText } = require("../utils/phone");
const { normalizeCustomerInput } = require("../utils/customerValidation");

// Formatos reales del Excel antiguo, con números inventados.
const cases = [
  ["600123123", [["+34", "600123123"]], null],
  ["600123123 / MADRE", [["+34", "600123123"]], "MADRE"],
  ["600123123/ HIJA ANA", [["+34", "600123123"]], "HIJA ANA"],
  ["600123123 ( PADRE )", [["+34", "600123123"]], "PADRE"],
  ["600 12 31 23", [["+34", "600123123"]], null],
  ["600123123- 611222333", [["+34", "600123123"], ["+34", "611222333"]], null],
  ["+44 7911 123456", [["+44", "7911123456"]], null],
  ["0033 6 12 34 56 78", [["+33", "612345678"]], null],
  ["60012312", [], null], // 8 cifras: se queda como texto para revisar
];

for (const [input, expected, note] of cases) {
  test(`interpreta el teléfono ${JSON.stringify(input)}`, () => {
    const result = parsePhoneText(input);
    assert.deepEqual(result.numbers.map((n) => [n.countryCode, n.phoneNumber]), expected);
    if (expected.length) assert.equal(result.note, note);
  });
}

test("un número extranjero escrito al crear un paciente conserva su prefijo", () => {
  const { phones } = normalizeCustomerInput({ fullName: "Ana", PhoneNumber: [{ rawValue: "+44 7911 123456" }] });
  assert.equal(phones[0].countryCode, "+44");
  assert.equal(phones[0].phoneNumber, 7911123456n);
});

test("la reparación completa los teléfonos guardados solo como texto", () => {
  const { planPhoneFix } = require("../scripts/normalizePhones");
  const fix = planPhoneFix({ rawValue: "600123123- 611222333", countryCode: "+34", phoneNumber: null });
  assert.equal(fix.action, "update");
  assert.equal(fix.first.phoneNumber, "600123123");
  assert.equal(fix.extra[0].phoneNumber, "611222333");
});

test("la reparación corrige extranjeros guardados con +34 y no toca los correctos", () => {
  const { planPhoneFix } = require("../scripts/normalizePhones");
  assert.equal(planPhoneFix({ rawValue: "+44 7911 123456", countryCode: "+34", phoneNumber: 447911123456n }).first.countryCode, "+44");
  assert.equal(planPhoneFix({ rawValue: "600123123", countryCode: "+34", phoneNumber: 600123123n }), null);
  assert.equal(planPhoneFix({ rawValue: "60012312", countryCode: "+34", phoneNumber: null }).action, "review");
});
