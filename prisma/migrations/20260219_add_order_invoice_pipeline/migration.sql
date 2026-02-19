-- Phase 0C: Order → Invoice Pipeline schema additions

-- Product: add HSN code
ALTER TABLE "Product" ADD COLUMN "hsnCode" TEXT;

-- Order: add customer state for GST determination
ALTER TABLE "Order" ADD COLUMN "customerState" TEXT;

-- Invoice: add GST type breakdown fields
ALTER TABLE "Invoice" ADD COLUMN "gstType" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "cgstAmount" DOUBLE PRECISION;
ALTER TABLE "Invoice" ADD COLUMN "sgstAmount" DOUBLE PRECISION;
ALTER TABLE "Invoice" ADD COLUMN "igstAmount" DOUBLE PRECISION;

-- InvoiceLine: add order line FK
ALTER TABLE "InvoiceLine" ADD COLUMN "orderLineId" TEXT;
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "InvoiceLine_orderLineId_idx" ON "InvoiceLine"("orderLineId");

-- InvoiceSequence: sequential invoice numbering
CREATE TABLE "InvoiceSequence" (
    "id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "currentNumber" INTEGER NOT NULL DEFAULT 0,
    "fiscalYear" TEXT NOT NULL,
    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InvoiceSequence_prefix_key" ON "InvoiceSequence"("prefix");
CREATE INDEX "InvoiceSequence_prefix_fiscalYear_idx" ON "InvoiceSequence"("prefix", "fiscalYear");

-- Seed the initial sequence row
INSERT INTO "InvoiceSequence" ("id", "prefix", "currentNumber", "fiscalYear")
VALUES (gen_random_uuid(), 'COH', 0, '25-26');
