-- Additive migration for clinic scheduling, practitioner profiles and versioned files.
-- Review and back up the database before running this file in production.

DO $$ BEGIN
    CREATE TYPE "PhoneKind" AS ENUM ('MOBILE', 'LANDLINE', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "PractitionerStatus" AS ENUM ('SCHEDULE_ONLY', 'INVITED', 'ACTIVE', 'INACTIVE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'QUARANTINED', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Clinic" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL DEFAULT 'Centro de Osteopatía TECA',
    "timeZone" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "allowOutsideHours" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Clinic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ClinicHours" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "firstStart" TEXT,
    "firstEnd" TEXT,
    "secondStart" TEXT,
    "secondEnd" TEXT,
    CONSTRAINT "ClinicHours_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Practitioner" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "color" TEXT NOT NULL DEFAULT '#047857',
    "status" "PractitionerStatus" NOT NULL DEFAULT 'SCHEDULE_ONLY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Practitioner_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Clinic" ("id") VALUES ('default') ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ClinicHours" (
    "id", "clinicId", "weekday", "enabled", "firstStart", "firstEnd", "secondStart", "secondEnd"
) VALUES
    ('default-0', 'default', 0, false, NULL, NULL, NULL, NULL),
    ('default-1', 'default', 1, true, '10:00', '14:00', '16:00', '22:00'),
    ('default-2', 'default', 2, true, '10:00', '14:00', '16:00', '22:00'),
    ('default-3', 'default', 3, true, '10:00', '14:00', '16:00', '22:00'),
    ('default-4', 'default', 4, true, '10:00', '14:00', '16:00', '22:00'),
    ('default-5', 'default', 5, true, '10:00', '16:00', NULL, NULL),
    ('default-6', 'default', 6, false, NULL, NULL, NULL, NULL)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Practitioner" (
    "id", "userId", "name", "lastName", "email", "status", "active", "createdAt", "updatedAt"
)
SELECT
    "id", "id", "name", "lastName", "email", 'ACTIVE'::"PractitionerStatus", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "Customer"
    ADD COLUMN IF NOT EXISTS "customerNumber" INTEGER,
    ADD COLUMN IF NOT EXISTS "legacyFolderName" TEXT,
    ADD COLUMN IF NOT EXISTS "legacySourceRow" INTEGER,
    ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE SEQUENCE IF NOT EXISTS "Customer_customerNumber_seq";
ALTER TABLE "Customer" ALTER COLUMN "customerNumber"
    SET DEFAULT nextval('"Customer_customerNumber_seq"');
UPDATE "Customer" SET "customerNumber" = nextval('"Customer_customerNumber_seq"')
WHERE "customerNumber" IS NULL;
ALTER TABLE "Customer" ALTER COLUMN "customerNumber" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_customerNumber_key" ON "Customer"("customerNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_legacySourceRow_key" ON "Customer"("legacySourceRow");

ALTER TABLE "PhoneNumber"
    ALTER COLUMN "phoneNumber" DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS "kind" "PhoneKind" NOT NULL DEFAULT 'OTHER',
    ADD COLUMN IF NOT EXISTS "label" TEXT,
    ADD COLUMN IF NOT EXISTS "rawValue" TEXT;

ALTER TABLE "Date" ADD COLUMN IF NOT EXISTS "practitionerId" TEXT;
UPDATE "Date" SET "practitionerId" = "userId" WHERE "practitionerId" IS NULL;

ALTER TABLE "Doc"
    ALTER COLUMN "fixedType" DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS "originalName" TEXT,
    ADD COLUMN IF NOT EXISTS "storageKey" TEXT,
    ADD COLUMN IF NOT EXISTS "mimeType" TEXT,
    ADD COLUMN IF NOT EXISTS "sizeBytes" INTEGER,
    ADD COLUMN IF NOT EXISTS "checksumSha256" TEXT,
    ADD COLUMN IF NOT EXISTS "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "DocumentVersion" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClinicHours_clinicId_weekday_key" ON "ClinicHours"("clinicId", "weekday");
CREATE INDEX IF NOT EXISTS "ClinicHours_clinicId_idx" ON "ClinicHours"("clinicId");
CREATE UNIQUE INDEX IF NOT EXISTS "Practitioner_userId_key" ON "Practitioner"("userId");
CREATE INDEX IF NOT EXISTS "Practitioner_active_name_idx" ON "Practitioner"("active", "name");
CREATE INDEX IF NOT EXISTS "Date_practitionerId_citaDate_idx" ON "Date"("practitionerId", "citaDate");
CREATE INDEX IF NOT EXISTS "Date_userId_citaDate_idx" ON "Date"("userId", "citaDate");
CREATE UNIQUE INDEX IF NOT EXISTS "Doc_storageKey_key" ON "Doc"("storageKey");
CREATE INDEX IF NOT EXISTS "Doc_customerId_createdAt_idx" ON "Doc"("customerId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentVersion_storageKey_key" ON "DocumentVersion"("storageKey");
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentVersion_docId_version_key" ON "DocumentVersion"("docId", "version");
CREATE INDEX IF NOT EXISTS "DocumentVersion_docId_createdAt_idx" ON "DocumentVersion"("docId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "ClinicHours" ADD CONSTRAINT "ClinicHours_clinicId_fkey"
        FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Practitioner" ADD CONSTRAINT "Practitioner_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Date" ADD CONSTRAINT "Date_practitionerId_fkey"
        FOREIGN KEY ("practitionerId") REFERENCES "Practitioner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_docId_fkey"
        FOREIGN KEY ("docId") REFERENCES "Doc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
