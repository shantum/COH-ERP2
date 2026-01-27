-- Hotfix: Add missing returnBatchNumber column and index to OrderLine
-- This was missing from the 20260125_add_orderline_return_fields migration

ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnBatchNumber" TEXT;

CREATE INDEX IF NOT EXISTS "OrderLine_returnBatchNumber_idx" ON "OrderLine"("returnBatchNumber");
