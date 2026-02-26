-- Add return fee configuration to ReturnSettings
ALTER TABLE "ReturnSettings" ADD COLUMN IF NOT EXISTS "returnShippingFee" DECIMAL(10,2);
ALTER TABLE "ReturnSettings" ADD COLUMN IF NOT EXISTS "restockingFeeType" TEXT;
ALTER TABLE "ReturnSettings" ADD COLUMN IF NOT EXISTS "restockingFeeValue" DECIMAL(10,2);
