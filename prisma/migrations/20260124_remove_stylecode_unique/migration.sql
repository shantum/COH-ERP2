-- Remove unique constraint on styleCode (products can share style codes for same pattern)
-- Drop the unique constraint/index
DROP INDEX IF EXISTS "Product_styleCode_key";

-- Add a regular index for query performance
CREATE INDEX IF NOT EXISTS "Product_styleCode_idx" ON "Product"("styleCode");
