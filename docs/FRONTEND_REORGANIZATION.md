# Frontend Reorganization Plan

> **Living Document** - Updated as UX improvements are implemented

**Last Updated**: 2026-01-05

---

## Current State Analysis

### Navigation (13 items, flat)
```
Dashboard → Products → Inventory → Fabrics → Fabric Count → Orders → 
Picklist → Customers → Returns → Return Inward → Production → Inward → 
Ledgers → Settings
```

### Problems
1. **Too many nav items** - 13 items forces scrolling on mobile
2. **No logical grouping** - Related pages scattered
3. **Confusing names** - "Inward" vs "Return Inward" unclear
4. **Large page files** - 6 pages over 35KB, hard to maintain

### Page Sizes (Largest)
| Page | Size | Lines (est) | Issue |
|------|------|-------------|-------|
| ReturnInward.tsx | 52KB | ~1,400 | Too many features |
| Production.tsx | 50KB | ~1,350 | Multiple modals |
| Returns.tsx | 50KB | ~1,350 | Form + grid |
| Products.tsx | 49KB | ~1,300 | CRUD + tabs |
| ProductionInward.tsx | 46KB | ~1,200 | Scanning + tables |
| Inventory.tsx | 42KB | ~1,100 | Multiple tabs |

---

## Recommended Navigation Structure

### Option A: Grouped Sidebar (Recommended)

```
📊 OVERVIEW
├── Dashboard

📦 CATALOG
├── Products
├── Inventory

🧵 MATERIALS
├── Fabrics
├── Fabric Count
├── Fabric Ledger

🛒 SALES
├── Orders
├── Customers
├── Picklist

🏭 OPERATIONS
├── Production Plan
├── Production Inward

🔄 RETURNS
├── Return Requests
├── Return Inward

⚙️ ADMIN
├── Settings
```

**Benefits**:
- 6 groups instead of 13 items
- Collapsible on mobile
- Clear mental model

---

### Option B: Role-Based Tabs (Alternative)

For different user workflows:

| Role | Primary Tabs |
|------|--------------|
| **Warehouse** | Inward, Picklist, Inventory |
| **Production** | Production Plan, Inward |
| **Sales** | Orders, Customers, Returns |
| **Admin** | All + Settings |

---

## UI Improvements

### 1. Add Breadcrumbs
Show context path on detail pages:
```
Production > Batch #123 > Edit
```

### 2. Quick Actions Bar
Fixed actions for common tasks:
```
[+ New Order] [📷 Scan Inward] [🔍 Search]
```

### 3. Page Tabs Instead of Sub-Pages
Merge related pages:

| Current | Proposed |
|---------|----------|
| Production + Production Inward | Production (Plan / Inward tabs) |
| Returns + Return Inward | Returns (Requests / Receive tabs) |
| Fabrics + Fabric Count + Ledger | Fabrics (Stock / Reconcile / Ledger tabs) |

---

## File Structure Refactor

### Current (Flat)
```
src/
├── pages/
│   ├── Products.tsx (49KB) ❌
│   ├── Production.tsx (50KB) ❌
│   ├── ProductionInward.tsx (46KB) ❌
│   └── ...
└── components/
    ├── orders/
    └── settings/
```

### Proposed (Feature-Based)
```
src/
├── features/
│   ├── catalog/
│   │   ├── ProductsPage.tsx
│   │   ├── ProductForm.tsx
│   │   ├── ProductGrid.tsx
│   │   ├── VariationModal.tsx
│   │   └── SkuTable.tsx
│   │
│   ├── production/
│   │   ├── ProductionPage.tsx (tabs wrapper)
│   │   ├── PlanTab.tsx
│   │   ├── InwardTab.tsx
│   │   ├── BatchModal.tsx
│   │   └── ScanPanel.tsx
│   │
│   ├── returns/
│   │   ├── ReturnsPage.tsx (tabs wrapper)
│   │   ├── RequestsTab.tsx
│   │   ├── ReceiveTab.tsx
│   │   └── ReturnModal.tsx
│   │
│   ├── fabrics/
│   │   ├── FabricsPage.tsx
│   │   ├── StockTab.tsx
│   │   ├── ReconcileTab.tsx
│   │   └── LedgerTab.tsx
│   │
│   └── orders/
│       ├── OrdersPage.tsx
│       ├── OrderGrid.tsx
│       └── OrderDetail.tsx
│
├── shared/
│   ├── ui/
│   │   ├── Modal.tsx
│   │   ├── Table.tsx
│   │   └── Tabs.tsx
│   └── hooks/
│       └── useBarcodeScan.ts
│
└── layout/
    ├── Sidebar.tsx
    ├── Breadcrumbs.tsx
    └── QuickActions.tsx
```

---

## Page Consolidation

### Merge These Pages

| Merge Into | Pages | Benefit |
|------------|-------|---------|
| **Production** | Production.tsx + ProductionInward.tsx | Single context |
| **Returns** | Returns.tsx + ReturnInward.tsx | Single context |
| **Fabrics** | Fabrics.tsx + FabricReconciliation.tsx + Ledgers(fabric tab) | One material hub |

---

## Implementation Priority

### Phase 1: Navigation Grouping (1 day)
- [ ] Update `Layout.tsx` with grouped navigation
- [ ] Add collapsible sections
- [ ] Test mobile responsiveness

### Phase 2: Page Consolidation (2-3 days)
- [ ] Merge Production + ProductionInward
- [ ] Merge Returns + ReturnInward
- [ ] Merge Fabrics + Reconciliation

### Phase 3: File Refactor (3-5 days)
- [ ] Create `features/` directory
- [ ] Split large pages into components
- [ ] Update imports

### Phase 4: Polish (1-2 days)
- [ ] Add breadcrumbs
- [ ] Add quick actions bar
- [ ] Improve loading states

---

## Mockup: Grouped Sidebar

```
┌─────────────────────┐
│ 🏷 COH ERP          │
├─────────────────────┤
│ ▼ OVERVIEW          │
│   Dashboard         │
├─────────────────────┤
│ ▶ CATALOG           │
│ ▼ MATERIALS         │
│   Fabrics           │
│   Reconcile         │
│   Ledger            │
├─────────────────────┤
│ ▶ SALES             │
│ ▶ OPERATIONS        │
│ ▶ RETURNS           │
├─────────────────────┤
│ ⚙ Settings          │
├─────────────────────┤
│ John (admin) [↪]    │
└─────────────────────┘
```

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-05 | Initial document created |
