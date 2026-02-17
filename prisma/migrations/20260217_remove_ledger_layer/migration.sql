-- Add debitAccountCode to Payment (what account was this payment booked to)
ALTER TABLE "Payment" ADD COLUMN "debitAccountCode" TEXT;

-- Backfill from ledger entry (debit line that isn't a bank/cash account)
UPDATE "Payment" p
SET "debitAccountCode" = (
  SELECT la.code
  FROM "LedgerEntry" le
  JOIN "LedgerEntryLine" lel ON lel."entryId" = le.id
  JOIN "LedgerAccount" la ON la.id = lel."accountId"
  WHERE le.id = p."ledgerEntryId"
    AND lel.debit > 0
    AND la.code NOT IN ('BANK_HDFC', 'BANK_RAZORPAYX', 'CASH')
  LIMIT 1
)
WHERE p."ledgerEntryId" IS NOT NULL;

-- Backfill from BankTransaction for payments linked to bank imports
UPDATE "Payment" p
SET "debitAccountCode" = bt."debitAccountCode"
FROM "BankTransaction" bt
WHERE bt."paymentId" = p.id
  AND p."debitAccountCode" IS NULL
  AND bt."debitAccountCode" IS NOT NULL;

-- Remaining outgoing payments default to ACCOUNTS_PAYABLE
UPDATE "Payment"
SET "debitAccountCode" = 'ACCOUNTS_PAYABLE'
WHERE "debitAccountCode" IS NULL AND direction = 'outgoing';

-- Remaining incoming payments default to BANK_HDFC
UPDATE "Payment"
SET "debitAccountCode" = 'BANK_HDFC'
WHERE "debitAccountCode" IS NULL AND direction = 'incoming';

-- Backfill invoice billingPeriod from invoiceDate where missing
UPDATE "Invoice"
SET "billingPeriod" = TO_CHAR("invoiceDate" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')
WHERE "billingPeriod" IS NULL
  AND "invoiceDate" IS NOT NULL
  AND status IN ('confirmed', 'partially_paid', 'paid');

-- Index for invoice-based P&L queries
CREATE INDEX IF NOT EXISTS idx_invoice_pnl
  ON "Invoice"(type, status, "billingPeriod")
  WHERE status IN ('confirmed', 'partially_paid', 'paid');
