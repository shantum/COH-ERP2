# Order Grid Column Reference

> Complete mapping of every column in the Orders grids to their data sources. **Last updated: January 8, 2026**

---

## Quick Reference: Visible Columns in Archived View

| Column | Database Field | Source | Details |
|--------|---------------|--------|---------|
| **Order** | `Order.orderNumber` | Shopify | `shopifyOrder.name` or `order_number` |
| **Customer** | `Order.customerName` | Shopify | `shippingAddress.first_name + last_name` |
| **City** | Parsed from `Order.shippingAddress` | Shopify | Extracted from JSON shipping address |
| **Items** | `COUNT(OrderLine)` | Order Lines | Number of line items |
| **Total** | `Order.totalAmount` | Shopify | `shopifyOrder.total_price` |
| **Ordered** | `Order.orderDate` | Shopify | `shopifyOrder.created_at` |
| **Shipped** | `Order.shippedAt` | Shopify | `fulfillments[0].created_at` |
| **Delivered** | `Order.deliveredAt` | iThink Tracking | Courier delivery confirmation |
| **Del Days** | Computed | Frontend | `deliveredAt - shippedAt` in days |
| **Archived** | `Order.archivedAt` | ERP | Manual archive or auto-archive (>90 days) |

---

## Data Sources Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Shopify      │     │  iThink/Courier │     │   ERP Actions   │
│    API/Sync     │     │   Tracking API  │     │   (User Input)  │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Order Table                               │
│  orderNumber, customerName, totalAmount, status, shippedAt...   │
└─────────────────────────────────────────────────────────────────┘
         │
         ├──────────────────┐
         ▼                  ▼
┌─────────────────┐  ┌─────────────────┐
│ ShopifyOrderCache│  │   OrderLine     │
│ (raw Shopify)   │  │ (fulfillment)   │
└─────────────────┘  └─────────────────┘
```

---

## Column Details by Category

### 1. Order & Customer Info

| Column | DB Field | Source | Origin Details |
|--------|----------|--------|----------------|
| Order Number | `Order.orderNumber` | Shopify Sync | `shopifyOrderProcessor.js:256` - from `shopifyOrder.name` |
| Customer Name | `Order.customerName` | Shopify Sync | Constructed from shipping address or customer object |
| Customer Email | `Order.customerEmail` | Shopify Sync | `shopifyOrder.email` or `customer.email` |
| Customer Phone | `Order.customerPhone` | Shopify Sync | `shippingAddress.phone` or `customer.phone` |
| City | Parsed from `shippingAddress` | Shopify Sync | JSON field, extracted via `parseCity()` helper |
| State | Parsed from `shippingAddress` | Shopify Sync | JSON field |
| Pincode | Parsed from `shippingAddress` | Shopify Sync | JSON field |
| Channel | `Order.channel` | Shopify Sync | Mapped from Shopify tags or default 'shopify' |

### 2. Financial Data

| Column | DB Field | Source | Origin Details |
|--------|----------|--------|----------------|
| Total Amount | `Order.totalAmount` | Shopify Sync | `parseFloat(shopifyOrder.total_price)` |
| Discount Code | `ShopifyOrderCache.discountCodes` | Shopify Cache | `shopifyOrder.discount_codes[].code` joined |
| Payment Method | `ShopifyOrderCache.paymentMethod` | Shopify Cache | Derived from `payment_gateway_names` |
| Financial Status | `ShopifyOrderCache.financialStatus` | Shopify Cache | paid, pending, refunded, etc. |
| COD Amount | `Order.codAmount` | Shopify Sync | Total when payment method is COD |
| COD Remitted At | `Order.codRemittedAt` | Remittance Upload | Set when COD payment CSV processed |
| COD UTR | `Order.codUtr` | Remittance Upload | Bank reference from CSV |

### 3. Timestamps

| Column | DB Field | Source | Origin Details |
|--------|----------|--------|----------------|
| Order Date | `Order.orderDate` | Shopify Sync | `shopifyOrder.created_at` |
| Shipped At | `Order.shippedAt` | Shopify Sync | `fulfillments[0].created_at` |
| Delivered At | `Order.deliveredAt` | iThink Tracking | Courier API delivery timestamp |
| Archived At | `Order.archivedAt` | ERP Action | Manual or auto-archive (server startup >90 days) |
| RTO Initiated At | `Order.rtoInitiatedAt` | iThink Tracking | When courier marks RTO |
| RTO Received At | `Order.rtoReceivedAt` | ERP Action | When RTO physically received |
| Created At | `Order.createdAt` | Database | Auto-generated on insert |

### 4. Shipping & Tracking

| Column | DB Field | Source | Origin Details |
|--------|----------|--------|----------------|
| AWB Number | `Order.awbNumber` | Shopify Sync | `fulfillments[0].tracking_number` |
| Courier | `Order.courier` | Shopify Sync | `fulfillments[0].tracking_company` |
| Tracking Status | `Order.trackingStatus` | iThink Tracking | in_transit, out_for_delivery, delivered, rto_* |
| Last Scan Location | `Order.lastScanLocation` | iThink Tracking | Latest courier scan location |
| Last Scan At | `Order.lastScanAt` | iThink Tracking | Timestamp of last scan |
| Is RTO | `Order.isRto` | iThink Tracking | Boolean, set when RTO detected |
| Shopify Status | `ShopifyOrderCache.fulfillmentStatus` | Shopify Cache | unfulfilled, fulfilled, partial |

### 5. Order Line Fields (Per-Item)

| Column | DB Field | Source | Origin Details |
|--------|----------|--------|----------------|
| SKU Code | `OrderLine.sku.skuCode` | Product Catalog | Matched from Shopify variant |
| Product Name | `Sku.variation.product.name` | Product Catalog | Via SKU -> Variation -> Product |
| Quantity | `OrderLine.qty` | Shopify Sync | `line_item.quantity` |
| Line Status | `OrderLine.lineStatus` | ERP Workflow | pending, allocated, picked, packed, shipped |
| Is Customized | `OrderLine.isCustomized` | ERP | User-marked customization |
| Customization Notes | `OrderLine.customizationNotes` | ERP | User-entered notes |
| Notes | `OrderLine.notes` | ERP | General line notes |
| Production Batch | `OrderLine.productionBatchId` | ERP | Link to ProductionBatch |

### 6. Computed/Enriched Fields

| Column | Computation | Source | Details |
|--------|-------------|--------|---------|
| Order Age | `now() - orderDate` | Frontend | Days since order placed |
| Delivery Days | `deliveredAt - shippedAt` | Frontend | Transit time in days |
| Days in RTO | `now() - rtoInitiatedAt` | API Enrichment | RTO duration |
| Days Since Delivery | `now() - deliveredAt` | API Enrichment | For COD pending view |
| SKU Stock | `SUM(inward) - SUM(outward)` | Inventory System | `calculateInventoryBalance()` |
| Fabric Balance | `SUM(inward) - SUM(outward)` | Fabric System | For SKU's assigned fabric |
| Customer Order Count | `COUNT(orders)` | API Enrichment | Total orders by customer |
| Customer LTV | `SUM(totalAmount)` | API Enrichment | Lifetime value |
| Fulfillment Stage | Derived from line statuses | API Enrichment | Order-level progress indicator |

---

## Source Files Reference

| Source | File | Purpose |
|--------|------|---------|
| Shopify Sync | `server/src/services/shopifyOrderProcessor.js` | Maps Shopify API to Order table |
| Tracking Sync | `server/src/services/trackingSync.js` | Updates tracking fields from iThink |
| Enrichment | `server/src/utils/orderViews.js` | Adds computed fields per view |
| Query Patterns | `server/src/utils/queryPatterns.js` | Customer stats, inventory lookups |
| Grid Display | `client/src/components/orders/OrdersGrid.tsx` | Column definitions, formatters |
| Archived Grid | `client/src/components/orders/ArchivedOrdersGrid.tsx` | Archived-specific columns |

---

## Database Schema (Key Fields)

```prisma
model Order {
  // Identity
  id              String    @id @default(uuid())
  orderNumber     String    @unique
  shopifyOrderId  String?   @unique

  // Customer
  customerName    String
  customerEmail   String?
  customerPhone   String?
  shippingAddress Json?

  // Financial
  totalAmount     Float
  codAmount       Float?
  codRemittedAt   DateTime?
  codUtr          String?

  // Status
  status          String    @default("open")  // open, shipped, delivered, cancelled
  isArchived      Boolean   @default(false)
  archivedAt      DateTime?

  // Shipping
  awbNumber       String?
  courier         String?
  shippedAt       DateTime?
  deliveredAt     DateTime?

  // Tracking
  trackingStatus  String?
  lastScanLocation String?
  lastScanAt      DateTime?
  isRto           Boolean   @default(false)
  rtoInitiatedAt  DateTime?
  rtoReceivedAt   DateTime?

  // Timestamps
  orderDate       DateTime
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // Relations
  lines           OrderLine[]
  shopifyCache    ShopifyOrderCache?
}
```

---

## Grid Column Visibility

Users can customize visible columns. Defaults stored in `orderHelpers.ts`:

```typescript
DEFAULT_HEADERS = [
  'orderDate', 'orderNumber', 'customerName', 'city',
  'skuCode', 'productName', 'qty', 'skuStock',
  'allocate', 'production', 'pick', 'pack', 'ship'
]
```

Persistence:
- Visible columns: `localStorage.ordersGridVisibleColumns`
- Column order: `localStorage.ordersGridColumnOrder`
- Custom headers: `localStorage.ordersGridHeaders`
