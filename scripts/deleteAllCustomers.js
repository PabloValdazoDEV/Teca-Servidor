require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const prisma = require("../prisma/prisma");

const CONFIRMATION = "BORRAR-TODOS-LOS-CLIENTES";
const applyChanges = process.argv.includes("--apply");
const confirmationArgument = process.argv.find((argument) =>
  argument.startsWith("--confirm=")
);
const confirmation = confirmationArgument?.slice("--confirm=".length) || "";
const storageRoot = path.resolve(
  process.env.DOCUMENT_STORAGE_PATH ||
    path.join(__dirname, "..", "storage", "documents")
);

function safeCustomerDirectory(customerId) {
  const directory = path.resolve(storageRoot, customerId);
  if (!directory.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error("Ruta de documentos de cliente no válida");
  }
  return directory;
}

async function databaseSummary() {
  const [customers, appointments, phones, documents, versions, clinicalRecords] =
    await Promise.all([
      prisma.customer.count(),
      prisma.date.count(),
      prisma.phoneNumber.count(),
      prisma.doc.count(),
      prisma.documentVersion.count(),
      prisma.ficha.count(),
    ]);

  return { customers, appointments, phones, documents, versions, clinicalRecords };
}

async function main() {
  const summary = await databaseSummary();
  console.log(JSON.stringify({
    mode: applyChanges ? "apply" : "dry-run",
    storageRoot,
    ...summary,
  }, null, 2));

  if (!applyChanges) {
    console.log(
      `No se ha borrado nada. Para ejecutar: npm run customers:delete-all -- --apply --confirm=${CONFIRMATION}`
    );
    return;
  }

  if (confirmation !== CONFIRMATION) {
    throw new Error(
      `Confirmación incorrecta. Debes escribir exactamente --confirm=${CONFIRMATION}`
    );
  }

  const customers = await prisma.customer.findMany({ select: { id: true } });

  await prisma.$transaction(async (transaction) => {
    await transaction.customer.deleteMany();
    await transaction.$queryRaw`
      SELECT setval(
        pg_get_serial_sequence('"Customer"', 'customerNumber'),
        1,
        false
      )
    `;
  });

  const failedDirectories = [];
  for (const customer of customers) {
    const directory = safeCustomerDirectory(customer.id);
    try {
      await fs.rm(directory, { recursive: true, force: true });
    } catch (error) {
      failedDirectories.push({ directory, error: error.code || error.message });
    }
  }

  console.log(JSON.stringify({
    deletedCustomers: customers.length,
    deletedRelatedData: {
      appointments: summary.appointments,
      phones: summary.phones,
      documents: summary.documents,
      versions: summary.versions,
      clinicalRecords: summary.clinicalRecords,
    },
    failedDirectories,
  }, null, 2));

  if (failedDirectories.length) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { CONFIRMATION, safeCustomerDirectory };
