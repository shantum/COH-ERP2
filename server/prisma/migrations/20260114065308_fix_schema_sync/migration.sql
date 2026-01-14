/*
  Warnings:

  - You are about to drop the column `customerNotes` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shopifyData` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shopifyFulfillmentStatus` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `resolutionType` on the `ReturnRequest` table. All the data in the column will be lost.
  - You are about to alter the column `totalLineItemsPrice` on the `ShopifyOrderCache` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `DoublePrecision`.
  - You are about to alter the column `totalOutstanding` on the `ShopifyOrderCache` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `DoublePrecision`.
  - You are about to alter the column `totalShippingPrice` on the `ShopifyOrderCache` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `DoublePrecision`.
  - You are about to alter the column `shippingLatitude` on the `ShopifyOrderCache` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `DoublePrecision`.
  - You are about to alter the column `shippingLongitude` on the `ShopifyOrderCache` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `DoublePrecision`.
  - You are about to drop the `StockAlert` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[linkedOrderLineId]` on the table `Sku` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "OrderPayment" DROP CONSTRAINT "OrderPayment_recordedById_fkey";

-- DropIndex
DROP INDEX "ShopifyOrderCache_customerEmail_idx";

-- DropIndex
DROP INDEX "ShopifyOrderCache_shopifyCreatedAt_idx";

-- DropIndex
DROP INDEX "ShopifyOrderCache_totalPrice_idx";

-- AlterTable
ALTER TABLE "CostConfig" ADD COLUMN     "gstRateAbove" DOUBLE PRECISION NOT NULL DEFAULT 18,
ADD COLUMN     "gstRateBelow" DOUBLE PRECISION NOT NULL DEFAULT 5,
ADD COLUMN     "gstThreshold" DOUBLE PRECISION NOT NULL DEFAULT 2500;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "exchangeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rtoCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tier" TEXT NOT NULL DEFAULT 'bronze';

-- AlterTable
ALTER TABLE "Fabric" ALTER COLUMN "costPerUnit" DROP NOT NULL,
ALTER COLUMN "leadTimeDays" DROP NOT NULL,
ALTER COLUMN "leadTimeDays" DROP DEFAULT,
ALTER COLUMN "minOrderQty" DROP NOT NULL,
ALTER COLUMN "minOrderQty" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FabricType" ADD COLUMN     "defaultCostPerUnit" DOUBLE PRECISION,
ADD COLUMN     "defaultLeadTimeDays" INTEGER,
ADD COLUMN     "defaultMinOrderQty" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "customerNotes",
DROP COLUMN "shopifyData",
DROP COLUMN "shopifyFulfillmentStatus",
ADD COLUMN     "codRemittanceUtr" TEXT,
ADD COLUMN     "codRemittedAmount" DOUBLE PRECISION,
ADD COLUMN     "codRemittedAt" TIMESTAMP(3),
ADD COLUMN     "codShopifySyncError" TEXT,
ADD COLUMN     "codShopifySyncStatus" TEXT,
ADD COLUMN     "codShopifySyncedAt" TIMESTAMP(3),
ADD COLUMN     "courierStatusCode" TEXT,
ADD COLUMN     "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expectedDeliveryDate" TIMESTAMP(3),
ADD COLUMN     "holdAt" TIMESTAMP(3),
ADD COLUMN     "holdNotes" TEXT,
ADD COLUMN     "holdReason" TEXT,
ADD COLUMN     "isExchange" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isOnHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastScanAt" TIMESTAMP(3),
ADD COLUMN     "lastScanLocation" TEXT,
ADD COLUMN     "lastScanStatus" TEXT,
ADD COLUMN     "lastTrackingUpdate" TIMESTAMP(3),
ADD COLUMN     "originalOrderId" TEXT,
ADD COLUMN     "partiallyCancelled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rtoInitiatedAt" TIMESTAMP(3),
ADD COLUMN     "rtoReceivedAt" TIMESTAMP(3),
ADD COLUMN     "shipByDate" TIMESTAMP(3),
ADD COLUMN     "terminalAt" TIMESTAMP(3),
ADD COLUMN     "terminalStatus" TEXT,
ADD COLUMN     "trackingStatus" TEXT;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "awbNumber" TEXT,
ADD COLUMN     "courier" TEXT,
ADD COLUMN     "customizedAt" TIMESTAMP(3),
ADD COLUMN     "customizedById" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "holdAt" TIMESTAMP(3),
ADD COLUMN     "holdNotes" TEXT,
ADD COLUMN     "holdReason" TEXT,
ADD COLUMN     "isCustomized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isNonReturnable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isOnHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastTrackingUpdate" TIMESTAMP(3),
ADD COLUMN     "originalSkuId" TEXT,
ADD COLUMN     "refundAmount" DOUBLE PRECISION,
ADD COLUMN     "refundNotes" TEXT,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "rtoCondition" TEXT,
ADD COLUMN     "rtoInitiatedAt" TIMESTAMP(3),
ADD COLUMN     "rtoInwardedAt" TIMESTAMP(3),
ADD COLUMN     "rtoInwardedById" TEXT,
ADD COLUMN     "rtoNotes" TEXT,
ADD COLUMN     "rtoReceivedAt" TIMESTAMP(3),
ADD COLUMN     "shippingAddress" TEXT,
ADD COLUMN     "trackingStatus" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "exchangeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "liningCost" DOUBLE PRECISION,
ADD COLUMN     "packagingCost" DOUBLE PRECISION,
ADD COLUMN     "returnCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shopifyProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "trimsCost" DOUBLE PRECISION,
ADD COLUMN     "writeOffCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ReturnRequest" DROP COLUMN "resolutionType",
ADD COLUMN     "exchangeOrderId" TEXT,
ADD COLUMN     "forwardDelivered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "forwardDeliveredAt" TIMESTAMP(3),
ADD COLUMN     "forwardShippedAt" TIMESTAMP(3),
ADD COLUMN     "paymentAmount" DOUBLE PRECISION,
ADD COLUMN     "paymentCollectedAt" TIMESTAMP(3),
ADD COLUMN     "refundAmount" DOUBLE PRECISION,
ADD COLUMN     "refundProcessedAt" TIMESTAMP(3),
ADD COLUMN     "replacementValue" DOUBLE PRECISION,
ADD COLUMN     "resolution" TEXT NOT NULL DEFAULT 'refund',
ADD COLUMN     "returnValue" DOUBLE PRECISION,
ADD COLUMN     "reverseInTransitAt" TIMESTAMP(3),
ADD COLUMN     "reverseReceived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reverseReceivedAt" TIMESTAMP(3),
ADD COLUMN     "valueDifference" DOUBLE PRECISION,
ALTER COLUMN "status" SET DEFAULT 'pending_pickup';

-- AlterTable
ALTER TABLE "ReturnRequestLine" ADD COLUMN     "unitPrice" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ShopifyOrderCache" ADD COLUMN     "customerNotes" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "discountCodes" TEXT,
ADD COLUMN     "fulfillmentUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "processingLock" TIMESTAMP(3),
ADD COLUMN     "shipmentStatus" TEXT,
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "shippingCity" TEXT,
ADD COLUMN     "shippingCountry" TEXT,
ADD COLUMN     "shippingState" TEXT,
ADD COLUMN     "tags" TEXT,
ADD COLUMN     "trackingCompany" TEXT,
ADD COLUMN     "trackingNumber" TEXT,
ADD COLUMN     "trackingUrl" TEXT;
-- ALTER COLUMN "totalLineItemsPrice" DROP DEFAULT,
-- ALTER COLUMN "totalLineItemsPrice" SET DATA TYPE DOUBLE PRECISION,
-- ALTER COLUMN "totalOutstanding" DROP DEFAULT,
-- ALTER COLUMN "totalOutstanding" SET DATA TYPE DOUBLE PRECISION,
-- ALTER COLUMN "totalShippingPrice" DROP DEFAULT,
-- ALTER COLUMN "totalShippingPrice" SET DATA TYPE DOUBLE PRECISION,
-- ALTER COLUMN "customerEmail" DROP DEFAULT,
-- ALTER COLUMN "customerPhone" DROP DEFAULT,
-- ALTER COLUMN "customerFirstName" DROP DEFAULT,
-- ALTER COLUMN "customerLastName" DROP DEFAULT,
-- ALTER COLUMN "customerId" DROP DEFAULT,
-- ALTER COLUMN "shippingName" DROP DEFAULT,
-- ALTER COLUMN "shippingAddress1" DROP DEFAULT,
-- ALTER COLUMN "shippingAddress2" DROP DEFAULT,
-- ALTER COLUMN "shippingZip" DROP DEFAULT,
-- ALTER COLUMN "shippingPhone" DROP DEFAULT,
-- ALTER COLUMN "shippingProvince" DROP DEFAULT,
-- ALTER COLUMN "shippingProvinceCode" DROP DEFAULT,
-- ALTER COLUMN "shippingCountryCode" DROP DEFAULT,
-- ALTER COLUMN "shippingLatitude" DROP DEFAULT,
-- ALTER COLUMN "shippingLatitude" SET DATA TYPE DOUBLE PRECISION,
-- ALTER COLUMN "shippingLongitude" DROP DEFAULT,
-- ALTER COLUMN "shippingLongitude" SET DATA TYPE DOUBLE PRECISION,
-- ALTER COLUMN "billingName" DROP DEFAULT,
-- ALTER COLUMN "billingCity" DROP DEFAULT,
-- ALTER COLUMN "billingState" DROP DEFAULT,
-- ALTER COLUMN "billingZip" DROP DEFAULT,
-- ALTER COLUMN "billingPhone" DROP DEFAULT,
-- ALTER COLUMN "shopifyCreatedAt" DROP DEFAULT,
-- ALTER COLUMN "shopifyCreatedAt" SET DATA TYPE TIMESTAMP(3),
-- ALTER COLUMN "shopifyUpdatedAt" DROP DEFAULT,
-- ALTER COLUMN "shopifyUpdatedAt" SET DATA TYPE TIMESTAMP(3),
-- ALTER COLUMN "shopifyProcessedAt" DROP DEFAULT,
-- ALTER COLUMN "shopifyProcessedAt" SET DATA TYPE TIMESTAMP(3),
-- ALTER COLUMN "shopifyClosedAt" DROP DEFAULT,
-- ALTER COLUMN "shopifyClosedAt" SET DATA TYPE TIMESTAMP(3),
-- ALTER COLUMN "shopifyCancelledAt" DROP DEFAULT,
-- ALTER COLUMN "shopifyCancelledAt" SET DATA TYPE TIMESTAMP(3),
-- ALTER COLUMN "shopifyOrderName" DROP DEFAULT,
-- ALTER COLUMN "confirmationNumber" DROP DEFAULT,
-- ALTER COLUMN "currency" DROP DEFAULT,
-- ALTER COLUMN "sourceName" DROP DEFAULT,
-- ALTER COLUMN "cancelReason" DROP DEFAULT,
-- ALTER COLUMN "paymentGatewayNames" DROP DEFAULT,
-- ALTER COLUMN "lineItemCount" DROP DEFAULT,
-- ALTER COLUMN "fulfillmentCount" DROP DEFAULT,
-- ALTER COLUMN "refundCount" DROP DEFAULT,
-- ALTER COLUMN "isConfirmed" DROP DEFAULT,
-- ALTER COLUMN "isTaxExempt" DROP DEFAULT,
-- ALTER COLUMN "isTest" DROP DEFAULT,
-- ALTER COLUMN "buyerAcceptsMarketing" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Sku" ADD COLUMN     "customizationCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "customizationNotes" TEXT,
ADD COLUMN     "customizationType" TEXT,
ADD COLUMN     "customizationValue" TEXT,
ADD COLUMN     "exchangeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isCustomSku" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "laborMinutes" DOUBLE PRECISION,
ADD COLUMN     "liningCost" DOUBLE PRECISION,
ADD COLUMN     "linkedOrderLineId" TEXT,
ADD COLUMN     "packagingCost" DOUBLE PRECISION,
ADD COLUMN     "parentSkuId" TEXT,
ADD COLUMN     "returnCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trimsCost" DOUBLE PRECISION,
ADD COLUMN     "writeOffCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "roleId" TEXT,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Variation" ADD COLUMN     "hasLining" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "laborMinutes" DOUBLE PRECISION,
ADD COLUMN     "liningCost" DOUBLE PRECISION,
ADD COLUMN     "packagingCost" DOUBLE PRECISION,
ADD COLUMN     "shopifySourceHandle" TEXT,
ADD COLUMN     "shopifySourceProductId" TEXT,
ADD COLUMN     "trimsCost" DOUBLE PRECISION;

-- DropTable
DROP TABLE "StockAlert";

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermissionOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplacementItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ReplacementItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepackingQueueItem" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "returnRequestId" TEXT,
    "returnLineId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "condition" TEXT NOT NULL,
    "inspectionNotes" TEXT,
    "writeOffReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processedById" TEXT,
    "qcComments" TEXT,
    "orderLineId" TEXT,

    CONSTRAINT "RepackingQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WriteOffLog" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "notes" TEXT,
    "costValue" DOUBLE PRECISION,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WriteOffLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "resourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "responseCode" INTEGER,
    "processingTime" INTEGER,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FailedSyncItem" (
    "id" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "rawData" TEXT,
    "error" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailedSyncItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryReconciliation" (
    "id" TEXT NOT NULL,
    "reconcileDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryReconciliationItem" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "systemQty" INTEGER NOT NULL,
    "physicalQty" INTEGER,
    "variance" INTEGER,
    "adjustmentReason" TEXT,
    "notes" TEXT,
    "txnId" TEXT,

    CONSTRAINT "InventoryReconciliationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pincode" (
    "id" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "region" TEXT,
    "division" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pincode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE INDEX "UserPermissionOverride_userId_idx" ON "UserPermissionOverride"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionOverride_userId_permission_key" ON "UserPermissionOverride"("userId", "permission");

-- CreateIndex
CREATE INDEX "ReplacementItem_requestId_idx" ON "ReplacementItem"("requestId");

-- CreateIndex
CREATE INDEX "ReplacementItem_skuId_idx" ON "ReplacementItem"("skuId");

-- CreateIndex
CREATE INDEX "RepackingQueueItem_skuId_idx" ON "RepackingQueueItem"("skuId");

-- CreateIndex
CREATE INDEX "RepackingQueueItem_status_idx" ON "RepackingQueueItem"("status");

-- CreateIndex
CREATE INDEX "RepackingQueueItem_returnRequestId_idx" ON "RepackingQueueItem"("returnRequestId");

-- CreateIndex
CREATE INDEX "RepackingQueueItem_orderLineId_idx" ON "RepackingQueueItem"("orderLineId");

-- CreateIndex
CREATE INDEX "RepackingQueueItem_skuId_status_idx" ON "RepackingQueueItem"("skuId", "status");

-- CreateIndex
CREATE INDEX "WriteOffLog_skuId_idx" ON "WriteOffLog"("skuId");

-- CreateIndex
CREATE INDEX "WriteOffLog_reason_idx" ON "WriteOffLog"("reason");

-- CreateIndex
CREATE INDEX "WriteOffLog_createdAt_idx" ON "WriteOffLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookLog_webhookId_key" ON "WebhookLog"("webhookId");

-- CreateIndex
CREATE INDEX "WebhookLog_webhookId_idx" ON "WebhookLog"("webhookId");

-- CreateIndex
CREATE INDEX "WebhookLog_topic_idx" ON "WebhookLog"("topic");

-- CreateIndex
CREATE INDEX "WebhookLog_resourceId_idx" ON "WebhookLog"("resourceId");

-- CreateIndex
CREATE INDEX "WebhookLog_receivedAt_idx" ON "WebhookLog"("receivedAt");

-- CreateIndex
CREATE INDEX "FailedSyncItem_status_idx" ON "FailedSyncItem"("status");

-- CreateIndex
CREATE INDEX "FailedSyncItem_nextRetryAt_idx" ON "FailedSyncItem"("nextRetryAt");

-- CreateIndex
CREATE INDEX "FailedSyncItem_itemType_idx" ON "FailedSyncItem"("itemType");

-- CreateIndex
CREATE UNIQUE INDEX "FailedSyncItem_itemType_resourceId_key" ON "FailedSyncItem"("itemType", "resourceId");

-- CreateIndex
CREATE INDEX "InventoryReconciliation_status_idx" ON "InventoryReconciliation"("status");

-- CreateIndex
CREATE INDEX "InventoryReconciliation_createdAt_idx" ON "InventoryReconciliation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReconciliationItem_txnId_key" ON "InventoryReconciliationItem"("txnId");

-- CreateIndex
CREATE INDEX "InventoryReconciliationItem_reconciliationId_idx" ON "InventoryReconciliationItem"("reconciliationId");

-- CreateIndex
CREATE INDEX "InventoryReconciliationItem_skuId_idx" ON "InventoryReconciliationItem"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "Pincode_pincode_key" ON "Pincode"("pincode");

-- CreateIndex
CREATE INDEX "Pincode_state_idx" ON "Pincode"("state");

-- CreateIndex
CREATE INDEX "Pincode_district_idx" ON "Pincode"("district");

-- CreateIndex
CREATE INDEX "Customer_createdAt_idx" ON "Customer"("createdAt");

-- CreateIndex
CREATE INDEX "FabricTransaction_fabricId_createdAt_idx" ON "FabricTransaction"("fabricId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryTransaction_skuId_reason_createdAt_idx" ON "InventoryTransaction"("skuId", "reason", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryTransaction_skuId_txnType_idx" ON "InventoryTransaction"("skuId", "txnType");

-- CreateIndex
CREATE INDEX "InventoryTransaction_referenceId_idx" ON "InventoryTransaction"("referenceId");

-- CreateIndex
CREATE INDEX "Order_isExchange_idx" ON "Order"("isExchange");

-- CreateIndex
CREATE INDEX "Order_originalOrderId_idx" ON "Order"("originalOrderId");

-- CreateIndex
CREATE INDEX "Order_shipByDate_idx" ON "Order"("shipByDate");

-- CreateIndex
CREATE INDEX "Order_status_orderDate_idx" ON "Order"("status", "orderDate");

-- CreateIndex
CREATE INDEX "Order_customerId_orderDate_idx" ON "Order"("customerId", "orderDate");

-- CreateIndex
CREATE INDEX "Order_status_isArchived_idx" ON "Order"("status", "isArchived");

-- CreateIndex
CREATE INDEX "Order_status_isArchived_orderDate_idx" ON "Order"("status", "isArchived", "orderDate");

-- CreateIndex
CREATE INDEX "Order_terminalStatus_idx" ON "Order"("terminalStatus");

-- CreateIndex
CREATE INDEX "Order_terminalAt_idx" ON "Order"("terminalAt");

-- CreateIndex
CREATE INDEX "Order_terminalStatus_terminalAt_idx" ON "Order"("terminalStatus", "terminalAt");

-- CreateIndex
CREATE INDEX "Order_shippedAt_idx" ON "Order"("shippedAt");

-- CreateIndex
CREATE INDEX "Order_status_shippedAt_idx" ON "Order"("status", "shippedAt");

-- CreateIndex
CREATE INDEX "OrderLine_lineStatus_orderId_idx" ON "OrderLine"("lineStatus", "orderId");

-- CreateIndex
CREATE INDEX "OrderLine_rtoInwardedById_idx" ON "OrderLine"("rtoInwardedById");

-- CreateIndex
CREATE INDEX "OrderLine_customizedById_idx" ON "OrderLine"("customizedById");

-- CreateIndex
CREATE INDEX "OrderLine_awbNumber_idx" ON "OrderLine"("awbNumber");

-- CreateIndex
CREATE INDEX "OrderLine_skuId_rtoCondition_idx" ON "OrderLine"("skuId", "rtoCondition");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_rtoCondition_idx" ON "OrderLine"("orderId", "rtoCondition");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "ProductionBatch_batchDate_batchCode_idx" ON "ProductionBatch"("batchDate", "batchCode");

-- CreateIndex
CREATE INDEX "ProductionBatch_skuId_status_idx" ON "ProductionBatch"("skuId", "status");

-- CreateIndex
CREATE INDEX "ReturnRequest_resolution_idx" ON "ReturnRequest"("resolution");

-- CreateIndex
CREATE INDEX "ReturnRequest_exchangeOrderId_idx" ON "ReturnRequest"("exchangeOrderId");

-- CreateIndex
CREATE INDEX "ReturnRequest_status_createdAt_idx" ON "ReturnRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReturnRequest_customerId_status_idx" ON "ReturnRequest"("customerId", "status");

-- CreateIndex
CREATE INDEX "ReturnRequestLine_skuId_itemCondition_idx" ON "ReturnRequestLine"("skuId", "itemCondition");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_linkedOrderLineId_key" ON "Sku"("linkedOrderLineId");

-- CreateIndex
CREATE INDEX "Sku_parentSkuId_idx" ON "Sku"("parentSkuId");

-- CreateIndex
CREATE INDEX "Sku_isCustomSku_idx" ON "Sku"("isCustomSku");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE INDEX "Variation_shopifySourceProductId_idx" ON "Variation"("shopifySourceProductId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sku" ADD CONSTRAINT "Sku_parentSkuId_fkey" FOREIGN KEY ("parentSkuId") REFERENCES "Sku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES "ShopifyOrderCache"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_originalOrderId_fkey" FOREIGN KEY ("originalOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_customizedById_fkey" FOREIGN KEY ("customizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_rtoInwardedById_fkey" FOREIGN KEY ("rtoInwardedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_exchangeOrderId_fkey" FOREIGN KEY ("exchangeOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementItem" ADD CONSTRAINT "ReplacementItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ReturnRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementItem" ADD CONSTRAINT "ReplacementItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepackingQueueItem" ADD CONSTRAINT "RepackingQueueItem_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepackingQueueItem" ADD CONSTRAINT "RepackingQueueItem_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepackingQueueItem" ADD CONSTRAINT "RepackingQueueItem_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepackingQueueItem" ADD CONSTRAINT "RepackingQueueItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteOffLog" ADD CONSTRAINT "WriteOffLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteOffLog" ADD CONSTRAINT "WriteOffLog_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReconciliationItem" ADD CONSTRAINT "InventoryReconciliationItem_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "InventoryReconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReconciliationItem" ADD CONSTRAINT "InventoryReconciliationItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
