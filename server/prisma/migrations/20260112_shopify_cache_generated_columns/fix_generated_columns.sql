-- Fix: Drop regular columns and recreate as generated columns
-- The columns were created as regular nullable columns by Prisma db push
-- We need to drop them and recreate as GENERATED columns

-- ============================================
-- DROP EXISTING COLUMNS (created by Prisma)
-- ============================================

ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "totalPrice";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "subtotalPrice";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "totalTax";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "totalDiscounts";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "totalLineItemsPrice";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "totalOutstanding";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "totalShippingPrice";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "customerEmail";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "customerPhone";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "customerFirstName";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "customerLastName";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "customerId";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shippingName";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shippingAddress1";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shippingAddress2";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shippingZip";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shippingPhone";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shippingProvince";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shippingProvinceCode";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shippingCountryCode";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shippingLatitude";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shippingLongitude";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "billingName";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "billingCity";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "billingState";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "billingZip";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "billingPhone";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shopifyCreatedAt";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shopifyUpdatedAt";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shopifyProcessedAt";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shopifyClosedAt";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shopifyCancelledAt";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "shopifyOrderName";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "confirmationNumber";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "currency";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "sourceName";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "cancelReason";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "paymentGatewayNames";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "lineItemCount";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "fulfillmentCount";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "refundCount";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "isConfirmed";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "isTaxExempt";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "isTest";
ALTER TABLE "ShopifyOrderCache" DROP COLUMN IF EXISTS "buyerAcceptsMarketing";

-- ============================================
-- RECREATE AS GENERATED COLUMNS
-- ============================================

-- Order amounts
ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "totalPrice" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_price')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "subtotalPrice" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'subtotal_price')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "totalTax" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_tax')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "totalDiscounts" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_discounts')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "totalLineItemsPrice" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_line_items_price')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "totalOutstanding" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'total_outstanding')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "totalShippingPrice" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'total_shipping_price_set' -> 'shop_money' ->> 'amount')::numeric) STORED;

-- Customer info
ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "customerEmail" TEXT
GENERATED ALWAYS AS (COALESCE(
    (("rawData"::jsonb) ->> 'email'),
    (("rawData"::jsonb) ->> 'contact_email'),
    (("rawData"::jsonb) -> 'customer' ->> 'email')
)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "customerPhone" TEXT
GENERATED ALWAYS AS (COALESCE(
    (("rawData"::jsonb) ->> 'phone'),
    (("rawData"::jsonb) -> 'shipping_address' ->> 'phone'),
    (("rawData"::jsonb) -> 'billing_address' ->> 'phone'),
    (("rawData"::jsonb) -> 'customer' ->> 'phone')
)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "customerFirstName" TEXT
GENERATED ALWAYS AS (COALESCE(
    (("rawData"::jsonb) -> 'customer' ->> 'first_name'),
    (("rawData"::jsonb) -> 'shipping_address' ->> 'first_name'),
    (("rawData"::jsonb) -> 'billing_address' ->> 'first_name')
)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "customerLastName" TEXT
GENERATED ALWAYS AS (COALESCE(
    (("rawData"::jsonb) -> 'customer' ->> 'last_name'),
    (("rawData"::jsonb) -> 'shipping_address' ->> 'last_name'),
    (("rawData"::jsonb) -> 'billing_address' ->> 'last_name')
)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "customerId" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'customer' ->> 'id')) STORED;

-- Shipping address
ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shippingName" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'name')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shippingAddress1" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'address1')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shippingAddress2" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'address2')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shippingZip" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'zip')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shippingPhone" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'phone')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shippingProvince" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'province')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shippingProvinceCode" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'province_code')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shippingCountryCode" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'country_code')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shippingLatitude" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'latitude')::numeric) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shippingLongitude" NUMERIC
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'shipping_address' ->> 'longitude')::numeric) STORED;

-- Billing address
ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "billingName" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'billing_address' ->> 'name')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "billingCity" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'billing_address' ->> 'city')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "billingState" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'billing_address' ->> 'province')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "billingZip" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'billing_address' ->> 'zip')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "billingPhone" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) -> 'billing_address' ->> 'phone')) STORED;

-- Order timestamps
ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shopifyCreatedAt" TIMESTAMP WITH TIME ZONE
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'created_at')::timestamptz) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shopifyUpdatedAt" TIMESTAMP WITH TIME ZONE
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'updated_at')::timestamptz) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shopifyProcessedAt" TIMESTAMP WITH TIME ZONE
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'processed_at')::timestamptz) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shopifyClosedAt" TIMESTAMP WITH TIME ZONE
GENERATED ALWAYS AS (
    CASE WHEN (("rawData"::jsonb) ->> 'closed_at') IS NOT NULL AND (("rawData"::jsonb) ->> 'closed_at') != ''
         THEN ((("rawData"::jsonb) ->> 'closed_at')::timestamptz)
         ELSE NULL
    END
) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shopifyCancelledAt" TIMESTAMP WITH TIME ZONE
GENERATED ALWAYS AS (
    CASE WHEN (("rawData"::jsonb) ->> 'cancelled_at') IS NOT NULL AND (("rawData"::jsonb) ->> 'cancelled_at') != ''
         THEN ((("rawData"::jsonb) ->> 'cancelled_at')::timestamptz)
         ELSE NULL
    END
) STORED;

-- Order metadata
ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "shopifyOrderName" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'name')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "confirmationNumber" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'confirmation_number')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "currency" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'currency')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "sourceName" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'source_name')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "cancelReason" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'cancel_reason')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "paymentGatewayNames" TEXT
GENERATED ALWAYS AS ((("rawData"::jsonb) ->> 'payment_gateway_names')) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "lineItemCount" INTEGER
GENERATED ALWAYS AS ((jsonb_array_length(("rawData"::jsonb) -> 'line_items'))) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "fulfillmentCount" INTEGER
GENERATED ALWAYS AS (
    CASE WHEN (("rawData"::jsonb) -> 'fulfillments') IS NOT NULL
         THEN (jsonb_array_length(("rawData"::jsonb) -> 'fulfillments'))
         ELSE 0
    END
) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "refundCount" INTEGER
GENERATED ALWAYS AS (
    CASE WHEN (("rawData"::jsonb) -> 'refunds') IS NOT NULL
         THEN (jsonb_array_length(("rawData"::jsonb) -> 'refunds'))
         ELSE 0
    END
) STORED;

-- Boolean flags
ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "isConfirmed" BOOLEAN
GENERATED ALWAYS AS (((("rawData"::jsonb) ->> 'confirmed')::boolean)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "isTaxExempt" BOOLEAN
GENERATED ALWAYS AS (((("rawData"::jsonb) ->> 'tax_exempt')::boolean)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "isTest" BOOLEAN
GENERATED ALWAYS AS (((("rawData"::jsonb) ->> 'test')::boolean)) STORED;

ALTER TABLE "ShopifyOrderCache"
ADD COLUMN "buyerAcceptsMarketing" BOOLEAN
GENERATED ALWAYS AS (((("rawData"::jsonb) ->> 'buyer_accepts_marketing')::boolean)) STORED;

-- Indexes
CREATE INDEX IF NOT EXISTS "ShopifyOrderCache_totalPrice_idx" ON "ShopifyOrderCache" ("totalPrice");
CREATE INDEX IF NOT EXISTS "ShopifyOrderCache_customerEmail_idx" ON "ShopifyOrderCache" ("customerEmail");
CREATE INDEX IF NOT EXISTS "ShopifyOrderCache_shopifyCreatedAt_idx" ON "ShopifyOrderCache" ("shopifyCreatedAt");
