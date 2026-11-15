const express = require("express");
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middelwares/authMiddleware");

const router = express.Router();
const { requireRole } = authMiddleware;

router.use(authMiddleware, requireRole("SUPERADMIN", "ADMIN"));

const manageableRoles = (role) => (role === "SUPERADMIN" ? ["ADMIN", "EMPLOYEE"] : ["EMPLOYEE"]);
const userSelect = { id: true, email: true, name: true, lastName: true, role: true, disabledAt: true };

// Todas las personas del centro en una sola lista: con agenda, con cuenta o con
// ambas. `canManageAccess` indica si quien consulta puede tocar su acceso.
router.get("/", async (req, res) => {
  try {
    const [practitioners, accountsWithoutAgenda] = await Promise.all([
      prisma.practitioner.findMany({
        select: { id: true, name: true, lastName: true, email: true, color: true, active: true, status: true, user: { select: userSelect } },
        orderBy: [{ active: "desc" }, { name: "asc" }],
      }),
      prisma.user.findMany({
        where: { practitioner: null },
        select: userSelect,
        orderBy: [{ name: "asc" }],
      }),
    ]);
    const manageable = manageableRoles(req.user.role);
    const describeAccount = (user) => user && ({
      ...user,
      canManageAccess: user.id !== req.user.id && manageable.includes(user.role),
    });

    const people = [
      ...practitioners.map((practitioner) => ({
        key: `p-${practitioner.id}`,
        name: practitioner.name,
        lastName: practitioner.lastName || "",
        agenda: { id: practitioner.id, active: practitioner.active, color: practitioner.color, email: practitioner.email, status: practitioner.status },
        account: describeAccount(practitioner.user),
      })),
      ...accountsWithoutAgenda.map((user) => ({
        key: `u-${user.id}`,
        name: user.name,
        lastName: user.lastName,
        agenda: null,
        account: describeAccount(user),
      })),
    ];
    return res.json({ people });
  } catch (error) {
    console.error("Team could not be loaded", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// Crea una agenda para una cuenta que no tenía (p. ej. recepción que empieza a atender).
router.post("/:userId/agenda", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: { id: true, name: true, lastName: true, email: true, role: true, practitioner: { select: { id: true } } },
    });
    if (!user || (user.id !== req.user.id && !manageableRoles(req.user.role).includes(user.role))) {
      return res.status(404).json({ message: "Persona no encontrada" });
    }
    if (user.practitioner) {
      return res.status(409).json({ message: "Esta persona ya tiene agenda" });
    }
    const practitioner = await prisma.practitioner.create({
      data: { userId: user.id, name: user.name, lastName: user.lastName, email: user.email, status: "ACTIVE" },
    });
    return res.status(201).json({ message: "Agenda creada", practitioner });
  } catch (error) {
    console.error("Agenda creation failed", error);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
