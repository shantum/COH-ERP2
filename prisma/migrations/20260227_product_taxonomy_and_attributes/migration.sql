-- Product Taxonomy & Attributes
-- Adds garmentGroup (high-level: tops/bottoms/dresses/sets/accessories),
-- googleProductCategoryId (for Google Shopping & Meta catalog feeds),
-- and attributes (JSONB for structured product attributes like construction, sleeve, neckline, fit).

-- 1. Add new columns
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "garmentGroup" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "googleProductCategoryId" INT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "attributes" JSONB;

-- 2. Backfill garmentGroup from existing category values
UPDATE "Product" SET "garmentGroup" = CASE
  -- TOPS: t-shirts, tanks, tops, shirts, outerwear (all go on the top half)
  WHEN category IN (
    't-shirt','crew neck t-shirt','v-neck t-shirt','polo t-shirt',
    'henley t-shirt','oversized t-shirt',
    'tank top','crop tank top','v-neck tank top','flared tank top',
    'top','v-neck top','wrap top','flared top','shirt blouse',
    'shirt','oversized shirt','buttondown shirt','bandhgala shirt',
    'jacket','bomber jacket','hoodie','sweatshirt','pullover','waistcoat','bandhgala'
  ) THEN 'tops'
  -- BOTTOMS: pants, shorts, skirts
  WHEN category IN (
    'pants','joggers','cargo pants','flared pants','pleated pants',
    'oversized pants','wide leg pants','baggy pants','panelled pants',
    'lounge pants','chinos',
    'shorts','cargo shorts','chino shorts','lounge shorts',
    'skirt','midi skirt'
  ) THEN 'bottoms'
  -- DRESSES
  WHEN category IN (
    'dress','midi dress','maxi dress','mini dress','slip dress',
    'tee dress','shirt dress','skater dress','flow dress','princess dress',
    'flared dress','pocket dress','drawstring dress','satin dress'
  ) THEN 'dresses'
  -- SETS
  WHEN category = 'co-ord set' THEN 'sets'
  -- ACCESSORIES
  WHEN category = 'tote bag' THEN 'accessories'
  -- FALLBACK
  ELSE 'tops'
END
WHERE "garmentGroup" IS NULL;

-- 3. Backfill googleProductCategoryId from existing category values
-- Reference: https://support.google.com/merchants/answer/6324436
--   212  = Apparel & Accessories > Clothing > Shirts & Tops
--   2271 = Apparel & Accessories > Clothing > Dresses
--   204  = Apparel & Accessories > Clothing > Pants
--   207  = Apparel & Accessories > Clothing > Shorts
--   1581 = Apparel & Accessories > Clothing > Skirts
--   5598 = Apparel & Accessories > Clothing > Outerwear > Coats & Jackets
--   6553 = Apparel & Accessories > Handbags, Wallets & Cases > Handbags > Tote Handbags
UPDATE "Product" SET "googleProductCategoryId" = CASE
  WHEN category IN ('jacket','bomber jacket','hoodie','sweatshirt','pullover','waistcoat','bandhgala')
    THEN 5598
  WHEN category IN (
    'dress','midi dress','maxi dress','mini dress','slip dress','tee dress',
    'shirt dress','skater dress','flow dress','princess dress','flared dress',
    'pocket dress','drawstring dress','satin dress','co-ord set'
  ) THEN 2271
  WHEN category IN (
    'pants','joggers','cargo pants','flared pants','pleated pants',
    'oversized pants','wide leg pants','baggy pants','panelled pants',
    'lounge pants','chinos'
  ) THEN 204
  WHEN category IN ('shorts','cargo shorts','chino shorts','lounge shorts')
    THEN 207
  WHEN category IN ('skirt','midi skirt')
    THEN 1581
  WHEN category = 'tote bag'
    THEN 6553
  ELSE 212  -- Shirts & Tops (default for all tops/shirts/tanks)
END
WHERE "googleProductCategoryId" IS NULL;

-- 4. Make garmentGroup NOT NULL with default after backfill
ALTER TABLE "Product" ALTER COLUMN "garmentGroup" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "garmentGroup" SET DEFAULT 'tops';

-- 5. Index for analytics/reporting queries
CREATE INDEX IF NOT EXISTS "Product_garmentGroup_idx" ON "Product"("garmentGroup");
