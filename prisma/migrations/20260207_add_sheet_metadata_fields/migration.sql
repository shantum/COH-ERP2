-- AlterTable
ALTER TABLE "InventoryTransaction" ADD COLUMN "source" TEXT;
ALTER TABLE "InventoryTransaction" ADD COLUMN "destination" TEXT;
ALTER TABLE "InventoryTransaction" ADD COLUMN "tailorNumber" TEXT;
ALTER TABLE "InventoryTransaction" ADD COLUMN "performedBy" TEXT;
ALTER TABLE "InventoryTransaction" ADD COLUMN "orderNumber" TEXT;

-- CreateIndex
CREATE INDEX "InventoryTransaction_orderNumber_idx" ON "InventoryTransaction"("orderNumber");
