# Catalog Domain

> Combined product + inventory view with integrated costing. SKU-level data with full hierarchy.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/catalog.js`, `products.js` (cost-config) |
| Key Files | `queryPatterns.js` |
| Related | Inventory (balances), Fabrics (cost), Products |

## Costing Cascade

**Priority**: SKU → Variation → Product → Global

| Field | Fallback Chain |
|-------|----------------|
| `trimsCost` | SKU → Variation → Product → null |
| `liningCost` | Only if `hasLining=true`, else null |
| `packagingCost` | SKU → Variation → Product → CostConfig.defaultPackagingCost |
| `laborMinutes` | SKU → Variation → Product.baseProductionTimeMins → 60 |

## Cost Calculations

```javascript
// Fabric cost
fabricCost = SKU.fabricConsumption * (Fabric.costPerUnit ?? FabricType.defaultCostPerUnit)

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

## View Levels

| View | Aggregation |
|------|-------------|
| `sku` | Individual size-level |
| `variation` | Aggregate all sizes of a color |
| `product` | Aggregate all colors/sizes |

## Key Endpoints

| Path | Purpose |
|------|---------|
| `GET /sku-inventory` | Flat SKU list with product, inventory, costing |
| `GET /filters` | Filter options (genders, categories, products) |
| `GET/PUT /products/cost-config` | Global cost settings |

## Cross-Domain

- **← Inventory**: Balance and available quantities
- **← Fabrics**: Fabric cost per unit
- **← Products**: Product hierarchy and base values

## Gotchas

1. **Lining cost null**: Only populated when `hasLining=true`
2. **Cascade means null inheritance**: Null at SKU level falls back to Variation, then Product
3. **GST threshold**: Determines which rate applies (above/below)
4. **Bulk updates**: Variation/Product views aggregate SKU IDs for multi-update
