# COH-ERP2 Orders System - Complete Documentation

> **For:** All Users | **Last Updated:** January 2026  
> This document explains how orders work in the COH-ERP2 system in simple, easy-to-understand language.

---

## Table of Contents

1. [What is the Orders System?](#1-what-is-the-orders-system)
2. [The Order Lifecycle](#2-the-order-lifecycle)
3. [Order Views - Your Different Workspaces](#3-order-views---your-different-workspaces)
4. [Understanding Order Status](#4-understanding-order-status)
5. [Order Line Status - The Heart of the System](#5-order-line-status---the-heart-of-the-system)
6. [Creating Orders](#6-creating-orders)
7. [The Fulfillment Process](#7-the-fulfillment-process)
8. [Shipping Orders](#8-shipping-orders)
9. [Post-Shipping: Tracking and Delivery](#9-post-shipping-tracking-and-delivery)
10. [Handling Problems: RTO and Cancellations](#10-handling-problems-rto-and-cancellations)
11. [Payments and COD](#11-payments-and-cod)
12. [Archiving Orders](#12-archiving-orders)
13. [The Orders Grid](#13-the-orders-grid)
14. [Data Structure Overview](#14-data-structure-overview)
15. [Quick Reference](#15-quick-reference)
16. [Technical Codemap](#16-technical-codemap)

---

## 1. What is the Orders System?

The Orders System is the **central hub** for managing customer orders from the moment they're placed until they're completed. Think of it as a smart spreadsheet that:

- 📦 Tracks every order and what items are in it
- 🔄 Monitors where each item is in the fulfillment process
- 📊 Shows you different views based on what you need to focus on
- 💰 Manages payments and Cash on Delivery (COD)
- 🚚 Integrates with shipping couriers for tracking

### Key Concept: Orders vs Order Lines

Every order consists of:
- **Order (Header):** Customer info, shipping address, payment method, totals
- **Order Lines:** Individual items in the order (each product/size/color is a line)

> **Example:** A customer orders 2 t-shirts and 1 pair of jeans = 1 Order with 3 Order Lines

---

## 2. The Order Lifecycle

An order moves through these stages from start to finish:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   CREATED   │ ──▶ │  FULFILLING │ ──▶ │   SHIPPED   │ ──▶ │  DELIVERED  │
│  (pending)  │     │ (in progress)│    │ (in transit)│     │   (done!)   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                                        │                   │
       ▼                                        ▼                   ▼
  ┌─────────┐                              ┌─────────┐         ┌─────────┐
  │CANCELLED│                              │   RTO   │         │ARCHIVED │
  └─────────┘                              │(return) │         └─────────┘
                                           └─────────┘
```

### Typical Flow:
1. **Order Created** → Appears in Open Orders
2. **Fulfillment** → Items are allocated, picked, and packed
3. **Shipped** → Order goes to courier
4. **Delivered** → Customer receives order
5. **Archived** → Order moves to historical records

---

## 3. Order Views - Your Different Workspaces

The system organizes orders into **views** so you can focus on what matters. Think of views as filtered workspaces.

### Main Views

| View | What It Shows | When to Use It |
|------|---------------|----------------|
| **Open Orders** | Orders that need work | Daily fulfillment work |
| **Shipped** | Orders in transit | Track shipments |
| **RTO** | Return-to-origin orders | Handle failed deliveries |
| **COD Pending** | Delivered COD awaiting payment | Finance reconciliation |
| **Cancelled** | Cancelled orders | Reference/auditing |
| **Archived** | Completed/historical orders | Lookups and reports |

### Action-Oriented Views (For Quick Focus)

| View | What It Shows | Use Case |
|------|---------------|----------|
| **Ready to Ship** | Orders ready for fulfillment | Start your work queue |
| **Needs Attention** | Orders on hold or RTO awaiting action | Address problems |
| **Watch List** | At-risk orders (RTO in progress, COD delayed) | Monitor issues |
| **In Transit** | Orders currently being delivered | Track happy path |
| **Pending Payment** | COD delivered but payment not received | Finance work |

### How Views Work

```
      ┌──────────────────────────────────────────────────────────────┐
      │                     ALL ORDERS (One Table)                   │
      └──────────────────────────────────────────────────────────────┘
                    ▼              ▼              ▼              ▼
              ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
              │  Open   │   │ Shipped │   │   RTO   │   │Archived │
              │  View   │   │  View   │   │  View   │   │  View   │
              │ (filter)│   │(filter) │   │(filter) │   │(filter) │
              └─────────┘   └─────────┘   └─────────┘   └─────────┘
```

> **Think of it like Gmail:** All emails are in one place, but you see them through different views (Inbox, Sent, Spam, etc.)

---

## 4. Understanding Order Status

Orders have an overall **status** computed from the status of their lines.

### Order-Level Statuses

| Status | Meaning | Displayed In |
|--------|---------|--------------|
| `open` | Still being processed | Open Orders view |
| `on_hold` | Order paused (all lines held) | Needs Attention |
| `partially_on_hold` | Some lines on hold | Open Orders |
| `shipped` | All items shipped | Shipped view |
| `partially_shipped` | Some items shipped, some not | Open Orders |
| `delivered` | All items delivered | Shipped view |
| `cancelled` | All items cancelled | Cancelled view |
| `archived` | Moved to historical records | Archived view |

### How Order Status is Computed

```
Order Status = What are all the order lines doing?

All lines cancelled?           → Order is CANCELLED
All lines delivered?           → Order is DELIVERED  
All lines shipped/delivered?   → Order is SHIPPED
Some lines shipped?            → PARTIALLY_SHIPPED
Order is on hold?              → ON_HOLD
Default                        → OPEN
```

> **Key Principle:** The **lines** are the source of truth. Order status is just a summary of what all lines are doing.

---

## 5. Order Line Status - The Heart of the System

Each item (line) in an order has its own status that progresses through the fulfillment workflow.

### Line Status Flow

```
                    FULFILLMENT PROCESS
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ PENDING  │ ─▶ │ALLOCATED │ ─▶ │  PICKED  │ ─▶ │  PACKED  │ ─▶ │ SHIPPED  │
│   Item   │    │  Stock   │    │ From     │    │   In     │    │  Handed  │
│ received │    │ reserved │    │ shelf    │    │   box    │    │   over   │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
      │                                              │                │
      ▼                                              │                ▼
 ┌──────────┐                                        │          ┌──────────┐
 │ ON_HOLD  │◀─────────── Can go on hold ────────────┘          │DELIVERED │
 │  Paused  │                                                   │  Done!   │
 └──────────┘                                                   └──────────┘
      │                                                               │
      │                                                               ▼
      │                                                    ┌────────────────┐
      │                                                    │ RTO_INITIATED  │
      │                                                    │ Customer       │
      │                                                    │ refused/failed │
      │                                                    └────────────────┘
      │                                                               │
      │                                                               ▼
      │                                                    ┌────────────────┐
      │                                                    │  RTO_RECEIVED  │
      │                                                    │ Back at        │
      │                                                    │ warehouse      │
      │                                                    └────────────────┘
      ▼
 ┌──────────┐
 │CANCELLED │ ◀─────────── Can cancel from ANY status
 │  Voided  │
 └──────────┘
```

### What Each Status Means

| Status | What Happened | What's Next |
|--------|---------------|-------------|
| **pending** | Order received, awaiting processing | Check stock & allocate |
| **allocated** | Stock reserved for this item | Pick from shelf |
| **picked** | Item physically retrieved | Pack for shipping |
| **packed** | Item in shipping box | Ship with courier |
| **shipped** | Handed to delivery courier | Wait for delivery |
| **delivered** | Customer received item | ✅ Complete! |
| **rto_initiated** | Customer refused/failed delivery | Await return |
| **rto_received** | Item returned to warehouse | Restock or dispose |
| **cancelled** | Order line voided | ❌ No further action |
| **on_hold** | Temporarily paused | Resolve issue, then release |

### Status Transitions

You can only move **forward** through the fulfillment process, with these exceptions:

- **Going backward** (for corrections): allocated → pending, picked → allocated, etc.
- **Cancellation:** Any status → cancelled
- **Hold/Release:** Any status ↔ on_hold

---

## 6. Creating Orders

Orders come from two sources:

### 1. Shopify (Automatic)
- Orders sync automatically from your Shopify store
- System caches raw Shopify data first, then processes to ERP
- Customer accounts are created/linked automatically
- SKUs are matched to your product catalog

### 2. Manual Orders (Offline/Phone)
- Create orders directly in the system
- Used for phone orders, retail, or B2B
- Generates order number like `COH-12345678`
- Can link to existing customers or create new ones

### What You Need to Create an Order

1. **Customer info:** Name, email/phone, shipping address
2. **Items:** Product, color, size, quantity, price
3. **Payment method:** Prepaid, COD, etc.
4. **Channel:** Shopify, Phone, Retail, etc.

### Exchange Orders

You can mark an order as an "exchange" and link it to the original order. This helps track:
- Which order the exchange came from
- Running customer exchange count statistics

---

## 7. The Fulfillment Process

This is the daily workflow for getting orders out the door.

### Step 1: Allocate Stock

```
┌─────────────────────────────────────────────────────────────────┐
│  Click "Allocate" for a line item                               │
│  ────────────────────────                                       │
│  System checks: Is there stock available?                       │
│  ✓ Yes → Creates OUTWARD inventory transaction                  │
│         → Stock is now "reserved" for this order                │
│         → Line status changes to "allocated"                    │
│  ✗ No  → Error: "Insufficient inventory (need X, have Y)"       │
└─────────────────────────────────────────────────────────────────┘
```

> **What "Allocate" does:** Reserves inventory so other orders can't take it.

### Step 2: Pick

Once allocated, physically retrieve the item from the shelf. Click "Pick" to mark it as picked.

### Step 3: Pack

Put the item in its shipping box. Click "Pack" to mark it as packed.

### Step 4: Ship

Ready to hand over to courier! This requires:
- **AWB Number** (Air Waybill / Tracking number)
- **Courier name** (Delhivery, BlueDart, etc.)

### Production Batches (Optional)

If an item needs to be manufactured:
1. Create a production batch
2. Assign the order line to that batch
3. Track production progress
4. Once complete, continue with pick/pack/ship

---

## 8. Shipping Orders

### Single Line Shipping

Ship individual items with their own AWB and courier.

### Order-Level Shipping

Ship the entire order with one AWB:
1. Open the order modal
2. Go to "Ship" tab
3. Enter AWB and courier
4. All packed lines get shipped together

### Force Ship (Admin Only)

Bypass normal workflow and ship directly:
- Used for corrections or special cases
- Sets all lines to shipped status immediately

### Release to Shipped

After shipping, orders stay in "Open" view until you click **"Release to Shipped"**. This:
- Moves the order to the Shipped view
- Confirms fulfillment is complete
- Useful for batch review before releasing

---

## 9. Post-Shipping: Tracking and Delivery

### Automatic Tracking Updates

The system integrates with iThink Logistics (or other tracking services) to:
- Update tracking status automatically
- Record delivery attempts
- Track expected delivery dates
- Monitor scan locations

### Tracking Statuses

| Status | Meaning |
|--------|---------|
| `in_transit` | Package on its way |
| `out_for_delivery` | With delivery person |
| `delivered` | Successfully delivered |
| `rto_initiated` | Customer refused / failed delivery |
| `rto_in_transit` | Returning to warehouse |
| `rto_delivered` | Returned to warehouse |

### Days in Transit

The system automatically calculates how long orders have been in transit:
- Helps identify delayed shipments
- COD orders in transit >7 days flagged as "at risk"

---

## 10. Handling Problems: RTO and Cancellations

### RTO (Return to Origin)

When a delivery fails:
1. **RTO Initiated:** Courier marks for return
2. **RTO In Transit:** Package coming back
3. **RTO Received:** Back at your warehouse
4. **Inward Processing:** Inspect and restock or dispose

### Cancellations

Cancel an entire order:
- All lines marked as cancelled
- If items were allocated, inventory is released back

Cancel a single line:
- Just that line is cancelled
- Other lines continue normal processing
- If the order has some lines cancelled and some processed = "Partially Cancelled"

### Holds

Put order/line on hold when you need to pause:
- Customer requested pause
- Payment issue
- Address to be verified

Release the hold to continue processing.

---

## 11. Payments and COD

### Payment Methods

| Method | How It Works |
|--------|--------------|
| **Prepaid** | Customer paid upfront (online payment) |
| **COD** | Cash on Delivery - paid when delivered |

### COD Workflow

```
Order Shipped (COD)
        │
        ▼
   Delivered ────────────────┐
        │                    │
        ▼                    │
 COD Pending View            │ Awaiting courier
 (delivered, payment         │ remittance
  not yet received)          │
        │                    │
        ▼                    │
 Courier Remits Payment  ◀───┘
        │
        ▼
 Order Complete ✓
```

### Payment Tracking

Each order can have multiple payment transactions:
- Amount paid
- Payment method (cash, bank transfer, UPI, etc.)
- Reference number (UTR, receipt number)
- Who recorded it and when

The system calculates payment status:
- **pending:** No payments recorded
- **partially_paid:** Some amount paid
- **paid:** Full amount received
- **overpaid:** More than order total received (shows warning)

---

## 12. Archiving Orders

### What Archiving Does

Moves completed orders from active views to historical storage:
- Reduces clutter in working views
- Keeps data for reports and lookups
- Cannot be undone easily (but unarchive is available)

### When Orders Get Archived

Orders with a **terminal status** (delivered, rto_received, cancelled) can be archived:
- Manually by clicking Archive
- Bulk archive by date range
- Automatic archiving (if configured)

### Archived Order Access

View archived orders in the "Archived" view for:
- Customer history lookups
- Sales reports
- Auditing purposes

---

## 13. The Orders Grid

The main interface for working with orders is a powerful **spreadsheet-style grid**.

### Grid Features

| Feature | Description |
|---------|-------------|
| **Columns** | 30+ columns covering all order data |
| **Sorting** | Click column headers to sort |
| **Filtering** | Search by order number, customer, etc. |
| **Column Visibility** | Show/hide columns as needed |
| **Inline Actions** | Allocate, Pick, Pack, Ship buttons right in the grid |
| **Row Selection** | Select rows for bulk actions |
| **Status Colors** | Color-coded by fulfillment status |

### Visual Indicators

- **Red left border:** Order >5 days old (urgent)
- **Amber left border:** Order 3-5 days old (attention needed)
- **Strikethrough text:** Cancelled lines
- **Status badges:** Color-coded by line status

### Customization

- Save your column preferences
- Reorder columns by drag & drop
- Resize columns
- Reset to defaults

---

## 14. Data Structure Overview

For technical users, here's how the data is structured:

### Core Tables

```
┌─────────────────────────────────────────────────────────────────┐
│                           ORDER                                 │
├─────────────────────────────────────────────────────────────────┤
│ id, orderNumber, shopifyOrderId, channel                        │
│ customerName, customerEmail, customerPhone, customerId          │
│ shippingAddress, orderDate, shipByDate                          │
│ paymentMethod, paymentStatus, totalAmount                       │
│ status, isArchived, isOnHold, isExchange                        │
│ awbNumber, courier, shippedAt, deliveredAt                      │
│ trackingStatus, terminalStatus, terminalAt                      │
│ codRemittedAt, codRemittanceUtr, codRemittedAmount              │
└─────────────────────────────────────────────────────────────────┘
                         │ (has many)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                       ORDER_LINE                                │
├─────────────────────────────────────────────────────────────────┤
│ id, orderId, skuId, qty, unitPrice                              │
│ lineStatus (pending/allocated/picked/packed/shipped/etc.)       │
│ productionBatchId, awbNumber, courier                           │
│ shippedAt, deliveredAt, trackingStatus                          │
│ isOnHold, holdReason, isCustomized                              │
│ rtoCondition, rtoInwardedAt, refundAmount                       │
└─────────────────────────────────────────────────────────────────┘
                         
┌─────────────────────────────────────────────────────────────────┐
│                      ORDER_PAYMENT                              │
├─────────────────────────────────────────────────────────────────┤
│ id, orderId, amount, paymentMethod                              │
│ reference (UTR, receipt #), notes                               │
│ recordedById, recordedAt                                        │
└─────────────────────────────────────────────────────────────────┘
```

### Related Tables

- **Customer:** Links to customer data, tier, LTV
- **SKU:** Links to product catalog (Product → Variation → SKU)
- **ProductionBatch:** Manufacturing queue
- **ShopifyOrderCache:** Raw Shopify data preserved
- **ReturnRequest:** For exchange/return tracking

### Enrichments (Computed Fields)

The system adds computed fields for display:
- `fulfillmentStage`: Summary of where order is in workflow
- `daysInTransit`: Days since shipped
- `daysSinceDelivery`: Days since delivered (for COD)
- `customerLtv`: Customer lifetime value
- `customerOrderCount`: Total orders by this customer
- `rtoStatus`: Whether RTO is in transit or received

---

## 15. Quick Reference

### Status Progression Cheat Sheet

```
Line Status:    pending → allocated → picked → packed → shipped → delivered
                    ↓                                       ↓
              (on_hold) ←───────── hold ──────────────     ↓
                    ↓                                       ↓
              cancelled ◀─────── cancel from any ─────────────
                                                            ↓
                                              rto_initiated → rto_received
```

### Common Actions

| Action | What It Does | When to Use |
|--------|-------------|-------------|
| Allocate | Reserve stock | Before picking |
| Pick | Mark as retrieved | After physical pick |
| Pack | Mark as boxed | After packing |
| Ship | Assign AWB, set as shipped | Ready for courier |
| Hold | Pause processing | Need to verify something |
| Release | Resume from hold | Issue resolved |
| Cancel | Void the line | Customer cancelled |
| Archive | Move to history | Order fully complete |

### View Quick Guide

| Need to... | Go to... |
|------------|----------|
| Process new orders | Open Orders |
| Track shipments | Shipped |
| Handle failed deliveries | RTO |
| Reconcile COD payments | COD Pending |
| Find old orders | Archived |
| See orders needing help | Needs Attention |
| Monitor risky orders | Watch List |

### Keyboard Shortcuts

- **Escape:** Close modals
- **Tab:** Navigate between fields
- Standard grid navigation with arrow keys

---

## 16. Technical Codemap

> **For developers and technical users:** This section maps all files involved in the orders system.

---

### 📁 Database Schema

| File | Description |
|------|-------------|
| `server/prisma/schema.prisma` | Database models: `Order`, `OrderLine`, `OrderPayment`, `Customer`, `ShopifyOrderCache` |

---

### 📁 Server - Core Utilities

| File | Description |
|------|-------------|
| `server/src/utils/orderStatus.ts` | **Order status computation engine.** Computes order status from line states, validates transitions, calculates processing times |
| `server/src/utils/orderViews.ts` | **View configuration system.** Defines all 12 order views (open, shipped, rto, etc.) with filtering, enrichment, and sorting rules |
| `server/src/utils/orderLock.js` | Distributed locking utility to prevent race conditions during order processing |
| `server/src/utils/queryPatterns.ts` | Shared query patterns for enriching orders with customer stats, tracking status, fulfillment stage |
| `server/src/utils/customerUtils.ts` | Customer find-or-create logic, used when processing orders |
| `server/src/utils/tierUtils.ts` | Customer tier calculations and LTV updates triggered by order changes |

---

### 📁 Server - API Routes

| File | Description |
|------|-------------|
| `server/src/routes/orders/index.ts` | Route aggregator - mounts all order sub-routers |
| `server/src/routes/orders/listOrders.ts` | **GET endpoints.** View-based order listing, search-all, summary endpoints, archived orders |
| `server/src/routes/orders/mutations.ts` | **CRUD operations.** Create, update, delete, cancel, archive orders. Handles holds, line notes, customizations |
| `server/src/routes/orders/lineStatus.ts` | **Line status transitions.** Unified endpoint for allocate/pick/pack/ship/cancel with validation |
| `server/src/routes/orders/fulfillment.ts` | Fulfillment operations: ship order, mark delivered, handle RTO inward processing |

---

### 📁 Server - Services

| File | Description |
|------|-------------|
| `server/src/services/shopifyOrderProcessor.ts` | **Shopify integration.** Cache-first pattern: caches raw Shopify data, then processes to ERP. Handles order create/update/cancel |
| `server/src/services/shipOrderService.ts` | Order shipping logic: validates readiness, creates inventory transactions, updates line statuses |
| `server/src/services/inventoryBalanceCache.ts` | Caches inventory balances for fast lookups during order processing |

---

### 📁 Server - tRPC Layer

| File | Description |
|------|-------------|
| `server/src/trpc/routers/orders.ts` | Type-safe tRPC router for orders - `list`, `getById`, `create`, `update` procedures |
| `server/src/trpc/routers/index.ts` | Root tRPC router that includes orders router |

---

### 📁 Server - Tracking & Webhooks

| File | Description |
|------|-------------|
| `server/src/routes/tracking.ts` | iThink Logistics integration: fetch tracking, bulk updates, webhook handlers |
| `server/src/routes/webhooks.ts` | Shopify webhook handlers: order/create, order/update, order/cancelled |
| `server/src/routes/remittance.ts` | COD payment reconciliation: mark remittance, bulk mark, sync with Shopify |

---

### 📁 Client - Pages

| File | Description |
|------|-------------|
| `client/src/pages/Orders.tsx` | **Main orders page.** View selector, integrates grid + modals, handles all order actions |
| `client/src/pages/OrderSearch.tsx` | Global order search page - search across all views/tabs |

---

### 📁 Client - Core Hooks

| File | Description |
|------|-------------|
| `client/src/hooks/useOrdersData.ts` | **Data fetching hook.** Queries for open/cancelled views, SKUs, inventory, fabrics. Uses tRPC |
| `client/src/hooks/useUnifiedOrdersData.ts` | Data hook for shipped-related views (shipped, RTO, COD pending, archived) |
| `client/src/hooks/useOrdersMutations.ts` | **Mutation hook.** All order mutations: allocate, pick, pack, ship, cancel, edit, hold, archive |
| `client/src/hooks/useOrderSSE.ts` | Server-Sent Events hook for real-time order updates across browser tabs |

---

### 📁 Client - Order Components

| File | Description |
|------|-------------|
| `client/src/components/orders/OrdersGrid.tsx` | **Main grid component.** AG-Grid wrapper with 30+ columns, inline actions, status colors |
| `client/src/components/orders/CreateOrderModal.tsx` | Multi-step order creation form: customer search, product search, address, payment |
| `client/src/components/orders/GlobalOrderSearch.tsx` | Global search component - searches across all order views |
| `client/src/components/orders/OrdersAnalyticsBar.tsx` | Summary bar: order counts, revenue, fulfillment metrics |
| `client/src/components/orders/SummaryPanel.tsx` | Collapsible panel showing order/shipped/RTO summaries |
| `client/src/components/orders/TrackingModal.tsx` | Detailed tracking view with timeline, scan history, courier info |
| `client/src/components/orders/CustomerDetailModal.tsx` | Customer detail popup: order history, LTV, contact info, addresses |
| `client/src/components/orders/CustomizationModal.tsx` | Line customization modal: length/size adjustments, special notes |
| `client/src/components/orders/index.ts` | Barrel export for all order components |

---

### 📁 Client - UnifiedOrderModal (Order Detail View)

| File | Description |
|------|-------------|
| `client/src/components/orders/UnifiedOrderModal/UnifiedOrderModal.tsx` | **Main modal.** Consolidated view/edit/ship modal with tabbed interface |
| `client/src/components/orders/UnifiedOrderModal/types.ts` | TypeScript types for modal props, modes, sections |
| `client/src/components/orders/UnifiedOrderModal/hooks/useUnifiedOrderModal.ts` | Modal state management: mode switching, form state, side effects |
| `client/src/components/orders/UnifiedOrderModal/components/ItemsSection.tsx` | Order items display with line-level actions |
| `client/src/components/orders/UnifiedOrderModal/components/CustomerSection.tsx` | Customer info and address editing |
| `client/src/components/orders/UnifiedOrderModal/components/ShippingSection.tsx` | Shipping form: AWB, courier, ship action |
| `client/src/components/orders/UnifiedOrderModal/components/TimelineSection.tsx` | Order timeline/history display |
| `client/src/components/orders/UnifiedOrderModal/components/NotesSection.tsx` | Internal notes editing |
| `client/src/components/orders/UnifiedOrderModal/components/OrderSummary.tsx` | Order totals, payment status summary |

---

### 📁 Client - OrdersGrid Internals

| File | Description |
|------|-------------|
| `client/src/components/orders/ordersGrid/columns/` | Column definitions directory (7 files by category) |
| `client/src/components/orders/ordersGrid/columns/index.ts` | Column builder: assembles all columns for the grid |
| `client/src/components/orders/ordersGrid/columns/orderInfoColumns.tsx` | Order header columns: date, number, customer, city |
| `client/src/components/orders/ordersGrid/columns/productColumns.tsx` | Product/SKU columns: name, color, size, SKU code |
| `client/src/components/orders/ordersGrid/columns/fulfillmentColumns.tsx` | Fulfillment status and action columns: allocate, pick, pack buttons |
| `client/src/components/orders/ordersGrid/columns/postShipColumns.tsx` | Post-ship status columns for shipped view |
| `client/src/components/orders/ordersGrid/columns/trackingColumns.tsx` | Tracking columns: AWB, courier, status, days in transit |
| `client/src/components/orders/ordersGrid/columns/paymentColumns.tsx` | Payment columns: method, COD status, remittance |
| `client/src/components/orders/ordersGrid/cellRenderers/` | Custom cell renderers for buttons, badges, tooltips |
| `client/src/components/orders/ordersGrid/helpers/` | Grid helper functions: sorting, filtering, row styling |
| `client/src/components/orders/ordersGrid/types.ts` | Grid-specific TypeScript types |
| `client/src/components/orders/ordersGrid/constants.ts` | Grid constants: default columns, status colors, config |

---

### 📁 Client - Utilities

| File | Description |
|------|-------------|
| `client/src/utils/orderHelpers.ts` | **Order utility functions.** Flatten orders to rows, filter, SKU selection helpers, default headers |
| `client/src/constants/queryKeys.ts` | React Query cache keys for orders and related data |
| `client/src/constants/sizes.ts` | Size ordering constants for display |

---

### 📁 Client - API Services

| File | Description |
|------|-------------|
| `client/src/services/api.ts` | Axios API client with `ordersApi` methods for REST endpoints |
| `client/src/services/trpc.ts` | tRPC client setup for type-safe server calls |

---

### 📁 Tests

| File | Description |
|------|-------------|
| `server/src/__tests__/ordersApi.test.js` | API endpoint tests for order CRUD operations |
| `server/src/__tests__/orders-inventory.test.js` | Tests for inventory transactions during order processing |
| `server/src/__tests__/orderLock.test.js` | Tests for distributed locking during concurrent order updates |
| `server/src/__tests__/shipOrderService.test.js` | Tests for order shipping logic |
| `server/src/__tests__/shopifyOrderProcessing.test.js` | Tests for Shopify order sync and processing |

---

### 📊 Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (React)                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│  Pages: Orders.tsx, OrderSearch.tsx                                          │
│  Hooks: useOrdersData, useOrdersMutations, useOrderSSE                       │
│  Components: OrdersGrid, CreateOrderModal, UnifiedOrderModal                 │
│  Utils: orderHelpers.ts                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
                    │ tRPC / REST API                    ▲ SSE
                    ▼                                    │
┌──────────────────────────────────────────────────────────────────────────────┐
│                              SERVER (Express)                                │
├──────────────────────────────────────────────────────────────────────────────┤
│  Routes: orders/ (listOrders, mutations, lineStatus, fulfillment)            │
│  tRPC: routers/orders.ts                                                     │
│  Services: shopifyOrderProcessor, shipOrderService                           │
│  Utils: orderStatus, orderViews, orderLock                                   │
└──────────────────────────────────────────────────────────────────────────────┘
                    │ Prisma ORM
                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           DATABASE (PostgreSQL)                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  Tables: Order, OrderLine, OrderPayment, Customer, ShopifyOrderCache         │
└──────────────────────────────────────────────────────────────────────────────┘
                    ▲
                    │ Webhooks
┌──────────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL INTEGRATIONS                                │
├──────────────────────────────────────────────────────────────────────────────┤
│  Shopify: Order sync, webhooks, fulfillment updates                          │
│  iThink Logistics: Tracking updates, delivery status                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Need Help?

If you have questions about the orders system:
1. Check this documentation first
2. Look at the specific view's description in the dropdown
3. Contact your system administrator

---

*This documentation covers the COH-ERP2 Orders System. For other modules (Inventory, Products, Returns, etc.), see their respective documentation.*

