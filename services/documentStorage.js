const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { patientTemplatePath } = require("../config/legacyPaths");

const storageRoot = path.resolve(
  process.env.DOCUMENT_STORAGE_PATH || path.join(__dirname, "..", "storage", "documents")
);
const templateRoot = patientTemplatePath;

const EXTENSION_TO_TYPE = new Map([
  [".doc", "DOC"],
  [".docx", "DOC"],
  [".odt", "DOC"],
  [".rtf", "DOC"],
  [".xls", "EXCEL"],
  [".xlsx", "EXCEL"],
  [".xlsm", "EXCEL"],
  [".ods", "EXCEL"],
  [".csv", "EXCEL"],
  [".pdf", "PDF"],
  [".jpg", "IMG"],
  [".jpeg", "IMG"],
  [".png", "IMG"],
  [".webp", "IMG"],
  [".txt", "OTRO"],
]);

const MIME_BY_EXTENSION = new Map([
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".odt", "application/vnd.oasis.opendocument.text"],
  [".rtf", "application/rtf"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"],
  [".ods", "application/vnd.oasis.opendocument.spreadsheet"],
  [".csv", "text/csv"],
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".txt", "text/plain"],
]);

const FIXED_TEMPLATES = new Map([
  ["FICHA.XLS", "FICHA"],
  ["VISCERAL Y CRANEAL.doc", "VISCERAL_CRANEAL"],
  ["HISTORIAL CLINICO.docx", "HISTORIAL_CLINICO"],
]);

function safeFileName(value) {
  const name = path.basename(String(value || "documento"))
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return (name || "documento").slice(0, 180);
}

function fileExtension(fileName) {
  return path.extname(fileName || "").toLowerCase();
}

function assertAllowedFile(fileName, buffer) {
  const extension = fileExtension(fileName);
  if (!EXTENSION_TO_TYPE.has(extension)) {
    const error = new Error("UNSUPPORTED_FILE_TYPE");
    error.code = "UNSUPPORTED_FILE_TYPE";
    throw error;
  }

  const header = buffer.subarray(0, 12).toString("hex").toLowerCase();
  const isZip = header.startsWith("504b0304") || header.startsWith("504b0506");
  const isOle = header.startsWith("d0cf11e0a1b11ae1");
  const checks = {
    ".pdf": header.startsWith("25504446"),
    ".png": header.startsWith("89504e470d0a1a0a"),
    ".jpg": header.startsWith("ffd8ff"),
    ".jpeg": header.startsWith("ffd8ff"),
    ".webp": header.startsWith("52494646") && buffer.subarray(8, 12).toString("ascii") === "WEBP",
    ".doc": isOle,
    ".xls": isOle,
    ".docx": isZip,
    ".xlsx": isZip,
    ".xlsm": isZip,
    ".odt": isZip,
    ".ods": isZip,
  };

  if (Object.hasOwn(checks, extension) && !checks[extension]) {
    const error = new Error("FILE_SIGNATURE_MISMATCH");
    error.code = "FILE_SIGNATURE_MISMATCH";
    throw error;
  }

  return {
    extension,
    typeDoc: EXTENSION_TO_TYPE.get(extension),
    mimeType: MIME_BY_EXTENSION.get(extension) || "application/octet-stream",
  };
}

function checksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function resolveStorageKey(storageKey) {
  const resolved = path.resolve(storageRoot, storageKey);
  if (resolved !== storageRoot && !resolved.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error("INVALID_STORAGE_KEY");
  }
  return resolved;
}

async function writeVersionFile({ customerId, docId, originalName, buffer }) {
  const safeName = safeFileName(originalName);
  const storageKey = path.join(customerId, docId, `${crypto.randomUUID()}-${safeName}`);
  const destination = resolveStorageKey(storageKey);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, buffer, { flag: "wx", mode: 0o600 });
  return { safeName, storageKey, destination };
}

async function createStoredDocument({ prisma, customerId, file, createdById, fixedType = null }) {
  const info = assertAllowedFile(file.originalname, file.buffer);
  const docId = crypto.randomUUID();
  const stored = await writeVersionFile({
    customerId,
    docId,
    originalName: file.originalname,
    buffer: file.buffer,
  });
  const sha256 = checksum(file.buffer);

  try {
    return await prisma.doc.create({
      data: {
        id: docId,
        customerId,
        typeDoc: info.typeDoc,
        fixedType,
        fileName: stored.safeName,
        originalName: stored.safeName,
        storageKey: stored.storageKey,
        mimeType: info.mimeType,
        sizeBytes: file.buffer.length,
        checksumSha256: sha256,
        versions: {
          create: {
            version: 1,
            storageKey: stored.storageKey,
            originalName: stored.safeName,
            mimeType: info.mimeType,
            sizeBytes: file.buffer.length,
            checksumSha256: sha256,
            createdById,
          },
        },
      },
      include: { versions: { orderBy: { version: "desc" } } },
    });
  } catch (error) {
    await fs.unlink(stored.destination).catch(() => {});
    throw error;
  }
}

async function addStoredVersion({ prisma, doc, file, createdById }) {
  const info = assertAllowedFile(file.originalname, file.buffer);
  const stored = await writeVersionFile({
    customerId: doc.customerId,
    docId: doc.id,
    originalName: file.originalname,
    buffer: file.buffer,
  });
  const sha256 = checksum(file.buffer);

  try {
    return await prisma.$transaction(async (transaction) => {
      const latest = await transaction.documentVersion.aggregate({
        where: { docId: doc.id },
        _max: { version: true },
      });
      const version = (latest._max.version || 0) + 1;
      const createdVersion = await transaction.documentVersion.create({
        data: {
          docId: doc.id,
          version,
          storageKey: stored.storageKey,
          originalName: stored.safeName,
          mimeType: info.mimeType,
          sizeBytes: file.buffer.length,
          checksumSha256: sha256,
          createdById,
        },
      });

      await transaction.doc.update({
        where: { id: doc.id },
        data: {
          typeDoc: info.typeDoc,
          fileName: stored.safeName,
          originalName: stored.safeName,
          storageKey: stored.storageKey,
          mimeType: info.mimeType,
          sizeBytes: file.buffer.length,
          checksumSha256: sha256,
          status: "ACTIVE",
        },
      });

      return createdVersion;
    });
  } catch (error) {
    await fs.unlink(stored.destination).catch(() => {});
    throw error;
  }
}

async function materializePatientTemplates({ prisma, customerId, createdById }) {
  const created = [];
  const existing = await prisma.doc.findMany({
    where: {
      customerId,
      status: "ACTIVE",
      fixedType: { in: [...FIXED_TEMPLATES.values()] },
    },
    select: { fixedType: true },
  });
  const existingTypes = new Set(existing.map((document) => document.fixedType));
  for (const [templateName, fixedType] of FIXED_TEMPLATES) {
    if (existingTypes.has(fixedType)) continue;
    const source = path.join(templateRoot, templateName);
    try {
      const buffer = await fs.readFile(source);
      const document = await createStoredDocument({
        prisma,
        customerId,
        createdById,
        fixedType,
        file: { originalname: templateName, buffer },
      });
      created.push(document);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return created;
}

module.exports = {
  EXTENSION_TO_TYPE,
  addStoredVersion,
  createStoredDocument,
  materializePatientTemplates,
  resolveStorageKey,
  safeFileName,
  storageRoot,
  templateRoot,
};
