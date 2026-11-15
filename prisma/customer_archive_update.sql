-- Archivo de pacientes: en lugar de borrarlos (la historia clínica debe
-- conservarse), se marcan como archivados y dejan de aparecer en el día a día.
-- Aditivo y repetible. Haz copia de PostgreSQL antes de aplicarlo en producción.

ALTER TABLE "Customer"
    ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "archivedById" TEXT;

CREATE INDEX IF NOT EXISTS "Customer_archivedAt_idx" ON "Customer"("archivedAt");
