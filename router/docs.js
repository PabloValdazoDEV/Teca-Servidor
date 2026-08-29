const express = require("express");
const router = express.Router();
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");
const multer = require("multer");
const authMiddleware = require("../middelwares/authMiddleware");
const prisma = require("../prisma/prisma");
const { patientsWorkbookPath: legacyPatientsWorkbookPath } = require("../config/legacyPaths");
const {
  addStoredVersion,
  createStoredDocument,
  materializePatientTemplates,
  resolveStorageKey,
  safeFileName,
  templateRoot,
} = require("../services/documentStorage");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 5 },
});

function serializedPhone(phone) {
  return {
    ...phone,
    phoneNumber: phone.phoneNumber?.toString() || null,
  };
}

function exportFolderName(customer) {
  const number = String(customer.customerNumber).padStart(6, "0");
  return `ID-${number} - ${safeFileName(customer.fullName || "Sin nombre")}`;
}

function uniqueArchivePath(targetFolder, fileName, usedPaths, suffix) {
  const safeName = safeFileName(fileName);
  let targetPath = path.posix.join(targetFolder, safeName);
  if (usedPaths.has(targetPath)) {
    const extension = path.extname(safeName);
    const stem = safeName.slice(0, safeName.length - extension.length);
    targetPath = path.posix.join(targetFolder, `${stem} (${suffix})${extension}`);
  }
  usedPaths.add(targetPath);
  return targetPath;
}

function archiveDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "fecha-desconocida";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}-${parts.minute}-${parts.second}`;
}

function documentHistoryFolderName(document) {
  const originalName = safeFileName(
    document.versions?.[0]?.originalName || document.originalName || document.fileName || "Documento"
  );
  const extension = path.extname(originalName);
  return safeFileName(originalName.slice(0, originalName.length - extension.length) || "Documento");
}

function historyVersionFileName(version) {
  const originalName = safeFileName(version.originalName || "documento");
  const extension = path.extname(originalName);
  const label = version.version === 1 ? "Original" : "Modificado";
  return `${label} - ${archiveDate(version.createdAt)}${extension}`;
}

async function appendStoredFile(archive, file, targetFolder, manifest, usedPaths, metadata) {
  if (!file.storageKey) return;
  const source = resolveStorageKey(file.storageKey);
  const fileName = safeFileName(metadata.archiveName || file.originalName || file.fileName || "documento");
  const targetPath = uniqueArchivePath(targetFolder, fileName, usedPaths, metadata.collisionSuffix);
  try {
    await fs.promises.access(source, fs.constants.R_OK);
    archive.file(source, { name: targetPath });
    manifest.push({
      ...metadata,
      fileName,
      targetPath,
      sha256: file.checksumSha256,
      sizeBytes: file.sizeBytes,
    });
  } catch {
    manifest.push({
      ...metadata,
      fileName,
      targetPath,
      missing: true,
    });
  }
}

async function appendPatientTemplates(archive, manifest, usedPaths) {
  let entries;
  try {
    entries = await fs.promises.readdir(templateRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const source = path.join(templateRoot, entry.name);
    const targetPath = uniqueArchivePath("Fichas Paciente", entry.name, usedPaths, "plantilla");
    const fileInfo = await fs.promises.stat(source);
    archive.file(source, { name: targetPath });
    manifest.push({
      kind: "patient-template",
      fileName: safeFileName(entry.name),
      targetPath,
      sizeBytes: fileInfo.size,
    });
  }
}

function styleWorkbookSheet(sheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF047857" } };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount },
  };
}

function formulaValue(formula, result = "") {
  return { formula, result };
}

function patientPhoneColumns(customer) {
  const phones = (customer.phones || []).map((phone) => ({
    ...phone,
    text: phone.rawValue || [phone.label, phone.countryCode, phone.phoneNumber?.toString()]
      .filter(Boolean)
      .join(" "),
  })).filter((phone) => phone.text);
  const firstIndex = Math.max(0, phones.findIndex((phone) => phone.kind === "LANDLINE"));
  const secondIndex = phones.findIndex((phone, index) =>
    index !== firstIndex && (phone.isCommunicationPhone || phone.kind === "MOBILE")
  );
  const effectiveSecondIndex = secondIndex >= 0
    ? secondIndex
    : phones.findIndex((_, index) => index !== firstIndex);
  const first = phones[firstIndex]?.text || "";
  const second = phones
    .filter((_, index) => index !== firstIndex)
    .sort((left, right) =>
      Number(phones.indexOf(left) !== effectiveSecondIndex) -
      Number(phones.indexOf(right) !== effectiveSecondIndex)
    )
    .map((phone) => phone.text)
    .join(" | ");
  return [first, second];
}

function populateLegacyPatientsWorkbook(workbook, customers) {
  const sheet = workbook.getWorksheet("Hoja1") || workbook.worksheets[0];
  if (!sheet) return false;

  const firstPatientRow = 6;
  const lastPatientRow = firstPatientRow + customers.length - 1;
  const lastRowToClear = Math.max(sheet.rowCount, lastPatientRow);
  for (let rowNumber = firstPatientRow; rowNumber <= lastRowToClear; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (let columnNumber = 1; columnNumber <= 20; columnNumber += 1) {
      row.getCell(columnNumber).value = null;
    }
  }

  sheet.getCell("P2").value = formulaValue("TODAY()", new Date());
  const extraHeaders = ["Email", "Comunicación preferida", "Observaciones hijos", "Alta en TECA"];
  extraHeaders.forEach((header, index) => {
    const cell = sheet.getRow(5).getCell(17 + index);
    cell.value = header;
    cell.style = { ...sheet.getRow(5).getCell(16).style };
  });
  sheet.getColumn(17).width = 30;
  sheet.getColumn(18).width = 22;
  sheet.getColumn(19).width = 32;
  sheet.getColumn(20).width = 20;

  customers.forEach((customer, index) => {
    const rowNumber = firstPatientRow + index;
    const row = sheet.getRow(rowNumber);
    const [firstPhone, remainingPhones] = patientPhoneColumns(customer);
    const folderName = exportFolderName(customer);
    const heightInMetres = customer.height ? Number(customer.height) / 100 : null;
    const formulaAge = customer.dateBirth
      ? Math.max(0, (Date.now() - new Date(customer.dateBirth).getTime()) / (365.2425 * 24 * 60 * 60 * 1_000))
      : "";

    row.getCell(1).value = customer.fullName || "";
    row.getCell(2).value = formulaValue(`IFERROR(IF(P${rowNumber}="","",($P$2-P${rowNumber})/365),"")`, formulaAge);
    row.getCell(3).value = firstPhone;
    row.getCell(4).value = remainingPhones;
    row.getCell(5).value = customer.weight;
    row.getCell(6).value = customer.children;
    row.getCell(7).value = customer.profession || "";
    row.getCell(8).value = heightInMetres;
    row.getCell(9).value = customer.population || "";
    row.getCell(10).value = customer.customerNumber;
    row.getCell(11).value = customer.province?.replaceAll("_", " ") || "";
    row.getCell(12).value = customer.cD ? String(customer.cD).padStart(5, "0") : "";
    row.getCell(13).value = customer.address || "";
    row.getCell(14).value = formulaValue("ROW()", rowNumber);
    row.getCell(15).value = formulaValue(
      `"..\\Datos adjuntos\\ID-"&TEXT(J${rowNumber},"000000")&" - "&A${rowNumber}&"\\"`,
      `..\\Datos adjuntos\\${folderName}\\`
    );
    row.getCell(16).value = customer.dateBirth || null;
    row.getCell(17).value = customer.emailAddress || "";
    row.getCell(18).value = customer.preferredCommunication || "";
    row.getCell(19).value = customer.observationChildren || "";
    row.getCell(20).value = customer.createdAt || null;
  });

  sheet.getColumn(16).numFmt = "dd/mm/yyyy";
  sheet.getColumn(20).numFmt = "dd/mm/yyyy hh:mm";

  const reviewSheet = workbook.getWorksheet("Hoja3");
  if (reviewSheet) {
    const lastReviewRow = Math.max(reviewSheet.rowCount, lastPatientRow);
    for (let rowNumber = firstPatientRow; rowNumber <= lastReviewRow; rowNumber += 1) {
      reviewSheet.getCell(`A${rowNumber}`).value = null;
      reviewSheet.getCell(`B${rowNumber}`).value = null;
    }
    const sortedNames = customers
      .map((customer) => customer.fullName || "")
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" }));
    sortedNames.forEach((name, index) => {
      const rowNumber = firstPatientRow + index;
      const nextName = sortedNames[index + 1] || "";
      reviewSheet.getCell(`A${rowNumber}`).value = name;
      reviewSheet.getCell(`B${rowNumber}`).value = formulaValue(
        `IF(A${rowNumber}=A${rowNumber + 1},"Revisar","")`,
        name === nextName ? "Revisar" : ""
      );
    });
  }

  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.calcProperties.forceFullCalc = true;
  return true;
}

function removeWorksheetIfPresent(workbook, name) {
  const worksheet = workbook.getWorksheet(name);
  if (worksheet) workbook.removeWorksheet(worksheet.id);
}

async function buildPatientsWorkbook(customers) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TECA";
  workbook.created = new Date();
  try {
    await workbook.xlsx.readFile(legacyPatientsWorkbookPath);
    populateLegacyPatientsWorkbook(workbook, customers);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const sheet = workbook.addWorksheet("Pacientes", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      { header: "ID", key: "id", width: 12 },
      { header: "Nombre", key: "name", width: 32 },
      { header: "Fecha nacimiento", key: "birthDate", width: 18 },
      { header: "Teléfonos", key: "phones", width: 42 },
      { header: "Comunicación preferida", key: "preferredCommunication", width: 22 },
      { header: "Email", key: "email", width: 30 },
      { header: "Dirección", key: "address", width: 36 },
      { header: "Población", key: "population", width: 22 },
      { header: "Provincia", key: "province", width: 20 },
      { header: "Código postal", key: "postalCode", width: 16 },
      { header: "Profesión", key: "profession", width: 24 },
      { header: "Peso (kg)", key: "weight", width: 12 },
      { header: "Altura (cm)", key: "height", width: 12 },
      { header: "Nº hijos", key: "children", width: 12 },
      { header: "Observaciones hijos", key: "childrenObservations", width: 30 },
      { header: "Alta en TECA", key: "createdAt", width: 20 },
    ];
    for (const customer of customers) {
      sheet.addRow({
        id: `ID-${String(customer.customerNumber).padStart(6, "0")}`,
        name: customer.fullName || "",
        birthDate: customer.dateBirth || null,
        phones: customer.phones
          .map((phone) => phone.rawValue || [phone.label, phone.countryCode, phone.phoneNumber?.toString()].filter(Boolean).join(" "))
          .join(" | "),
        preferredCommunication: customer.preferredCommunication || "",
        email: customer.emailAddress || "",
        address: customer.address || "",
        population: customer.population || "",
        province: customer.province || "",
        postalCode: customer.cD ? String(customer.cD).padStart(5, "0") : "",
        profession: customer.profession || "",
        weight: customer.weight,
        height: customer.height,
        children: customer.children,
        childrenObservations: customer.observationChildren || "",
        createdAt: customer.createdAt,
      });
    }
    styleWorkbookSheet(sheet);
    sheet.getColumn("birthDate").numFmt = "yyyy-mm-dd";
    sheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm";
  }

  ["Citas", "Documentos", "Fichas clínicas", "Valoraciones corporales"]
    .forEach((name) => removeWorksheetIfPresent(workbook, name));

  const appointmentsSheet = workbook.addWorksheet("Citas", { views: [{ state: "frozen", ySplit: 1 }] });
  appointmentsSheet.columns = [
    { header: "ID cita", key: "appointmentId", width: 38 },
    { header: "ID paciente", key: "customerId", width: 14 },
    { header: "Paciente", key: "customerName", width: 32 },
    { header: "Fecha y hora", key: "date", width: 22 },
    { header: "Duración (min)", key: "duration", width: 16 },
    { header: "Precio (€)", key: "price", width: 14 },
    { header: "Profesional", key: "practitioner", width: 28 },
    { header: "Urgente", key: "urgent", width: 12 },
    { header: "Se puede adelantar", key: "advance", width: 20 },
    { header: "Observaciones", key: "observations", width: 48 },
  ];
  for (const customer of customers) {
    for (const appointment of customer.appointments) {
      const professional = appointment.practitioner || appointment.user;
      appointmentsSheet.addRow({
        appointmentId: appointment.id,
        customerId: `ID-${String(customer.customerNumber).padStart(6, "0")}`,
        customerName: customer.fullName || "",
        date: appointment.citaDate,
        duration: appointment.time,
        price: appointment.sessionPrice,
        practitioner: [professional?.name, professional?.lastName].filter(Boolean).join(" "),
        urgent: appointment.urgent_date ? "Sí" : "No",
        advance: appointment.advance_date === "TRUE" ? "Sí" : "No",
        observations: appointment.dateObservation || "",
      });
    }
  }
  styleWorkbookSheet(appointmentsSheet);
  appointmentsSheet.getColumn("date").numFmt = "yyyy-mm-dd hh:mm";

  const documentsSheet = workbook.addWorksheet("Documentos", { views: [{ state: "frozen", ySplit: 1 }] });
  documentsSheet.columns = [
    { header: "ID paciente", key: "customerId", width: 14 },
    { header: "Paciente", key: "customerName", width: 32 },
    { header: "ID documento", key: "documentId", width: 38 },
    { header: "Archivo", key: "fileName", width: 42 },
    { header: "Tipo", key: "type", width: 16 },
    { header: "Plantilla", key: "fixedType", width: 22 },
    { header: "Estado", key: "status", width: 16 },
    { header: "Versiones", key: "versions", width: 12 },
    { header: "Tamaño actual", key: "size", width: 16 },
    { header: "Actualizado", key: "updatedAt", width: 22 },
  ];
  for (const customer of customers) {
    for (const document of customer.docs) {
      documentsSheet.addRow({
        customerId: `ID-${String(customer.customerNumber).padStart(6, "0")}`,
        customerName: customer.fullName || "",
        documentId: document.id,
        fileName: document.originalName || document.fileName || "",
        type: document.typeDoc,
        fixedType: document.fixedType || "",
        status: document.status,
        versions: document.versions.length,
        size: document.sizeBytes,
        updatedAt: document.updatedAt,
      });
    }
  }
  styleWorkbookSheet(documentsSheet);
  documentsSheet.getColumn("updatedAt").numFmt = "yyyy-mm-dd hh:mm";

  const clinicalRecordsSheet = workbook.addWorksheet("Fichas clínicas", { views: [{ state: "frozen", ySplit: 1 }] });
  clinicalRecordsSheet.columns = [
    { header: "ID ficha", key: "recordId", width: 38 },
    { header: "ID paciente", key: "customerId", width: 14 },
    { header: "Paciente", key: "customerName", width: 32 },
    { header: "ID documento", key: "documentId", width: 38 },
    { header: "ID cita", key: "appointmentId", width: 38 },
    { header: "Fecha de cita", key: "appointmentDate", width: 22 },
    { header: "Observaciones", key: "observations", width: 54 },
    { header: "Plan de tratamiento", key: "treatmentPlan", width: 54 },
  ];
  const bodyAssessmentsSheet = workbook.addWorksheet("Valoraciones corporales", { views: [{ state: "frozen", ySplit: 1 }] });
  bodyAssessmentsSheet.columns = [
    { header: "ID valoración", key: "assessmentId", width: 38 },
    { header: "ID ficha", key: "recordId", width: 38 },
    { header: "ID paciente", key: "customerId", width: 14 },
    { header: "Paciente", key: "customerName", width: 32 },
    { header: "Zona corporal", key: "bodyPart", width: 20 },
    { header: "Subzona", key: "subBodyPart", width: 18 },
    { header: "Descripción", key: "description", width: 54 },
  ];
  for (const customer of customers) {
    for (const document of customer.docs) {
      for (const clinicalRecord of document.Fichas) {
        clinicalRecordsSheet.addRow({
          recordId: clinicalRecord.id,
          customerId: `ID-${String(customer.customerNumber).padStart(6, "0")}`,
          customerName: customer.fullName || "",
          documentId: document.id,
          appointmentId: clinicalRecord.dateFichaId || "",
          appointmentDate: clinicalRecord.date?.citaDate || null,
          observations: clinicalRecord.observations || "",
          treatmentPlan: clinicalRecord.treatmentPlan || "",
        });
        for (const assessment of clinicalRecord.bodyAssessments) {
          bodyAssessmentsSheet.addRow({
            assessmentId: assessment.id,
            recordId: clinicalRecord.id,
            customerId: `ID-${String(customer.customerNumber).padStart(6, "0")}`,
            customerName: customer.fullName || "",
            bodyPart: assessment.bodyPart,
            subBodyPart: assessment.subBodyPart,
            description: assessment.description,
          });
        }
      }
    }
  }
  styleWorkbookSheet(clinicalRecordsSheet);
  clinicalRecordsSheet.getColumn("appointmentDate").numFmt = "yyyy-mm-dd hh:mm";
  styleWorkbookSheet(bodyAssessmentsSheet);
  return workbook.xlsx.writeBuffer();
}

router.use(authMiddleware);

router.post("/customer/:customerId/templates", async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.customerId }, select: { id: true } });
    if (!customer) return res.status(404).json({ message: "Cliente no encontrado" });
    const documents = await materializePatientTemplates({ prisma, customerId: customer.id, createdById: req.user.id });
    return res.status(201).json({
      message: documents.length ? "Plantillas clínicas creadas" : "El cliente ya tiene todas las plantillas",
      documents,
    });
  } catch (error) {
    console.error("Patient templates could not be created", error);
    return res.status(500).json({ message: "No se han podido crear las plantillas" });
  }
});

router.post("/customer/:customerId/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Selecciona un archivo" });
  }

  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.customerId },
      select: { id: true },
    });
    if (!customer) {
      return res.status(404).json({ message: "Cliente no encontrado" });
    }

    const document = await createStoredDocument({
      prisma,
      customerId: customer.id,
      createdById: req.user.id,
      file: req.file,
    });
    return res.status(201).json({ message: "Documento guardado", document });
  } catch (error) {
    if (["UNSUPPORTED_FILE_TYPE", "FILE_SIGNATURE_MISMATCH"].includes(error.code)) {
      return res.status(400).json({ message: "El tipo o contenido del archivo no está permitido" });
    }
    console.error("Document upload failed", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/file/:docId/version", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Selecciona un archivo" });
  }

  try {
    const document = await prisma.doc.findUnique({ where: { id: req.params.docId } });
    if (!document || document.status === "ARCHIVED") {
      return res.status(404).json({ message: "Documento no encontrado" });
    }

    const version = await addStoredVersion({
      prisma,
      doc: document,
      file: req.file,
      createdById: req.user.id,
    });
    return res.status(201).json({ message: "Nueva versión guardada", version });
  } catch (error) {
    if (["UNSUPPORTED_FILE_TYPE", "FILE_SIGNATURE_MISMATCH"].includes(error.code)) {
      return res.status(400).json({ message: "El tipo o contenido del archivo no está permitido" });
    }
    console.error("Document version upload failed", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/file/:docId", async (req, res) => {
  try {
    const document = await prisma.doc.findUnique({
      where: { id: req.params.docId },
      include: {
        customer: { select: { id: true, fullName: true, customerNumber: true } },
        versions: { orderBy: { version: "desc" } },
      },
    });
    if (!document || document.status !== "ACTIVE") {
      return res.status(404).json({ message: "Documento no encontrado" });
    }
    return res.json({ document });
  } catch (error) {
    console.error("Document metadata could not be loaded", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/file/:docId/content", async (req, res) => {
  try {
    const document = await prisma.doc.findUnique({
      where: { id: req.params.docId },
      include: { versions: { orderBy: { version: "desc" } } },
    });
    if (!document || document.status !== "ACTIVE") {
      return res.status(404).json({ message: "Documento no encontrado" });
    }

    const requestedVersion = req.query.version
      ? document.versions.find((version) => version.version === Number(req.query.version))
      : document.versions[0];
    const storageKey = requestedVersion?.storageKey || document.storageKey;
    if (!storageKey) {
      return res.status(404).json({ message: "El archivo físico no está disponible" });
    }

    const fileName = safeFileName(requestedVersion?.originalName || document.originalName || "documento");
    const disposition = req.query.download === "true" ? "attachment" : "inline";
    return res.sendFile(resolveStorageKey(storageKey), {
      headers: {
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Content-Type": requestedVersion?.mimeType || document.mimeType || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({ message: "El archivo físico no está disponible" });
    }
    console.error("Document download failed", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/export/all", authMiddleware.requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  try {
    const { ZipArchive } = await import("archiver");
    const exportedAt = new Date();
    const customers = await prisma.customer.findMany({
      include: {
        phones: true,
        appointments: {
          include: {
            practitioner: { select: { name: true, lastName: true } },
            user: { select: { name: true, lastName: true } },
          },
          orderBy: { citaDate: "asc" },
        },
        docs: {
          include: {
            versions: { orderBy: { version: "asc" } },
            Fichas: {
              include: {
                bodyAssessments: true,
                date: { select: { id: true, citaDate: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { customerNumber: "asc" },
    });
    const workbook = await buildPatientsWorkbook(customers);
    const manifest = [];
    const usedPaths = new Set();
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on("error", (error) => res.destroy(error));
    res.setHeader("X-TECA-Exported-At", exportedAt.toISOString());
    res.attachment(`TECA-export-${exportedAt.toISOString().slice(0, 10)}.zip`);
    archive.pipe(res);
    archive.append(Buffer.from(workbook), { name: "Pacientes/PACIENTES.xlsx" });
    await appendPatientTemplates(archive, manifest, usedPaths);

    for (const customer of customers) {
      const customerFolder = path.posix.join("Datos adjuntos", exportFolderName(customer));
      for (const document of customer.docs) {
        const currentFolder = document.status === "ACTIVE"
          ? customerFolder
          : path.posix.join(customerFolder, "_Archivados");
        await appendStoredFile(archive, document, currentFolder, manifest, usedPaths, {
          collisionSuffix: document.id.slice(0, 8),
          customerId: customer.id,
          documentId: document.id,
          kind: "current",
          status: document.status,
          version: document.versions.at(-1)?.version || null,
        });

        const historyFolder = path.posix.join(
          customerFolder,
          "_Historial de versiones",
          documentHistoryFolderName(document)
        );
        for (const version of document.versions) {
          if (version.storageKey === document.storageKey) continue;
          await appendStoredFile(archive, version, historyFolder, manifest, usedPaths, {
            archiveName: historyVersionFileName(version),
            collisionSuffix: `v${version.version}`,
            customerId: customer.id,
            documentId: document.id,
            kind: "previous-version",
            status: document.status,
            version: version.version,
          });
        }
      }
    }
    await archive.finalize();
    await prisma.clinic.upsert({
      where: { id: "default" },
      create: { id: "default", lastBackupExportAt: exportedAt },
      update: { lastBackupExportAt: exportedAt },
    });
  } catch (error) {
    console.error("Mass export failed", error);
    if (!res.headersSent) {
      return res.status(500).json({ message: "No se ha podido generar la exportación" });
    }
    return res.end();
  }
});

router.get("/ficha/:docId", async (req, res) => {
  const { docId } = req.params;
  try {
    const customerId = await prisma.doc.findUnique({
      where:{
        id: docId
      },
      select:{
        customerId:true
      }
    })
    const customer = await prisma.customer.findMany({
      where: {
        id: customerId.customerId
      },
      include: {
        appointments: {
          where: {
            Ficha: {
              none: {} 
            }
          },
          orderBy: {
            citaDate: "desc"
          },
          include: {
            Ficha: true 
          }
        }
      }
    });
    // console.log(customer)
    const response = await prisma.ficha.findMany({
      where: {
        docId,
      },
      include:{
        bodyAssessments:true,
        date:true
      },
      orderBy:{
        date:{
          citaDate: "desc"
        }
      }
    });
    // console.log(response)
    res.json({"fichas": response, "customer": customer[0], docId: docId});
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:customerId", async (req, res) => {
  const { customerId } = req.params;
  // const { typeDoc, fixedType } = req.body;
  try {
    await prisma.doc.create({
      data: {
        typeDoc: "OTRO",
        fixedType: "FICHA",
        customerId,
      },
    });
    res.send("Documeto Creada")
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/ficha/:docId", async (req, res) => {
  // console.log(req.body)
  const { docId } = req.params;
  // console.log(docId)
  const { observations, treatmentPlan, dateFichaId, bodyAssessments } = req.body;
  try {
    await prisma.ficha.create({
      data: {
        docId: docId,
        observations: observations,
        treatmentPlan: treatmentPlan,
        dateFichaId: dateFichaId,
        bodyAssessments: {
          createMany: {
            data: bodyAssessments,
          },
        },
      },
    });
    res.send("Ficha Creada")
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/ficha/:fichaId", async (req, res) => {
  const { fichaId } = req.params;
  const { observations, treatmentPlan, dateFichaId, bodyAssessments } = req.body;

  // console.log(req.body)
  try {

    await prisma.bodyPartAssessment.deleteMany({
      where: { fichaId: fichaId }
    });
    

    await prisma.ficha.update({
      where: { id: fichaId },
      data: {
        observations: observations,
        treatmentPlan: treatmentPlan,
        dateFichaId: dateFichaId,
        bodyAssessments: {
          createMany: {
            data: bodyAssessments,
          },
        },
      },
    });
    
    res.send("ficha actualizada");
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/ficha/:fichaId", async(req, res)=> {
  const { fichaId } = req.params
  try {
    await prisma.ficha.delete({
      where:{
        id: fichaId
      }
    })
    res.send("ficha eliminada")
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
})

router.delete("/:docId", async(req, res)=> {
  const { docId } = req.params
  try {
    await prisma.doc.update({
      where:{
        id: docId
      },
      data: { status: "ARCHIVED" },
    })
    res.send("Documento archivado")
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
})

router.get("/:customerId", async (req, res) => {
  const { customerId } = req.params;
  try {
    const response = await prisma.doc.findMany({
      where: {
        customerId,
        status: "ACTIVE",
      },
      include:{
        customer: true,
        versions: { orderBy: { version: "desc" } },
      }
    });
    // console.log(response)
    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

if (process.env.NODE_ENV === "test") {
  router._exportTestHelpers = {
    buildPatientsWorkbook,
    documentHistoryFolderName,
    historyVersionFileName,
  };
}

module.exports = router;
