-- ============================================
-- Migration: Unified Party Model
-- Merges Supplier + Vendor into a single Party table
-- ============================================

-- Step 1: Drop all FK constraints referencing Supplier
ALTER TABLE "Fabric" DROP CONSTRAINT IF EXISTS "Fabric_supplierId_fkey";
ALTER TABLE "FabricColour" DROP CONSTRAINT IF EXISTS "FabricColour_supplierId_fkey";
ALTER TABLE "FabricOrder" DROP CONSTRAINT IF EXISTS "FabricOrder_supplierId_fkey";
ALTER TABLE "FabricColourTransaction" DROP CONSTRAINT IF EXISTS "FabricColourTransaction_supplierId_fkey";
ALTER TABLE "TrimItem" DROP CONSTRAINT IF EXISTS "TrimItem_supplierId_fkey";
ALTER TABLE "FabricInvoice" DROP CONSTRAINT IF EXISTS "FabricInvoice_supplierId_fkey";
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_supplierId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_supplierId_fkey";

-- Drop FK constraints referencing Vendor
ALTER TABLE "ServiceItem" DROP CONSTRAINT IF EXISTS "ServiceItem_vendorId_fkey";
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_vendorId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_vendorId_fkey";

-- Step 2: Drop indexes on columns that will be renamed
DROP INDEX IF EXISTS "Fabric_supplierId_idx";
DROP INDEX IF EXISTS "FabricColour_supplierId_idx";
DROP INDEX IF EXISTS "FabricOrder_supplierId_idx";
DROP INDEX IF EXISTS "FabricColourTransaction_supplierId_idx";
DROP INDEX IF EXISTS "TrimItem_supplierId_idx";
DROP INDEX IF EXISTS "FabricInvoice_supplierId_idx";
DROP INDEX IF EXISTS "Invoice_supplierId_idx";
DROP INDEX IF EXISTS "Invoice_vendorId_idx";
DROP INDEX IF EXISTS "Payment_supplierId_idx";
DROP INDEX IF EXISTS "Payment_vendorId_idx";
DROP INDEX IF EXISTS "ServiceItem_vendorId_idx";

-- Step 3: Handle Vendor name conflicts before merging
-- Vendors with the same name as an existing Supplier get suffixed
UPDATE "Vendor" SET name = name || ' (Service)'
WHERE LOWER(name) IN (SELECT LOWER(name) FROM "Supplier");

-- Step 4: Rename Supplier table → Party
ALTER TABLE "Supplier" RENAME TO "Party";

-- Rename the unique constraint on name (Prisma convention)
ALTER INDEX IF EXISTS "Supplier_name_key" RENAME TO "Party_name_key";
ALTER INDEX IF EXISTS "Supplier_pkey" RENAME TO "Party_pkey";

-- Step 5: Add new columns to Party
ALTER TABLE "Party" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'fabric';
ALTER TABLE "Party" ADD COLUMN "gstin" TEXT;
ALTER TABLE "Party" ADD COLUMN "pan" TEXT;
ALTER TABLE "Party" ADD COLUMN "stateCode" TEXT;
ALTER TABLE "Party" ADD COLUMN "tdsApplicable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Party" ADD COLUMN "tdsSection" TEXT;
ALTER TABLE "Party" ADD COLUMN "tdsRate" DOUBLE PRECISION;
ALTER TABLE "Party" ADD COLUMN "bankAccountName" TEXT;
ALTER TABLE "Party" ADD COLUMN "bankAccountNumber" TEXT;
ALTER TABLE "Party" ADD COLUMN "bankIfsc" TEXT;
ALTER TABLE "Party" ADD COLUMN "bankName" TEXT;
ALTER TABLE "Party" ADD COLUMN "paymentTermsDays" INTEGER;
ALTER TABLE "Party" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Step 6: Insert Vendor rows into Party with category = 'service'
INSERT INTO "Party" (id, name, "contactName", email, phone, address, "isActive", "createdAt", "updatedAt", category)
SELECT id, name, "contactName", email, phone, address, "isActive", "createdAt", "updatedAt", 'service'
FROM "Vendor";

-- Step 7: Rename supplierId → partyId across all tables (simple FK columns)
ALTER TABLE "Fabric" RENAME COLUMN "supplierId" TO "partyId";
ALTER TABLE "FabricColour" RENAME COLUMN "supplierId" TO "partyId";
ALTER TABLE "FabricOrder" RENAME COLUMN "supplierId" TO "partyId";
ALTER TABLE "FabricColourTransaction" RENAME COLUMN "supplierId" TO "partyId";
ALTER TABLE "TrimItem" RENAME COLUMN "supplierId" TO "partyId";
ALTER TABLE "FabricInvoice" RENAME COLUMN "supplierId" TO "partyId";

-- Step 8: Rename vendorId → partyId on ServiceItem
ALTER TABLE "ServiceItem" RENAME COLUMN "vendorId" TO "partyId";

-- Step 9: Merge Invoice's supplierId + vendorId → partyId
ALTER TABLE "Invoice" ADD COLUMN "partyId" TEXT;
UPDATE "Invoice" SET "partyId" = COALESCE("supplierId", "vendorId");
ALTER TABLE "Invoice" DROP COLUMN "supplierId";
ALTER TABLE "Invoice" DROP COLUMN "vendorId";

-- Step 10: Merge Payment's supplierId + vendorId → partyId
ALTER TABLE "Payment" ADD COLUMN "partyId" TEXT;
UPDATE "Payment" SET "partyId" = COALESCE("supplierId", "vendorId");
ALTER TABLE "Payment" DROP COLUMN "supplierId";
ALTER TABLE "Payment" DROP COLUMN "vendorId";

-- Step 11: Add FK constraints pointing to Party
ALTER TABLE "Fabric" ADD CONSTRAINT "Fabric_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FabricColour" ADD CONSTRAINT "FabricColour_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FabricOrder" ADD CONSTRAINT "FabricOrder_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FabricColourTransaction" ADD CONSTRAINT "FabricColourTransaction_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrimItem" ADD CONSTRAINT "TrimItem_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FabricInvoice" ADD CONSTRAINT "FabricInvoice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 12: Recreate indexes
CREATE INDEX "Fabric_partyId_idx" ON "Fabric"("partyId");
CREATE INDEX "FabricColour_partyId_idx" ON "FabricColour"("partyId");
CREATE INDEX "FabricOrder_partyId_idx" ON "FabricOrder"("partyId");
CREATE INDEX "FabricColourTransaction_partyId_idx" ON "FabricColourTransaction"("partyId");
CREATE INDEX "TrimItem_partyId_idx" ON "TrimItem"("partyId");
CREATE INDEX "ServiceItem_partyId_idx" ON "ServiceItem"("partyId");
CREATE INDEX "FabricInvoice_partyId_idx" ON "FabricInvoice"("partyId");
CREATE INDEX "Invoice_partyId_idx" ON "Invoice"("partyId");
CREATE INDEX "Payment_partyId_idx" ON "Payment"("partyId");
CREATE INDEX "Party_category_idx" ON "Party"("category");

-- Step 13: Drop the old Vendor table
DROP TABLE "Vendor";
