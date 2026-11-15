const prisma = require("../prisma/prisma");

const ACCESS_ACTIONS = new Set([
  "VIEW_PATIENT",
  "VIEW_DOCUMENT",
  "DOWNLOAD_DOCUMENT",
  "EDIT_DOCUMENT",
  "UPLOAD_DOCUMENT",
  "ARCHIVE_PATIENT",
  "RESTORE_PATIENT",
  "EXPORT_ALL",
]);

// Guarda una entrada sin bloquear la respuesta: si el registro falla, la clínica
// sigue trabajando y el fallo queda en el log del servidor.
async function recordAccess(client, { userId, action, customerId = null, docId = null, ip = null }) {
  if (!ACCESS_ACTIONS.has(action)) throw new Error(`Acción de registro desconocida: ${action}`);
  return client.accessLog.create({
    data: { userId: userId || null, action, customerId, docId, ip: ip ? String(ip).slice(0, 64) : null },
  });
}

function logAccess(req, entry) {
  if (process.env.NODE_ENV === "test") return;
  recordAccess(prisma, { userId: req.user?.id, ip: req.ip, ...entry }).catch((error) => {
    console.error("Access log write failed", error.message);
  });
}

module.exports = { ACCESS_ACTIONS, logAccess, recordAccess };
