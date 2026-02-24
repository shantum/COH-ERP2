-- CreateTable
CREATE TABLE "ReturnPrimeCsvEnrichment" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "requestType" TEXT,
    "status" TEXT,
    "csvReason" TEXT,
    "customerComment" TEXT,
    "inspectionNotes" TEXT,
    "notes" TEXT,
    "refundStatus" TEXT,
    "requestedRefundMode" TEXT,
    "actualRefundMode" TEXT,
    "refundedAtRaw" TEXT,
    "pickupAwb" TEXT,
    "pickupLogistics" TEXT,
    "sourceFile" TEXT,
    "rawRow" JSONB,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnPrimeCsvEnrichment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReturnPrimeCsvEnrichment_requestNumber_key" ON "ReturnPrimeCsvEnrichment"("requestNumber");

-- CreateIndex
CREATE INDEX "ReturnPrimeCsvEnrichment_requestType_idx" ON "ReturnPrimeCsvEnrichment"("requestType");

-- CreateIndex
CREATE INDEX "ReturnPrimeCsvEnrichment_status_idx" ON "ReturnPrimeCsvEnrichment"("status");

-- CreateIndex
CREATE INDEX "ReturnPrimeCsvEnrichment_importedAt_idx" ON "ReturnPrimeCsvEnrichment"("importedAt");
