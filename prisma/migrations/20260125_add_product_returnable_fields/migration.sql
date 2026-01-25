-- Add returnable fields to Product

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isReturnable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "nonReturnableReason" TEXT;
