-- Copy leadTimeDays/minOrderQty data to default* columns where the latter is null
UPDATE "Fabric"
SET "defaultLeadTimeDays" = "leadTimeDays"
WHERE "leadTimeDays" IS NOT NULL AND "defaultLeadTimeDays" IS NULL;

UPDATE "Fabric"
SET "defaultMinOrderQty" = "minOrderQty"
WHERE "minOrderQty" IS NOT NULL AND "defaultMinOrderQty" IS NULL;

-- Drop duplicate columns
ALTER TABLE "Fabric" DROP COLUMN IF EXISTS "leadTimeDays";
ALTER TABLE "Fabric" DROP COLUMN IF EXISTS "minOrderQty";

-- Add default for colorName
ALTER TABLE "Fabric" ALTER COLUMN "colorName" SET DEFAULT 'N/A';
