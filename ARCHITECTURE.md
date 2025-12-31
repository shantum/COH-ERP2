# Architecture Planning

This document outlines the planned architecture and roadmap for COH-ERP.

## Current State

- Express.js backend with Prisma ORM (SQLite)
- React + TypeScript frontend with Vite
- JWT authentication
- Core modules: Products, Inventory, Orders, Customers, Returns, Production

## Planned Architecture

# Creatures of Habit - Internal ERP Architecture

## Executive Summary

A lightweight, purpose-built ERP system for managing COH's manufacturing operations, inventory, orders, and production planning. Built around the reality that you manufacture in-house with master tailors, use natural fabrics with variable shrinkage, and need to balance made-to-order flexibility with stock optimization.

---

## Core Concepts & Data Model

### 1. Product Hierarchy

```
PRODUCT (e.g., "Linen MIDI Dress")
    └── VARIATION (e.g., "Linen MIDI Dress - Blue")
            └── SKU (e.g., "LMD-BLU-XL")
```

**Products Table**
| Field | Type | Description |
|-------|------|-------------|
| product_id | UUID | Primary key |
| name | String | "Linen MIDI Dress" |
| category | Enum | dress, top, bottom, outerwear, etc. |
| product_type | Enum | basic, seasonal, limited |
| base_production_time_mins | Int | Avg tailoring time per piece |
| created_at | Timestamp | |
| is_active | Boolean | |

**Variations Table**
| Field | Type | Description |
|-------|------|-------------|
| variation_id | UUID | Primary key |
| product_id | FK | Links to product |
| color_name | String | "Blue" |
| color_hex | String | #4A90A4 |
| fabric_id | FK | Links to fabric |
| is_active | Boolean | |

**SKUs Table**
| Field | Type | Description |
|-------|------|-------------|
| sku_id | UUID | Primary key |
| sku_code | String | Unique, e.g., "LMD-BLU-XL" |
| variation_id | FK | Links to variation |
| size | Enum | XS, S, M, L, XL, XXL, Free |
| fabric_consumption | Decimal | Meters/kg per piece |
| mrp | Decimal | |
| target_stock_qty | Int | Optimal inventory level |
| target_stock_method | Enum | 7day, 14day, 28day, manual |
| is_active | Boolean | |

---

### 1a. COGS Calculation

COGS (Cost of Goods Sold) is calculated per SKU based on fabric cost + labor cost.

**SKU Costing Table**
| Field | Type | Description |
|-------|------|-------------|
| sku_id | FK | Primary key, links to SKU |
| fabric_cost | Decimal | Calculated: fabric_consumption × fabric.cost_per_unit |
| labor_time_mins | Int | Time to produce one piece |
| labor_rate_per_min | Decimal | Cost per minute of tailor time |
| labor_cost | Decimal | Calculated: labor_time_mins × labor_rate_per_min |
| packaging_cost | Decimal | Packaging materials per unit |
| other_cost | Decimal | Any additional per-unit costs |
| total_cogs | Decimal | Calculated: fabric + labor + packaging + other |
| last_updated | Timestamp | When costs were last recalculated |

**COGS Calculation Logic**
```sql
-- View for real-time COGS calculation
CREATE VIEW sku_cogs_view AS
SELECT 
    s.sku_id,
    s.sku_code,
    s.fabric_consumption,
    f.cost_per_unit as fabric_rate,
    (s.fabric_consumption * f.cost_per_unit) as fabric_cost,
    
    p.base_production_time_mins as labor_mins,
    cfg.labor_rate_per_min,
    (p.base_production_time_mins * cfg.labor_rate_per_min) as labor_cost,
    
    COALESCE(sc.packaging_cost, cfg.default_packaging_cost) as packaging_cost,
    COALESCE(sc.other_cost, 0) as other_cost,
    
    -- Total COGS
    (s.fabric_consumption * f.cost_per_unit) + 
    (p.base_production_time_mins * cfg.labor_rate_per_min) + 
    COALESCE(sc.packaging_cost, cfg.default_packaging_cost) +
    COALESCE(sc.other_cost, 0) as total_cogs,
    
    -- Margin calculation
    s.mrp,
    s.mrp - (
        (s.fabric_consumption * f.cost_per_unit) + 
        (p.base_production_time_mins * cfg.labor_rate_per_min) + 
        COALESCE(sc.packaging_cost, cfg.default_packaging_cost) +
        COALESCE(sc.other_cost, 0)
    ) as gross_margin,
    
    ROUND(
        ((s.mrp - total_cogs) / s.mrp) * 100, 
        1
    ) as margin_pct

FROM skus s
JOIN variations v ON s.variation_id = v.variation_id
JOIN products p ON v.product_id = p.product_id
JOIN fabrics f ON v.fabric_id = f.fabric_id
LEFT JOIN sku_costing sc ON s.sku_id = sc.sku_id
CROSS JOIN cost_config cfg
WHERE s.is_active = TRUE;
```

**Cost Config Table** (Global settings)
| Field | Type | Description |
|-------|------|-------------|
| labor_rate_per_min | Decimal | Default: ₹2.50/min (~₹150/hr) |
| default_packaging_cost | Decimal | Default per-unit packaging |
| last_updated | Timestamp | |

**COGS Dashboard Features**
- SKU-wise COGS breakdown (fabric vs labor vs other)
- Margin analysis by product category
- Alert when margin falls below threshold (e.g., <50%)
- Fabric cost change impact analysis
- Bulk recalculation when fabric prices change

---

### 2. Fabric Management

**Fabric Types Table**
| Field | Type | Description |
|-------|------|-------------|
| fabric_type_id | UUID | Primary key |
| name | String | "Linen 60 Lea" |
| composition | String | "100% Linen" |
| unit | Enum | meter, kg |
| avg_shrinkage_pct | Decimal | Expected shrinkage % |

**Fabrics Table**
| Field | Type | Description |
|-------|------|-------------|
| fabric_id | UUID | Primary key |
| fabric_type_id | FK | Links to fabric type |
| name | String | "Linen Wildflower Blue 60 Lea" |
| color_name | String | "Wildflower Blue" |
| color_hex | String | #6B8E9F |
| cost_per_unit | Decimal | Cost per meter/kg |
| supplier_id | FK | Primary supplier |
| lead_time_days | Int | Typical delivery time |
| min_order_qty | Decimal | Minimum order from supplier |
| is_active | Boolean | |

**Fabric Transactions Table** (Inward/Outward)
| Field | Type | Description |
|-------|------|-------------|
| txn_id | UUID | Primary key |
| fabric_id | FK | Links to fabric |
| txn_type | Enum | inward, outward |
| qty | Decimal | Positive number |
| unit | Enum | meter, kg |
| reason | Enum | supplier_receipt, production, shrinkage, damage, adjustment |
| reference_id | UUID | Nullable - links to production batch or PO |
| notes | Text | |
| created_by | FK | User who made entry |
| created_at | Timestamp | |

**Fabric Balance View** (Computed)
```sql
-- Current balance = SUM(inward) - SUM(outward)
-- Running balance calculated via window function
```

---

### 3. Inventory Management

**Inventory Transactions Table**
| Field | Type | Description |
|-------|------|-------------|
| txn_id | UUID | Primary key |
| sku_id | FK | Links to SKU |
| txn_type | Enum | inward, outward |
| qty | Int | Always positive |
| reason | Enum | production, sale, return, damage, adjustment, transfer |
| reference_id | UUID | Links to order_line_id or production_batch_id |
| notes | Text | |
| warehouse_location | String | Optional: shelf/bin location |
| created_by | FK | User |
| created_at | Timestamp | |

**Inventory Balance View** (Computed per SKU)
```sql
SELECT 
    sku_id,
    SUM(CASE WHEN txn_type = 'inward' THEN qty ELSE 0 END) as total_inward,
    SUM(CASE WHEN txn_type = 'outward' THEN qty ELSE 0 END) as total_outward,
    SUM(CASE WHEN txn_type = 'inward' THEN qty ELSE -qty END) as current_balance
FROM inventory_transactions
GROUP BY sku_id
```

---

### 4. Customer Management (Synced from Shopify)

**Customers Table**
| Field | Type | Description |
|-------|------|-------------|
| customer_id | UUID | Primary key |
| shopify_customer_id | String | Shopify's customer ID |
| email | String | Unique, primary identifier |
| phone | String | |
| first_name | String | |
| last_name | String | |
| default_address | JSON | Primary shipping address |
| tags | Array | Shopify tags (VIP, wholesale, etc.) |
| accepts_marketing | Boolean | Email opt-in status |
| first_order_date | Timestamp | Date of first purchase |
| last_order_date | Timestamp | Date of most recent order |
| created_at | Timestamp | When synced to ERP |
| updated_at | Timestamp | |

**Customer Metrics View** (Computed in real-time)
```sql
CREATE VIEW customer_metrics_view AS
SELECT 
    c.customer_id,
    c.email,
    c.first_name,
    c.last_name,
    
    -- Order metrics
    COUNT(DISTINCT o.order_id) as total_orders,
    SUM(o.total_amount) as lifetime_value,
    AVG(o.total_amount) as avg_order_value,
    MIN(o.order_date) as first_order_date,
    MAX(o.order_date) as last_order_date,
    
    -- Days since last order
    EXTRACT(DAY FROM NOW() - MAX(o.order_date)) as days_since_last_order,
    
    -- Return/Exchange metrics
    COUNT(DISTINCT CASE WHEN rr.request_type = 'return' THEN rr.request_id END) as total_returns,
    COUNT(DISTINCT CASE WHEN rr.request_type = 'exchange' THEN rr.request_id END) as total_exchanges,
    
    -- Return rate (returns / orders)
    ROUND(
        COUNT(DISTINCT CASE WHEN rr.request_type = 'return' THEN rr.request_id END)::DECIMAL / 
        NULLIF(COUNT(DISTINCT o.order_id), 0) * 100, 
        1
    ) as return_rate_pct,
    
    -- Exchange rate (exchanges / orders)
    ROUND(
        COUNT(DISTINCT CASE WHEN rr.request_type = 'exchange' THEN rr.request_id END)::DECIMAL / 
        NULLIF(COUNT(DISTINCT o.order_id), 0) * 100, 
        1
    ) as exchange_rate_pct,
    
    -- Items purchased (for product affinity)
    COUNT(ol.order_line_id) as total_items_purchased,
    
    -- Customer tier (based on LTV)
    CASE 
        WHEN SUM(o.total_amount) >= 50000 THEN 'platinum'
        WHEN SUM(o.total_amount) >= 25000 THEN 'gold'
        WHEN SUM(o.total_amount) >= 10000 THEN 'silver'
        ELSE 'bronze'
    END as customer_tier

FROM customers c
LEFT JOIN orders o ON c.customer_id = o.customer_id
LEFT JOIN order_lines ol ON o.order_id = ol.order_id
LEFT JOIN return_requests rr ON o.order_id = rr.original_order_id
GROUP BY c.customer_id, c.email, c.first_name, c.last_name;
```

**Customer Product Affinity View** (What does this customer buy?)
```sql
CREATE VIEW customer_product_affinity AS
SELECT 
    c.customer_id,
    p.product_id,
    p.name as product_name,
    p.category,
    COUNT(ol.order_line_id) as times_purchased,
    SUM(ol.qty) as total_qty,
    MAX(o.order_date) as last_purchased
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
JOIN order_lines ol ON o.order_id = ol.order_id
JOIN skus s ON ol.sku_id = s.sku_id
JOIN variations v ON s.variation_id = v.variation_id
JOIN products p ON v.product_id = p.product_id
GROUP BY c.customer_id, p.product_id, p.name, p.category;
```

**Shopify Customer Sync**
- Webhook: `customers/create`, `customers/update`
- Sync fields: email, phone, name, address, tags, marketing consent
- On order sync, auto-create/update customer if not exists

---

### 5. Orders Management

**Orders Table**
| Field | Type | Description |
|-------|------|-------------|
| order_id | UUID | Primary key |
| order_number | String | Unique, from Shopify/channel |
| shopify_order_id | String | Shopify's internal ID for sync |
| channel | Enum | shopify, amazon, offline, custom |
| customer_id | FK | Links to customer (NEW) |
| customer_name | String | Denormalized for quick display |
| customer_email | String | Denormalized |
| customer_phone | String | |
| shipping_address | JSON | Full address object |
| order_date | Timestamp | When order was placed |
| customer_notes | Text | Notes from customer |
| internal_notes | Text | Team notes |
| status | Enum | open, shipped, delivered, cancelled, returned |
| awb_number | String | Tracking/AWB number |
| courier | String | Shipping carrier name |
| shipped_at | Timestamp | When marked shipped |
| delivered_at | Timestamp | When marked delivered |
| total_amount | Decimal | |
| created_at | Timestamp | |
| synced_at | Timestamp | Last Shopify sync time |

**Order Lines Table**
| Field | Type | Description |
|-------|------|-------------|
| order_line_id | UUID | Primary key |
| order_id | FK | Links to order |
| shopify_line_id | String | Shopify's line item ID |
| sku_id | FK | Links to SKU |
| qty | Int | Quantity ordered |
| unit_price | Decimal | Price at time of order |
| line_status | Enum | pending, allocated, picked, packed, shipped |
| allocated_at | Timestamp | When inventory was reserved |
| picked_at | Timestamp | When physically picked |
| packed_at | Timestamp | When packed for shipping |
| shipped_at | Timestamp | When handed to courier |
| inventory_txn_id | FK | Links to outward txn when shipped |
| production_batch_id | FK | Nullable - if being produced |
| notes | Text | |

**Order Line Status Flow**
```
PENDING ──► ALLOCATED ──► PICKED ──► PACKED ──► SHIPPED
   │            │            │          │          │
   │            │            │          │          └─ Inventory outward created
   │            │            │          └─ Ready for handover
   │            │            └─ Physically pulled from shelf
   │            └─ Inventory reserved (soft hold)
   └─ Awaiting stock or production
```

**Order Status Rules**
- Order `status` = 'open' until ALL lines are shipped
- Order `status` = 'shipped' when ALL lines have `line_status` = 'shipped'
- Individual lines can be at different stages (partial fulfillment supported)

**Open Orders View** (Active fulfillment queue)
```sql
CREATE VIEW open_orders_view AS
SELECT 
    o.order_id,
    o.order_number,
    o.customer_name,
    o.order_date,
    o.customer_notes,
    o.internal_notes,
    COUNT(ol.order_line_id) as total_lines,
    SUM(CASE WHEN ol.line_status = 'pending' THEN 1 ELSE 0 END) as pending_lines,
    SUM(CASE WHEN ol.line_status = 'allocated' THEN 1 ELSE 0 END) as allocated_lines,
    SUM(CASE WHEN ol.line_status = 'picked' THEN 1 ELSE 0 END) as picked_lines,
    SUM(CASE WHEN ol.line_status = 'packed' THEN 1 ELSE 0 END) as packed_lines,
    
    -- Overall order progress
    CASE 
        WHEN SUM(CASE WHEN ol.line_status = 'packed' THEN 1 ELSE 0 END) = COUNT(*) THEN 'ready_to_ship'
        WHEN SUM(CASE WHEN ol.line_status IN ('picked', 'packed') THEN 1 ELSE 0 END) > 0 THEN 'in_progress'
        WHEN SUM(CASE WHEN ol.line_status = 'allocated' THEN 1 ELSE 0 END) = COUNT(*) THEN 'allocated'
        ELSE 'pending'
    END as fulfillment_stage

FROM orders o
JOIN order_lines ol ON o.order_id = ol.order_id
WHERE o.status = 'open'
GROUP BY o.order_id
ORDER BY o.order_date ASC;
```

**Shipped Orders View** (Tracking & delivery monitoring)
```sql
CREATE VIEW shipped_orders_view AS
SELECT 
    o.order_id,
    o.order_number,
    o.customer_name,
    o.customer_phone,
    o.shipping_address,
    o.awb_number,
    o.courier,
    o.shipped_at,
    o.status,
    o.delivered_at,
    
    -- Days since shipped
    EXTRACT(DAY FROM NOW() - o.shipped_at) as days_in_transit,
    
    -- Alert if not delivered in expected time
    CASE 
        WHEN o.status = 'shipped' AND EXTRACT(DAY FROM NOW() - o.shipped_at) > 7 
        THEN 'delivery_delayed'
        WHEN o.status = 'delivered' THEN 'completed'
        ELSE 'in_transit'
    END as tracking_status

FROM orders o
WHERE o.status IN ('shipped', 'delivered')
ORDER BY o.shipped_at DESC;
```

**Orders Dashboard View** (Denormalized for UI - line level detail)
```sql
SELECT 
    ol.order_line_id,
    o.order_number,
    o.customer_name,
    o.order_date,
    p.name as product_name,
    v.color_name,
    s.size,
    s.sku_code,
    ol.qty as ordered_qty,
    ol.line_status,
    ol.allocated_at,
    ol.picked_at,
    ol.packed_at,
    inv.current_balance as stock_available,
    fab.current_balance as fabric_balance,
    CASE 
        WHEN inv.current_balance >= ol.qty THEN 'in_stock'
        WHEN fab.current_balance >= (ol.qty * s.fabric_consumption) THEN 'can_produce'
        ELSE 'fabric_needed'
    END as fulfillment_status,
    o.customer_notes,
    o.internal_notes
FROM order_lines ol
JOIN orders o ON ol.order_id = o.order_id
JOIN skus s ON ol.sku_id = s.sku_id
JOIN variations v ON s.variation_id = v.variation_id
JOIN products p ON v.product_id = p.product_id
LEFT JOIN inventory_balance_view inv ON s.sku_id = inv.sku_id
LEFT JOIN fabric_balance_view fab ON v.fabric_id = fab.fabric_id
WHERE o.status = 'open';
```

---

### 6. Returns & Exchanges

A 6-step workflow to track returns and exchanges from request to resolution.

**Return Requests Table**
| Field | Type | Description |
|-------|------|-------------|
| request_id | UUID | Primary key |
| request_number | String | Unique, e.g., "RET-2024-0001" |
| request_type | Enum | return, exchange |
| original_order_id | FK | Links to original order |
| customer_id | FK | Links to customer |
| status | Enum | requested, reverse_initiated, in_transit, received, inspected, resolved, cancelled |
| reason_category | Enum | size_issue, color_mismatch, quality_defect, wrong_item, changed_mind, other |
| reason_details | Text | Customer's explanation |
| resolution_type | Enum | refund, exchange, store_credit, rejected |
| resolution_notes | Text | Internal notes on resolution |
| created_at | Timestamp | |
| updated_at | Timestamp | |

**Return Request Lines Table** (Items being returned/exchanged)
| Field | Type | Description |
|-------|------|-------------|
| request_line_id | UUID | Primary key |
| request_id | FK | Links to return request |
| original_order_line_id | FK | Links to original order line |
| sku_id | FK | SKU being returned |
| qty | Int | Quantity being returned |
| exchange_sku_id | FK | Nullable - new SKU for exchange |
| exchange_qty | Int | Nullable - qty for exchange |
| item_condition | Enum | unused, used, damaged, defective |
| inspection_notes | Text | Notes from QC inspection |

**Return Shipping Table** (Reverse logistics tracking)
| Field | Type | Description |
|-------|------|-------------|
| shipping_id | UUID | Primary key |
| request_id | FK | Links to return request |
| direction | Enum | reverse (customer→warehouse), forward (exchange shipment) |
| courier | String | Shipping carrier |
| awb_number | String | Tracking number |
| pickup_address | JSON | Customer's address |
| pickup_scheduled_at | Timestamp | When pickup is scheduled |
| picked_up_at | Timestamp | When actually picked up |
| received_at | Timestamp | When received at warehouse |
| shipped_at | Timestamp | For forward/exchange shipments |
| delivered_at | Timestamp | |
| status | Enum | scheduled, picked_up, in_transit, delivered, failed |
| notes | Text | |

**Return Status History Table** (Audit trail)
| Field | Type | Description |
|-------|------|-------------|
| history_id | UUID | Primary key |
| request_id | FK | Links to return request |
| from_status | Enum | Previous status |
| to_status | Enum | New status |
| changed_by | FK | User who made change |
| notes | Text | Optional notes |
| created_at | Timestamp | |

**Return/Exchange Workflow**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 1: REQUEST CREATED                                                │
│  ├─ Customer initiates return/exchange (via support or portal)         │
│  ├─ Select order, items, reason                                        │
│  └─ Status: REQUESTED                                                  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 2: REVERSE SHIPPING INITIATED                                     │
│  ├─ Create reverse pickup with courier                                 │
│  ├─ Generate AWB, schedule pickup date                                 │
│  ├─ Notify customer of pickup details                                  │
│  └─ Status: REVERSE_INITIATED                                          │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 3: REVERSE SHIPMENT IN TRANSIT                                    │
│  ├─ Courier picks up from customer                                     │
│  ├─ Track via AWB                                                      │
│  └─ Status: IN_TRANSIT                                                 │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 4: REVERSE SHIPMENT RECEIVED                                      │
│  ├─ Package received at warehouse                                      │
│  ├─ Log receipt time, initial condition                                │
│  └─ Status: RECEIVED                                                   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 5: INSPECTION                                                     │
│  ├─ QC checks each item                                                │
│  ├─ Log condition: unused, used, damaged, defective                    │
│  ├─ Determine eligibility for refund/exchange                          │
│  ├─ If resellable: Create inventory INWARD (reason: return)            │
│  └─ Status: INSPECTED                                                  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 6: RESOLUTION                                                     │
│  ├─ REFUND: Process refund via payment gateway                         │
│  ├─ EXCHANGE: Create forward shipment for new item                     │
│  │   └─ Create inventory OUTWARD for exchange item                     │
│  ├─ STORE CREDIT: Issue credit note                                    │
│  ├─ REJECTED: Notify customer, return item to them                     │
│  └─ Status: RESOLVED                                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Return/Exchange Analytics Views**

```sql
-- Return/Exchange rate by Customer
CREATE VIEW customer_return_rates AS
SELECT 
    c.customer_id,
    c.email,
    c.first_name || ' ' || c.last_name as customer_name,
    COUNT(DISTINCT o.order_id) as total_orders,
    COUNT(DISTINCT CASE WHEN rr.request_type = 'return' THEN rr.request_id END) as returns,
    COUNT(DISTINCT CASE WHEN rr.request_type = 'exchange' THEN rr.request_id END) as exchanges,
    ROUND(COUNT(DISTINCT CASE WHEN rr.request_type = 'return' THEN rr.request_id END)::DECIMAL / 
          NULLIF(COUNT(DISTINCT o.order_id), 0) * 100, 1) as return_rate_pct,
    ROUND(COUNT(DISTINCT CASE WHEN rr.request_type = 'exchange' THEN rr.request_id END)::DECIMAL / 
          NULLIF(COUNT(DISTINCT o.order_id), 0) * 100, 1) as exchange_rate_pct
FROM customers c
LEFT JOIN orders o ON c.customer_id = o.customer_id
LEFT JOIN return_requests rr ON o.order_id = rr.original_order_id
GROUP BY c.customer_id, c.email, c.first_name, c.last_name;

-- Return/Exchange rate by Product
CREATE VIEW product_return_rates AS
SELECT 
    p.product_id,
    p.name as product_name,
    p.category,
    COUNT(DISTINCT ol.order_line_id) as times_sold,
    COUNT(DISTINCT CASE WHEN rr.request_type = 'return' THEN rrl.request_line_id END) as times_returned,
    COUNT(DISTINCT CASE WHEN rr.request_type = 'exchange' THEN rrl.request_line_id END) as times_exchanged,
    ROUND(COUNT(DISTINCT CASE WHEN rr.request_type = 'return' THEN rrl.request_line_id END)::DECIMAL / 
          NULLIF(COUNT(DISTINCT ol.order_line_id), 0) * 100, 1) as return_rate_pct,
    ROUND(COUNT(DISTINCT CASE WHEN rr.request_type = 'exchange' THEN rrl.request_line_id END)::DECIMAL / 
          NULLIF(COUNT(DISTINCT ol.order_line_id), 0) * 100, 1) as exchange_rate_pct
FROM products p
JOIN variations v ON p.product_id = v.product_id
JOIN skus s ON v.variation_id = s.variation_id
LEFT JOIN order_lines ol ON s.sku_id = ol.sku_id
LEFT JOIN return_request_lines rrl ON ol.order_line_id = rrl.original_order_line_id
LEFT JOIN return_requests rr ON rrl.request_id = rr.request_id
GROUP BY p.product_id, p.name, p.category;

-- Return/Exchange rate by Variation (Product + Color)
CREATE VIEW variation_return_rates AS
SELECT 
    v.variation_id,
    p.name as product_name,
    v.color_name,
    COUNT(DISTINCT ol.order_line_id) as times_sold,
    COUNT(DISTINCT CASE WHEN rr.request_type = 'return' THEN rrl.request_line_id END) as times_returned,
    COUNT(DISTINCT CASE WHEN rr.request_type = 'exchange' THEN rrl.request_line_id END) as times_exchanged,
    ROUND(COUNT(DISTINCT CASE WHEN rr.request_type = 'return' THEN rrl.request_line_id END)::DECIMAL / 
          NULLIF(COUNT(DISTINCT ol.order_line_id), 0) * 100, 1) as return_rate_pct
FROM variations v
JOIN products p ON v.product_id = p.product_id
JOIN skus s ON v.variation_id = s.variation_id
LEFT JOIN order_lines ol ON s.sku_id = ol.sku_id
LEFT JOIN return_request_lines rrl ON ol.order_line_id = rrl.original_order_line_id
LEFT JOIN return_requests rr ON rrl.request_id = rr.request_id
GROUP BY v.variation_id, p.name, v.color_name;

-- Return/Exchange rate by SKU (most granular)
CREATE VIEW sku_return_rates AS
SELECT 
    s.sku_id,
    s.sku_code,
    p.name as product_name,
    v.color_name,
    s.size,
    COUNT(DISTINCT ol.order_line_id) as times_sold,
    COUNT(DISTINCT CASE WHEN rr.request_type = 'return' THEN rrl.request_line_id END) as times_returned,
    COUNT(DISTINCT CASE WHEN rr.request_type = 'exchange' THEN rrl.request_line_id END) as times_exchanged,
    ROUND(COUNT(DISTINCT CASE WHEN rr.request_type = 'return' THEN rrl.request_line_id END)::DECIMAL / 
          NULLIF(COUNT(DISTINCT ol.order_line_id), 0) * 100, 1) as return_rate_pct,
    -- Most common return reason for this SKU
    MODE() WITHIN GROUP (ORDER BY rr.reason_category) as top_return_reason
FROM skus s
JOIN variations v ON s.variation_id = v.variation_id
JOIN products p ON v.product_id = p.product_id
LEFT JOIN order_lines ol ON s.sku_id = ol.sku_id
LEFT JOIN return_request_lines rrl ON ol.order_line_id = rrl.original_order_line_id
LEFT JOIN return_requests rr ON rrl.request_id = rr.request_id
GROUP BY s.sku_id, s.sku_code, p.name, v.color_name, s.size;

-- Return reasons breakdown
CREATE VIEW return_reasons_summary AS
SELECT 
    reason_category,
    COUNT(*) as total_requests,
    COUNT(CASE WHEN request_type = 'return' THEN 1 END) as returns,
    COUNT(CASE WHEN request_type = 'exchange' THEN 1 END) as exchanges,
    ROUND(COUNT(*)::DECIMAL / SUM(COUNT(*)) OVER() * 100, 1) as pct_of_total
FROM return_requests
WHERE status != 'cancelled'
GROUP BY reason_category
ORDER BY total_requests DESC;
```

**Return/Exchange Dashboard Features**
- Pending returns queue (sorted by age)
- Returns in transit (with courier tracking)
- Items awaiting inspection
- Resolution summary (refund vs exchange vs rejected)
- Return rate alerts (flag products/SKUs with >10% return rate)
- Customer flagging (frequent returners)
- Reason analysis (size issues point to sizing guide problems)

---

### 7. Customer Feedback

Capture and analyze feedback at product, variation, and SKU level.

**Feedback Table**
| Field | Type | Description |
|-------|------|-------------|
| feedback_id | UUID | Primary key |
| customer_id | FK | Links to customer (nullable for anonymous) |
| order_id | FK | Nullable - links to specific order |
| order_line_id | FK | Nullable - links to specific item purchased |
| source | Enum | post_delivery, review_request, support, manual, shopify_review |
| feedback_type | Enum | rating, review, complaint, suggestion, praise |
| status | Enum | new, acknowledged, actioned, resolved, archived |

**Feedback Ratings Table** (Structured ratings)
| Field | Type | Description |
|-------|------|-------------|
| rating_id | UUID | Primary key |
| feedback_id | FK | Links to feedback |
| dimension | Enum | overall, quality, fit, comfort, value, packaging |
| score | Int | 1-5 rating |

**Feedback Content Table** (Free-form content)
| Field | Type | Description |
|-------|------|-------------|
| content_id | UUID | Primary key |
| feedback_id | FK | Links to feedback |
| title | String | Review title/summary |
| body | Text | Full review/comment text |
| pros | Text | What they liked |
| cons | Text | What they didn't like |
| would_recommend | Boolean | |

**Feedback Media Table** (Photos/videos)
| Field | Type | Description |
|-------|------|-------------|
| media_id | UUID | Primary key |
| feedback_id | FK | Links to feedback |
| media_type | Enum | image, video |
| url | String | S3/CDN URL |
| caption | String | Optional caption |

**Feedback Product Links Table** (Connect feedback to products)
| Field | Type | Description |
|-------|------|-------------|
| link_id | UUID | Primary key |
| feedback_id | FK | Links to feedback |
| product_id | FK | Nullable - product-level feedback |
| variation_id | FK | Nullable - variation-level feedback |
| sku_id | FK | Nullable - SKU-level feedback |

**Feedback Tags Table** (Categorization)
| Field | Type | Description |
|-------|------|-------------|
| tag_id | UUID | Primary key |
| feedback_id | FK | Links to feedback |
| tag | String | e.g., "sizing_runs_large", "fabric_quality", "delivery_issue" |

**Feedback Analytics Views**

```sql
-- Product-level feedback summary
CREATE VIEW product_feedback_summary AS
SELECT 
    p.product_id,
    p.name as product_name,
    p.category,
    COUNT(DISTINCT f.feedback_id) as total_feedback,
    ROUND(AVG(CASE WHEN fr.dimension = 'overall' THEN fr.score END), 1) as avg_overall_rating,
    ROUND(AVG(CASE WHEN fr.dimension = 'quality' THEN fr.score END), 1) as avg_quality_rating,
    ROUND(AVG(CASE WHEN fr.dimension = 'fit' THEN fr.score END), 1) as avg_fit_rating,
    ROUND(AVG(CASE WHEN fr.dimension = 'comfort' THEN fr.score END), 1) as avg_comfort_rating,
    ROUND(AVG(CASE WHEN fr.dimension = 'value' THEN fr.score END), 1) as avg_value_rating,
    COUNT(CASE WHEN fc.would_recommend = TRUE THEN 1 END) as would_recommend_count,
    ROUND(COUNT(CASE WHEN fc.would_recommend = TRUE THEN 1 END)::DECIMAL / 
          NULLIF(COUNT(fc.would_recommend), 0) * 100, 0) as recommend_pct
FROM products p
LEFT JOIN feedback_product_links fpl ON p.product_id = fpl.product_id
LEFT JOIN feedback f ON fpl.feedback_id = f.feedback_id
LEFT JOIN feedback_ratings fr ON f.feedback_id = fr.feedback_id
LEFT JOIN feedback_content fc ON f.feedback_id = fc.feedback_id
GROUP BY p.product_id, p.name, p.category;

-- Variation-level feedback (product + color)
CREATE VIEW variation_feedback_summary AS
SELECT 
    v.variation_id,
    p.name as product_name,
    v.color_name,
    COUNT(DISTINCT f.feedback_id) as total_feedback,
    ROUND(AVG(CASE WHEN fr.dimension = 'overall' THEN fr.score END), 1) as avg_rating,
    -- Common tags for this variation
    ARRAY_AGG(DISTINCT ft.tag) FILTER (WHERE ft.tag IS NOT NULL) as common_tags
FROM variations v
JOIN products p ON v.product_id = p.product_id
LEFT JOIN feedback_product_links fpl ON v.variation_id = fpl.variation_id
LEFT JOIN feedback f ON fpl.feedback_id = f.feedback_id
LEFT JOIN feedback_ratings fr ON f.feedback_id = fr.feedback_id AND fr.dimension = 'overall'
LEFT JOIN feedback_tags ft ON f.feedback_id = ft.feedback_id
GROUP BY v.variation_id, p.name, v.color_name;

-- SKU-level feedback (for size-specific issues)
CREATE VIEW sku_feedback_summary AS
SELECT 
    s.sku_id,
    s.sku_code,
    p.name as product_name,
    v.color_name,
    s.size,
    COUNT(DISTINCT f.feedback_id) as total_feedback,
    ROUND(AVG(CASE WHEN fr.dimension = 'fit' THEN fr.score END), 1) as avg_fit_rating,
    -- Fit issue detection
    CASE 
        WHEN AVG(CASE WHEN fr.dimension = 'fit' THEN fr.score END) < 3.0 THEN 'fit_issues_detected'
        ELSE 'ok'
    END as fit_alert
FROM skus s
JOIN variations v ON s.variation_id = v.variation_id
JOIN products p ON v.product_id = p.product_id
LEFT JOIN feedback_product_links fpl ON s.sku_id = fpl.sku_id
LEFT JOIN feedback f ON fpl.feedback_id = f.feedback_id
LEFT JOIN feedback_ratings fr ON f.feedback_id = fr.feedback_id
GROUP BY s.sku_id, s.sku_code, p.name, v.color_name, s.size;

-- Recent feedback feed (for dashboard)
CREATE VIEW recent_feedback AS
SELECT 
    f.feedback_id,
    f.created_at,
    c.first_name || ' ' || c.last_name as customer_name,
    f.source,
    f.feedback_type,
    f.status,
    COALESCE(p.name, 'General') as product_name,
    v.color_name,
    s.size,
    fr_overall.score as overall_rating,
    fc.title,
    LEFT(fc.body, 200) as preview
FROM feedback f
LEFT JOIN customers c ON f.customer_id = c.customer_id
LEFT JOIN feedback_product_links fpl ON f.feedback_id = fpl.feedback_id
LEFT JOIN products p ON fpl.product_id = p.product_id
LEFT JOIN variations v ON fpl.variation_id = v.variation_id
LEFT JOIN skus s ON fpl.sku_id = s.sku_id
LEFT JOIN feedback_ratings fr_overall ON f.feedback_id = fr_overall.feedback_id AND fr_overall.dimension = 'overall'
LEFT JOIN feedback_content fc ON f.feedback_id = fc.feedback_id
ORDER BY f.created_at DESC
LIMIT 50;
```

**Feedback Collection Triggers**
1. **Post-delivery email** (7 days after delivery) — automated review request
2. **Support ticket closure** — prompt for feedback
3. **Shopify review sync** — import reviews from Shopify
4. **Manual entry** — for phone/WhatsApp feedback

**Feedback Dashboard Features**
- Recent feedback feed (newest first)
- Products with low ratings (alert for <3.5 avg)
- Fit issues by size (identify sizing problems)
- Common complaint tags (trending issues)
- NPS-style would-recommend tracking
- Customer testimonials queue (for marketing)

---

### 8. Production Planning

**Tailors Table**
| Field | Type | Description |
|-------|------|-------------|
| tailor_id | UUID | Primary key |
| name | String | |
| specializations | Array | product_types they excel at |
| daily_capacity_mins | Int | Available working time |
| is_active | Boolean | |

**Production Batches Table**
| Field | Type | Description |
|-------|------|-------------|
| batch_id | UUID | Primary key |
| batch_date | Date | Production date |
| tailor_id | FK | Assigned tailor |
| sku_id | FK | What's being produced |
| qty_planned | Int | Pieces to produce |
| qty_completed | Int | Pieces finished |
| priority | Enum | order_fulfillment, stock_replenishment |
| source_order_line_id | FK | Nullable - if for specific order |
| status | Enum | planned, in_progress, completed, cancelled |
| notes | Text | |
| created_at | Timestamp | |
| completed_at | Timestamp | |

**Production Capacity Config**
| Field | Type | Description |
|-------|------|-------------|
| product_type | Enum | |
| daily_capacity | Int | Max pieces per day (all tailors) |
| priority_weight | Decimal | For scheduling algorithm |

**Production Planning Algorithm** (Pseudo-logic)
```
1. Get all pending order lines (status = pending, ordered by order_date ASC)
2. For each order line:
   a. Check inventory balance for SKU
   b. If stock available → mark as "allocated", create outward txn reservation
   c. If no stock but fabric available:
      - Check daily capacity for product type
      - If capacity available → create production batch
      - Deduct fabric consumption from balance
   d. If no fabric → flag for fabric ordering

3. After order fulfillment needs met, check stock replenishment:
   a. For each SKU where current_balance < target_stock_qty
   b. Calculate replenishment need
   c. If fabric available and capacity remaining → create production batch

4. Assign batches to tailors based on specialization and capacity
```

**Target Stock Calculation**
```sql
-- Based on outward velocity
SELECT 
    sku_id,
    CASE target_stock_method
        WHEN '7day' THEN AVG(daily_outward) * 7 * 1.2  -- 20% buffer
        WHEN '14day' THEN AVG(daily_outward) * 14 * 1.15
        WHEN '28day' THEN AVG(daily_outward) * 28 * 1.1
        ELSE target_stock_qty  -- manual override
    END as recommended_target
FROM (
    SELECT 
        sku_id,
        DATE(created_at) as date,
        SUM(qty) as daily_outward
    FROM inventory_transactions
    WHERE txn_type = 'outward' 
    AND reason = 'sale'
    AND created_at > NOW() - INTERVAL '28 days'
    GROUP BY sku_id, DATE(created_at)
) daily_data
GROUP BY sku_id
```

---

### 6. Fabric Planning

**Fabric Stock Analysis View**
```sql
SELECT 
    f.fabric_id,
    f.name as fabric_name,
    fb.current_balance,
    f.unit,
    
    -- Average daily consumption (last 28 days)
    COALESCE(
        (SELECT SUM(qty) / 28.0 
         FROM fabric_transactions 
         WHERE fabric_id = f.fabric_id 
         AND txn_type = 'outward'
         AND created_at > NOW() - INTERVAL '28 days'),
        0
    ) as avg_daily_consumption,
    
    -- Days of stock remaining
    CASE 
        WHEN avg_daily_consumption > 0 
        THEN fb.current_balance / avg_daily_consumption
        ELSE NULL 
    END as days_of_stock,
    
    -- Reorder point (lead time + 7 day buffer)
    avg_daily_consumption * (f.lead_time_days + 7) as reorder_point,
    
    -- Order reminder
    CASE 
        WHEN fb.current_balance <= (avg_daily_consumption * (f.lead_time_days + 7))
        THEN 'ORDER NOW'
        WHEN fb.current_balance <= (avg_daily_consumption * (f.lead_time_days + 14))
        THEN 'ORDER SOON'
        ELSE 'OK'
    END as status,
    
    -- Suggested order qty (30 days stock after lead time)
    GREATEST(
        f.min_order_qty,
        (avg_daily_consumption * 30) - fb.current_balance + (avg_daily_consumption * f.lead_time_days)
    ) as suggested_order_qty

FROM fabrics f
LEFT JOIN fabric_balance_view fb ON f.fabric_id = fb.fabric_id
WHERE f.is_active = TRUE
```

**Fabric Orders Table** (For tracking POs to suppliers)
| Field | Type | Description |
|-------|------|-------------|
| fabric_order_id | UUID | Primary key |
| fabric_id | FK | |
| supplier_id | FK | |
| qty_ordered | Decimal | |
| unit | Enum | |
| cost_per_unit | Decimal | At time of order |
| total_cost | Decimal | |
| order_date | Date | |
| expected_date | Date | |
| received_date | Date | Nullable |
| qty_received | Decimal | |
| status | Enum | ordered, partial, received, cancelled |
| notes | Text | |

---

### 7. Shopify Integration

Real-time sync between COH ERP and Shopify store via webhooks and API calls.

**Webhook Endpoints (Inbound from Shopify)**

| Webhook | Trigger | Action |
|---------|---------|--------|
| orders/create | New order placed | Create order + order lines in ERP |
| orders/updated | Order modified | Sync status, notes, customer info |
| orders/fulfilled | Order fulfilled in Shopify | Update AWB, courier, shipped status |
| orders/cancelled | Order cancelled | Mark order cancelled, release allocations |
| refunds/create | Refund processed | Create return record, inventory inward if applicable |

**Order Sync Webhook Handler** (orders/create)
```javascript
// Webhook: orders/create
async function handleOrderCreate(shopifyOrder) {
  const order = await db.orders.create({
    order_number: shopifyOrder.name, // e.g., "#COH-1234"
    shopify_order_id: shopifyOrder.id,
    channel: 'shopify',
    customer_name: shopifyOrder.customer?.first_name + ' ' + shopifyOrder.customer?.last_name,
    customer_email: shopifyOrder.customer?.email,
    customer_phone: shopifyOrder.customer?.phone,
    shipping_address: shopifyOrder.shipping_address,
    order_date: shopifyOrder.created_at,
    customer_notes: shopifyOrder.note,
    status: 'open',
    total_amount: shopifyOrder.total_price,
  });

  // Create order lines
  for (const item of shopifyOrder.line_items) {
    const sku = await db.skus.findByCode(item.sku);
    if (sku) {
      await db.orderLines.create({
        order_id: order.order_id,
        shopify_line_id: item.id,
        sku_id: sku.sku_id,
        qty: item.quantity,
        unit_price: item.price,
        line_status: 'pending',
      });
    }
  }

  // Trigger allocation check
  await checkAndAllocateInventory(order.order_id);
}
```

**Order Update Webhook Handler** (orders/updated, orders/fulfilled)
```javascript
// Webhook: orders/updated
async function handleOrderUpdate(shopifyOrder) {
  const order = await db.orders.findByShopifyId(shopifyOrder.id);
  if (!order) return;

  // Sync tracking info from Shopify fulfillments
  const fulfillment = shopifyOrder.fulfillments?.[0];
  if (fulfillment) {
    await db.orders.update(order.order_id, {
      awb_number: fulfillment.tracking_number,
      courier: fulfillment.tracking_company,
      shipped_at: fulfillment.created_at,
      status: 'shipped',
      synced_at: new Date(),
    });

    // Mark all lines as shipped
    await db.orderLines.updateByOrder(order.order_id, {
      line_status: 'shipped',
      shipped_at: fulfillment.created_at,
    });
  }

  // Sync delivery status if available
  if (shopifyOrder.fulfillment_status === 'delivered') {
    await db.orders.update(order.order_id, {
      status: 'delivered',
      delivered_at: new Date(),
    });
  }
}
```

**Outbound Sync to Shopify** (ERP → Shopify)

| Action | Trigger | Shopify API Call |
|--------|---------|------------------|
| Inventory update | Inventory txn created | PUT /inventory_levels/set |
| Fulfillment create | Order marked shipped | POST /orders/{id}/fulfillments |
| Order note update | Internal note added | PUT /orders/{id} |

**Inventory Sync Service**

```javascript
// Sync inventory levels to Shopify
async function syncInventoryToShopify(sku_id) {
  const sku = await db.skus.findById(sku_id);
  const balance = await db.inventoryBalance.getBySku(sku_id);
  
  // Get Shopify inventory item ID (stored during initial product sync)
  const shopifyInventoryItemId = sku.shopify_inventory_item_id;
  const shopifyLocationId = config.SHOPIFY_LOCATION_ID;

  await shopifyClient.inventoryLevel.set({
    inventory_item_id: shopifyInventoryItemId,
    location_id: shopifyLocationId,
    available: balance.current_balance,
  });
}

// Hook into inventory transaction creation
db.inventoryTransactions.afterCreate(async (txn) => {
  await syncInventoryToShopify(txn.sku_id);
});
```

**Stock Availability Monitor**

Compares Shopify listed inventory against actual availability (ready stock + producible from fabric).

```sql
CREATE VIEW shopify_stock_monitor AS
SELECT 
    s.sku_id,
    s.sku_code,
    s.shopify_inventory_item_id,
    
    -- What Shopify thinks we have
    shopify.available_qty as shopify_listed,
    
    -- What we actually have ready
    COALESCE(inv.current_balance, 0) as ready_stock,
    
    -- What we can produce from fabric
    FLOOR(
        COALESCE(fab.current_balance, 0) / NULLIF(s.fabric_consumption, 0)
    ) as producible_qty,
    
    -- Total available (ready + producible)
    COALESCE(inv.current_balance, 0) + 
    FLOOR(COALESCE(fab.current_balance, 0) / NULLIF(s.fabric_consumption, 0)) as total_available,
    
    -- Alert flags
    CASE 
        WHEN shopify.available_qty > COALESCE(inv.current_balance, 0) + 
             FLOOR(COALESCE(fab.current_balance, 0) / NULLIF(s.fabric_consumption, 0))
        THEN 'OVERSOLD_RISK'
        WHEN shopify.available_qty > COALESCE(inv.current_balance, 0) 
             AND shopify.available_qty <= COALESCE(inv.current_balance, 0) + 
             FLOOR(COALESCE(fab.current_balance, 0) / NULLIF(s.fabric_consumption, 0))
        THEN 'PRODUCTION_REQUIRED'
        ELSE 'OK'
    END as stock_status,
    
    -- Recommended action
    CASE 
        WHEN shopify.available_qty > COALESCE(inv.current_balance, 0) + 
             FLOOR(COALESCE(fab.current_balance, 0) / NULLIF(s.fabric_consumption, 0))
        THEN 'SET_OUT_OF_STOCK'
        ELSE 'NO_ACTION'
    END as recommended_action

FROM skus s
LEFT JOIN inventory_balance_view inv ON s.sku_id = inv.sku_id
LEFT JOIN (
    SELECT v.variation_id, fb.current_balance
    FROM variations v
    JOIN fabric_balance_view fb ON v.fabric_id = fb.fabric_id
) fab ON s.variation_id = fab.variation_id
LEFT JOIN shopify_inventory_cache shopify ON s.sku_id = shopify.sku_id
WHERE s.is_active = TRUE
AND s.shopify_inventory_item_id IS NOT NULL;
```

**Shopify Inventory Cache Table**
| Field | Type | Description |
|-------|------|-------------|
| sku_id | FK | Links to SKU |
| shopify_inventory_item_id | String | Shopify's inventory item ID |
| available_qty | Int | Last known Shopify quantity |
| last_synced | Timestamp | When we last pulled from Shopify |

**Stock Monitor Cron Job**
```javascript
// Run every 15 minutes
async function runStockMonitor() {
  // 1. Pull current inventory levels from Shopify
  const shopifyInventory = await shopifyClient.inventoryLevel.list({
    location_ids: config.SHOPIFY_LOCATION_ID,
  });
  
  // 2. Update cache
  for (const item of shopifyInventory) {
    await db.shopifyInventoryCache.upsert({
      shopify_inventory_item_id: item.inventory_item_id,
      available_qty: item.available,
      last_synced: new Date(),
    });
  }
  
  // 3. Check for oversold risks
  const risks = await db.query(`
    SELECT * FROM shopify_stock_monitor 
    WHERE stock_status = 'OVERSOLD_RISK'
  `);
  
  // 4. Auto-set to zero if oversold
  for (const risk of risks) {
    await shopifyClient.inventoryLevel.set({
      inventory_item_id: risk.shopify_inventory_item_id,
      location_id: config.SHOPIFY_LOCATION_ID,
      available: 0,
    });
    
    // Log the action
    await db.stockAlerts.create({
      sku_id: risk.sku_id,
      alert_type: 'auto_out_of_stock',
      details: `Set to OOS. Ready: ${risk.ready_stock}, Producible: ${risk.producible_qty}, Shopify had: ${risk.shopify_listed}`,
    });
  }
  
  // 5. Send alert for production-required items
  const productionNeeded = await db.query(`
    SELECT * FROM shopify_stock_monitor 
    WHERE stock_status = 'PRODUCTION_REQUIRED'
  `);
  
  if (productionNeeded.length > 0) {
    await sendAlert('production_required', productionNeeded);
  }
}
```

**Sync Status Dashboard**
- Last sync timestamp per data type
- Failed webhook log with retry option
- Manual sync trigger buttons
- Inventory discrepancy report (ERP vs Shopify)
- Stock alert history

---

## System Modules & UI Structure

### Module 1: Products & Catalog
- **Products List**: Grid view of all products with quick filters
- **Product Detail**: Full hierarchy view (product → variations → SKUs)
- **SKU Management**: Fabric linking, consumption settings, target stock config
- **COGS View**: SKU-wise cost breakdown (fabric, labor, packaging)
- **Margin Analysis**: Profitability by product/category, alerts for low-margin items
- **Bulk Operations**: Import/export, mass price updates

### Module 2: Inventory
- **Dashboard**: SKU-wise current stock with status indicators
- **Inward Entry**: Form for production receipts, returns
- **Outward Entry**: Sales, damages, adjustments
- **Transaction History**: Filterable log with export
- **Stock Alerts**: Below-target notifications
- **Shopify Sync Status**: Discrepancy alerts, sync logs

### Module 3: Fabrics
- **Fabric Catalog**: All fabrics with type grouping
- **Balance Dashboard**: Current stock, consumption rates, days remaining
- **Inward/Outward Entry**: Supplier receipts, production consumption
- **Reorder Alerts**: Visual indicators for ordering
- **Supplier Management**: Contacts, lead times, pricing history

### Module 4: Orders
- **Open Orders Queue**: All orders with status = 'open'
  - Line-level status tracking (pending → allocated → picked → packed)
  - Inventory/fabric availability per line
  - Quick actions: allocate, pick, pack
  - Filters by fulfillment stage
- **Order Detail**: Line items with full status timeline
- **Bulk Fulfillment**: Multi-select for batch pick/pack operations
- **Shipped Orders View**: Separate tab for tracking
  - AWB numbers, courier info
  - Days in transit, delivery status
  - Delayed delivery alerts (>7 days)
- **Order Processing**: Allocate → Pick → Pack → Ship workflow

### Module 5: Customers (NEW)
- **Customer List**: Searchable list with tier badges (bronze/silver/gold/platinum)
- **Customer Detail**:
  - Contact info, addresses
  - Order history (all orders, total LTV)
  - Return/exchange history with rates
  - Product affinity (what they buy most)
  - Feedback they've submitted
- **Customer Metrics Dashboard**:
  - LTV distribution histogram
  - Repeat purchase rate
  - Average order value trends
  - Customer tier breakdown
- **High-Value Customers**: Platinum/gold customers for VIP treatment
- **At-Risk Customers**: High LTV + long time since last order
- **Frequent Returners**: Customers with return rate >20%

### Module 6: Returns & Exchanges (NEW)
- **Returns Queue**: All active return/exchange requests
  - Status-based tabs: Requested, In Transit, Received, Inspecting, Resolved
  - Age indicator (days since created)
  - Priority flags for urgent items
- **Return Detail**:
  - Original order info
  - Items being returned/exchanged
  - Full status timeline with timestamps
  - Shipping/tracking info (reverse + forward)
  - Inspection notes and photos
  - Resolution actions
- **Create Return/Exchange**: Form to initiate new request
  - Order lookup
  - Select items, reason
  - Choose return vs exchange
  - Generate reverse shipping label
- **Returns Analytics**:
  - Return/exchange rate by customer
  - Return rate by product/variation/SKU
  - Common return reasons
  - Resolution breakdown (refund vs exchange vs rejected)
  - Flagged products (>10% return rate)
- **Reverse Logistics**:
  - Schedule pickups with courier
  - Track reverse shipments
  - Receive and log at warehouse

### Module 7: Customer Feedback (NEW)
- **Feedback Feed**: Recent feedback, newest first
  - Filter by source, type, status, rating
  - Quick acknowledge/action buttons
- **Feedback Detail**:
  - Customer info, linked order
  - All ratings (overall, quality, fit, comfort, value)
  - Full review content, pros/cons
  - Attached media (photos/videos)
  - Action history, internal notes
- **Product Feedback View**:
  - Aggregate ratings by product
  - Rating trends over time
  - Common tags/themes
  - Low-rating alerts
- **Collect Feedback**:
  - Manual entry form
  - Post-delivery email trigger config
  - Shopify review sync status
- **Testimonials Queue**: High-rating reviews for marketing use
- **Issues Dashboard**:
  - Products with low ratings (<3.5)
  - Fit issues by size
  - Recurring complaint themes

### Module 8: Production
- **Production Planner**: Daily/weekly capacity view
- **Batch Management**: Create, assign, track batches
- **Tailor Dashboard**: Individual workload and completion
- **Auto-Planning**: Generate batches from orders + stock targets
- **Completion Entry**: Mark batches done, auto-inward inventory

### Module 9: Shopify Integration
- **Sync Dashboard**: Last sync times, health status
- **Stock Monitor**: Shopify vs ERP inventory comparison
  - Oversold risk alerts
  - Auto-OOS actions log
- **Webhook Logs**: Incoming webhook history, failures, retries
- **Manual Sync**: Force sync buttons for inventory, orders, customers
- **Settings**: API keys, location mapping, sync frequency

### Module 10: Reports & Analytics
- **Sales Velocity**: SKU-wise movement trends
- **Inventory Turnover**: Days on hand, slow movers
- **Production Efficiency**: Tailor performance, capacity utilization
- **Fabric Usage**: Consumption vs estimates, shrinkage tracking
- **Reorder Reports**: Upcoming fabric needs
- **COGS & Margin Reports**: Profitability analysis, cost trends
- **Fulfillment Metrics**: Time to ship, stage bottlenecks
- **Customer Analytics**: LTV trends, cohort analysis, retention rates
- **Returns Analytics**: Return rates, reason analysis, cost of returns
- **Feedback Summary**: Rating trends, NPS scores, issue tracking


---

## Technical Architecture

### Stack Recommendation

**Frontend**
- React with TypeScript
- TailwindCSS for styling
- React Query for data fetching
- React Table for data grids
- Chart.js or Recharts for analytics

**Backend**
- Node.js with Express or Fastify
- PostgreSQL database
- Prisma ORM
- REST API (or tRPC if you want type-safety)

**Infrastructure**
- Vercel or Railway for hosting
- Supabase for managed Postgres (or self-hosted)
- Basic auth to start (can add proper auth later)

### Database Schema Diagram

```
┌─────────────────┐
│    PRODUCTS     │
├─────────────────┤
│ product_id (PK) │
│ name            │
│ category        │
│ product_type    │
└────────┬────────┘
         │ 1:N
         ▼
┌─────────────────┐      ┌─────────────────┐
│   VARIATIONS    │      │   FABRIC_TYPES  │
├─────────────────┤      ├─────────────────┤
│ variation_id(PK)│      │ fabric_type_id  │
│ product_id (FK) │      │ name            │
│ color_name      │      │ unit            │
│ fabric_id (FK)  │◄─────│ avg_shrinkage   │
└────────┬────────┘      └────────┬────────┘
         │ 1:N                    │ 1:N
         ▼                        ▼
┌─────────────────┐      ┌─────────────────┐
│      SKUS       │      │    FABRICS      │
├─────────────────┤      ├─────────────────┤
│ sku_id (PK)     │      │ fabric_id (PK)  │
│ sku_code        │      │ fabric_type_id  │
│ variation_id(FK)│      │ name            │
│ size            │      │ cost_per_unit   │
│ fabric_consump. │      │ supplier_id     │
│ target_stock    │      └────────┬────────┘
└────────┬────────┘               │
         │                        │
         ▼                        ▼
┌─────────────────┐      ┌─────────────────┐
│ INVENTORY_TXNS  │      │  FABRIC_TXNS    │
├─────────────────┤      ├─────────────────┤
│ txn_id (PK)     │      │ txn_id (PK)     │
│ sku_id (FK)     │      │ fabric_id (FK)  │
│ txn_type        │      │ txn_type        │
│ qty             │      │ qty             │
│ reason          │      │ reason          │
│ reference_id    │      │ reference_id    │
└─────────────────┘      └─────────────────┘

┌─────────────────┐      ┌─────────────────┐
│     ORDERS      │      │    TAILORS      │
├─────────────────┤      ├─────────────────┤
│ order_id (PK)   │      │ tailor_id (PK)  │
│ order_number    │      │ name            │
│ customer_name   │      │ specializations │
│ status          │      │ daily_capacity  │
└────────┬────────┘      └────────┬────────┘
         │ 1:N                    │ 1:N
         ▼                        ▼
┌─────────────────┐      ┌─────────────────┐
│  ORDER_LINES    │      │PRODUCTION_BATCH │
├─────────────────┤      ├─────────────────┤
│ order_line_id   │      │ batch_id (PK)   │
│ order_id (FK)   │      │ tailor_id (FK)  │
│ sku_id (FK)     │      │ sku_id (FK)     │
│ qty             │      │ qty_planned     │
│ status          │◄────►│ order_line_id   │
│ production_batch│      │ status          │
└─────────────────┘      └─────────────────┘
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- Database setup with core tables
- Products/Variations/SKUs CRUD
- Fabrics catalog and types
- Basic auth and user management

### Phase 2: Inventory Core (Week 3-4)
- Inventory transaction entry
- Balance calculations and views
- Fabric transaction entry
- Balance dashboards

### Phase 3: Orders & Customers (Week 5-6)
- Orders import (manual + Shopify sync)
- Order lines management
- Customer sync from Shopify
- Customer metrics views (LTV, order count)
- Fulfillment status calculation
- Order processing workflows

### Phase 4: Production (Week 7-8)
- Tailors management
- Production batch creation
- Capacity planning views
- Batch completion → inventory inward flow

### Phase 5: Returns & Exchanges (Week 9-10)
- Return request creation and workflow
- 6-step status tracking
- Reverse shipping integration
- Inspection and resolution flows
- Return/exchange rate analytics (customer, product, SKU level)
- Inventory inward for returned items

### Phase 6: Customer Feedback (Week 11-12)
- Feedback collection forms
- Multi-dimension ratings
- Product/variation/SKU linking
- Feedback analytics views
- Post-delivery email triggers
- Shopify review sync

### Phase 7: Intelligence (Week 13-14)
- Auto production planning algorithm
- Target stock recommendations
- Fabric reorder alerts
- Customer segmentation (tiers)
- Return rate alerts (flag problematic products)
- Low rating alerts

### Phase 8: Polish (Week 15-16)
- Bulk operations
- Export/reporting
- Mobile-friendly views for warehouse use
- Dashboard refinements
- Customer LTV and cohort analytics

---

## Key Workflows

### Order Fulfillment Flow (Shopify → Shipped)
```
┌─────────────────────────────────────────────────────────────────┐
│  SHOPIFY WEBHOOK: orders/create                                 │
└─────────────────────┬───────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  Create Order + Order Lines in ERP                              │
│  Line Status: PENDING                                           │
└─────────────────────┬───────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  Auto-Allocation Check                                          │
├─────────────────────────────────────────────────────────────────┤
│  For each line:                                                 │
│  ├─ Stock available? → ALLOCATE (soft reserve)                  │
│  ├─ No stock, fabric available? → Create production batch       │
│  └─ No fabric? → Flag for fabric order                          │
└─────────────────────┬───────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  ALLOCATED                                                      │
│  (Inventory reserved, waiting for pick)                         │
└─────────────────────┬───────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  PICKED                                                         │
│  (Physically pulled from shelf, scan/confirm)                   │
└─────────────────────┬───────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  PACKED                                                         │
│  (In box, label printed, ready for courier)                     │
└─────────────────────┬───────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  SHIPPED                                                        │
│  ├─ Create inventory OUTWARD transaction                        │
│  ├─ Update AWB, courier in ERP                                  │
│  ├─ Sync to Shopify (create fulfillment)                        │
│  └─ Move order to "Shipped Orders" view                         │
└─────────────────────────────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  SHOPIFY WEBHOOK: orders/fulfilled                              │
│  (Confirms sync, updates delivered status when available)       │
└─────────────────────────────────────────────────────────────────┘
```

### Production Completion Flow
```
Tailor completes batch
    ↓
Mark batch "completed"
    ↓
Auto-create inventory inward txn
(qty = qty_completed, reason = production)
    ↓
Auto-create fabric outward txn
(qty = qty_completed × fabric_consumption)
    ↓
If batch linked to order_line:
    → Update order_line status
    → Check if full order ready
```

---

## Data Entry Simplifications

To keep daily operations simple:

1. **Quick Inward**: Single form - scan/enter SKU, enter qty, done
2. **Quick Outward**: Auto-generated from order shipping
3. **Batch Completion**: One-click "done" with optional partial qty
4. **Fabric Receipt**: Barcode/reference to PO, enter received qty

---

## Questions to Resolve

1. ~~**Shopify Integration**: Immediate priority or manual order entry first?~~ ✅ Webhook-based sync
2. **Multi-warehouse**: Single location or need to track multiple?
3. **Returns Handling**: Simple inventory adjustment or full RMA tracking?
4. ~~**Costing**: Need full cost tracking (fabric + labor) or just inventory?~~ ✅ Full COGS tracking
5. **User Roles**: Who needs access to what? (Production team vs management)
6. **Mobile**: Warehouse team need mobile-friendly picking/packing interface?
7. **Shopify Multi-location**: Do you use multiple Shopify locations, or single warehouse?
8. **Labor Rate**: Is ₹150/hr (~₹2.50/min) a reasonable default for tailor time costing?
9. **Partial Fulfillment**: Ship available items immediately, or hold for complete orders?

---

## Next Steps

1. Confirm data model covers your needs
2. Prioritize which modules are most urgent
3. Decide on build vs buy for Shopify sync
4. Set up development environment
5. Start with Phase 1: Foundation

### Backend

### Frontend

### Database

### Integrations

## Roadmap

<!-- Add planned features and milestones -->

## Technical Decisions

<!-- Document key technical decisions and their rationale -->

## Open Questions

<!-- List architectural questions that need to be resolved -->
