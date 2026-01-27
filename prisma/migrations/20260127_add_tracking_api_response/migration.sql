-- CreateTable: TrackingApiResponse
-- Stores raw iThink API responses for debugging (max 5 per AWB, rotated)

CREATE TABLE IF NOT EXISTS "TrackingApiResponse" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "awbNumber" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingApiResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TrackingApiResponse_awbNumber_idx" ON "TrackingApiResponse"("awbNumber");
CREATE INDEX IF NOT EXISTS "TrackingApiResponse_awbNumber_createdAt_idx" ON "TrackingApiResponse"("awbNumber", "createdAt");
