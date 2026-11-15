-- Registro de accesos a datos clínicos (quién vio, descargó o modificó qué y cuándo).
-- Aditivo y repetible. Haz copia de PostgreSQL antes de aplicarlo en producción.

CREATE TABLE IF NOT EXISTS "AccessLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "customerId" TEXT,
    "docId" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AccessLog_customerId_createdAt_idx" ON "AccessLog"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "AccessLog_userId_createdAt_idx" ON "AccessLog"("userId", "createdAt");
