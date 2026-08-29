require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const ExcelJS = require("exceljs");
const prisma = require("../prisma/prisma");
const {
  patientsWorkbookPath,
  legacyAttachmentsPath,
} = require("../config/legacyPaths");
const { createStoredDocument } = require("../services/documentStorage");
const { buildLegacyMatchPlan } = require("../services/legacyMatching");

function pathOption(name) {
  const prefix = `${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  const value = argument?.slice(prefix.length).trim();
  return value || null;
}

const workbookPath = path.resolve(pathOption("--patients-file") || patientsWorkbookPath);
const attachmentsPath = path.resolve(pathOption("--attachments") || legacyAttachmentsPath);
const reportDirectory = path.resolve(process.env.LEGACY_REPORT_PATH || path.join(__dirname, "..", "migration-reports"));
const applyChanges = process.argv.includes("--apply");

const PROVINCES = new Map([
  ["ALAVA", "ALAVA"], ["ALBACETE", "ALBACETE"], ["ALICANTE", "ALICANTE"], ["ALMERIA", "ALMERIA"],
  ["ASTURIAS", "ASTURIAS"], ["AVILA", "AVILA"], ["BADAJOZ", "BADAJOZ"], ["BARCELONA", "BARCELONA"],
  ["BURGOS", "BURGOS"], ["CACERES", "CACERES"], ["CADIZ", "CADIZ"], ["CANTABRIA", "CANTABRIA"],
  ["CASTELLON", "CASTELLON"], ["CIUDAD REAL", "CIUDAD_REAL"], ["CORDOBA", "CORDOBA"], ["LA CORUNA", "LA_CORUNA"],
  ["CORUNA", "LA_CORUNA"], ["CUENCA", "CUENCA"], ["GERONA", "GERONA"], ["GIRONA", "GERONA"],
  ["GRANADA", "GRANADA"], ["GUADALAJARA", "GUADALAJARA"], ["GUIPUZCOA", "GUIPUZCOA"], ["HUELVA", "HUELVA"],
  ["HUESCA", "HUESCA"], ["ISLAS BALEARES", "ISLAS_BALEARES"], ["BALEARES", "ISLAS_BALEARES"], ["JAEN", "JAEN"],
  ["LEON", "LEON"], ["LERIDA", "LERIDA"], ["LLEIDA", "LERIDA"], ["LUGO", "LUGO"],
  ["MADRID", "MADRID"], ["MALAGA", "MALAGA"], ["MURCIA", "MURCIA"], ["NAVARRA", "NAVARRA"],
  ["ORENSE", "ORENSE"], ["OURENSE", "ORENSE"], ["PALENCIA", "PALENCIA"], ["LAS PALMAS", "LAS_PALMAS"],
  ["PONTEVEDRA", "PONTEVEDRA"], ["LA RIOJA", "LA_RIOJA"], ["SALAMANCA", "SALAMANCA"], ["SEGOVIA", "SEGOVIA"],
  ["SEVILLA", "SEVILLA"], ["SORIA", "SORIA"], ["TARRAGONA", "TARRAGONA"], ["SANTA CRUZ DE TENERIFE", "SANTA_CRUZ_DE_TENERIFE"],
  ["TENERIFE", "SANTA_CRUZ_DE_TENERIFE"], ["TERUEL", "TERUEL"], ["TOLEDO", "TOLEDO"], ["VALENCIA", "VALENCIA"],
  ["VALLADOLID", "VALLADOLID"], ["VIZCAYA", "VIZCAYA"], ["BIZKAIA", "VIZCAYA"], ["ZAMORA", "ZAMORA"],
  ["ZARAGOZA", "ZARAGOZA"],
]);

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

function optionalNumber(value) {
  const parsed = typeof value === "number"
    ? value
    : Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalInteger(value, minimum = -2_147_483_648, maximum = 2_147_483_647) {
  const parsed = optionalNumber(value);
  if (parsed === null) return null;
  const integer = Math.trunc(parsed);
  return Number.isSafeInteger(integer) && integer >= minimum && integer <= maximum ? integer : null;
}

function legacyHeight(value) {
  const parsed = optionalNumber(value);
  if (parsed === null) return null;
  const centimeters = Math.round(parsed < 3 ? parsed * 100 : parsed);
  return centimeters >= 30 && centimeters <= 300 ? centimeters : null;
}

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function legacyFolderHint(value) {
  const normalizedPath = String(value ?? "").trim().replace(/[\\/]+$/, "");
  return optionalText(normalizedPath.split(/[\\/]/).at(-1), 250);
}

function legacyProvince(value) {
  const normalized = normalizedText(value);
  return normalized ? PROVINCES.get(normalized) || "OTRO" : null;
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
      age: optionalInteger(cellValue(row.getCell(2)), 0, 130),
      weight: optionalInteger(cellValue(row.getCell(5)), 1, 500),
      children: optionalInteger(cellValue(row.getCell(6)), 0, 50),
      profession: optionalText(cellValue(row.getCell(7)), 200),
      height: legacyHeight(cellValue(row.getCell(8))),
      population: optionalText(cellValue(row.getCell(9)), 160),
      legacyId: optionalInteger(cellValue(row.getCell(10)), 0),
      province: legacyProvince(cellValue(row.getCell(11))),
      cD: optionalInteger(cellValue(row.getCell(12)), 0, 99_999),
      address: optionalText(cellValue(row.getCell(13)), 300),
      folderHint: legacyFolderHint(cellValue(row.getCell(15))),
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
        customerNumber: row.legacyId,
        fullName: row.fullName, age: row.age, weight: row.weight, height: row.height,
        children: row.children, profession: row.profession, population: row.population,
        province: row.province, cD: row.cD, address: row.address, dateBirth: row.dateBirth,
        preferredCommunication: "PHONE",
        legacySourceRow: row.sourceRow, legacyFolderName: folder?.name || row.folderHint || null,
        ...(row.phones.length ? { phones: { createMany: { data: row.phones } } } : {}),
      },
    });
    importLog.createdCustomers += 1;
  } else {
    if (customer.customerNumber !== row.legacyId) {
      throw new Error(
        `El paciente ya existe con ID-${customer.customerNumber}, pero la columna J indica ID-${row.legacyId}. ` +
        "Borra la importación anterior y vuelve a importarla para corregir los IDs sin colisiones."
      );
    }
    importLog.existingCustomers += 1;
    if (folder && customer.legacyFolderName !== folder.name) {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: { legacyFolderName: folder.name },
      });
    }
  }

  let importedPatientFiles = 0;
  if (folder) {
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
        importedPatientFiles += 1;
        importLog.importedFiles += 1;
      } catch (error) {
        importLog.skippedFiles.push({ filePath, reason: error.code || error.message });
      }
    }
  }

  importLog.patientMappings.push({
    sourceRow: row.sourceRow,
    legacyId: row.legacyId,
    customerId: customer.id,
    customerNumber: customer.customerNumber,
    patient: customer.fullName,
    folder: folder?.name || null,
    importedFiles: importedPatientFiles,
  });
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.worksheets[0];
  const rows = parseLegacyRows(sheet);
  const missingLegacyIds = rows.filter((row) => row.legacyId === null);
  const legacyIdCounts = new Map();
  for (const row of rows) {
    if (row.legacyId !== null) {
      legacyIdCounts.set(row.legacyId, (legacyIdCounts.get(row.legacyId) || 0) + 1);
    }
  }
  const duplicateLegacyIds = [...legacyIdCounts]
    .filter(([, count]) => count > 1)
    .map(([legacyId]) => legacyId);
  if (missingLegacyIds.length || duplicateLegacyIds.length) {
    throw new Error(
      `La columna J debe contener IDs únicos en todas las filas. ` +
      `Sin ID: ${missingLegacyIds.length}; duplicados: ${duplicateLegacyIds.length}.`
    );
  }
  const folders = await readFolders();
  const plan = buildLegacyMatchPlan(rows, folders);
  const matchedRows = new Map(plan.autoMatches.map((match) => [match.row.sourceRow, match.folder]));
  const report = {
    generatedAt: new Date().toISOString(), mode: applyChanges ? "apply" : "dry-run",
    source: { workbookPath, attachmentsPath, patientRows: rows.length, folders: folders.length },
    summary: { automaticMatches: plan.autoMatches.length, ambiguousNames: plan.ambiguous.length, unmatchedPatients: plan.unmatchedRows.length, unmatchedFolders: plan.unmatchedFolders.length },
    automaticMatches: plan.autoMatches.map((match) => ({ sourceRow: match.row.sourceRow, legacyId: match.row.legacyId, patient: match.row.fullName, folder: match.folder.name, strategy: match.strategy })),
    ambiguous: plan.ambiguous.map((item) => ({ normalizedName: item.key, rows: item.rows.map((row) => ({ sourceRow: row.sourceRow, fullName: row.fullName })), folders: item.folders.map((folder) => folder.name) })),
    unmatchedPatients: plan.unmatchedRows.map((row) => ({ sourceRow: row.sourceRow, fullName: row.fullName })),
    unmatchedFolders: plan.unmatchedFolders.map((folder) => folder.name),
    import: { createdCustomers: 0, existingCustomers: 0, importedFiles: 0, skippedFiles: [], patientMappings: [] },
  };

  if (applyChanges) {
    const actor = await prisma.user.findFirst({ where: { role: { in: ["SUPERADMIN", "ADMIN"] } }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!actor) throw new Error("Necesitas al menos un usuario administrador antes de importar");
    console.log(`Importando ${rows.length} pacientes. Las carpetas se copian; los originales no se modifican.`);
    for (const [index, row] of rows.entries()) {
      try {
        await importPatient(row, matchedRows.get(row.sourceRow), actor.id, report.import);
      } catch (error) {
        error.message = `Error en la fila ${row.sourceRow} del Excel: ${error.message}`;
        throw error;
      }
      const completed = index + 1;
      if (completed % 100 === 0 || completed === rows.length) {
        console.log(`Progreso: ${completed}/${rows.length} pacientes`);
      }
    }
    await prisma.$queryRaw`
      SELECT setval(
        pg_get_serial_sequence('"Customer"', 'customerNumber'),
        COALESCE(MAX("customerNumber"), 1),
        MAX("customerNumber") IS NOT NULL
      )
      FROM "Customer"
    `;
  }

  await fs.mkdir(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, `legacy-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({
    reportPath,
    ...report.summary,
    createdCustomers: report.import.createdCustomers,
    existingCustomers: report.import.existingCustomers,
    importedFiles: report.import.importedFiles,
    skippedFiles: report.import.skippedFiles,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => prisma.$disconnect());
}

module.exports = { legacyHeight, optionalInteger, optionalNumber, parseLegacyRows };
