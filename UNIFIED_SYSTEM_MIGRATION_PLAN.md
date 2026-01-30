# Unified System Migration Plan: From Chaos to Clarity

## Executive Summary

**Goal**: Consolidate three competing systems (Legacy Fabric, New Material Hierarchy, BOM) into ONE unified system where **BOM is the single source of truth** for product composition and costing.

**Approach**: Phased migration with parallel running, feature flags, and zero downtime. Each phase is independently verifiable and rollback-safe.

**Timeline**: 6 phases over ~2 weeks, with verification periods between each.

---

## Current State Analysis

### Three Colliding Systems

```
┌─────────────────────────────────────────────────────────────────────────┐
│ SYSTEM 1: Legacy FabricType/Fabric (2-tier)                            │
│   FabricType → Fabric (with embedded colorName)                        │
│   Product.fabricTypeId → FabricType                                    │
│   Variation.fabricId → Fabric (REQUIRED)                               │
│   FabricTransaction → balance calculated on-the-fly                    │
│   156+ files reference this system                                     │
├─────────────────────────────────────────────────────────────────────────┤
│ SYSTEM 2: New Material Hierarchy (3-tier)                              │
│   Material → Fabric → FabricColour                                     │
│   Variation.fabricColourId → FabricColour (OPTIONAL)                   │
│   FabricColourTransaction → materialized balance via trigger           │
│   ~40 files reference this system                                      │
├─────────────────────────────────────────────────────────────────────────┤
│ SYSTEM 3: BOM System (3-tier cascade)                                  │
│   ProductBomTemplate → VariationBomLine → SkuBomLine                   │
│   Uses FabricColour, TrimItem, ServiceItem                             │
│   ~52 files reference this system                                      │
├─────────────────────────────────────────────────────────────────────────┤
│ SCATTERED COST FIELDS                                                  │
│   Product: trimsCost, packagingCost, liningCost                        │
│   Variation: trimsCost, packagingCost, liningCost, laborMinutes,       │
│              bomCost                                                    │
│   Sku: trimsCost, packagingCost, liningCost, laborMinutes, bomCost,    │
│        fabricConsumption                                                │
│   SkuCosting: separate costing table                                   │
│   Cascade logic duplicated in 6+ files                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### Target State

```
┌─────────────────────────────────────────────────────────────────────────┐
│ UNIFIED SYSTEM                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│ INGREDIENTS (what we stock):                                           │
│   Material → Fabric → FabricColour (inventory tracked here)            │
│   TrimItem (buttons, zippers, labels)                                  │
│   ServiceItem (printing, embroidery)                                   │
│   FabricColourTransaction (materialized balance)                       │
├─────────────────────────────────────────────────────────────────────────┤
│ PRODUCTS (what we sell):                                               │
│   Product → Variation → Sku                                            │
│   Variation.fabricColourId (REQUIRED) → FabricColour                   │
├─────────────────────────────────────────────────────────────────────────┤
│ RECIPE (BOM - single source of truth for costs):                       │
│   ProductBomTemplate (structure + defaults)                            │
│   VariationBomLine (color-specific components)                         │
│   SkuBomLine (size-specific quantities)                                │
│   Sku.bomCost (computed, stored for O(1) display)                      │
│   Variation.bomCost (average of SKU costs)                             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Risk Assessment Matrix

| Item to Change | Risk Level | Dependencies | Mitigation |
|----------------|------------|--------------|------------|
| `Variation.fabricId` → `fabricColourId` | 🔴 HIGH | 78+ files, all product queries | Keep both during transition, feature flag |
| `Product.fabricTypeId` removal | 🟡 MEDIUM | 22 files, UI filtering | Add `materialId` first, parallel running |
| `FabricType` → `Material` | 🟡 MEDIUM | 22 files | Already parallel, just remove FabricType |
| `Fabric.colorName` removal | 🟡 MEDIUM | 40+ files | FabricColour already has data |
| `FabricTransaction` → `FabricColourTransaction` | 🟡 MEDIUM | 18 files, historical data | Migrate data, keep read-only |
| Inline cost fields removal | 🟢 LOW | 15+ files | BOM already works, remove cascade code |
| `SkuCosting` table removal | 🟢 LOW | 3 files | Already unused |
| `Sku.fabricConsumption` removal | 🟢 LOW | 12 files | SkuBomLine.quantity replaces it |

---

## Phase-by-Phase Migration

### Phase 0: Pre-Migration Verification (Day 1)

**Goal**: Ensure we have accurate data before starting.

#### 0.1 Data Audit Script

Create and run `server/src/scripts/audit/preMigrationAudit.ts`:

```typescript
// Run this to understand current state
async function audit() {
  // Count variations with/without fabricColourId
  const withFabricColour = await prisma.variation.count({
    where: { fabricColourId: { not: null } }
  });
  const withoutFabricColour = await prisma.variation.count({
    where: { fabricColourId: null }
  });

  // Count transactions in each system
  const legacyTxnCount = await prisma.fabricTransaction.count();
  const newTxnCount = await prisma.fabricColourTransaction.count();

  // Check BOM coverage
  const productsWithBom = await prisma.productBomTemplate.groupBy({
    by: ['productId'],
  });
  const totalProducts = await prisma.product.count({ where: { isActive: true } });

  // Check for orphaned data
  const orphanedFabricColours = await prisma.fabricColour.count({
    where: { fabric: { materialId: null } }
  });

  console.log({
    variations: { withFabricColour, withoutFabricColour },
    transactions: { legacy: legacyTxnCount, new: newTxnCount },
    bomCoverage: { withBom: productsWithBom.length, total: totalProducts },
    orphanedFabricColours,
  });
}
```

#### 0.2 Expected Results Before Proceeding

| Check | Required State | Action if Not Met |
|-------|---------------|-------------------|
| All FabricColours have Fabric with materialId | 100% | Run migrateMaterialsBom.ts first |
| Transaction migration | newTxnCount ≥ legacyTxnCount | Run migrateFabricTransactions.ts |
| BOM coverage | ≥ 90% products have templates | Run migrateMaterialsBom.ts Phase 2 |
| Variations with fabricColourId | ≥ 80% | Run linkVariationsCorrect.ts |

#### 0.3 Backup

```bash
# Backup database before any changes
pg_dump $DATABASE_URL > backup_pre_migration_$(date +%Y%m%d).sql
```

---

### Phase 1: Complete Data Backfill (Days 1-2)

**Goal**: Ensure ALL data exists in the new system before touching code.

#### 1.1 Ensure All Materials Exist

```bash
cd server
npx ts-node src/scripts/migrateMaterialsBom.ts --skip-phase1
```

Verify: Every FabricType has a corresponding Material.

#### 1.2 Ensure All FabricColours Exist

For every Fabric that has colorName, there should be a FabricColour record.

```typescript
// Check: Every Fabric with colorName has matching FabricColour
const fabricsWithoutColour = await prisma.fabric.findMany({
  where: {
    colorName: { not: '' },
    colours: { none: {} }
  }
});
// Should be empty
```

If not empty, run:
```bash
npx ts-node src/scripts/migrateMaterialsBom.ts --only-phase1
```

#### 1.3 Ensure All Variations Have fabricColourId

This is CRITICAL. Run the linking scripts:

```bash
# Preview first
npx ts-node src/scripts/previewVariationLinks.ts

# Then execute each linking script
npx ts-node src/scripts/linkLinenProducts.ts
npx ts-node src/scripts/linkSeersuckerProduction.ts
# ... other linking scripts as needed
```

**Verification Query:**
```sql
SELECT COUNT(*) as total,
       COUNT(CASE WHEN "fabricColourId" IS NOT NULL THEN 1 END) as linked,
       COUNT(CASE WHEN "fabricColourId" IS NULL THEN 1 END) as unlinked
FROM "Variation"
WHERE "isActive" = true;
```

**Required**: `unlinked` should be 0 (or very close to 0).

#### 1.4 Migrate Transaction History

Run transaction migration to copy FabricTransaction → FabricColourTransaction:

```bash
npx ts-node src/scripts/migrateFabricTransactions.ts --dry-run
# Review output
npx ts-node src/scripts/migrateFabricTransactions.ts
```

**Verification:**
```sql
SELECT
  (SELECT SUM(CASE WHEN "txnType" = 'inward' THEN qty ELSE -qty END) FROM "FabricTransaction") as legacy_balance,
  (SELECT SUM(CASE WHEN "txnType" = 'inward' THEN qty ELSE -qty END) FROM "FabricColourTransaction") as new_balance;
```

Balances should match (or new_balance ≥ legacy_balance if new transactions added).

#### 1.5 Ensure All Products Have BOM Templates

```bash
npx ts-node src/scripts/migrateMaterialsBom.ts --only-phase2
```

**Verification:**
```sql
SELECT
  (SELECT COUNT(DISTINCT id) FROM "Product" WHERE "isActive" = true) as products,
  (SELECT COUNT(DISTINCT "productId") FROM "ProductBomTemplate") as with_template;
```

Numbers should match.

---

### Phase 2: Add Feature Flags & Parallel Reading (Days 3-4)

**Goal**: Read from new system by default, fall back to old system if data missing.

#### 2.1 Create Feature Flag Config

Add to `server/src/config/featureFlags.ts`:

```typescript
export const FEATURE_FLAGS = {
  // When true, use fabricColourId as primary, fabricId as fallback
  USE_FABRIC_COLOUR_PRIMARY: true,

  // When true, read costs from BOM instead of inline fields
  USE_BOM_FOR_COSTS: true,

  // When true, use Material instead of FabricType for filtering
  USE_MATERIAL_HIERARCHY: true,

  // When true, use FabricColourTransaction for balance
  USE_FABRIC_COLOUR_TRANSACTIONS: true,
};
```

#### 2.2 Update Key Query Functions

**Pattern: Fabric Resolution with Fallback**

In `client/src/server/functions/products.ts`:

```typescript
// Before:
const fabricInfo = variation.fabric;

// After (with feature flag):
const fabricInfo = FEATURE_FLAGS.USE_FABRIC_COLOUR_PRIMARY
  ? variation.fabricColour?.fabric ?? variation.fabric
  : variation.fabric;

const colourInfo = FEATURE_FLAGS.USE_FABRIC_COLOUR_PRIMARY
  ? variation.fabricColour
  : null;
```

**Files to Update:**
1. `client/src/server/functions/products.ts` - getProductsTree, getProductsList
2. `client/src/server/functions/production.ts` - getProductionBatches
3. `server/src/db/queries/productsListKysely.ts` - Products table query
4. `server/src/db/queries/productionKysely.ts` - Production batch query

#### 2.3 Update Cost Resolution

**Pattern: BOM-First Cost Resolution**

In `client/src/server/functions/catalog.ts`, replace the cascade logic:

```typescript
// Before (cascade):
const effectiveTrimsCost = sku.trimsCost ?? variation.trimsCost ?? product.trimsCost ?? null;

// After (BOM-first):
if (FEATURE_FLAGS.USE_BOM_FOR_COSTS && sku.bomCost != null) {
  // BOM cost is pre-computed and stored
  effectiveTotalCost = sku.bomCost;
} else {
  // Fallback to cascade for SKUs without BOM
  effectiveTotalCost = calculateCascadeCost(sku, variation, product);
}
```

#### 2.4 Verification Testing

Create `server/src/scripts/verify/verifyParallelRead.ts`:

```typescript
async function verify() {
  // Pick 100 random variations
  const variations = await prisma.variation.findMany({
    take: 100,
    include: {
      fabric: true,
      fabricColour: { include: { fabric: true } },
    },
  });

  let mismatches = 0;
  for (const v of variations) {
    // Old system fabric name
    const oldFabricName = v.fabric.name;
    // New system fabric name
    const newFabricName = v.fabricColour?.fabric.name;

    if (newFabricName && oldFabricName !== newFabricName) {
      console.log(`Mismatch: ${v.id} - old: ${oldFabricName}, new: ${newFabricName}`);
      mismatches++;
    }
  }

  console.log(`Verified ${variations.length} variations, ${mismatches} mismatches`);
}
```

Run this daily during Phase 2 to catch any issues.

---

### Phase 3: Make fabricColourId Required (Days 5-6)

**Goal**: Stop writing to old system, make new system required.

**⚠️ CRITICAL: Only proceed if Phase 1 verification shows ≥99% coverage**

#### 3.1 Add Database Constraint (Soft First)

Create migration `prisma/migrations/YYYYMMDD_variation_fabric_colour_not_null`:

```sql
-- Step 1: Add NOT NULL with default (temporary)
-- This won't fail if any nulls exist
ALTER TABLE "Variation" ALTER COLUMN "fabricColourId" SET DEFAULT 'PLACEHOLDER';

-- Step 2: Find any remaining nulls and log them
SELECT id, "colorName", "productId" FROM "Variation"
WHERE "fabricColourId" IS NULL AND "isActive" = true;

-- Step 3: Link remaining nulls to a "Default" fabric colour (or fail migration)
-- See script below for implementation
```

#### 3.2 Create Final Linking Script

`server/src/scripts/linkRemainingVariations.ts`:

```typescript
// Find variations without fabricColourId and attempt to link
async function linkRemaining() {
  const unlinked = await prisma.variation.findMany({
    where: {
      fabricColourId: null,
      isActive: true,
    },
    include: {
      fabric: { include: { colours: true } },
    },
  });

  for (const v of unlinked) {
    // Try to find matching colour by name
    const matchingColour = v.fabric.colours.find(
      c => c.colourName.toLowerCase() === v.colorName.toLowerCase()
    );

    if (matchingColour) {
      await prisma.variation.update({
        where: { id: v.id },
        data: { fabricColourId: matchingColour.id },
      });
      console.log(`Linked: ${v.id} → ${matchingColour.id}`);
    } else {
      // Create the colour if it doesn't exist
      const newColour = await prisma.fabricColour.create({
        data: {
          fabricId: v.fabricId,
          colourName: v.colorName,
          isActive: true,
        },
      });
      await prisma.variation.update({
        where: { id: v.id },
        data: { fabricColourId: newColour.id },
      });
      console.log(`Created and linked: ${v.id} → ${newColour.id}`);
    }
  }
}
```

#### 3.3 Update Mutation Code

In `client/src/server/functions/productsMutations.ts`:

```typescript
// createVariation - REQUIRE fabricColourId
export const createVariationSchema = z.object({
  productId: z.string().uuid(),
  colorName: z.string().min(1),
  fabricColourId: z.string().uuid(), // NOW REQUIRED
  // fabricId removed from input - derived from fabricColourId
  // ...
});

export async function createVariation({ data }) {
  // Get fabricId from fabricColourId
  const fabricColour = await prisma.fabricColour.findUnique({
    where: { id: data.fabricColourId },
  });

  if (!fabricColour) {
    throw new Error('FabricColour not found');
  }

  return prisma.variation.create({
    data: {
      ...data,
      fabricId: fabricColour.fabricId, // Derived, not input
      fabricColourId: data.fabricColourId,
    },
  });
}
```

#### 3.4 Verification

```sql
-- No variations should be unlinked after this phase
SELECT COUNT(*) FROM "Variation"
WHERE "fabricColourId" IS NULL AND "isActive" = true;
-- Expected: 0
```

---

### Phase 4: Remove Legacy Cost Fields (Days 7-8)

**Goal**: BOM is the only source of truth for costs.

#### 4.1 Ensure All SKUs Have bomCost

Run recalculation:

```typescript
// server/src/scripts/recalculateAllBomCosts.ts
async function recalculateAll() {
  const skus = await prisma.sku.findMany({
    where: { isActive: true },
    select: { id: true, variationId: true },
  });

  for (const sku of skus) {
    await recalculateSkuBomCost(prisma, sku.id);
  }

  // Then variations
  const variations = await prisma.variation.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  for (const v of variations) {
    await recalculateVariationBomCost(prisma, v.id);
  }
}
```

#### 4.2 Update UI to Read Only bomCost

Files to update:
- `client/src/components/products/VariationsDataTable.tsx` - Use bomCost directly
- `client/src/components/products/detail/SkuDetail.tsx` - Remove cost override display
- `client/src/components/products/detail/ProductCostsTab.tsx` - Show BOM summary only
- `client/src/server/functions/catalog.ts` - Remove cascade logic

#### 4.3 Mark Inline Cost Fields as Deprecated

In schema, add comments:

```prisma
model Product {
  // @deprecated Use BOM system instead
  trimsCost     Float?  // DEPRECATED - remove in Phase 6
  packagingCost Float?  // DEPRECATED - remove in Phase 6
  liningCost    Float?  // DEPRECATED - remove in Phase 6
}
```

#### 4.4 Remove SkuCosting Table Usage

`SkuCosting` is already unused in most code. Search for remaining usages and remove:

```bash
grep -r "SkuCosting" --include="*.ts" --include="*.tsx" .
```

---

### Phase 5: Remove FabricType System (Days 9-10)

**Goal**: Material is the only top-level classification.

#### 5.1 Add Product.materialId

Schema change:

```prisma
model Product {
  materialId    String?  // NEW
  material      Material? @relation(fields: [materialId], references: [id])

  fabricTypeId  String?  // DEPRECATED
  fabricType    FabricType? @relation(fields: [fabricTypeId], references: [id])
}
```

Migration script to populate:

```typescript
// Map FabricType → Material for all products
async function migrateProductMaterials() {
  const products = await prisma.product.findMany({
    where: { fabricTypeId: { not: null } },
    include: { fabricType: true },
  });

  for (const p of products) {
    // Find Material that matches FabricType name (from mapping)
    const material = await prisma.material.findFirst({
      where: { name: getMaterialNameForFabricType(p.fabricType.name) },
    });

    if (material) {
      await prisma.product.update({
        where: { id: p.id },
        data: { materialId: material.id },
      });
    }
  }
}
```

#### 5.2 Update UI Filters

In `client/src/server/functions/products.ts`:

```typescript
// Before
fabricTypes: await prisma.fabricType.findMany({ ... })

// After
materials: await prisma.material.findMany({ ... })
```

Files to update:
- `client/src/server/functions/products.ts` - getCatalogFilters
- `client/src/pages/Catalog.tsx` - Filter dropdowns
- `client/src/components/catalog/FabricEditPopover.tsx` - Material selector
- `client/src/utils/catalogColumns.tsx` - Column definitions

#### 5.3 Mark FabricType as Deprecated

Add comment to schema:

```prisma
/// @deprecated Use Material model instead. Will be removed in Phase 6.
model FabricType {
  // ...
}
```

---

### Phase 6: Final Cleanup (Days 11-14)

**Goal**: Remove all deprecated code and fields.

**⚠️ ONLY proceed after 1 week of successful production use of new system**

#### 6.1 Database Cleanup Migration

Create migration `prisma/migrations/YYYYMMDD_cleanup_legacy_fabric`:

```sql
-- Remove deprecated fields from Variation
ALTER TABLE "Variation" DROP COLUMN "fabricId";

-- Remove deprecated fields from Product
ALTER TABLE "Product" DROP COLUMN "fabricTypeId";

-- Remove deprecated cost fields from Product
ALTER TABLE "Product" DROP COLUMN "trimsCost";
ALTER TABLE "Product" DROP COLUMN "packagingCost";
ALTER TABLE "Product" DROP COLUMN "liningCost";

-- Remove deprecated cost fields from Variation
ALTER TABLE "Variation" DROP COLUMN "trimsCost";
ALTER TABLE "Variation" DROP COLUMN "packagingCost";
ALTER TABLE "Variation" DROP COLUMN "liningCost";
ALTER TABLE "Variation" DROP COLUMN "laborMinutes";

-- Remove deprecated cost fields from Sku
ALTER TABLE "Sku" DROP COLUMN "trimsCost";
ALTER TABLE "Sku" DROP COLUMN "packagingCost";
ALTER TABLE "Sku" DROP COLUMN "liningCost";
ALTER TABLE "Sku" DROP COLUMN "laborMinutes";
ALTER TABLE "Sku" DROP COLUMN "fabricConsumption";

-- Remove deprecated Fabric color fields
ALTER TABLE "Fabric" DROP COLUMN "colorName";
ALTER TABLE "Fabric" DROP COLUMN "standardColor";
ALTER TABLE "Fabric" DROP COLUMN "colorHex";

-- Drop deprecated tables (archive data first if needed)
-- DROP TABLE "FabricTransaction";  -- Keep for historical reference
-- DROP TABLE "FabricType";         -- Keep for historical reference
-- DROP TABLE "SkuCosting";         -- Safe to drop, unused
```

#### 6.2 Code Cleanup

Delete files:
- `client/src/server/functions/fabrics.ts` (most functions)
- `client/src/server/functions/fabricMutations.ts` (most functions)

Remove from files:
- All `fabricId` references in product code
- All `fabricTypeId` references
- All inline cost cascade logic
- Feature flags (they're now always true)

#### 6.3 Final Verification

Run comprehensive test suite:

```bash
# Type check
cd client && npx tsc -p tsconfig.app.json --noEmit && cd ../server && npx tsc --noEmit

# Run any existing tests
npm test

# Manual verification checklist (see below)
```

---

## Verification Checklist

### After Each Phase

| Check | Command/Query | Expected Result |
|-------|--------------|-----------------|
| TypeScript compiles | `npx tsc --noEmit` | No errors |
| Products page loads | Manual | All products visible |
| Fabric info displays | Manual | Correct fabric name & color |
| BOM tab works | Manual | Can view/edit BOM |
| Cost displays correctly | Manual | bomCost shown in table |
| Fabric receipt works | Manual | Can add transactions |
| Ledgers page shows history | Manual | Transactions visible |

### Production Monitoring

After each phase deployment, monitor for 24-48 hours:

1. **Error rates** - Check for new 500 errors
2. **Page load times** - Products page should be ≤3s
3. **User complaints** - Any reports of missing/wrong data
4. **Database queries** - No slow queries (>1s)

---

## Rollback Procedures

### Phase 1-2 Rollback (Low Risk)

Data backfill and feature flags are additive. To rollback:
1. Set feature flags to false
2. Code continues using old system

### Phase 3 Rollback (Medium Risk)

If fabricColourId becomes required and issues arise:
1. Revert migration (add NULL back)
2. Revert code changes
3. Set feature flags to false

### Phase 4-5 Rollback (Medium Risk)

If BOM-only costs or Material-only hierarchy has issues:
1. Restore inline cost reading code (it's just commented, not deleted)
2. Set feature flags to false

### Phase 6 Rollback (HIGH Risk)

**Phase 6 is irreversible.** If serious issues found:
1. Restore from database backup
2. Redeploy previous code version
3. This is why Phase 6 has a mandatory 1-week verification period

---

## Files to Modify (Summary)

### High-Impact Files (Touch Carefully)

| File | Changes | Risk |
|------|---------|------|
| `prisma/schema.prisma` | Remove deprecated fields, add constraints | 🔴 |
| `client/src/server/functions/products.ts` | Use fabricColourId, remove FabricType | 🔴 |
| `client/src/server/functions/productsMutations.ts` | Require fabricColourId | 🔴 |
| `server/src/db/queries/productsListKysely.ts` | Update JOINs | 🟡 |

### Medium-Impact Files

| File | Changes |
|------|---------|
| `client/src/server/functions/catalog.ts` | Remove cost cascade, use bomCost |
| `client/src/components/products/VariationsDataTable.tsx` | Use bomCost column |
| `client/src/pages/Catalog.tsx` | Material filters instead of FabricType |
| `client/src/components/catalog/FabricEditPopover.tsx` | Material selector |

### Files to Delete (Phase 6)

| File | Reason |
|------|--------|
| `client/src/server/functions/fabrics.ts` | Legacy system |
| `client/src/server/functions/fabricMutations.ts` | Legacy system |
| Most files in `server/src/scripts/link*.ts` | One-time migration scripts |

---

## Terminology Guide (Post-Migration)

| Domain | Term | Definition |
|--------|------|------------|
| **Ingredients** | Material | Base fiber type (Linen, Cotton, Pima Cotton) |
| **Ingredients** | Fabric | Specific construction (Linen Twill, Cotton Jersey) |
| **Ingredients** | FabricColour | Inventory-tracked color variant (Navy Blue) |
| **Ingredients** | TrimItem | Buttons, zippers, labels, elastic |
| **Ingredients** | ServiceItem | Printing, embroidery, washing |
| **Products** | Product | Catalog item (Classic Shirt) |
| **Products** | Variation | Color variant (Navy Blue Classic Shirt) |
| **Products** | Sku | Size variant (SHIRT-NAVY-M) |
| **Recipe** | BomTemplate | Product-level component structure |
| **Recipe** | BomLine | Specific component assignment |
| **Recipe** | Role | Component function (main, accent, lining) |
| **Costing** | bomCost | Pre-computed total cost from BOM |
| **Inventory** | Balance | currentBalance field (materialized) |
| **Inventory** | Transaction | FabricColourTransaction record |

---

## Success Criteria

Migration is complete when:

1. ✅ All Variations have `fabricColourId` (required, not null)
2. ✅ All Products have `materialId` for filtering
3. ✅ All SKUs have `bomCost` computed from BOM
4. ✅ All fabric inventory uses `FabricColourTransaction`
5. ✅ No code references `FabricType`, `Fabric.colorName`, or inline cost fields
6. ✅ Products page loads in <3s with full data
7. ✅ No user complaints about missing/wrong data for 1 week

---

## Appendix A: Quick Reference Commands

```bash
# Pre-migration audit
npx ts-node server/src/scripts/audit/preMigrationAudit.ts

# Run all migration scripts
npx ts-node server/src/scripts/migrateMaterialsBom.ts
npx ts-node server/src/scripts/migrateFabricTransactions.ts
npx ts-node server/src/scripts/linkRemainingVariations.ts
npx ts-node server/src/scripts/recalculateAllBomCosts.ts

# Verify migration
npx ts-node server/src/scripts/verify/verifyParallelRead.ts

# Type check before commit
cd client && npx tsc -p tsconfig.app.json --noEmit && cd ../server && npx tsc --noEmit

# Database backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
```

---

**Document Version**: 1.0
**Created**: 2026-01-30
**Status**: Ready for Review
