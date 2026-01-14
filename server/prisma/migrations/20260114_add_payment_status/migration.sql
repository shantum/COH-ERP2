-- AlterTable: Add payment status fields to Order table
ALTER TABLE "Order" ADD COLUMN "paymentStatus" TEXT DEFAULT 'pending';
ALTER TABLE "Order" ADD COLUMN "paymentConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "paymentConfirmedBy" TEXT;

-- CreateIndex: Add indexes for payment status filtering
CREATE INDEX "Order_paymentStatus_idx" ON "Order"("paymentStatus");
CREATE INDEX "Order_paymentMethod_paymentStatus_idx" ON "Order"("paymentMethod", "paymentStatus");

-- Backfill: Set paymentStatus based on existing data
-- For Shopify orders, sync from financialStatus
UPDATE "Order" o
SET "paymentStatus" = COALESCE(
  (SELECT "financialStatus" FROM "ShopifyOrderCache" WHERE id = o."shopifyOrderId"),
  'pending'
)
WHERE o."shopifyOrderId" IS NOT NULL;

-- For offline/non-Shopify orders, keep as 'pending' (conservative approach)
-- They can be manually marked as paid via the UI
