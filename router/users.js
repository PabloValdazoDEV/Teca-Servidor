const express = require("express");
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middelwares/authMiddleware");
const {
  isValidEmail,
  normalizeEmail,
  publicUser,
} = require("../utils/accountValidation");

const router = express.Router();
const { requireRole } = authMiddleware;

router.use(authMiddleware, requireRole("SUPERADMIN", "ADMIN"));

function manageableRoles(requesterRole) {
  return requesterRole === "SUPERADMIN"
    ? ["ADMIN", "EMPLOYEE"]
    : ["EMPLOYEE"];
}

router.get("/", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: { in: manageableRoles(req.user.role) } },
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ role: "asc" }, { name: "asc" }, { lastName: "asc" }],
    });

    return res.json({ users });
  } catch {
    console.error("Employee list could not be loaded");
    return res.status(500).json({ message: "Server error" });
  }
});

router.put("/:id", async (req, res) => {
  const allowedRoles = manageableRoles(req.user.role);
  const normalizedEmail = normalizeEmail(req.body.email);
  const normalizedName = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const normalizedLastName = typeof req.body.lastName === "string"
    ? req.body.lastName.trim()
    : "";
  const requestedRole = req.body.role;

  if (
    !normalizedName ||
    normalizedName.length > 100 ||
    !normalizedLastName ||
    normalizedLastName.length > 100 ||
    !isValidEmail(normalizedEmail) ||
    !allowedRoles.includes(requestedRole)
  ) {
    return res.status(400).json({ message: "Invalid employee data" });
  }

  try {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, role: true },
    });

    if (!target || target.id === req.user.id || !allowedRoles.includes(target.role)) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const user = await prisma.user.update({
      where: { id: target.id },
      data: {
        email: normalizedEmail,
        name: normalizedName,
        lastName: normalizedLastName,
        role: requestedRole,
      },
    });
    await prisma.practitioner.updateMany({
      where: { userId: target.id },
      data: {
        email: normalizedEmail,
        name: normalizedName,
        lastName: normalizedLastName,
      },
    }).catch(() => {
      console.error("Practitioner profile could not be synchronized");
    });

    return res.json({ message: "Employee updated", user: publicUser(user) });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "A user with that email already exists" });
    }

    console.error("Employee update failed");
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
