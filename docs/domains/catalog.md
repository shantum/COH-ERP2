# Catalog Domain

> Combined product + inventory view with integrated costing. SKU-level data with full hierarchy.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/catalog.ts` (inventory view), `products.ts` (cost-config, CRUD) |
| Key Files | `utils/queryPatterns.ts` (calculateAllInventoryBalances) |
| Related | Inventory (balances), Fabrics (cost), Products |

## Costing Cascade

**Priority**: SKU → Variation → Product → Global

| Field | Fallback Chain |
|-------|----------------|
| `trimsCost` | SKU → Variation → Product → null |
| `liningCost` | Only if `hasLining=true`, else null |
| `packagingCost` | SKU → Variation → Product → CostConfig.defaultPackagingCost |
| `laborMinutes` | SKU → Variation → Product.baseProductionTimeMins → 60 |
| `fabricConsumption` | SKU.fabricConsumption → Product.defaultFabricConsumption → 1.5 |

## Cost Calculations

```javascript
// Fabric cost cascade
fabricCostPerUnit = Fabric.costPerUnit ?? FabricType.defaultCostPerUnit
fabricCost = SKU.fabricConsumption * fabricCostPerUnit

// Labor cost
laborCost = laborMinutes * CostConfig.laborRatePerMin

// Total
totalCost = fabricCost + laborCost + trimsCost + liningCost + packagingCost

// GST (MRP is inclusive)
gstRate = mrp >= gstThreshold ? gstRateAbove : gstRateBelow
exGstPrice = mrp / (1 + gstRate/100)
costMultiple = mrp / totalCost
```

## Cost Config (Global)

Stored in `CostConfig` table (single row):
- `laborRatePerMin`: 2.5 (default)
- `defaultPackagingCost`: 50 (default)
- `gstThreshold`: 2500
- `gstRateAbove`: 18%, `gstRateBelow`: 5%

## Key Endpoints

**Catalog routes** (`/api/catalog`):

| Path | Purpose |
|------|---------|
| `GET /sku-inventory` | Flat SKU list with product, inventory, costing |
| `GET /filters` | Filter options (genders, categories, products, fabricTypes, fabrics) |

**Product routes** (`/api/products`):

| Path | Purpose |
|------|---------|
| `GET/PUT /cost-config` | Global cost settings |

## Response Structure

`GET /sku-inventory` returns both effective costs AND raw cascade values:
- **Effective**: `trimsCost`, `liningCost`, `packagingCost`, `laborMinutes` (best from hierarchy)
- **Raw**: `skuTrimsCost`, `variationTrimsCost`, `productTrimsCost`, `globalPackagingCost` (for editing UI)
- **Computed**: `fabricCost`, `laborCost`, `totalCost`, `gstRate`, `exGstPrice`, `costMultiple`
- **Inventory**: `currentBalance`, `reservedBalance`, `availableBalance`, `status` (below_target/ok)

## Cross-Domain

- **Inventory**: Balance and available quantities via `calculateAllInventoryBalances()`
- **Fabrics**: Fabric cost per unit (with FabricType fallback)
- **Products**: Product hierarchy and base values

## Gotchas

1. **Lining cost null**: Only populated when `hasLining=true`
2. **Cascade means null inheritance**: Null at SKU level falls back to Variation, then Product
3. **GST threshold**: Determines which rate applies (above/below)
4. **Custom SKUs excluded**: `isCustomSku=false` filter applied to catalog view
5. **Permission filtering**: Cost fields filtered server-side via `filterConfidentialFields()`
6. **Size sorting**: Custom order (XS, S, M, L, XL, 2XL, 3XL, 4XL, Free)
