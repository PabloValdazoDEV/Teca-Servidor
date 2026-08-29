process.env.NODE_ENV = "test";

const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { patientsWorkbookPath: legacyWorkbookPath } = require("../config/legacyPaths");
const docsRouter = require("../router/docs");

test("the weekly patient workbook retains the legacy layout and formulas", {
  skip: !fs.existsSync(legacyWorkbookPath),
}, async () => {
  const createdAt = new Date("2026-08-29T08:00:00.000Z");
  const workbookBuffer = await docsRouter._exportTestHelpers.buildPatientsWorkbook([{
    id: "customer-id",
    customerNumber: 42,
    fullName: "PACIENTE ACTUAL",
    weight: 72,
    height: 168,
    children: 1,
    profession: "FISIOTERAPEUTA",
    population: "Madrid",
    province: "MADRID",
    cD: 28001,
    address: "Calle de prueba 1",
    dateBirth: new Date("1990-04-05T00:00:00.000Z"),
    emailAddress: "paciente@example.com",
    preferredCommunication: "PHONE",
    observationChildren: "Sin observaciones",
    createdAt,
    phones: [{ kind: "MOBILE", rawValue: "600 123 123", isCommunicationPhone: true }],
    appointments: [],
    docs: [],
  }]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBuffer);
  const sheet = workbook.getWorksheet("Hoja1");

  assert.ok(sheet);
  assert.equal(sheet.getCell("A6").value, "PACIENTE ACTUAL");
  assert.equal(sheet.getCell("J6").value, 42);
  assert.match(sheet.getCell("B6").value.formula, /^IFERROR/);
  assert.match(sheet.getCell("O6").value.formula, /Datos adjuntos/);
  assert.equal(sheet.getCell("Q6").value, "paciente@example.com");
  assert.equal(sheet.getCell("R6").value, "PHONE");
  assert.equal(sheet.getCell("A7").value, null);
  assert.ok(workbook.worksheets.some((worksheet) => worksheet.getImages().length > 0));
  assert.ok(workbook.getWorksheet("Citas"));
  assert.ok(workbook.getWorksheet("Documentos"));
});

test("history versions use readable document names and Madrid dates", () => {
  const document = {
    id: "a-technical-document-id",
    originalName: "FICHA 1.XLS",
    versions: [{ originalName: "FICHA ORIGINAL.XLS" }],
  };
  const original = {
    version: 1,
    originalName: "FICHA ORIGINAL.XLS",
    createdAt: new Date("2026-08-29T10:15:30.000Z"),
  };
  const modified = { ...original, version: 2 };

  assert.equal(
    docsRouter._exportTestHelpers.documentHistoryFolderName(document),
    "FICHA ORIGINAL"
  );
  assert.equal(
    docsRouter._exportTestHelpers.historyVersionFileName(original),
    "Original - 2026-08-29 12-15-30.XLS"
  );
  assert.equal(
    docsRouter._exportTestHelpers.historyVersionFileName(modified),
    "Modificado - 2026-08-29 12-15-30.XLS"
  );
});
