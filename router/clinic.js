const express = require("express");
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middelwares/authMiddleware");
const { DEFAULT_HOURS, normalizeHours } = require("../services/clinicSchedule");

const router = express.Router();
const { requireRole } = authMiddleware;

async function ensureClinic() {
  return prisma.clinic.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      hours: { createMany: { data: DEFAULT_HOURS } },
    },
    update: {},
    include: { hours: { orderBy: { weekday: "asc" } } },
  });
}

router.use(authMiddleware);

router.get("/", async (req, res) => {
  try {
    const clinic = await ensureClinic();
    return res.json({ clinic });
  } catch (error) {
    console.error("Clinic settings could not be loaded", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.put("/", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";

  if (!name || name.length > 150 || typeof req.body.allowOutsideHours !== "boolean") {
    return res.status(400).json({ message: "La configuración de la clínica no es válida" });
  }

  let hours;
  try {
    hours = normalizeHours(req.body.hours);
  } catch {
    return res.status(400).json({ message: "Revisa los tramos horarios de la clínica" });
  }

  try {
    const clinic = await prisma.$transaction(async (transaction) => {
      await transaction.clinic.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          name,
          allowOutsideHours: req.body.allowOutsideHours,
        },
        update: { name, allowOutsideHours: req.body.allowOutsideHours },
      });

      await Promise.all(
        hours.map((day) =>
          transaction.clinicHours.upsert({
            where: { clinicId_weekday: { clinicId: "default", weekday: day.weekday } },
            create: { clinicId: "default", ...day },
            update: day,
          })
        )
      );

      return transaction.clinic.findUnique({
        where: { id: "default" },
        include: { hours: { orderBy: { weekday: "asc" } } },
      });
    });

    return res.json({ message: "Configuración guardada", clinic });
  } catch (error) {
    console.error("Clinic settings update failed", error);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
