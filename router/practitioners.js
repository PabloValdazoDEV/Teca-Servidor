const express = require("express");
const crypto = require("node:crypto");
const bcrypt = require("bcrypt");
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middelwares/authMiddleware");
const transporter = require("../config/nodemail");
const { frontendUrl } = require("../config/security");
const { BCRYPT_ROUNDS, isValidEmail, normalizeEmail } = require("../utils/accountValidation");
const { createOpaqueToken, hashOpaqueToken } = require("../services/sessionService");

const router = express.Router();
const { requireRole } = authMiddleware;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function normalizePractitioner(body = {}) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  const email = body.email ? normalizeEmail(body.email) : null;
  const color = COLOR_PATTERN.test(body.color || "") ? body.color.toLowerCase() : "#047857";

  if (!name || name.length > 100 || lastName.length > 150 || (email && !isValidEmail(email))) {
    return null;
  }

  return { name, lastName: lastName || null, email, color };
}

router.use(authMiddleware);

router.get("/", async (req, res) => {
  try {
    const practitioners = await prisma.practitioner.findMany({
      where: req.query.includeInactive === "true" ? {} : { active: true },
      select: {
        id: true,
        userId: true,
        name: true,
        lastName: true,
        email: true,
        color: true,
        status: true,
        active: true,
        createdAt: true,
      },
      orderBy: [{ active: "desc" }, { name: "asc" }, { lastName: "asc" }],
    });

    return res.json({ practitioners });
  } catch (error) {
    console.error("Practitioner list could not be loaded", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const data = normalizePractitioner(req.body);
  if (!data) {
    return res.status(400).json({ message: "Los datos del profesional no son válidos" });
  }

  try {
    const practitioner = await prisma.practitioner.create({ data });
    return res.status(201).json({ message: "Profesional creado", practitioner });
  } catch (error) {
    console.error("Practitioner creation failed", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.put("/:id", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const data = normalizePractitioner(req.body);
  if (!data || typeof req.body.active !== "boolean") {
    return res.status(400).json({ message: "Los datos del profesional no son válidos" });
  }

  try {
    const practitioner = await prisma.practitioner.update({
      where: { id: req.params.id },
      data: { ...data, active: req.body.active, status: req.body.active ? undefined : "INACTIVE" },
    });
    return res.json({ message: "Profesional actualizado", practitioner });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Profesional no encontrado" });
    }
    console.error("Practitioner update failed", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/:id/invite", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: "Indica un email válido para enviar la invitación" });
  }

  let createdUser;
  let invitationContext;
  try {
    const practitioner = await prisma.practitioner.findUnique({ where: { id: req.params.id } });
    if (!practitioner || practitioner.userId) {
      return res.status(409).json({ message: "Este profesional ya tiene una cuenta vinculada" });
    }

    invitationContext = {
      practitionerId: practitioner.id,
      previousEmail: practitioner.email,
      previousStatus: practitioner.status,
    };

    const resetToken = createOpaqueToken();
    const temporaryPassword = crypto.randomBytes(32).toString("hex");
    createdUser = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          email,
          name: practitioner.name,
          lastName: practitioner.lastName || "—",
          password: await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS),
          role: "EMPLOYEE",
          passwordResetTokenHash: hashOpaqueToken(resetToken),
          passwordResetExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        },
      });
      await transaction.practitioner.update({
        where: { id: practitioner.id },
        data: { userId: user.id, email, status: "INVITED" },
      });
      return user;
    });

    const resetUrl = new URL("/reset-password", frontendUrl);
    resetUrl.hash = `token=${resetToken}`;
    await transporter.sendMail({
      from: `"Centro de Osteopatía TECA" <${process.env.USER_GMAIL}>`,
      to: email,
      subject: "Activa tu acceso a TECA",
      text: `Te han invitado a TECA. Crea tu contraseña durante las próximas 48 horas: ${resetUrl.toString()}`,
      html: `<p>Te han invitado a TECA.</p><p><a href="${resetUrl.toString()}">Crear mi contraseña</a></p><p>El enlace caduca en 48 horas.</p>`,
    });
    return res.status(201).json({ message: "Invitación enviada" });
  } catch (error) {
    if (createdUser && invitationContext) {
      try {
        await prisma.$transaction(async (transaction) => {
          const disconnected = await transaction.practitioner.updateMany({
            where: {
              id: invitationContext.practitionerId,
              userId: createdUser.id,
            },
            data: {
              userId: null,
              email: invitationContext.previousEmail,
              status: invitationContext.previousStatus,
            },
          });

          if (disconnected.count === 1) {
            await transaction.user.deleteMany({ where: { id: createdUser.id } });
          }
        });
      } catch (rollbackError) {
        console.error("Practitioner invitation rollback failed", rollbackError);
      }
    }
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Ya existe una cuenta con ese email" });
    }
    console.error("Practitioner invitation failed", error);
    return res.status(500).json({ message: "No se ha podido enviar la invitación" });
  }
});

module.exports = router;
