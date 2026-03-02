-- Add extended attribution columns to Order
ALTER TABLE "Order" ADD COLUMN "referringSite" TEXT;
ALTER TABLE "Order" ADD COLUMN "landingPageUrl" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerType" TEXT;
ALTER TABLE "Order" ADD COLUMN "origReferrer" TEXT;
ALTER TABLE "Order" ADD COLUMN "checkoutId" TEXT;
ALTER TABLE "Order" ADD COLUMN "sourceName" TEXT;
ALTER TABLE "Order" ADD COLUMN "elevarFbc" TEXT;
ALTER TABLE "Order" ADD COLUMN "elevarFbp" TEXT;
ALTER TABLE "Order" ADD COLUMN "elevarGaClientId" TEXT;
ALTER TABLE "Order" ADD COLUMN "elevarVisitorId" TEXT;
ALTER TABLE "Order" ADD COLUMN "elevarSessionId" TEXT;
ALTER TABLE "Order" ADD COLUMN "shopfloSessionId" TEXT;
ALTER TABLE "Order" ADD COLUMN "storefrontVisitorId" TEXT;
ALTER TABLE "Order" ADD COLUMN "storefrontSessionId" TEXT;

-- Indexes for attribution lookups
CREATE INDEX "Order_storefrontVisitorId_idx" ON "Order"("storefrontVisitorId");
CREATE INDEX "Order_elevarFbp_idx" ON "Order"("elevarFbp");
CREATE INDEX "Order_fbclid_idx" ON "Order"("fbclid");

-- Index for pixel linkage via fbclid
CREATE INDEX "StorefrontEvent_fbclid_idx" ON "StorefrontEvent"("fbclid");
