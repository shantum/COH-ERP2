# Shopify Sync System Documentation

> **Complete guide to understanding how the ERP system synchronizes data with Shopify**

This document explains the entire Shopify synchronization system in simple, easy-to-understand language. It covers how products, orders, and customers flow between your Shopify store and the ERP system.

---

## Table of Contents

1. [Overview - What is Shopify Sync?](#overview---what-is-shopify-sync)
2. [The Cache-First Architecture](#the-cache-first-architecture)
3. [How Products Sync](#how-products-sync)
4. [How Orders Sync](#how-orders-sync)
5. [How Customers Sync](#how-customers-sync)
6. [Real-Time Updates (Webhooks)](#real-time-updates-webhooks)
7. [Background Jobs & Scheduler](#background-jobs--scheduler)
8. [Database Storage](#database-storage)
9. [Settings & Configuration](#settings--configuration)
10. [Common Operations Guide](#common-operations-guide)
11. [Troubleshooting](#troubleshooting)

---

## Overview - What is Shopify Sync?

The Shopify Sync system is the bridge between your Shopify online store and the ERP (Enterprise Resource Planning) system. It ensures that:

- **Products** in Shopify become SKUs in the ERP
- **Orders** from Shopify appear in the ERP for processing
- **Customers** from Shopify are tracked in the ERP
- **Inventory levels** stay synchronized
- **Order status updates** (shipped, delivered, cancelled) flow both ways

### The Key Principle: "Cache First"

The system follows a **"Cache First"** approach:

```
Shopify Store → Cache (temporary storage) → ERP System
```

This means:
1. First, data from Shopify is stored in a temporary holding area (cache)
2. Then, the cached data is processed and converted into ERP records
3. This two-step process ensures reliability - even if processing fails, the raw data is never lost

---

## The Cache-First Architecture

### Why Use a Cache?

Imagine you have 10,000 orders coming from Shopify. Processing all of them at once would:
- Take a very long time
- Risk losing some data if something fails
- Overload the database

With the cache approach:
- **Step 1 (Cache)**: Quickly store all raw Shopify data (this is fast and safe)
- **Step 2 (Process)**: Convert cached data to ERP format at your own pace (can retry if fails)

### The Three Cache Tables

| Cache Table | What It Stores | Purpose |
|-------------|----------------|---------|
| `ShopifyOrderCache` | Raw order data from Shopify | Holds all order details before processing |
| `ShopifyProductCache` | Raw product data from Shopify | Holds product/SKU info before processing |
| `ShopifyInventoryCache` | Inventory levels per SKU | Tracks what Shopify thinks is in stock |

### Cache Entry Status

Each cache entry has a status that tells you where it is in the process:

| Status | Meaning |
|--------|---------|
| **Pending** | Received from Shopify, waiting to be processed |
| **Processed** | Successfully converted to ERP record |
| **Failed** | Processing failed (error message stored) |

---

## How Products Sync

### What Gets Synced?

When you sync products from Shopify:

```
Shopify Product → ERP Product
  └── Variants   → ERP Variations + SKUs
```

**Example:**
```
Shopify: "Classic Cotton Shirt"
  ├── White / S (SKU: CSH-WHT-S)
  ├── White / M (SKU: CSH-WHT-M)
  └── Blue / S (SKU: CSH-BLU-S)

Becomes in ERP:
Product: "Classic Cotton Shirt"
  ├── Variation: White
  │     ├── SKU: CSH-WHT-S (Size S)
  │     └── SKU: CSH-WHT-M (Size M)
  └── Variation: Blue
        └── SKU: CSH-BLU-S (Size S)
```

### How Product Sync Works

1. **Fetch**: System pulls all products from Shopify API
2. **Cache**: Products are stored in `ShopifyProductCache`
3. **Process**: Each product is matched or created:
   - Match by `shopifyProductId` (if already synced before)
   - Match by product name + attributes (for new products)
   - Create new if no match found
4. **Link**: Products, Variations, and SKUs are linked to their Shopify IDs

### Starting a Product Sync

From the **Settings → Shopify** tab:
1. Click **"Preview"** to see what's in Shopify
2. Click **"Sync All Products"** to start the sync

**What happens:**
- Creates new products that don't exist
- Updates existing products with new information
- Creates new SKUs for new variants
- Links SKUs to their Shopify Variant IDs and Inventory Item IDs

---

## How Orders Sync

Order sync is the most important part of the system. Here's how it works:

### Order Sync Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    ORDER SYNC FLOW                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  SHOPIFY                    CACHE                  ERP      │
│  ────────                   ─────                  ───      │
│                                                             │
│  New Order ──────────────→ ShopifyOrderCache               │
│              (Webhook or     (Raw JSON stored)              │
│               Full Dump)           │                        │
│                                    │                        │
│                                    ↓                        │
│                              Process Cache ──────→ Order    │
│                              (Convert to ERP)     OrderLines│
│                                    │                        │
│                                    ↓                        │
│                              Mark Processed                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Two Ways Orders Enter the System

#### 1. Real-Time Webhooks (Automatic)
When a customer places an order on Shopify:
- Shopify immediately sends a "webhook" to the ERP
- The order is cached and processed within seconds
- **This is the primary method for day-to-day operations**

#### 2. Full Dump (Manual)
For historical orders or catching missing ones:
- You click "Full Dump" in Settings
- System fetches all orders from the selected time period
- All orders are cached, then processed
- **Use this for initial setup or troubleshooting**

### What Data Comes with an Order?

| Order Field | What It Means |
|-------------|---------------|
| `orderNumber` | The "#1234" format order number |
| `customerName` | Who placed the order |
| `customerEmail` | Customer's email address |
| `customerPhone` | Customer's phone number |
| `shippingAddress` | Where to ship the order |
| `totalAmount` | Order total in ₹ |
| `paymentMethod` | COD (Cash on Delivery) or Prepaid |
| `financialStatus` | paid, pending, refunded, etc. |
| `fulfillmentStatus` | unfulfilled, fulfilled, partial |
| `discountCodes` | Any discount codes used |
| `tags` | Shopify order tags |

### Order Line Items

Each order can have multiple line items (products ordered):

| Line Item Field | What It Means |
|-----------------|---------------|
| `skuId` | Links to the SKU in your catalog |
| `qty` | How many were ordered |
| `unitPrice` | Price per unit (after discounts) |
| `lineStatus` | pending, allocated, picked, shipped, etc. |
| `awbNumber` | Tracking number (if shipped) |
| `courier` | Which courier company |

### Payment Method Detection

The system automatically detects whether an order is **COD** or **Prepaid**:

- If payment gateway is "cash_on_delivery" → **COD**
- If order is paid via Razorpay, Stripe, etc. → **Prepaid**
- **Once marked COD, it stays COD** (even after payment is received)

This helps in COD remittance tracking and carrier preference.

---

## How Customers Sync

### What Gets Synced?

| Shopify Field | ERP Field |
|---------------|-----------|
| `id` | `shopifyCustomerId` |
| `email` | `email` |
| `phone` | `phone` |
| `first_name` | `firstName` |
| `last_name` | `lastName` |
| `default_address` | `defaultAddress` |
| `accepts_marketing` | `acceptsMarketing` |
| `tags` | `tags` |

### Customer Sync Rules

- **Only customers with at least 1 order are synced** (to avoid syncing empty accounts)
- Customers are matched by `shopifyCustomerId` or `email`
- Existing customers are updated, new ones are created

---

## Real-Time Updates (Webhooks)

Webhooks are automatic notifications from Shopify whenever something changes.

### Webhook Endpoints

The ERP listens for these Shopify events:

| Endpoint | Shopify Topics | When It's Triggered |
|----------|----------------|---------------------|
| `/api/webhooks/shopify/orders` | orders/create, orders/updated, orders/cancelled, orders/fulfilled | Any order change |
| `/api/webhooks/shopify/products` | products/create, products/update, products/delete | Any product change |
| `/api/webhooks/shopify/customers` | customers/create, customers/update | Any customer change |

### How Webhooks Work

```
Customer places order on Shopify
         │
         ↓
Shopify sends webhook to ERP
         │
         ↓
ERP verifies webhook signature (security)
         │
         ↓
ERP caches the order data
         │
         ↓
ERP processes order to create/update records
         │
         ↓
ERP responds "200 OK" to Shopify
```

### Security: HMAC Verification

Each webhook includes a signature (HMAC) that proves it really came from Shopify:
- The ERP checks this signature using your Shopify webhook secret
- Invalid signatures are rejected (protects against fake webhooks)

### Duplicate Prevention

A single order might trigger multiple webhooks. The system handles this:
- Each webhook has a unique ID (`X-Shopify-Webhook-Id`)
- If the same webhook ID is seen twice, it's ignored
- This prevents duplicate processing

---

## Background Jobs & Scheduler

### The Scheduler

The ERP has an automatic scheduler that runs periodic syncs:

| Setting | Default | What It Does |
|---------|---------|--------------|
| **Interval** | 60 minutes | How often the sync runs |
| **Lookback** | 24 hours | How far back to check for orders |

### What the Scheduler Does

Every hour (by default):
1. **Fetches recent orders** from Shopify (last 24 hours)
2. **Caches them** in `ShopifyOrderCache`
3. **Processes pending cache entries** to ERP

This catches any orders that webhooks might have missed.

### Scheduler Controls

From Settings → Shopify:
- **Start/Stop** the scheduler
- **Trigger Now** to run immediately
- **View Status** (last run, next run, results)

### The Cache Processor

A separate background process that:
- Continuously watches for pending cache entries
- Processes them to ERP in batches
- Retries failed entries periodically

### Sync Jobs

For large operations, the system creates trackable "jobs":

| Job Status | Meaning |
|------------|---------|
| **pending** | Job is waiting to start |
| **running** | Job is currently processing |
| **completed** | Job finished successfully |
| **failed** | Job encountered errors |
| **cancelled** | Job was manually cancelled |

Jobs can be:
- **Paused** and resumed
- **Cancelled** if needed
- **Monitored** for progress (records processed, errors)

---

## Database Storage

### Key Tables

#### ShopifyOrderCache
Stores raw order data from Shopify:
```
id: "12345678901234" (Shopify order ID)
rawData: { full JSON from Shopify }
orderNumber: "#1234"
financialStatus: "paid"
fulfillmentStatus: "unfulfilled"
paymentMethod: "COD" or "Prepaid"
processedAt: null (pending) or timestamp (done)
processingError: null (ok) or "error message"
```

#### ShopifyProductCache
Stores raw product data:
```
id: "9876543210"
rawData: { full product JSON }
title: "Classic Cotton Shirt"
handle: "classic-cotton-shirt"
processedAt: timestamp
```

#### ShopifyInventoryCache
Tracks inventory per SKU:
```
skuId: "sku-uuid-here"
shopifyInventoryItemId: "98765432"
availableQty: 15
lastSynced: timestamp
```

#### SyncJob
Tracks long-running sync operations:
```
id: "job-uuid"
jobType: "orders" / "customers" / "products"
status: "running"
processed: 450
created: 200
updated: 245
skipped: 5
errors: 0
```

### Linking ERP Records to Shopify

| ERP Table | Shopify Link Field |
|-----------|-------------------|
| Order | `shopifyOrderId` |
| Product | `shopifyProductId`, `shopifyProductIds[]` |
| Variation | `shopifySourceProductId` |
| Sku | `shopifyVariantId`, `shopifyInventoryItemId` |
| Customer | `shopifyCustomerId` |
| OrderLine | `shopifyLineId` |

---

## Settings & Configuration

### Required Settings

| Setting | Where to Set |
|---------|--------------|
| **Shop Domain** | Environment variable or Settings page |
| **Access Token** | Environment variable (secure!) |
| **Webhook Secret** | Environment variable |
| **API Version** | Defaults to 2024-01 |

### Environment Variables

```
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxx
SHOPIFY_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

### Webhook Configuration in Shopify

1. Go to Shopify Admin → Settings → Notifications → Webhooks
2. Add webhooks for each endpoint:
   - `orders/create` → `https://your-erp.com/api/webhooks/shopify/orders`
   - `orders/updated` → same URL
   - `orders/cancelled` → same URL
   - `orders/fulfilled` → same URL
   - `products/create` → `https://your-erp.com/api/webhooks/shopify/products`
   - `products/update` → same URL
   - `customers/create` → `https://your-erp.com/api/webhooks/shopify/customers`
   - `customers/update` → same URL

---

## Common Operations Guide

### Initial Setup (First Time)

1. **Configure Shopify Connection**
   - Set environment variables with your shop credentials
   - Verify connection in Settings → Shopify

2. **Sync Products First**
   - Click "Sync All Products"
   - Wait for completion
   - Verify products and SKUs appear in Catalog

3. **Full Dump Orders**
   - Select time period (e.g., "Last 90 days")
   - Click "Start Full Dump"
   - Wait for caching to complete

4. **Process Cache**
   - Click "Process Pending"
   - Repeat until all entries are processed

5. **Configure Webhooks**
   - Copy webhook URLs from Settings
   - Add them in Shopify Admin
   - Test by creating a test order

6. **Start Scheduler**
   - Enable the scheduler for ongoing sync
   - Set interval and lookback as needed

### Daily Operations

- **Check Sync Status**: View cache status in Settings → Shopify
- **Monitor Webhooks**: Check "Real-Time Sync Status" for recent activity
- **Process Failed**: Retry any failed cache entries

### Catching Missing Orders

If you think orders are missing:

1. **Check Cache Status**
   - Are there pending entries? Process them.
   - Are there failed entries? Check errors and retry.

2. **Run Full Dump**
   - Select appropriate time period
   - This will re-fetch and update any missing orders

3. **Check Scheduler**
   - Is it running? When was last sync?
   - Try triggering a manual sync

### Troubleshooting Sync Issues

| Problem | Solution |
|---------|----------|
| Orders not appearing | Check webhooks are configured; do a Full Dump |
| SKU not found errors | Sync products first before orders |
| Duplicate orders | System handles this automatically via deduplication |
| Wrong payment method | Order was marked before payment; check cache for updates |

---

## Troubleshooting

### Understanding Error Messages

| Error | Meaning | Solution |
|-------|---------|----------|
| "Shopify is not configured" | Missing credentials | Check environment variables |
| "SKU not found" | Product sync missing | Run product sync first |
| "Rate limited" | Too many API requests | System will auto-retry |
| "HMAC verification failed" | Webhook signature invalid | Check webhook secret |
| "Order already exists" | Duplicate processing | Safe to ignore |

### Cache Entry Errors

If a cache entry fails to process:

1. **View the error**: Check `processingError` field
2. **Fix the cause**: Often a missing SKU or data issue
3. **Retry**: Click "Retry Failed" button

### When to Contact Support

- Persistent webhook failures
- Systematic SKU matching errors
- Database connection issues
- Shopify API access problems

---

## System Architecture Summary

```
┌──────────────────────────────────────────────────────────────────┐
│                     SHOPIFY SYNC ARCHITECTURE                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   SHOPIFY                                                        │
│   ════════                                                       │
│   ┌──────────┐     Webhooks (Real-time)                         │
│   │ Products │ ───────────────────────────────────┐             │
│   │ Orders   │                                     │             │
│   │ Customers│ ───── API Fetch (Manual/Scheduled)──┐             │
│   └──────────┘                                     │ │           │
│                                                    │ │           │
│   ERP SERVER                                       │ │           │
│   ══════════                                       ↓ ↓           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                    CACHE LAYER                           │   │
│   │  ┌─────────────────┐ ┌─────────────────┐                │   │
│   │  │ShopifyOrderCache│ │ShopifyProductCache                │   │
│   │  │(raw JSON stored)│ │(raw JSON stored)│                │   │
│   │  └────────┬────────┘ └────────┬────────┘                │   │
│   └───────────│───────────────────│─────────────────────────┘   │
│               │                   │                              │
│               ↓                   ↓                              │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                 ORDER PROCESSOR                          │   │
│   │  Shared Helpers (single source of truth):               │   │
│   │  - buildCustomerData() → Extract customer info          │   │
│   │  - determineOrderStatus() → ERP precedence rules        │   │
│   │  - buildOrderData() → Complete order payload            │   │
│   │  - createOrderLinesData() → SKU lookup abstraction      │   │
│   │  - handleExistingOrderUpdate() → Update flow            │   │
│   │  - createNewOrderWithLines() → Create flow              │   │
│   │                                                          │   │
│   │  Entry Points:                                           │   │
│   │  - processShopifyOrderToERP() (webhooks, DB lookups)    │   │
│   │  - processOrderWithContext() (batch, O(1) Map lookups)  │   │
│   └────────┬─────────────────────┬──────────────────────────┘   │
│            │                     │                              │
│            ↓                     ↓                              │
│   ┌────────────────┐    ┌───────────────┐    ┌───────────┐     │
│   │   Orders       │    │   Products    │    │ Customers │     │
│   │   OrderLines   │    │   Variations  │    │           │     │
│   │                │    │   SKUs        │    │           │     │
│   └────────────────┘    └───────────────┘    └───────────┘     │
│                                                                  │
│   BACKGROUND SERVICES                                            │
│   ═══════════════════                                           │
│   ┌───────────────┐  ┌────────────────┐  ┌─────────────────┐   │
│   │  Scheduler    │  │ Cache Processor│  │ Sync Worker     │   │
│   │ (hourly sync) │  │ (batch process)│  │ (job management)│   │
│   └───────────────┘  └────────────────┘  └─────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/shopify/sync/products` | POST | Sync products from Shopify |
| `/api/shopify/sync/customers` | POST | Sync customers from Shopify |
| `/api/shopify/sync/full-dump` | POST | Full order dump from Shopify |
| `/api/shopify/sync/process-cache` | POST | Process pending cache entries |
| `/api/shopify/sync/backfill` | POST | Backfill missing data fields |
| `/api/shopify/cache/cache-status` | GET | Get order cache statistics |
| `/api/shopify/jobs/start` | POST | Start a background sync job |
| `/api/shopify/jobs/scheduler/status` | GET | Get scheduler status |

### Key Files (For Developers)

| File | Purpose |
|------|---------|
| `server/src/services/shopify.ts` | Shopify API client |
| `server/src/services/shopifyOrderProcessor.ts` | Order processing logic (shared helpers + entry points) |
| `server/src/routes/webhooks.ts` | Webhook handlers |
| `server/src/routes/shopify/sync.ts` | Sync API endpoints |
| `server/src/routes/shopify/jobs.ts` | Background job endpoints |
| `server/src/routes/shopify/cache.ts` | Cache management endpoints |
| `client/src/components/settings/tabs/ShopifyTab.tsx` | Settings UI |

### Order Processor Architecture

The `shopifyOrderProcessor.ts` uses shared helper functions to eliminate duplication:

**Shared Helpers:**
- `buildCustomerData()` - Extract ShopifyCustomerData from order
- `determineOrderStatus()` - Calculate status with ERP precedence
- `extractOrderTrackingInfo()` - Get tracking from fulfillments
- `buildOrderData()` - Build complete order data payload
- `detectOrderChanges()` - Check if existing order needs update
- `createOrderLinesData()` - Build order lines with SKU lookup abstraction
- `handleExistingOrderUpdate()` - Process update for existing orders
- `createNewOrderWithLines()` - Create order with post-processing

**Entry Points:**
- `processShopifyOrderToERP()` - For webhooks/single orders (DB-based SKU lookups)
- `processOrderWithContext()` - For batch processing (Map-based O(1) SKU lookups)

---

*Last Updated: January 2026*
