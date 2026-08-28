const express = require("express");
const router = express.Router();
const crypto = require("node:crypto");
const prisma = require("../prisma/prisma");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");
const transporter = require("../config/nodemail");
const authMiddleware = require("../middelwares/authMiddleware");
const { requireRole } = authMiddleware;
const {
  frontendUrl,
  getRefreshCookieOptions,
  getSessionCookieOptions,
  isAllowedOrigin,
  jwtAudience,
  jwtIssuer,
  jwtSecret,
  jwtTtlSeconds,
  refreshCookieName,
  sessionCookieName,
} = require("../config/security");
const {
  BCRYPT_ROUNDS,
  isStrongPassword,
  isValidEmail,
  isValidPasswordInput,
  normalizeEmail,
  publicUser,
} = require("../utils/accountValidation");
const {
  createOpaqueToken,
  createRememberedSession,
  hashOpaqueToken,
  revokeRememberedSession,
  rotateRememberedSession,
} = require("../services/sessionService");

const VALID_ROLES = new Set(["ADMIN", "EMPLOYEE"]);
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  crypto.randomBytes(32).toString("hex"),
  BCRYPT_ROUNDS
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Too many login attempts; try again later" },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many recovery requests; try again later" },
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many reset attempts; try again later" },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many session refresh attempts" },
});

function createAccessToken(user) {
  return jwt.sign({}, jwtSecret, {
    algorithm: "HS256",
    audience: jwtAudience,
    expiresIn: jwtTtlSeconds,
    issuer: jwtIssuer,
    jwtid: crypto.randomUUID(),
    subject: user.id,
  });
}

function cookieClearOptions(options) {
  const { maxAge, ...clearOptions } = options;
  return clearOptions;
}

function clearAuthCookies(res) {
  res.clearCookie(
    sessionCookieName,
    cookieClearOptions(getSessionCookieOptions())
  );
  res.clearCookie(
    refreshCookieName,
    cookieClearOptions(getRefreshCookieOptions())
  );
  res.clearCookie("token", { path: "/" });
}

router.post(
  "/register",
  authMiddleware,
  requireRole("SUPERADMIN", "ADMIN"),
  async (req, res) => {
  const { email, password, name, lastName, role } = req.body;
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = typeof name === "string" ? name.trim() : "";
  const normalizedLastName = typeof lastName === "string" ? lastName.trim() : "";
  const requestedRole = role || "EMPLOYEE";

  try {
    if (
      !isValidEmail(normalizedEmail) ||
      !isStrongPassword(password) ||
      !normalizedName ||
      normalizedName.length > 100 ||
      !normalizedLastName ||
      normalizedLastName.length > 100 ||
      !VALID_ROLES.has(requestedRole)
    ) {
      return res.status(400).json({ message: "Invalid registration data" });
    }

    if (req.user.role === "ADMIN" && requestedRole !== "EMPLOYEE") {
      return res.status(403).json({ message: "Insufficient permissions for that role" });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await prisma.$transaction(async (transaction) => {
      const createdUser = await transaction.user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          name: normalizedName,
          lastName: normalizedLastName,
          role: requestedRole,
        },
      });

      await transaction.practitioner.create({
        data: {
          userId: createdUser.id,
          name: normalizedName,
          lastName: normalizedLastName,
          email: normalizedEmail,
          status: "ACTIVE",
        },
      });

      return createdUser;
    });

    return res.status(201).json({
      message: "User registered successfully",
      user: publicUser(user),
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "A user with that email already exists" });
    }

    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
  }
);

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password, rememberMe } = req.body;
  const normalizedEmail = normalizeEmail(email);

  if (!isValidEmail(normalizedEmail) || !isValidPasswordInput(password)) {
    return res.status(400).json({ message: "Invalid login data" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    const passwordMatches = await bcrypt.compare(
      password,
      user?.password || DUMMY_PASSWORD_HASH
    );

    if (!user || !passwordMatches) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = createAccessToken(user);
    res.cookie(
      sessionCookieName,
      token,
      getSessionCookieOptions({ persistent: rememberMe === true })
    );
    res.clearCookie("token", { path: "/" });

    const existingRefreshToken = req.cookies?.[refreshCookieName];
    if (existingRefreshToken) {
      await revokeRememberedSession(existingRefreshToken);
    }

    if (rememberMe === true) {
      const rememberedSession = await createRememberedSession(user.id);
      const remainingSeconds = Math.ceil(
        (rememberedSession.expiresAt.getTime() - Date.now()) / 1000
      );
      res.cookie(
        refreshCookieName,
        rememberedSession.token,
        getRefreshCookieOptions(remainingSeconds)
      );
    } else {
      res.clearCookie(
        refreshCookieName,
        cookieClearOptions(getRefreshCookieOptions())
      );
    }

    return res.json({ message: "Login successful", user: publicUser(user) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/refresh", refreshLimiter, async (req, res) => {
  if (!isAllowedOrigin(req.get("Origin"))) {
    return res.status(403).json({ message: "Request origin could not be verified" });
  }

  try {
    const rememberedSession = await rotateRememberedSession(
      req.cookies?.[refreshCookieName]
    );

    if (!rememberedSession) {
      clearAuthCookies(res);
      return res.status(401).json({ message: "Authentication required" });
    }

    const remainingSeconds = Math.ceil(
      (rememberedSession.expiresAt.getTime() - Date.now()) / 1000
    );
    res.cookie(
      sessionCookieName,
      createAccessToken(rememberedSession.user),
      getSessionCookieOptions()
    );
    res.cookie(
      refreshCookieName,
      rememberedSession.token,
      getRefreshCookieOptions(remainingSeconds)
    );

    return res.json({
      message: "Session refreshed",
      user: publicUser(rememberedSession.user),
    });
  } catch (error) {
    console.error("Session refresh failed");
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const normalizedEmail = normalizeEmail(req.body.email);
  const genericResponse = {
    message: "If the account exists, a recovery email has been sent",
  };

  if (!isValidEmail(normalizedEmail)) {
    return res.status(202).json(genericResponse);
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true },
    });

    if (!user) {
      return res.status(202).json(genericResponse);
    }

    const resetToken = createOpaqueToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetTokenHash: hashOpaqueToken(resetToken),
        passwordResetExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const resetUrl = new URL("/reset-password", frontendUrl);
    // Keep the token in the URL fragment so it is never sent to the frontend
    // web server or included in access logs.
    resetUrl.hash = `token=${resetToken}`;

    void transporter.sendMail({
      from: `"Centro de Osteopatía TECA" <${process.env.USER_GMAIL}>`,
      to: user.email,
      subject: "Restablece tu contraseña de TECA",
      text: `Se ha solicitado cambiar tu contraseña. Abre este enlace durante los próximos 30 minutos: ${resetUrl.toString()}\n\nSi no lo solicitaste, ignora este mensaje.`,
      html: `<p>Se ha solicitado cambiar tu contraseña.</p><p><a href="${resetUrl.toString()}">Restablecer contraseña</a></p><p>El enlace caduca en 30 minutos. Si no lo solicitaste, ignora este mensaje.</p>`,
    }).catch(async () => {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            passwordResetTokenHash: null,
            passwordResetExpiresAt: null,
          },
        });
      } catch {
        // The short-lived token remains safe even if cleanup fails.
      }
      console.error("Password recovery email delivery failed");
    });

    return res.status(202).json(genericResponse);
  } catch {
    console.error("Password recovery request failed");
    return res.status(202).json(genericResponse);
  }
});

router.post("/reset-password", resetPasswordLimiter, async (req, res) => {
  const { token, password } = req.body;

  if (!/^[a-f0-9]{64}$/.test(token || "") || !isStrongPassword(password)) {
    return res.status(400).json({ message: "Invalid token or password format" });
  }

  try {
    const user = await prisma.user.findFirst({
      where: {
        passwordResetTokenHash: hashOpaqueToken(token),
        passwordResetExpiresAt: { gt: new Date() },
      },
      select: { id: true, password: true },
    });

    if (!user || (await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ message: "Invalid or expired recovery link" });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await prisma.$transaction(async (tx) => {
      const claimedToken = await tx.user.updateMany({
        where: {
          id: user.id,
          passwordResetTokenHash: hashOpaqueToken(token),
          passwordResetExpiresAt: { gt: new Date() },
        },
        data: {
          password: passwordHash,
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
        },
      });

      if (claimedToken.count !== 1) {
        throw new Error("RECOVERY_TOKEN_ALREADY_USED");
      }

      await tx.session.deleteMany({ where: { userId: user.id } });
      if (tx.practitioner?.updateMany) {
        await tx.practitioner.updateMany({
          where: { userId: user.id },
          data: { status: "ACTIVE", active: true },
        });
      }
    });

    clearAuthCookies(res);
    return res.json({ message: "Password updated successfully" });
  } catch (error) {
    if (error.message === "RECOVERY_TOKEN_ALREADY_USED") {
      return res.status(400).json({ message: "Invalid or expired recovery link" });
    }

    console.error("Password reset failed");
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/logout", async (req, res) => {
  try {
    await revokeRememberedSession(req.cookies?.[refreshCookieName]);
  } catch {
    console.error("Remembered session revocation failed");
  }

  clearAuthCookies(res);
  return res.json({ message: "Logout successful" });
});

router.get("/me", authMiddleware, (req, res) => {
  return res.json({ loggedIn: true, user: req.user });
});

router.put("/me", authMiddleware, async (req, res) => {
  const normalizedName = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const normalizedLastName = typeof req.body.lastName === "string"
    ? req.body.lastName.trim()
    : "";
  const normalizedEmail = normalizeEmail(req.body.email);

  if (
    !normalizedName ||
    normalizedName.length > 100 ||
    !normalizedLastName ||
    normalizedLastName.length > 100 ||
    !isValidEmail(normalizedEmail)
  ) {
    return res.status(400).json({ message: "Invalid profile data" });
  }

  try {
    if (normalizedEmail !== req.user.email) {
      if (!isValidPasswordInput(req.body.currentPassword)) {
        return res.status(400).json({ message: "Current password is required to change email" });
      }

      const credentials = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { password: true },
      });

      if (!credentials || !(await bcrypt.compare(req.body.currentPassword, credentials.password))) {
        return res.status(403).json({ message: "Current password is incorrect" });
      }
    }

    const user = await prisma.$transaction(async (transaction) => {
      const updatedUser = await transaction.user.update({
        where: { id: req.user.id },
        data: {
          email: normalizedEmail,
          name: normalizedName,
          lastName: normalizedLastName,
        },
      });
      await transaction.practitioner.updateMany({
        where: { userId: req.user.id },
        data: {
          email: normalizedEmail,
          name: normalizedName,
          lastName: normalizedLastName,
        },
      });
      return updatedUser;
    });

    return res.json({ message: "Profile updated", user: publicUser(user) });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "A user with that email already exists" });
    }

    console.error("Profile update failed");
    return res.status(500).json({ message: "Server error" });
  }
});

router.put("/me/password", authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!isValidPasswordInput(currentPassword) || !isStrongPassword(newPassword)) {
    return res.status(400).json({
      message: "La nueva contraseña debe tener al menos 8 caracteres, mayúscula, minúscula, número y símbolo",
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { password: true },
    });
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(403).json({ message: "La contraseña actual no es correcta" });
    }
    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({ message: "La nueva contraseña debe ser distinta" });
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: req.user.id },
        data: { password: passwordHash },
      }),
      prisma.session.deleteMany({ where: { userId: req.user.id } }),
    ]);
    clearAuthCookies(res);
    return res.json({ message: "Contraseña actualizada. Vuelve a iniciar sesión" });
  } catch (error) {
    console.error("Password change failed", error);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
