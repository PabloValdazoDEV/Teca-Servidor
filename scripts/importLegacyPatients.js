require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const ExcelJS = require("exceljs");
const prisma = require("../prisma/prisma");
const { createStoredDocument } = require("../services/documentStorage");
const { buildLegacyMatchPlan } = require("../services/legacyMatching");

const root = path.resolve(__dirname, "..", "..");
const workbookPath = path.resolve(process.env.LEGACY_PATIENTS_FILE || path.join(root, "Ejemplos clientes", "Pacientes", "PACIENTES.xlsm"));
const attachmentsPath = path.resolve(process.env.LEGACY_ATTACHMENTS_PATH || path.join(root, "Ejemplos clientes", "Datos adjuntos"));
const reportDirectory = path.resolve(process.env.LEGACY_REPORT_PATH || path.join(__dirname, "..", "migration-reports"));
const applyChanges = process.argv.includes("--apply");

function cellValue(cell) {
  const value = cell.value;
  if (value && typeof value === "object" && Object.hasOwn(value, "result")) return value.result;
  if (value && typeof value === "object" && Array.isArray(value.richText)) return value.richText.map((item) => item.text).join("");
  return value;
}

function optionalText(value, maxLength = 250) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, maxLength) : null;
}

function optionalInteger(value) {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function optionalNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLegacyRows(sheet) {
  const rows = [];
  for (let rowNumber = 6; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const fullName = optionalText(cellValue(row.getCell(1)), 200);
    if (!fullName) continue;
    const dateBirthValue = cellValue(row.getCell(16));
    const dateBirth = dateBirthValue instanceof Date && !Number.isNaN(dateBirthValue.getTime()) ? dateBirthValue : null;
    const phones = [cellValue(row.getCell(3)), cellValue(row.getCell(4))]
      .map((value, index) => optionalText(value, 160) ? ({ label: index === 0 ? "Teléfono" : "Móvil", rawValue: optionalText(value, 160), kind: index === 0 ? "LANDLINE" : "MOBILE", isCommunicationPhone: index === 1 }) : null)
      .filter(Boolean);
    if (phones.length && !phones.some((phone) => phone.isCommunicationPhone)) phones[0].isCommunicationPhone = true;

    rows.push({
      sourceRow: rowNumber,
      fullName,
      age: optionalInteger(cellValue(row.getCell(2))),
      weight: optionalInteger(cellValue(row.getCell(5))),
      children: optionalInteger(cellValue(row.getCell(6))),
      profession: optionalText(cellValue(row.getCell(7)), 200),
      height: optionalNumber(cellValue(row.getCell(8))) ? Math.round(optionalNumber(cellValue(row.getCell(8))) * (optionalNumber(cellValue(row.getCell(8))) < 3 ? 100 : 1)) : null,
      population: optionalText(cellValue(row.getCell(9)), 160),
      cD: optionalInteger(cellValue(row.getCell(12))),
      address: optionalText(cellValue(row.getCell(13)), 300),
      dateBirth,
      phones,
    });
  }
  return rows;
}

async function readFolders() {
  const entries = await fs.readdir(attachmentsPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => ({ name: entry.name, path: path.join(attachmentsPath, entry.name) }));
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(target));
    else if (entry.isFile() && entry.name !== ".DS_Store") files.push(target);
  }
  return files;
}

function fixedTypeFor(fileName) {
  const name = fileName.toUpperCase();
  if (name.startsWith("FICHA")) return "FICHA";
  if (name.includes("VISCERAL") && name.includes("CRANEAL")) return "VISCERAL_CRANEAL";
  if (name.includes("HISTORIAL CLINICO")) return "HISTORIAL_CLINICO";
  return null;
}

async function importPatient(row, folder, createdById, importLog) {
  let customer = await prisma.customer.findUnique({ where: { legacySourceRow: row.sourceRow } });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        fullName: row.fullName, age: row.age, weight: row.weight, height: row.height,
        children: row.children, profession: row.profession, population: row.population,
        cD: row.cD, address: row.address, dateBirth: row.dateBirth,
        legacySourceRow: row.sourceRow, legacyFolderName: folder?.name || null,
        ...(row.phones.length ? { phones: { createMany: { data: row.phones } } } : {}),
      },
    });
    importLog.createdCustomers += 1;
  }

  if (!folder) return;
  for (const filePath of await listFiles(folder.path)) {
    const buffer = await fs.readFile(filePath);
    if (buffer.length > 25 * 1024 * 1024) {
      importLog.skippedFiles.push({ filePath, reason: "Archivo superior a 25 MB" });
      continue;
    }
    const originalname = path.basename(filePath);
    try {
      const existing = await prisma.doc.findFirst({ where: { customerId: customer.id, originalName: originalname, sizeBytes: buffer.length } });
      if (existing) continue;
      await createStoredDocument({ prisma, customerId: customer.id, createdById, fixedType: fixedTypeFor(originalname), file: { originalname, buffer } });
      importLog.importedFiles += 1;
    } catch (error) {
      importLog.skippedFiles.push({ filePath, reason: error.code || error.message });
    }
  }
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.worksheets[0];
  const rows = parseLegacyRows(sheet);
  const folders = await readFolders();
  const plan = buildLegacyMatchPlan(rows, folders);
  const matchedRows = new Map(plan.autoMatches.map((match) => [match.row.sourceRow, match.folder]));
  const report = {
    generatedAt: new Date().toISOString(), mode: applyChanges ? "apply" : "dry-run",
    source: { workbookPath, attachmentsPath, patientRows: rows.length, folders: folders.length },
    summary: { automaticMatches: plan.autoMatches.length, ambiguousNames: plan.ambiguous.length, unmatchedPatients: plan.unmatchedRows.length, unmatchedFolders: plan.unmatchedFolders.length },
    automaticMatches: plan.autoMatches.map((match) => ({ sourceRow: match.row.sourceRow, patient: match.row.fullName, folder: match.folder.name })),
    ambiguous: plan.ambiguous.map((item) => ({ normalizedName: item.key, rows: item.rows.map((row) => ({ sourceRow: row.sourceRow, fullName: row.fullName })), folders: item.folders.map((folder) => folder.name) })),
    unmatchedPatients: plan.unmatchedRows.map((row) => ({ sourceRow: row.sourceRow, fullName: row.fullName })),
    unmatchedFolders: plan.unmatchedFolders.map((folder) => folder.name),
    import: { createdCustomers: 0, importedFiles: 0, skippedFiles: [] },
  };

  if (applyChanges) {
    const actor = await prisma.user.findFirst({ where: { role: { in: ["SUPERADMIN", "ADMIN"] } }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!actor) throw new Error("Necesitas al menos un usuario administrador antes de importar");
    for (const row of rows) await importPatient(row, matchedRows.get(row.sourceRow), actor.id, report.import);
  }

  await fs.mkdir(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, `legacy-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ reportPath, ...report.summary, ...report.import }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
