const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { legacyHeight, optionalInteger, parseLegacyRows } = require("../scripts/importLegacyPatients");

test("decimal formula results are converted to bounded integers", () => {
  assert.equal(optionalInteger(76.53424657534246, 0, 130), 76);
  assert.equal(optionalInteger("76,53", 0, 130), 76);
  assert.equal(optionalInteger(7_653_424_657_534_246, 0, 130), null);
});

test("legacy heights accept metres or centimetres within human limits", () => {
  assert.equal(legacyHeight("1.65"), 165);
  assert.equal(legacyHeight(172), 172);
  assert.equal(legacyHeight(7_653_424_657_534_246), null);
});

test("the visible legacy patient ID is read from Excel column J", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Pacientes");
  sheet.getRow(6).getCell(1).value = "Ana Pérez";
  sheet.getRow(6).getCell(10).value = 248;

  const [patient] = parseLegacyRows(sheet);

  assert.equal(patient.sourceRow, 6);
  assert.equal(patient.legacyId, 248);
});

test("los teléfonos antiguos se separan en prefijo, número y nota", () => {
  const { legacyPhones } = require("../scripts/importLegacyPatients");
  const { phones, toReview } = legacyPhones("912345678", "600123123 / MADRE");
  assert.deepEqual(phones.map((p) => [p.label, p.countryCode, String(p.phoneNumber), p.isCommunicationPhone]), [
    ["Teléfono", "+34", "912345678", false],
    ["Móvil", "+34", "600123123", true],
  ]);
  assert.equal(phones[1].rawValue, "600123123 / MADRE");
  assert.equal(toReview.length, 0);
});

test("dos números en una casilla crean dos teléfonos y los dudosos se informan", () => {
  const { legacyPhones } = require("../scripts/importLegacyPatients");
  const { phones, toReview } = legacyPhones("60012312", "600123123- 611222333");
  assert.deepEqual(phones.map((p) => [p.label, p.phoneNumber && String(p.phoneNumber)]), [
    ["Teléfono", null],
    ["Móvil", "600123123"],
    ["Móvil 2", "611222333"],
  ]);
  assert.deepEqual(toReview, [{ column: "Teléfono", value: "60012312" }]);
});
