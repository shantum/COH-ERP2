# Domain Reference Index

> Routing document for finding domain-specific documentation. For app-wide patterns, see `CLAUDE.md`.

**Last updated**: January 13, 2026

---

## Routing Table

| Working On | Read |
|------------|------|
| Order fulfillment, shipping | [orders.md](domains/orders.md), [shipping.md](domains/shipping.md), [inventory.md](domains/inventory.md) |
| Inward Hub (any mode) | [inventory.md](domains/inventory.md), [frontend.md](domains/frontend.md) |
| Returns or RTO processing | [returns.md](domains/returns.md), [inventory.md](domains/inventory.md) |
| Shopify sync, webhooks | [shopify.md](domains/shopify.md) |
| COD reconciliation | [remittance.md](domains/remittance.md), [shopify.md](domains/shopify.md) |
| Production batches | [production.md](domains/production.md), [fabrics.md](domains/fabrics.md) |
| Fabric inventory | [fabrics.md](domains/fabrics.md) |
| Product costing | [catalog.md](domains/catalog.md), [fabrics.md](domains/fabrics.md) |
| Customer tiers, LTV | [customers.md](domains/customers.md) |
| User permissions | [admin.md](domains/admin.md) |
| Shipment tracking | [tracking.md](domains/tracking.md) |
| Frontend patterns | [frontend.md](domains/frontend.md) |

---

## Domain Cards

### Orders
- **Scope**: Order lifecycle, fulfillment workflow, unified views API
- **Key Files**: `routes/orders/`, `orderViews.ts`, `shipOrderService.ts`
- **Touches**: Inventory (reserved/sales), Shopify (cache), Customers (LTV)
- **[Read →](domains/orders.md)**

### Shipping
- **Scope**: Unified shipping via ShipOrderService
- **Key Files**: `services/shipOrderService.ts`
- **Touches**: Orders (status), Inventory (outward)
- **[Read →](domains/shipping.md)**

### Inventory
- **Scope**: SKU ledger, transactions, balances, mode-based Inward Hub
- **Key Files**: `routes/inventory/` (balance, pending, transactions, types), `components/inward/` (10 components)
- **Touches**: Orders (reserved/sales), Production (inward), Returns (RTO)
- **[Read →](domains/inventory.md)**

### Returns & RTO
- **Scope**: Customer returns + carrier RTOs (two distinct workflows)
- **Key Files**: `routes/returns/` (tickets, receive, shipping, qc, types), `routes/repacking.ts`
- **Touches**: Inventory (inward/write-off), Customers (RTO risk)
- **[Read →](domains/returns.md)**

### Shopify
- **Scope**: Sync, webhooks, cache management, COD payment sync
- **Key Files**: `routes/shopify.ts`, `services/shopify.ts`, `shopifyOrderProcessor.ts`
- **Touches**: Orders (synced data), Remittance (COD sync)
- **[Read →](domains/shopify.md)**

### Remittance
- **Scope**: COD payment reconciliation, Shopify financial sync
- **Key Files**: `routes/remittance.ts`
- **Touches**: Shopify (Transaction API), Orders (COD pending)
- **[Read →](domains/remittance.md)**

### Production
- **Scope**: Batch scheduling and completion
- **Key Files**: `routes/production.ts`
- **Touches**: Inventory (inward), Fabrics (outward)
- **[Read →](domains/production.md)**

### Tracking
- **Scope**: Shipment tracking via iThink Logistics
- **Key Files**: `routes/tracking.ts`, `services/ithinkLogistics.ts`
- **Touches**: Orders (trackingStatus), Returns (RTO detection)
- **[Read →](domains/tracking.md)** | **[Deep dive: ITHINK_LOGISTICS_API.md](ITHINK_LOGISTICS_API.md)**

### Fabrics
- **Scope**: Fabric inventory, cost inheritance, reorder analysis
- **Key Files**: `routes/fabrics/` (colors, fabricTypes, transactions, reconciliation, types), `queryPatterns.ts`
- **Touches**: Production (outward), Products (fabricTypeId)
- **[Read →](domains/fabrics.md)**

### Catalog
- **Scope**: Combined product + inventory view with costing
- **Key Files**: `routes/catalog.ts`, `routes/products.ts`
- **Touches**: Inventory (balances), Fabrics (cost), Products
- **[Read →](domains/catalog.md)**

### Customers
- **Scope**: Tier calculation, LTV tracking, RTO risk
- **Key Files**: `routes/customers.ts`, `tierUtils.ts`
- **Touches**: Orders (LTV source), Shopify (sync)
- **[Read →](domains/customers.md)**

### Admin
- **Scope**: Auth, permissions, settings, operational tools
- **Key Files**: `routes/admin.ts`, `routes/auth.ts`, `utils/permissions.ts`
- **Touches**: All domains (permission-gated)
- **[Read →](domains/admin.md)** | **[Deep dive: PERMISSIONS_PLAN.md](PERMISSIONS_PLAN.md)**

### Frontend
- **Scope**: React patterns, hooks, AG-Grid utilities, shared components
- **Key Files**: `hooks/useGridState.ts`, `utils/agGridHelpers.ts`, `components/common/`, `constants/`
- **[Read →](domains/frontend.md)**

---

## Cross-Domain Matrix

| From | To | Interaction |
|------|-----|-------------|
| Orders | Inventory | Allocation creates reserved; shipping creates outward |
| Orders | Customers | Delivery triggers tier recalculation |
| Production | Inventory | Batch completion creates inward |
| Production | Fabrics | Batch completion creates outward |
| Returns | Inventory | RTO inward (good) or write-off (damaged) |
| Remittance | Shopify | Transaction API marks orders paid |
| Tracking | Orders | Updates trackingStatus, triggers RTO visibility |
| Shopify | Orders | Synced orders create/update ERP Orders |

---

## Quick Reference

**Auth**: `POST /auth/login` → JWT with 7-day expiry

**Unified Orders API**: `GET /orders?view=open|shipped|rto|cod_pending|archived`

**Balance formulas**:
- Inventory: `Available = Balance - Reserved`
- Fabrics: `Balance = Inward - Outward` (no reserved)

**Cost cascade**: SKU → Variation → Product → Global (null = fallback)

**RTO vs Return**: RTOs are carrier-initiated (trackingStatus), Returns are customer-initiated (ReturnRequest)
