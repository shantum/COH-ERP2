-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'staff',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "styleCode" TEXT,
    "category" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "gender" TEXT NOT NULL DEFAULT 'unisex',
    "fabricTypeId" TEXT,
    "baseProductionTimeMins" INTEGER NOT NULL DEFAULT 60,
    "defaultFabricConsumption" DOUBLE PRECISION,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variation" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "standardColor" TEXT,
    "colorHex" TEXT,
    "fabricId" TEXT NOT NULL,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Variation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sku" (
    "id" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "fabricConsumption" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "mrp" DOUBLE PRECISION NOT NULL,
    "targetStockQty" INTEGER NOT NULL DEFAULT 10,
    "targetStockMethod" TEXT NOT NULL DEFAULT 'day14',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "shopifyInventoryItemId" TEXT,
    "shopifyVariantId" TEXT,

    CONSTRAINT "Sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuCosting" (
    "skuId" TEXT NOT NULL,
    "fabricCost" DOUBLE PRECISION NOT NULL,
    "laborTimeMins" INTEGER NOT NULL,
    "laborRatePerMin" DOUBLE PRECISION NOT NULL,
    "laborCost" DOUBLE PRECISION NOT NULL,
    "packagingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCogs" DOUBLE PRECISION NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkuCosting_pkey" PRIMARY KEY ("skuId")
);

-- CreateTable
CREATE TABLE "CostConfig" (
    "id" TEXT NOT NULL,
    "laborRatePerMin" DOUBLE PRECISION NOT NULL DEFAULT 2.50,
    "defaultPackagingCost" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FabricType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "composition" TEXT,
    "unit" TEXT NOT NULL,
    "avgShrinkagePct" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "FabricType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fabric" (
    "id" TEXT NOT NULL,
    "fabricTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "standardColor" TEXT,
    "colorHex" TEXT,
    "costPerUnit" DOUBLE PRECISION NOT NULL,
    "supplierId" TEXT,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 14,
    "minOrderQty" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Fabric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FabricTransaction" (
    "id" TEXT NOT NULL,
    "fabricId" TEXT NOT NULL,
    "txnType" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "costPerUnit" DOUBLE PRECISION,
    "supplierId" TEXT,
    "referenceId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FabricTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FabricOrder" (
    "id" TEXT NOT NULL,
    "fabricId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "qtyOrdered" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "costPerUnit" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "receivedDate" TIMESTAMP(3),
    "qtyReceived" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'ordered',
    "notes" TEXT,

    CONSTRAINT "FabricOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "txnType" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" TEXT,
    "notes" TEXT,
    "warehouseLocation" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "defaultAddress" TEXT,
    "tags" TEXT,
    "acceptsMarketing" BOOLEAN NOT NULL DEFAULT false,
    "firstOrderDate" TIMESTAMP(3),
    "lastOrderDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'shopify',
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "shippingAddress" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerNotes" TEXT,
    "internalNotes" TEXT,
    "paymentMethod" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "awbNumber" TEXT,
    "courier" TEXT,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3),
    "shopifyFulfillmentStatus" TEXT,
    "shopifyData" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyLineId" TEXT,
    "skuId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "lineStatus" TEXT NOT NULL DEFAULT 'pending',
    "allocatedAt" TIMESTAMP(3),
    "pickedAt" TIMESTAMP(3),
    "packedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "inventoryTxnId" TEXT,
    "productionBatchId" TEXT,
    "notes" TEXT,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "originalOrderId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "reasonCategory" TEXT NOT NULL,
    "reasonDetails" TEXT,
    "resolutionType" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequestLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "originalOrderLineId" TEXT,
    "skuId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "exchangeSkuId" TEXT,
    "exchangeQty" INTEGER,
    "itemCondition" TEXT,
    "inspectionNotes" TEXT,

    CONSTRAINT "ReturnRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnShipping" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "courier" TEXT,
    "awbNumber" TEXT,
    "pickupAddress" TEXT,
    "pickupScheduledAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "notes" TEXT,

    CONSTRAINT "ReturnShipping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnStatusHistory" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "orderId" TEXT,
    "orderLineId" TEXT,
    "source" TEXT NOT NULL,
    "feedbackType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackRating" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "FeedbackRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackContent" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "pros" TEXT,
    "cons" TEXT,
    "wouldRecommend" BOOLEAN,

    CONSTRAINT "FeedbackContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackMedia" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,

    CONSTRAINT "FeedbackMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackProductLink" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "productId" TEXT,
    "variationId" TEXT,
    "skuId" TEXT,

    CONSTRAINT "FeedbackProductLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackTag" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "FeedbackTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tailor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specializations" TEXT,
    "dailyCapacityMins" INTEGER NOT NULL DEFAULT 480,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tailor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" TEXT NOT NULL,
    "batchCode" TEXT,
    "batchDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tailorId" TEXT,
    "skuId" TEXT NOT NULL,
    "qtyPlanned" INTEGER NOT NULL,
    "qtyCompleted" INTEGER NOT NULL DEFAULT 0,
    "priority" TEXT NOT NULL,
    "sourceOrderLineId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyInventoryCache" (
    "skuId" TEXT NOT NULL,
    "shopifyInventoryItemId" TEXT NOT NULL,
    "availableQty" INTEGER NOT NULL,
    "lastSynced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopifyInventoryCache_pkey" PRIMARY KEY ("skuId")
);

-- CreateTable
CREATE TABLE "StockAlert" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dateFilter" TEXT,
    "daysBack" INTEGER,
    "syncMode" TEXT,
    "staleAfterMins" INTEGER,
    "totalRecords" INTEGER,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "lastProcessedId" TEXT,
    "currentBatch" INTEGER NOT NULL DEFAULT 0,
    "errorLog" TEXT,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyOrderCache" (
    "id" TEXT NOT NULL,
    "rawData" TEXT NOT NULL,
    "orderNumber" TEXT,
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "lastWebhookAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "webhookTopic" TEXT,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopifyOrderCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FabricReconciliation" (
    "id" TEXT NOT NULL,
    "reconcileDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FabricReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FabricReconciliationItem" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "fabricId" TEXT NOT NULL,
    "systemQty" DOUBLE PRECISION NOT NULL,
    "physicalQty" DOUBLE PRECISION,
    "variance" DOUBLE PRECISION,
    "adjustmentReason" TEXT,
    "notes" TEXT,
    "txnId" TEXT,

    CONSTRAINT "FabricReconciliationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Product_styleCode_key" ON "Product"("styleCode");

-- CreateIndex
CREATE INDEX "Product_fabricTypeId_idx" ON "Product"("fabricTypeId");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Variation_productId_idx" ON "Variation"("productId");

-- CreateIndex
CREATE INDEX "Variation_fabricId_idx" ON "Variation"("fabricId");

-- CreateIndex
CREATE UNIQUE INDEX "Variation_productId_colorName_key" ON "Variation"("productId", "colorName");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_skuCode_key" ON "Sku"("skuCode");

-- CreateIndex
CREATE INDEX "Sku_variationId_idx" ON "Sku"("variationId");

-- CreateIndex
CREATE INDEX "Fabric_fabricTypeId_idx" ON "Fabric"("fabricTypeId");

-- CreateIndex
CREATE INDEX "Fabric_supplierId_idx" ON "Fabric"("supplierId");

-- CreateIndex
CREATE INDEX "FabricTransaction_fabricId_idx" ON "FabricTransaction"("fabricId");

-- CreateIndex
CREATE INDEX "FabricTransaction_txnType_idx" ON "FabricTransaction"("txnType");

-- CreateIndex
CREATE INDEX "FabricTransaction_createdAt_idx" ON "FabricTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "FabricOrder_fabricId_idx" ON "FabricOrder"("fabricId");

-- CreateIndex
CREATE INDEX "FabricOrder_supplierId_idx" ON "FabricOrder"("supplierId");

-- CreateIndex
CREATE INDEX "FabricOrder_status_idx" ON "FabricOrder"("status");

-- CreateIndex
CREATE INDEX "InventoryTransaction_skuId_idx" ON "InventoryTransaction"("skuId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_txnType_idx" ON "InventoryTransaction"("txnType");

-- CreateIndex
CREATE INDEX "InventoryTransaction_createdAt_idx" ON "InventoryTransaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_shopifyCustomerId_key" ON "Customer"("shopifyCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_shopifyOrderId_key" ON "Order"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_orderDate_idx" ON "Order"("orderDate");

-- CreateIndex
CREATE INDEX "Order_isArchived_idx" ON "Order"("isArchived");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderLine_skuId_idx" ON "OrderLine"("skuId");

-- CreateIndex
CREATE INDEX "OrderLine_lineStatus_idx" ON "OrderLine"("lineStatus");

-- CreateIndex
CREATE INDEX "OrderLine_productionBatchId_idx" ON "OrderLine"("productionBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_requestNumber_key" ON "ReturnRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "ReturnRequest_originalOrderId_idx" ON "ReturnRequest"("originalOrderId");

-- CreateIndex
CREATE INDEX "ReturnRequest_customerId_idx" ON "ReturnRequest"("customerId");

-- CreateIndex
CREATE INDEX "ReturnRequest_status_idx" ON "ReturnRequest"("status");

-- CreateIndex
CREATE INDEX "ReturnRequestLine_requestId_idx" ON "ReturnRequestLine"("requestId");

-- CreateIndex
CREATE INDEX "ReturnRequestLine_skuId_idx" ON "ReturnRequestLine"("skuId");

-- CreateIndex
CREATE INDEX "ReturnShipping_requestId_idx" ON "ReturnShipping"("requestId");

-- CreateIndex
CREATE INDEX "ReturnStatusHistory_requestId_idx" ON "ReturnStatusHistory"("requestId");

-- CreateIndex
CREATE INDEX "Feedback_customerId_idx" ON "Feedback"("customerId");

-- CreateIndex
CREATE INDEX "Feedback_status_idx" ON "Feedback"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackContent_feedbackId_key" ON "FeedbackContent"("feedbackId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_batchCode_key" ON "ProductionBatch"("batchCode");

-- CreateIndex
CREATE INDEX "ProductionBatch_skuId_idx" ON "ProductionBatch"("skuId");

-- CreateIndex
CREATE INDEX "ProductionBatch_tailorId_idx" ON "ProductionBatch"("tailorId");

-- CreateIndex
CREATE INDEX "ProductionBatch_batchDate_idx" ON "ProductionBatch"("batchDate");

-- CreateIndex
CREATE INDEX "ProductionBatch_status_idx" ON "ProductionBatch"("status");

-- CreateIndex
CREATE INDEX "StockAlert_skuId_idx" ON "StockAlert"("skuId");

-- CreateIndex
CREATE INDEX "StockAlert_resolved_idx" ON "StockAlert"("resolved");

-- CreateIndex
CREATE INDEX "SyncJob_status_idx" ON "SyncJob"("status");

-- CreateIndex
CREATE INDEX "SyncJob_jobType_idx" ON "SyncJob"("jobType");

-- CreateIndex
CREATE INDEX "SyncJob_createdAt_idx" ON "SyncJob"("createdAt");

-- CreateIndex
CREATE INDEX "ShopifyOrderCache_orderNumber_idx" ON "ShopifyOrderCache"("orderNumber");

-- CreateIndex
CREATE INDEX "ShopifyOrderCache_processedAt_idx" ON "ShopifyOrderCache"("processedAt");

-- CreateIndex
CREATE INDEX "ShopifyOrderCache_lastWebhookAt_idx" ON "ShopifyOrderCache"("lastWebhookAt");

-- CreateIndex
CREATE INDEX "FabricReconciliation_status_idx" ON "FabricReconciliation"("status");

-- CreateIndex
CREATE INDEX "FabricReconciliation_createdAt_idx" ON "FabricReconciliation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FabricReconciliationItem_txnId_key" ON "FabricReconciliationItem"("txnId");

-- CreateIndex
CREATE INDEX "FabricReconciliationItem_reconciliationId_idx" ON "FabricReconciliationItem"("reconciliationId");

-- CreateIndex
CREATE INDEX "FabricReconciliationItem_fabricId_idx" ON "FabricReconciliationItem"("fabricId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_fabricTypeId_fkey" FOREIGN KEY ("fabricTypeId") REFERENCES "FabricType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variation" ADD CONSTRAINT "Variation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variation" ADD CONSTRAINT "Variation_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sku" ADD CONSTRAINT "Sku_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "Variation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuCosting" ADD CONSTRAINT "SkuCosting_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fabric" ADD CONSTRAINT "Fabric_fabricTypeId_fkey" FOREIGN KEY ("fabricTypeId") REFERENCES "FabricType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fabric" ADD CONSTRAINT "Fabric_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricTransaction" ADD CONSTRAINT "FabricTransaction_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricTransaction" ADD CONSTRAINT "FabricTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricTransaction" ADD CONSTRAINT "FabricTransaction_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricOrder" ADD CONSTRAINT "FabricOrder_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricOrder" ADD CONSTRAINT "FabricOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_originalOrderId_fkey" FOREIGN KEY ("originalOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequestLine" ADD CONSTRAINT "ReturnRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ReturnRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequestLine" ADD CONSTRAINT "ReturnRequestLine_originalOrderLineId_fkey" FOREIGN KEY ("originalOrderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequestLine" ADD CONSTRAINT "ReturnRequestLine_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequestLine" ADD CONSTRAINT "ReturnRequestLine_exchangeSkuId_fkey" FOREIGN KEY ("exchangeSkuId") REFERENCES "Sku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnShipping" ADD CONSTRAINT "ReturnShipping_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ReturnRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnStatusHistory" ADD CONSTRAINT "ReturnStatusHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ReturnRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnStatusHistory" ADD CONSTRAINT "ReturnStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRating" ADD CONSTRAINT "FeedbackRating_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackContent" ADD CONSTRAINT "FeedbackContent_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackMedia" ADD CONSTRAINT "FeedbackMedia_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackProductLink" ADD CONSTRAINT "FeedbackProductLink_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackProductLink" ADD CONSTRAINT "FeedbackProductLink_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackTag" ADD CONSTRAINT "FeedbackTag_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_tailorId_fkey" FOREIGN KEY ("tailorId") REFERENCES "Tailor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyInventoryCache" ADD CONSTRAINT "ShopifyInventoryCache_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricReconciliationItem" ADD CONSTRAINT "FabricReconciliationItem_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "FabricReconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricReconciliationItem" ADD CONSTRAINT "FabricReconciliationItem_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
