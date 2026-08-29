const path = require("node:path");

const serverRoot = path.resolve(__dirname, "..");
const examplesRoot = path.resolve(
  process.env.LEGACY_EXAMPLES_PATH || path.join(serverRoot, "Ejemplos clientes")
);
const patientsWorkbookPath = path.resolve(
  process.env.LEGACY_PATIENTS_FILE ||
    path.join(examplesRoot, "Pacientes", "PACIENTES.xlsm")
);
const legacyAttachmentsPath = path.resolve(
  process.env.LEGACY_ATTACHMENTS_PATH ||
    path.join(examplesRoot, "Datos adjuntos")
);
const patientTemplatePath = path.resolve(
  process.env.PATIENT_TEMPLATE_PATH ||
    path.join(examplesRoot, "Fichas Paciente")
);

module.exports = {
  serverRoot,
  examplesRoot,
  patientsWorkbookPath,
  legacyAttachmentsPath,
  patientTemplatePath,
};
