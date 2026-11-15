-- Acceso y agenda separados: desactivar el acceso de una cuenta (recepción o
-- profesional) ya no depende de su agenda. Aditivo y repetible.
-- Haz copia de PostgreSQL antes de aplicarlo en producción.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "disabledAt" TIMESTAMP(3);

-- Conserva el comportamiento anterior: las cuentas cuyo profesional estaba
-- desactivado siguen sin acceso. Revísalas después en "Empleados".
UPDATE "User" u
SET "disabledAt" = CURRENT_TIMESTAMP
FROM "Practitioner" p
WHERE p."userId" = u."id"
  AND p."active" = false
  AND u."disabledAt" IS NULL;
