-- Add Shopify integration fields to Product
ALTER TABLE "Product" ADD COLUMN "shopifyProductId" TEXT;
ALTER TABLE "Product" ADD COLUMN "shopifyHandle" TEXT;

-- Create unique index on shopifyProductId
CREATE UNIQUE INDEX "Product_shopifyProductId_key" ON "Product"("shopifyProductId");

-- Create index on shopifyHandle
CREATE INDEX "Product_shopifyHandle_idx" ON "Product"("shopifyHandle");

-- CreateTable ShopifyProductCache
CREATE TABLE "ShopifyProductCache" (
    "id" TEXT NOT NULL,
    "rawData" TEXT NOT NULL,
    "title" TEXT,
    "handle" TEXT,
    "lastWebhookAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "webhookTopic" TEXT,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopifyProductCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopifyProductCache_handle_idx" ON "ShopifyProductCache"("handle");

-- CreateIndex
CREATE INDEX "ShopifyProductCache_processedAt_idx" ON "ShopifyProductCache"("processedAt");

-- CreateIndex
CREATE INDEX "ShopifyProductCache_lastWebhookAt_idx" ON "ShopifyProductCache"("lastWebhookAt");
