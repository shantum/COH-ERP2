-- Add comprehensive generated columns to ShopifyOrderCache
-- These auto-extract from rawData JSON - no backfill needed!
-- Generated columns are automatically populated from existing rawData

-- ============================================
-- ORDER AMOUNTS
-- ============================================

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "totalPrice" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_price')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "subtotalPrice" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'subtotal_price')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "totalTax" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_tax')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "totalDiscounts" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_discounts')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "totalLineItemsPrice" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_line_items_price')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "totalOutstanding" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_outstanding')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "totalShippingPrice" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'total_shipping_price_set' -> 'shop_money' ->> 'amount')::numeric) STORED;

-- ============================================
-- CUSTOMER INFO (with fallback chains)
-- ============================================

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "customerEmail" TEXT
GENERATED ALWAYS AS (COALESCE(
    (("rawData"::jsonb) ->> 'email'),
    (("rawData"::jsonb) ->> 'contact_email'),
    (("rawData"::jsonb) -> 'customer' ->> 'email')
)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "customerPhone" TEXT
GENERATED ALWAYS AS (COALESCE(
    (("rawData"::jsonb) ->> 'phone'),
    (("rawData"::jsonb) -> 'shipping_address' ->> 'phone'),
    (("rawData"::jsonb) -> 'billing_address' ->> 'phone'),
    (("rawData"::jsonb) -> 'customer' ->> 'phone')
)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "customerFirstName" TEXT
GENERATED ALWAYS AS (COALESCE(
    (("rawData"::jsonb) -> 'customer' ->> 'first_name'),
    (("rawData"::jsonb) -> 'shipping_address' ->> 'first_name'),
    (("rawData"::jsonb) -> 'billing_address' ->> 'first_name')
)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "customerLastName" TEXT
GENERATED ALWAYS AS (COALESCE(
    (("rawData"::jsonb) -> 'customer' ->> 'last_name'),
    (("rawData"::jsonb) -> 'shipping_address' ->> 'last_name'),
    (("rawData"::jsonb) -> 'billing_address' ->> 'last_name')
)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "customerId" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'customer' ->> 'id')) STORED;

-- ============================================
-- SHIPPING ADDRESS (complete)
-- ============================================

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shippingName" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'name')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shippingAddress1" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'address1')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shippingAddress2" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'address2')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shippingZip" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'zip')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shippingPhone" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'phone')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shippingProvince" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'province')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shippingProvinceCode" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'province_code')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shippingCountryCode" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'country_code')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shippingLatitude" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'latitude')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shippingLongitude" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'longitude')::numeric) STORED;

-- ============================================
-- BILLING ADDRESS
-- ============================================

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "billingName" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'billing_address' ->> 'name')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "billingCity" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'billing_address' ->> 'city')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "billingState" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'billing_address' ->> 'province')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "billingZip" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'billing_address' ->> 'zip')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "billingPhone" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'billing_address' ->> 'phone')) STORED;

-- ============================================
-- ORDER TIMESTAMPS (from Shopify) - FIXED
-- Changed to TIMESTAMP (no timezone) for immutability
-- TIMESTAMPTZ is not immutable because it depends on timezone settings
-- ============================================

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shopifyCreatedAt" TIMESTAMP
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'created_at')::timestamp) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shopifyUpdatedAt" TIMESTAMP
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'updated_at')::timestamp) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shopifyProcessedAt" TIMESTAMP
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'processed_at')::timestamp) STORED;

-- Use NULLIF to handle empty strings before casting
ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shopifyClosedAt" TIMESTAMP
GENERATED ALWAYS AS ((NULLIF(("rawData"::jsonb) ->> 'closed_at', ''))::timestamp) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shopifyCancelledAt" TIMESTAMP
GENERATED ALWAYS AS ((NULLIF(("rawData"::jsonb) ->> 'cancelled_at', ''))::timestamp) STORED;

-- ============================================
-- ORDER METADATA
-- ============================================

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "shopifyOrderName" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'name')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "confirmationNumber" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'confirmation_number')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "currency" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'currency')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "sourceName" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'source_name')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "cancelReason" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'cancel_reason')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "paymentGatewayNames" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'payment_gateway_names')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "lineItemCount" INTEGER
GENERATED ALWAYS AS ((jsonb_array_length(("rawData"::jsonb) -> 'line_items'))) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "fulfillmentCount" INTEGER
GENERATED ALWAYS AS (
    CASE WHEN (("rawData"::jsonb) -> 'fulfillments') IS NOT NULL
         THEN (jsonb_array_length(("rawData"::jsonb) -> 'fulfillments'))
         ELSE 0
    END
) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "refundCount" INTEGER
GENERATED ALWAYS AS (
    CASE WHEN (("rawData"::jsonb) -> 'refunds') IS NOT NULL
         THEN (jsonb_array_length(("rawData"::jsonb) -> 'refunds'))
         ELSE 0
    END
) STORED;

-- Boolean flags
ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "isConfirmed" BOOLEAN
GENERATED ALWAYS AS (((("rawData"::jsonb) ->> 'confirmed')::boolean)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "isTaxExempt" BOOLEAN
GENERATED ALWAYS AS (((("rawData"::jsonb) ->> 'tax_exempt')::boolean)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "isTest" BOOLEAN
GENERATED ALWAYS AS (((("rawData"::jsonb) ->> 'test')::boolean)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN IF NOT EXISTS "buyerAcceptsMarketing" BOOLEAN
GENERATED ALWAYS AS (((("rawData"::jsonb) ->> 'buyer_accepts_marketing')::boolean)) STORED;

-- ============================================
-- INDEXES for commonly queried fields
-- ============================================

CREATE INDEX IF NOT EXISTS "ShopifyOrderCache_totalPrice_idx" ON "ShopifyOrderCache" ("totalPrice");
CREATE INDEX IF NOT EXISTS "ShopifyOrderCache_customerEmail_idx" ON "ShopifyOrderCache" ("customerEmail");
CREATE INDEX IF NOT EXISTS "ShopifyOrderCache_shopifyCreatedAt_idx" ON "ShopifyOrderCache" ("shopifyCreatedAt");
