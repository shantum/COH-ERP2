-- Add bomCost columns to Variation and Sku tables
-- These columns store pre-computed BOM costs for performance

-- Add bomCost to Variation (sum of SKU bomCosts)
ALTER TABLE "Variation" ADD COLUMN IF NOT EXISTS "bomCost" DOUBLE PRECISION;

-- Add bomCost to Sku (computed total: fabric + trims + services)
ALTER TABLE "Sku" ADD COLUMN IF NOT EXISTS "bomCost" DOUBLE PRECISION;
