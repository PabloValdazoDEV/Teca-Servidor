const crypto = require("node:crypto");
const prisma = require("../prisma/prisma");
const { rememberTtlSeconds } = require("../config/security");

const MAX_REMEMBERED_SESSIONS = 5;

function createOpaqueToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashOpaqueToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

async function createRememberedSession(userId) {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + rememberTtlSeconds * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: new Date() } },
          { userId, createdAt: { lt: new Date(Date.now() - rememberTtlSeconds * 1000) } },
        ],
      },
    });

    const existingSessions = await tx.session.findMany({
      where: { userId },
      select: { id: true },
      orderBy: { lastUsedAt: "desc" },
      skip: MAX_REMEMBERED_SESSIONS - 1,
    });

    if (existingSessions.length) {
      await tx.session.deleteMany({
        where: { id: { in: existingSessions.map((session) => session.id) } },
      });
    }

    await tx.session.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(token),
        expiresAt,
      },
    });
  });

  return { expiresAt, token };
}

async function rotateRememberedSession(token) {
  if (!/^[a-f0-9]{64}$/.test(token || "")) {
    return null;
  }

  const tokenHash = hashOpaqueToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          lastName: true,
          role: true,
        },
      },
    },
  });

  if (!session || session.expiresAt <= new Date()) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    }
    return null;
  }

  const rotatedToken = createOpaqueToken();
  await prisma.session.update({
    where: { id: session.id },
    data: {
      tokenHash: hashOpaqueToken(rotatedToken),
      lastUsedAt: new Date(),
    },
  });

  return {
    expiresAt: session.expiresAt,
    token: rotatedToken,
    user: session.user,
  };
}

async function revokeRememberedSession(token) {
  if (!/^[a-f0-9]{64}$/.test(token || "")) {
    return;
  }

  await prisma.session.deleteMany({
    where: { tokenHash: hashOpaqueToken(token) },
  });
}

module.exports = {
  createOpaqueToken,
  createRememberedSession,
  hashOpaqueToken,
  revokeRememberedSession,
  rotateRememberedSession,
};
