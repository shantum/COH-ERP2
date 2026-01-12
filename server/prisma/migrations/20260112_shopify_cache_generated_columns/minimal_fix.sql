-- Minimal fix: Only add the most essential generated columns
-- The database has limited disk space, so we add only critical fields

-- Drop the columns that were created as regular columns (if they exist)
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "totalPrice";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "subtotalPrice";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "totalTax";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "totalDiscounts";

-- Recreate just the amount fields as generated columns
ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "totalPrice" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_price')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "subtotalPrice" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'subtotal_price')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "totalTax" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_tax')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "totalDiscounts" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_discounts')::numeric) STORED;

-- Index for totalPrice
CREATE INDEX IF NOT EXISTS "ShopifyOrderCache_totalPrice_idx" ON "ShopifyOrderCache" ("totalPrice");
