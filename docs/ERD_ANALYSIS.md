# COH-ERP Database Schema Analysis

**Generated**: 2026-01-21
**Schema**: 56 Tables (Atlas ERD)

---

## Executive Summary

The schema is well-designed for the business domain (fashion/apparel D2C with make-to-order production). However, there are **specific redundancies and migration debt** that should be addressed to prevent data inconsistencies and reduce maintenance burden.

**Priority Issues**:
1. Order ↔ OrderLine field duplication (12+ fields)
2. User.role migration incomplete
3. Cost field inheritance confusion

---

## Schema Overview

### Domain Tables

| Domain | Tables | Purpose |
|--------|--------|---------|
| Orders | Order, OrderLine, OrderPayment | Order fulfillment pipeline |
| Products | Product, Variation, Sku, SkuCosting, SkuBomLine | Product catalog hierarchy |
| Materials | Material, Fabric, FabricColour, FabricType, FabricTransaction, FabricOrder | Fabric inventory |
| Inventory | InventoryTransaction, InventoryReconciliation, InventoryReconciliationItem | SKU inventory |
| Returns | ReturnRequest, ReturnRequestLine, ReturnShipping, ReturnStatusHistory, RepackingQueueItem | Returns/exchanges |
| Customers | Customer, Feedback (+ FeedbackContent, FeedbackMedia, FeedbackRating, FeedbackTag) | Customer data |
| BOM | ComponentType, ComponentRole, ProductBomTemplate, VariationBomLine, SkuBomLine | Bill of materials |
| Catalog | TrimItem, ServiceItem, Supplier, Vendor | Supporting items |
| Production | ProductionBatch, Tailor | Manufacturing |
| Users | User, Role, UserPermissionOverride, UserGridPreference | Auth & preferences |
| Shopify | ShopifyOrderCache, ShopifyProductCache, ShopifyInventoryCache | Integration cache |
| System | SyncJob, SystemSetting, WebhookLog, FailedSyncItem, CostConfig, Pincode | Infrastructure |

### Key Hierarchies

```
Products:  Product → Variation → Sku
Materials: Material → Fabric → FabricColour
BOM:       ProductBomTemplate → VariationBomLine → SkuBomLine
```

---

## Redundancies & Duplications

### 1. Order ↔ OrderLine Field Duplication 🔴 HIGH PRIORITY

**12+ fields duplicated between Order and OrderLine:**

| Field | On Order | On OrderLine | Notes |
|-------|----------|--------------|-------|
| `awbNumber` | ✓ | ✓ | Tracking number |
| `courier` | ✓ | ✓ | Shipping provider |
| `shippedAt` | ✓ | ✓ | Ship timestamp |
| `deliveredAt` | ✓ | ✓ | Delivery timestamp |
| `trackingStatus` | ✓ | ✓ | Current status |
| `lastTrackingUpdate` | ✓ | ✓ | Last sync |
| `rtoInitiatedAt` | ✓ | ✓ | RTO start |
| `rtoReceivedAt` | ✓ | ✓ | RTO receipt |
| `isOnHold` | ✓ | ✓ | Hold flag |
| `holdAt` | ✓ | ✓ | Hold timestamp |
| `holdReason` | ✓ | ✓ | Hold reason |
| `holdNotes` | ✓ | ✓ | Hold notes |

**Problem**: Per CLAUDE.md, line-level is authoritative for multi-AWB scenarios. But Order-level fields still exist and get written to.

**Risk**: Data inconsistency when Order and OrderLine values diverge.

**Recommendation**:
- Option A: Remove Order-level tracking fields, compute when needed
- Option B: Keep as denormalized summary, but add strict sync logic
- Either way: Document which is authoritative

---

### 2. Cost Fields Inheritance Confusion 🔴 HIGH PRIORITY

```
Product:    liningCost, packagingCost, trimsCost
Variation:  liningCost, packagingCost, trimsCost, laborMinutes
Sku:        liningCost, packagingCost, trimsCost, laborMinutes
SkuCosting: packagingCost, laborCost, fabricCost, totalCogs
```

**Problem**:
- Unclear which fields are inputs (overrides) vs outputs (calculated)
- `Sku` has cost fields AND `SkuCosting` exists as separate table
- Easy to update wrong field

**Recommendation**:
- Rename to clarify intent: `packagingCostOverride` vs `packagingCostCalculated`
- Or consolidate: Remove from Sku if SkuCosting is always computed
- Document inheritance chain: Product → Variation → Sku → SkuCosting

---

### 3. Fabric Default Fields Redundancy 🟡 MEDIUM

```prisma
FabricType {
  defaultCostPerUnit    Float?
  defaultLeadTimeDays   Int?
  defaultMinOrderQty    Float?
}

Fabric {
  costPerUnit           Float?    // actual value
  leadTimeDays          Int?      // actual value
  minOrderQty           Float?    // actual value
  defaultLeadTimeDays   Int?      // redundant?
  defaultMinOrderQty    Float?    // redundant?
}

FabricColour {
  costPerUnit           Float?    // can override Fabric
  leadTimeDays          Int?      // can override Fabric
  minOrderQty           Float?    // can override Fabric
}
```

**Problem**: `Fabric` has both actual values AND default values. Inheritance should be:
```
FabricType.default* → Fabric.* → FabricColour.*
```

Not:
```
FabricType.default* → Fabric.default* → Fabric.* → FabricColour.*
```

**Recommendation**: Remove `Fabric.defaultLeadTimeDays` and `Fabric.defaultMinOrderQty`

---

### 4. Return Tracking Duplication 🟡 MEDIUM

```prisma
ReturnRequest {
  reverseReceived      Boolean?
  reverseReceivedAt    DateTime?
  reverseInTransitAt   DateTime?
  forwardShippedAt     DateTime?
  forwardDeliveredAt   DateTime?
}

ReturnShipping {
  direction    String   // "reverse" | "forward"
  shippedAt    DateTime?
  deliveredAt  DateTime?
  receivedAt   DateTime?
}
```

**Problem**: ReturnRequest has summary fields that duplicate ReturnShipping data.

**Risk**: Update one, forget the other → data drift.

**Recommendation**:
- Remove from ReturnRequest, compute from ReturnShipping
- Or add trigger/hook to keep in sync

---

### 5. Denormalized Counters (Sync Risk) 🟡 MEDIUM

| Counter | Customer | Product | Sku |
|---------|----------|---------|-----|
| `exchangeCount` | ✓ | ✓ | ✓ |
| `returnCount` | ✓ | ✓ | ✓ |
| `rtoCount` | ✓ | - | - |
| `writeOffCount` | - | ✓ | ✓ |
| `customizationCount` | - | - | ✓ |
| `orderCount` | ✓ | - | - |

**Risk**: Counter drift if mutations don't update all locations.

**Recommendation**:
- Audit that all return/exchange mutations update all relevant tables
- Consider computing on-demand if query performance allows

---

## Migration Debt

### 1. User.role → User.roleId 🔴 HIGH PRIORITY

```prisma
User {
  role    String    // OLD: text like "admin", "user"
  roleId  String?   // NEW: FK to Role table
}
```

**Status**: Dual system exists. Role table has richer permissions (JSON field).

**Action**:
1. Verify all code uses `roleId` not `role`
2. Backfill any users missing `roleId`
3. Drop `role` column via migration

---

### 2. Product.shopifyProductId → shopifyProductIds 🟡 MEDIUM

```prisma
Product {
  shopifyProductId   String?    // singular (old)
  shopifyProductIds  String[]   // array (new)
}
```

**Status**: Migration from single to multi-Shopify-product mapping.

**Action**:
1. Migrate singular values to array
2. Update all code to use array field
3. Drop singular field

---

### 3. Order-level → Line-level Tracking 🟡 UNCLEAR

Identical tracking fields on both Order and OrderLine suggests either:
- (a) Migration in progress from order-level to line-level
- (b) Intentional denormalization

**Action**: Clarify intent and document. If (a), complete migration.

---

### 4. Shopify ID Naming Inconsistency 🟢 LOW

| Table | Field | Style |
|-------|-------|-------|
| Product | `shopifyProductId` | camelCase |
| Product | `shopifyProductIds` | plural |
| Product | `shopifyHandle` | different pattern |
| Variation | `shopifySourceProductId` | has "Source" |
| Variation | `shopifySourceHandle` | has "Source" |
| Sku | `shopifyVariantId` | consistent |
| Sku | `shopifyInventoryItemId` | consistent |

**Action**: Standardize naming when touching these fields.

---

## Justified Complexity (Keep As-Is)

### ✅ Fabric + FabricColour
Not redundant. Fabric-level color for single-color fabrics, FabricColour for variants. Inheritance pattern documented in CLAUDE.md.

### ✅ BOM 3-Tier Structure
Required for accurate costing. Mirrors product hierarchy (Product → Variation → SKU).

### ✅ Separate Inventory vs Fabric Reconciliation
Different units (integer vs decimal), different workflows. Merging would add complexity.

### ✅ ShopifyOrderCache (70+ fields)
Intentional denormalization for query performance. CLAUDE.md prohibits using rawData.

### ✅ Line-level OrderLine Tracking
Required for partial shipments, multi-AWB, mixed delivery states.

### ✅ Supplier vs Vendor Tables
Business distinction (materials vs services) may warrant different fields in future.

---

## Consolidation Candidates (Low Priority)

### Supplier + Vendor
Nearly identical structure. Could consolidate with `type` enum if no divergent fields planned.

### Feedback Sub-tables
If multi-dimensional ratings and structured pros/cons aren't used, could collapse to single table.

---

## Action Plan

### Phase 1: High Priority (Address First)

| Issue | Action | Effort |
|-------|--------|--------|
| User.role migration | Drop text field after verifying roleId usage | Low |
| Order/OrderLine duplication | Document authoritative source, consider removal | Medium |
| Cost field confusion | Rename or consolidate, document inheritance | Medium |

### Phase 2: Medium Priority

| Issue | Action | Effort |
|-------|--------|--------|
| Fabric default* fields | Remove redundant fields | Low |
| Product shopifyProductId | Migrate to array, drop singular | Low |
| Return tracking duplication | Compute from ReturnShipping or add sync | Medium |
| Counter sync | Audit mutation coverage | Medium |

### Phase 3: Low Priority (Opportunistic)

| Issue | Action | Effort |
|-------|--------|--------|
| Shopify ID naming | Standardize when touching | Low |
| Supplier/Vendor consolidation | Evaluate when extending | Low |
| Feedback simplification | Audit usage first | Medium |

---

## Appendix: Key Relationships

```
Order → Customer (N:1)
Order → ShopifyOrderCache (1:1)
Order → OrderLine (1:N)
OrderLine → Sku (N:1)

Sku → Variation → Product (N:1 → N:1)
Product → FabricType (N:1)
Variation → Fabric (N:1)

FabricColour → Fabric → Material (N:1 → N:1)

ReturnRequest → Order (N:1, original)
ReturnRequest → Order (N:1, exchange)
ReturnRequest → ReturnRequestLine (1:N)
ReturnRequestLine → OrderLine (N:1)

BOM: ProductBomTemplate → Product
     VariationBomLine → Variation
     SkuBomLine → Sku
     All BOM lines → ComponentRole → ComponentType
```
