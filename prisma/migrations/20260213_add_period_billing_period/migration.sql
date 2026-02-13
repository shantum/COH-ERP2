-- Add period (YYYY-MM) to LedgerEntry for accrual-basis P&L
-- Add billingPeriod to Invoice for cross-month billing (e.g. Sep Facebook bill paid in Nov)

-- Step 1: Add period as nullable
ALTER TABLE "LedgerEntry" ADD COLUMN "period" TEXT;

-- Step 2: Backfill from entryDate converted to IST month
-- IST = UTC + 5:30, so we shift the date before extracting year-month
UPDATE "LedgerEntry"
SET "period" = TO_CHAR("entryDate" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM');

-- Step 3: Make NOT NULL
ALTER TABLE "LedgerEntry" ALTER COLUMN "period" SET NOT NULL;

-- Step 4: Index for P&L queries
CREATE INDEX "LedgerEntry_period_idx" ON "LedgerEntry"("period");

-- Step 5: Add billingPeriod to Invoice (optional)
ALTER TABLE "Invoice" ADD COLUMN "billingPeriod" TEXT;
