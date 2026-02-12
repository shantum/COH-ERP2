-- Finance Ledger System: Accounts, Entries, Invoices, Payments
-- Follows the same trigger pattern as 20260124_sku_balance_trigger

-- ============================================
-- STEP 1: CREATE TABLES
-- ============================================

-- LedgerAccount — the chart of accounts
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- LedgerEntry — journal entry header
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "isReversed" BOOLEAN NOT NULL DEFAULT false,
    "reversedById" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- LedgerEntryLine — individual debit/credit lines
CREATE TABLE "LedgerEntryLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "LedgerEntryLine_pkey" PRIMARY KEY ("id")
);

-- Invoice — source document for money owed
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "invoiceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "supplierId" TEXT,
    "vendorId" TEXT,
    "customerId" TEXT,
    "counterpartyName" TEXT,
    "subtotal" DOUBLE PRECISION,
    "gstAmount" DOUBLE PRECISION,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceDue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderId" TEXT,
    "fabricInvoiceId" TEXT,
    "fileData" BYTEA,
    "fileName" TEXT,
    "fileMimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "aiRawResponse" JSONB,
    "aiModel" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "ledgerEntryId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- InvoiceLine — line items on an invoice
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT,
    "hsnCode" TEXT,
    "qty" DOUBLE PRECISION,
    "unit" TEXT,
    "rate" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "gstPercent" DOUBLE PRECISION,
    "gstAmount" DOUBLE PRECISION,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- Payment — record of actual money moving
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "direction" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "amount" DOUBLE PRECISION NOT NULL,
    "matchedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unmatchedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "supplierId" TEXT,
    "vendorId" TEXT,
    "customerId" TEXT,
    "counterpartyName" TEXT,
    "fileData" BYTEA,
    "fileName" TEXT,
    "fileMimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "ledgerEntryId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- PaymentInvoice — many-to-many join
CREATE TABLE "PaymentInvoice" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchedById" TEXT NOT NULL,

    CONSTRAINT "PaymentInvoice_pkey" PRIMARY KEY ("id")
);

-- ============================================
-- STEP 2: UNIQUE CONSTRAINTS
-- ============================================

CREATE UNIQUE INDEX "LedgerAccount_code_key" ON "LedgerAccount"("code");
CREATE UNIQUE INDEX "LedgerEntry_sourceType_sourceId_key" ON "LedgerEntry"("sourceType", "sourceId");
CREATE UNIQUE INDEX "Invoice_fabricInvoiceId_key" ON "Invoice"("fabricInvoiceId");
CREATE UNIQUE INDEX "Invoice_ledgerEntryId_key" ON "Invoice"("ledgerEntryId");
CREATE UNIQUE INDEX "Payment_ledgerEntryId_key" ON "Payment"("ledgerEntryId");
CREATE UNIQUE INDEX "PaymentInvoice_paymentId_invoiceId_key" ON "PaymentInvoice"("paymentId", "invoiceId");

-- ============================================
-- STEP 3: INDEXES
-- ============================================

-- LedgerAccount
CREATE INDEX "LedgerAccount_type_idx" ON "LedgerAccount"("type");

-- LedgerEntry
CREATE INDEX "LedgerEntry_entryDate_idx" ON "LedgerEntry"("entryDate");
CREATE INDEX "LedgerEntry_sourceType_idx" ON "LedgerEntry"("sourceType");
CREATE INDEX "LedgerEntry_createdAt_idx" ON "LedgerEntry"("createdAt");

-- LedgerEntryLine
CREATE INDEX "LedgerEntryLine_entryId_idx" ON "LedgerEntryLine"("entryId");
CREATE INDEX "LedgerEntryLine_accountId_idx" ON "LedgerEntryLine"("accountId");

-- Invoice
CREATE INDEX "Invoice_type_idx" ON "Invoice"("type");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_category_idx" ON "Invoice"("category");
CREATE INDEX "Invoice_supplierId_idx" ON "Invoice"("supplierId");
CREATE INDEX "Invoice_vendorId_idx" ON "Invoice"("vendorId");
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Invoice_orderId_idx" ON "Invoice"("orderId");
CREATE INDEX "Invoice_createdAt_idx" ON "Invoice"("createdAt");
CREATE INDEX "Invoice_invoiceNumber_idx" ON "Invoice"("invoiceNumber");

-- InvoiceLine
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- Payment
CREATE INDEX "Payment_direction_idx" ON "Payment"("direction");
CREATE INDEX "Payment_method_idx" ON "Payment"("method");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");
CREATE INDEX "Payment_supplierId_idx" ON "Payment"("supplierId");
CREATE INDEX "Payment_vendorId_idx" ON "Payment"("vendorId");
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");
CREATE INDEX "Payment_paymentDate_idx" ON "Payment"("paymentDate");
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- PaymentInvoice
CREATE INDEX "PaymentInvoice_paymentId_idx" ON "PaymentInvoice"("paymentId");
CREATE INDEX "PaymentInvoice_invoiceId_idx" ON "PaymentInvoice"("invoiceId");

-- ============================================
-- STEP 4: FOREIGN KEYS
-- ============================================

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LedgerEntryLine" ADD CONSTRAINT "LedgerEntryLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "LedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerEntryLine" ADD CONSTRAINT "LedgerEntryLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_fabricInvoiceId_fkey" FOREIGN KEY ("fabricInvoiceId") REFERENCES "FabricInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentInvoice" ADD CONSTRAINT "PaymentInvoice_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentInvoice" ADD CONSTRAINT "PaymentInvoice_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentInvoice" ADD CONSTRAINT "PaymentInvoice_matchedById_fkey" FOREIGN KEY ("matchedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================
-- STEP 5: LEDGER ACCOUNT BALANCE TRIGGER
-- (Same pattern as SKU balance trigger)
-- ============================================

-- Trigger function: auto-update LedgerAccount.balance on LedgerEntryLine changes
CREATE OR REPLACE FUNCTION update_ledger_account_balance()
RETURNS TRIGGER AS $$
DECLARE
    delta DOUBLE PRECISION;
    acct_type TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Get account type to determine sign convention
        SELECT "type" INTO acct_type FROM "LedgerAccount" WHERE "id" = NEW."accountId";

        -- Debit-normal (asset, direct_cost, expense): balance += debit - credit
        -- Credit-normal (liability, income, equity): balance += credit - debit
        IF acct_type IN ('asset', 'direct_cost', 'expense') THEN
            delta := NEW."debit" - NEW."credit";
        ELSE
            delta := NEW."credit" - NEW."debit";
        END IF;

        UPDATE "LedgerAccount"
        SET "balance" = "balance" + delta
        WHERE "id" = NEW."accountId";

        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        SELECT "type" INTO acct_type FROM "LedgerAccount" WHERE "id" = OLD."accountId";

        IF acct_type IN ('asset', 'direct_cost', 'expense') THEN
            delta := -(OLD."debit" - OLD."credit");
        ELSE
            delta := -(OLD."credit" - OLD."debit");
        END IF;

        UPDATE "LedgerAccount"
        SET "balance" = "balance" + delta
        WHERE "id" = OLD."accountId";

        RETURN OLD;

    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD."debit" != NEW."debit" OR OLD."credit" != NEW."credit" OR OLD."accountId" != NEW."accountId" THEN
            -- Reverse old effect
            SELECT "type" INTO acct_type FROM "LedgerAccount" WHERE "id" = OLD."accountId";
            IF acct_type IN ('asset', 'direct_cost', 'expense') THEN
                delta := -(OLD."debit" - OLD."credit");
            ELSE
                delta := -(OLD."credit" - OLD."debit");
            END IF;
            UPDATE "LedgerAccount"
            SET "balance" = "balance" + delta
            WHERE "id" = OLD."accountId";

            -- Apply new effect
            SELECT "type" INTO acct_type FROM "LedgerAccount" WHERE "id" = NEW."accountId";
            IF acct_type IN ('asset', 'direct_cost', 'expense') THEN
                delta := NEW."debit" - NEW."credit";
            ELSE
                delta := NEW."credit" - NEW."debit";
            END IF;
            UPDATE "LedgerAccount"
            SET "balance" = "balance" + delta
            WHERE "id" = NEW."accountId";
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if any (for idempotency)
DROP TRIGGER IF EXISTS trg_ledger_balance_insert ON "LedgerEntryLine";
DROP TRIGGER IF EXISTS trg_ledger_balance_delete ON "LedgerEntryLine";
DROP TRIGGER IF EXISTS trg_ledger_balance_update ON "LedgerEntryLine";

-- Create triggers
CREATE TRIGGER trg_ledger_balance_insert
    AFTER INSERT ON "LedgerEntryLine"
    FOR EACH ROW
    EXECUTE FUNCTION update_ledger_account_balance();

CREATE TRIGGER trg_ledger_balance_delete
    AFTER DELETE ON "LedgerEntryLine"
    FOR EACH ROW
    EXECUTE FUNCTION update_ledger_account_balance();

CREATE TRIGGER trg_ledger_balance_update
    AFTER UPDATE ON "LedgerEntryLine"
    FOR EACH ROW
    EXECUTE FUNCTION update_ledger_account_balance();

-- ============================================
-- STEP 6: GUARD TRIGGER (prevent direct balance writes)
-- ============================================

CREATE OR REPLACE FUNCTION guard_ledger_account_balance()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow changes if we're inside a trigger (like update_ledger_account_balance)
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    -- Block direct changes to balance
    IF OLD."balance" IS DISTINCT FROM NEW."balance" THEN
        RAISE EXCEPTION 'Direct modification of LedgerAccount.balance is not allowed. Use LedgerEntryLine instead.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_ledger_account_balance ON "LedgerAccount";

CREATE TRIGGER trg_guard_ledger_account_balance
    BEFORE UPDATE ON "LedgerAccount"
    FOR EACH ROW
    EXECUTE FUNCTION guard_ledger_account_balance();

-- ============================================
-- STEP 7: SEED CHART OF ACCOUNTS
-- ============================================

INSERT INTO "LedgerAccount" ("id", "code", "name", "type", "balance", "isActive", "createdAt", "updatedAt") VALUES
    (gen_random_uuid()::text, 'BANK', 'Bank', 'asset', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'CASH', 'Cash', 'asset', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'ACCOUNTS_RECEIVABLE', 'Money Customers Owe Us', 'asset', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'FABRIC_INVENTORY', 'Fabric Inventory', 'asset', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'FINISHED_GOODS', 'Finished Goods Inventory', 'asset', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'GST_INPUT', 'GST We Can Claim', 'asset', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'ADVANCES_GIVEN', 'Advances We Gave', 'asset', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'ACCOUNTS_PAYABLE', 'Money We Owe Vendors', 'liability', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'GST_OUTPUT', 'GST We Owe Government', 'liability', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'CUSTOMER_ADVANCES', 'Customer Advances', 'liability', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'SALES_REVENUE', 'Sales Revenue', 'income', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'COGS', 'Cost of Goods Sold', 'direct_cost', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'OPERATING_EXPENSES', 'Operating Expenses', 'expense', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'MARKETPLACE_FEES', 'Marketplace & Payment Fees', 'expense', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'OWNER_CAPITAL', 'Owner Capital', 'equity', 0, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'RETAINED_EARNINGS', 'Retained Earnings', 'equity', 0, true, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
