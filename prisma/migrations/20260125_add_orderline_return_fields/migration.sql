-- Add return lifecycle columns to OrderLine

-- Return Status & Basic Info
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnStatus" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnQty" INTEGER;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnRequestedAt" TIMESTAMP(3);
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnRequestedById" TEXT;

-- Pickup/Logistics
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnPickupType" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnAwbNumber" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnCourier" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnPickupScheduledAt" TIMESTAMP(3);
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnPickupAt" TIMESTAMP(3);
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnReceivedAt" TIMESTAMP(3);
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnReceivedById" TEXT;

-- Condition & QC
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnCondition" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnConditionNotes" TEXT;

-- Reason
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnReasonCategory" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnReasonDetail" TEXT;

-- Resolution
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnResolution" TEXT;

-- Refund Calculation
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnGrossAmount" DECIMAL(10, 2);
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnDiscountClawback" DECIMAL(10, 2);
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnDeductions" DECIMAL(10, 2);
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnDeductionNotes" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnNetAmount" DECIMAL(10, 2);

-- Refund Execution
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnRefundLinkSentAt" TIMESTAMP(3);
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnRefundLinkId" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnRefundCompletedAt" TIMESTAMP(3);
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnRefundMethod" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnRefundReference" TEXT;

-- Exchange
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnExchangeOrderId" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnExchangeSkuId" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnExchangePriceDiff" DECIMAL(10, 2);

-- Manual Close
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnClosedManually" BOOLEAN;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnClosedManuallyAt" TIMESTAMP(3);
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnClosedManuallyById" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnClosedReason" TEXT;

-- Internal
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "returnNotes" TEXT;

-- Foreign Key Constraints (only add if not exists)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderLine_returnRequestedById_fkey') THEN
        ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_returnRequestedById_fkey"
            FOREIGN KEY ("returnRequestedById") REFERENCES "User"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderLine_returnReceivedById_fkey') THEN
        ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_returnReceivedById_fkey"
            FOREIGN KEY ("returnReceivedById") REFERENCES "User"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderLine_returnClosedManuallyById_fkey') THEN
        ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_returnClosedManuallyById_fkey"
            FOREIGN KEY ("returnClosedManuallyById") REFERENCES "User"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderLine_returnExchangeOrderId_fkey') THEN
        ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_returnExchangeOrderId_fkey"
            FOREIGN KEY ("returnExchangeOrderId") REFERENCES "Order"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Indexes for Return Fields
CREATE INDEX IF NOT EXISTS "OrderLine_returnStatus_idx" ON "OrderLine"("returnStatus");
CREATE INDEX IF NOT EXISTS "OrderLine_returnStatus_orderId_idx" ON "OrderLine"("returnStatus", "orderId");
CREATE INDEX IF NOT EXISTS "OrderLine_returnAwbNumber_idx" ON "OrderLine"("returnAwbNumber");
CREATE INDEX IF NOT EXISTS "OrderLine_returnRequestedAt_idx" ON "OrderLine"("returnRequestedAt");
CREATE INDEX IF NOT EXISTS "OrderLine_returnRequestedById_idx" ON "OrderLine"("returnRequestedById");
CREATE INDEX IF NOT EXISTS "OrderLine_returnReceivedById_idx" ON "OrderLine"("returnReceivedById");
CREATE INDEX IF NOT EXISTS "OrderLine_returnClosedManuallyById_idx" ON "OrderLine"("returnClosedManuallyById");
CREATE INDEX IF NOT EXISTS "OrderLine_returnExchangeOrderId_idx" ON "OrderLine"("returnExchangeOrderId");
