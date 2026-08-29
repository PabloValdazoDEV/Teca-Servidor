-- Additive update for the default hourly rate and weekly export tracking.
-- Back up PostgreSQL before applying this file in production.

ALTER TABLE "Clinic"
    ADD COLUMN IF NOT EXISTS "defaultHourlyRate" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "lastBackupExportAt" TIMESTAMP(3);
