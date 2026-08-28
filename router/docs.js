const express = require("express");
const router = express.Router();
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");
const multer = require("multer");
const authMiddleware = require("../middelwares/authMiddleware");
const prisma = require("../prisma/prisma");
const {
  addStoredVersion,
  createStoredDocument,
  materializePatientTemplates,
  resolveStorageKey,
  safeFileName,
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

async function appendStoredFile(archive, document, targetFolder, manifest) {
  if (!document.storageKey || document.status !== "ACTIVE") {
    return;
  }

  const source = resolveStorageKey(document.storageKey);
  try {
    await fs.promises.access(source, fs.constants.R_OK);
    const fileName = safeFileName(document.originalName || document.fileName || "documento");
    archive.file(source, { name: path.posix.join(targetFolder, fileName) });
    manifest.push({
      documentId: document.id,
      customerId: document.customerId,
      fileName,
      sha256: document.checksumSha256,
      sizeBytes: document.sizeBytes,
    });
  } catch {
    manifest.push({
      documentId: document.id,
      customerId: document.customerId,
      fileName: document.originalName || document.fileName,
      missing: true,
    });
  }
}

async function buildPatientsWorkbook(customers) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TECA";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Pacientes", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "ID", key: "id", width: 12 },
    { header: "Nombre", key: "name", width: 32 },
    { header: "Edad", key: "age", width: 10 },
    { header: "Fecha nacimiento", key: "birthDate", width: 18 },
    { header: "Teléfonos", key: "phones", width: 42 },
    { header: "Email", key: "email", width: 30 },
    { header: "Dirección", key: "address", width: 36 },
    { header: "Población", key: "population", width: 22 },
    { header: "Provincia", key: "province", width: 20 },
    { header: "Código postal", key: "postalCode", width: 16 },
    { header: "Profesión", key: "profession", width: 24 },
    { header: "Carpeta histórica", key: "legacyFolder", width: 32 },
  ];

  for (const customer of customers) {
    sheet.addRow({
      id: `ID-${String(customer.customerNumber).padStart(6, "0")}`,
      name: customer.fullName || "",
      age: customer.age,
      birthDate: customer.dateBirth || null,
      phones: customer.phones
        .map((phone) => phone.rawValue || [phone.label, phone.countryCode, phone.phoneNumber?.toString()].filter(Boolean).join(" "))
        .join(" | "),
      email: customer.emailAddress || "",
      address: customer.address || "",
      population: customer.population || "",
      province: customer.province || "",
      postalCode: customer.cD ? String(customer.cD).padStart(5, "0") : "",
      profession: customer.profession || "",
      legacyFolder: customer.legacyFolderName || "",
    });
  }

  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF047857" } };
  sheet.autoFilter = { from: "A1", to: `L${Math.max(1, sheet.rowCount)}` };
  sheet.getColumn("birthDate").numFmt = "yyyy-mm-dd";
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
    const customers = await prisma.customer.findMany({
      include: {
        phones: true,
        docs: { where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { customerNumber: "asc" },
    });
    const workbook = await buildPatientsWorkbook(customers);
    const manifest = [];
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on("error", (error) => res.destroy(error));
    res.attachment(`TECA-export-${new Date().toISOString().slice(0, 10)}.zip`);
    archive.pipe(res);
    archive.append(Buffer.from(workbook), { name: "Pacientes/PACIENTES.xlsx" });

    for (const customer of customers) {
      const targetFolder = path.posix.join("Datos adjuntos", exportFolderName(customer));
      for (const document of customer.docs) {
        await appendStoredFile(archive, document, targetFolder, manifest);
      }
    }

    archive.append(JSON.stringify({ exportedAt: new Date().toISOString(), files: manifest }, null, 2), {
      name: "manifest.json",
    });
    await archive.finalize();
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

module.exports = router;
