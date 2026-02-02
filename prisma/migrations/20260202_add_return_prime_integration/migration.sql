-- Add Return Prime integration fields to OrderLine
ALTER TABLE "OrderLine" ADD COLUMN "returnPrimeRequestId" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "returnPrimeRequestNumber" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "returnPrimeStatus" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "returnPrimeCreatedAt" TIMESTAMP(3);
ALTER TABLE "OrderLine" ADD COLUMN "returnPrimeUpdatedAt" TIMESTAMP(3);
ALTER TABLE "OrderLine" ADD COLUMN "returnPrimeSyncedAt" TIMESTAMP(3);
ALTER TABLE "OrderLine" ADD COLUMN "returnPrimeSyncError" TEXT;

-- Add indexes for Return Prime fields
CREATE INDEX "OrderLine_returnPrimeRequestId_idx" ON "OrderLine"("returnPrimeRequestId");
CREATE INDEX "OrderLine_returnPrimeStatus_returnPrimeUpdatedAt_idx" ON "OrderLine"("returnPrimeStatus", "returnPrimeUpdatedAt");

-- Add source field to WebhookLog
ALTER TABLE "WebhookLog" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'shopify';

-- Add composite index for source + topic
CREATE INDEX "WebhookLog_source_topic_idx" ON "WebhookLog"("source", "topic");
