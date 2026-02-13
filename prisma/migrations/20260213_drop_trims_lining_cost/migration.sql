-- Drop legacy trimsCost and liningCost columns
-- All values are NULL (verified before migration)
-- BOM system (Sku.bomCost) handles material costs now

ALTER TABLE "Product" DROP COLUMN IF EXISTS "trimsCost";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "liningCost";

ALTER TABLE "Variation" DROP COLUMN IF EXISTS "trimsCost";
ALTER TABLE "Variation" DROP COLUMN IF EXISTS "liningCost";

ALTER TABLE "Sku" DROP COLUMN IF EXISTS "trimsCost";
ALTER TABLE "Sku" DROP COLUMN IF EXISTS "liningCost";
