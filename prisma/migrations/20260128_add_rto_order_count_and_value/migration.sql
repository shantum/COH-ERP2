-- Add RTO tracking fields to Customer
ALTER TABLE "Customer" ADD COLUMN "rtoOrderCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Customer" ADD COLUMN "rtoValue" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Add comments for clarity
COMMENT ON COLUMN "Customer"."rtoCount" IS 'Total number of lines RTO''d';
COMMENT ON COLUMN "Customer"."rtoOrderCount" IS 'Number of orders with at least one RTO';
COMMENT ON COLUMN "Customer"."rtoValue" IS 'Total value of RTO''d items';
