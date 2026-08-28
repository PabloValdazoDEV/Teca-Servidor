const express = require("express");
const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const authMiddleware = require("../middelwares/authMiddleware");
const prisma = require("../prisma/prisma");
const { storageRoot } = require("../services/documentStorage");

const router = express.Router();

router.get("/", authMiddleware, authMiddleware.requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const checks = [];
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ id: "database", label: "Base de datos", status: "ok", detail: "Conexión disponible" });
  } catch {
    checks.push({ id: "database", label: "Base de datos", status: "error", detail: "No responde" });
  }

  try {
    await fs.mkdir(storageRoot, { recursive: true });
    await fs.access(storageRoot, constants.R_OK | constants.W_OK);
    checks.push({ id: "documents", label: "Almacenamiento de documentos", status: "ok", detail: "Lectura y escritura disponibles" });
  } catch {
    checks.push({ id: "documents", label: "Almacenamiento de documentos", status: "error", detail: "Revisa DOCUMENT_STORAGE_PATH" });
  }

  checks.push({
    id: "email",
    label: "Correo de citas y recuperación",
    status: process.env.USER_GMAIL && process.env.PASSWORD_APP ? "ok" : "warning",
    detail: process.env.USER_GMAIL && process.env.PASSWORD_APP ? "Configurado" : "Falta configuración SMTP",
  });

  return res.json({
    status: checks.some((check) => check.status === "error") ? "degraded" : "ok",
    checkedAt: new Date().toISOString(),
    responseMs: Date.now() - startedAt,
    checks,
  });
});

module.exports = router;
