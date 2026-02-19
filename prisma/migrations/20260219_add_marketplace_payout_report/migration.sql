-- CreateTable
CREATE TABLE "MarketplacePayoutReport" (
    "id" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "reportPeriod" TEXT NOT NULL,
    "grossRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCommission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bannerDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingCharges" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "returnCharges" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tdsAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherIncome" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netPayout" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "returnCount" INTEGER NOT NULL DEFAULT 0,
    "cancelledCount" INTEGER NOT NULL DEFAULT 0,
    "orderLines" JSONB,
    "matchedOrders" JSONB,
    "bankMatchResult" JSONB,
    "revenueInvoiceId" TEXT,
    "commissionInvoiceId" TEXT,
    "promoInvoiceId" TEXT,
    "bankTransactionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplacePayoutReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplacePayoutReport_marketplace_fileHash_key" ON "MarketplacePayoutReport"("marketplace", "fileHash");

-- CreateIndex
CREATE INDEX "MarketplacePayoutReport_marketplace_idx" ON "MarketplacePayoutReport"("marketplace");

-- CreateIndex
CREATE INDEX "MarketplacePayoutReport_reportPeriod_idx" ON "MarketplacePayoutReport"("reportPeriod");

-- CreateIndex
CREATE INDEX "MarketplacePayoutReport_status_idx" ON "MarketplacePayoutReport"("status");
