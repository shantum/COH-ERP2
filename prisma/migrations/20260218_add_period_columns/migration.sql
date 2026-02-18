-- Add period ("YYYY-MM" IST) to Payment and BankTransaction for P&L / cash-flow grouping
-- Add billingPeriod index to Invoice

-- Payment: period derived from paymentDate
ALTER TABLE "Payment" ADD COLUMN "period" TEXT;
UPDATE "Payment" SET "period" = TO_CHAR("paymentDate" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') WHERE "period" IS NULL;
CREATE INDEX "Payment_period_idx" ON "Payment"("period");

-- BankTransaction: period derived from txnDate
ALTER TABLE "BankTransaction" ADD COLUMN "period" TEXT;
UPDATE "BankTransaction" SET "period" = TO_CHAR("txnDate" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') WHERE "period" IS NULL;
CREATE INDEX "BankTransaction_period_idx" ON "BankTransaction"("period");

-- Invoice: index on billingPeriod (already populated on all confirmed invoices)
CREATE INDEX "Invoice_billingPeriod_idx" ON "Invoice"("billingPeriod");

-- Party: billing period offset for accrual (e.g. -1 for Facebook/Google = previous month)
ALTER TABLE "Party" ADD COLUMN "billingPeriodOffsetMonths" INTEGER;
