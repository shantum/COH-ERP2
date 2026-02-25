-- Add filePath column to Invoice, Payment, and BankTransaction
-- for server filesystem storage (migration from DB blobs)

ALTER TABLE "Invoice" ADD COLUMN "filePath" TEXT;
ALTER TABLE "Payment" ADD COLUMN "filePath" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN "filePath" TEXT;
