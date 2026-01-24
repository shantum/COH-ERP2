# Fabric Data Model Cleanup: Migration from OLD to NEW System

## Goal
Remove duplication between OLD fabric system (FabricType → Fabric → FabricTransaction) and NEW system (Material → Fabric → FabricColour). Make FabricColour the source of truth.

## Summary of Changes

| Current (OLD) | Target (NEW) | Action |
|---------------|--------------|--------|
| FabricType | Material | Remove FabricType, use Material |
| Fabric (with colorName) | Fabric (construction only) | Remove color fields from Fabric |
| Fabric.fabricTypeId | Fabric.materialId | Migrate FK, remove fabricTypeId |
| Variation.fabricId → Fabric | Variation.fabricColourId → FabricColour | Add new FK, deprecate old |
| FabricTransaction | FabricColourTransaction | Create new model |
| FabricReconciliation | FabricColourReconciliation | Create new model |
| Product.fabricTypeId | Remove | No longer needed |

---

## Phase 1: Schema Additions (Non-Breaking)

### 1.1 Add to prisma/schema.prisma

```prisma
// Add to Variation model
fabricColourId String?
fabricColour   FabricColour? @relation(fields: [fabricColourId], references: [id])
@@index([fabricColourId])

// New FabricColourTransaction model
model FabricColourTransaction {
  id              String        @id @default(uuid())
  fabricColourId  String
  txnType         String        // "inward" | "outward"
  qty             Float
  unit            String
  reason          String
  costPerUnit     Float?
  supplierId      String?
  referenceId     String?
  notes           String?
  createdById     String
  createdAt       DateTime      @default(now())

  fabricColour    FabricColour  @relation(fields: [fabricColourId], references: [id])
  createdBy       User          @relation("FabricColourTxnCreator", fields: [createdById], references: [id])
  supplier        Supplier?     @relation("FabricColourTxnSupplier", fields: [supplierId], references: [id])

  @@index([fabricColourId])
  @@index([txnType])
  @@index([createdAt])
  @@index([fabricColourId, createdAt])
}

// New FabricColourReconciliation models (same pattern as FabricReconciliation)
model FabricColourReconciliation { ... }
model FabricColourReconciliationItem { ... }

// Add back-relations to FabricColour
model FabricColour {
  transactions        FabricColourTransaction[]
  reconciliationItems FabricColourReconciliationItem[]
  variations          Variation[]
}

// Add to User and Supplier
model User {
  fabricColourTransactions FabricColourTransaction[] @relation("FabricColourTxnCreator")
}
model Supplier {
  fabricColourTransactions FabricColourTransaction[] @relation("FabricColourTxnSupplier")
}
```

### 1.2 Run Migration
```bash
cd /Users/shantumgupta/Desktop/COH-ERP2
npm run db:generate && npm run db:push
```

---

## Phase 2: Data Migration Scripts

### 2.1 Migrate Variation.fabricColourId
Create `server/src/scripts/migrateVariationFabricColour.ts`:
- For each Variation, find matching FabricColour by (fabric.materialId + colorName)
- Set Variation.fabricColourId

### 2.2 Migrate Transaction History
Create `server/src/scripts/migrateFabricTransactions.ts`:
- For each FabricTransaction, find matching FabricColour
- Create FabricColourTransaction with same data
- Mark as migrated in notes

---

## Phase 3: Server Function Updates

### 3.1 Create New File: `client/src/server/functions/fabricColours.ts`

New functions (parallel to fabrics.ts):
- `getFabricColourTransactions()` - transactions for one colour
- `getAllFabricColourTransactions()` - for Ledgers page
- `getFabricColourStockAnalysis()` - reorder recommendations
- `getTopMaterials()` - replaces getTopFabrics at type level
- Reconciliation: `startFabricColourReconciliation()`, `updateFabricColourReconciliationItems()`, `submitFabricColourReconciliation()`, etc.

### 3.2 Create New File: `client/src/server/functions/fabricColourMutations.ts`

New functions:
- `createFabricColourTransaction()` - record inward/outward
- `deleteFabricColourTransaction()` - admin delete

### 3.3 Update Existing Functions

**materialsMutations.ts:**
- `createColour()` - already exists, no change needed
- `updateColour()` - already exists, no change needed

**productsMutations.ts:**
- `createVariation()` - add fabricColourId parameter
- `updateVariation()` - add fabricColourId parameter

---

## Phase 4: UI Component Updates

### 4.1 Ledgers Page (`pages/Ledgers.tsx`)

**Changes:**
1. Replace "Fabric Ledger" tab with "Materials Ledger"
2. Import from `fabricColours.ts` instead of `fabrics.ts`
3. Use `getAllFabricColourTransactions()`
4. Display hierarchy: Material → Fabric → Colour

### 4.2 Reconciliation Page (`pages/FabricReconciliation.tsx`)

**Changes:**
1. Use `FabricColourReconciliation` functions
2. Display colours with Material/Fabric context
3. Update table columns for new model

### 4.3 Dashboard TopFabricsCard (`components/dashboard/TopFabricsCard.tsx`)

**Changes:**
1. Change level options: "type" → "material", "color" → "colour"
2. Use `getTopMaterials()` for material aggregation
3. Display Material hierarchy instead of FabricType

### 4.4 Product/Variation Editing

**Files:**
- `components/products/unified-edit/tabs/VariationFabricTab.tsx`
- `components/products/unified-edit/shared/FabricSelector.tsx`

**Changes:**
1. Use 3-tier selector: Material → Fabric → Colour
2. Set `fabricColourId` instead of `fabricId`
3. Auto-derive fabricId from selected colour's parent

---

## Phase 5: Cleanup (After Verification)

### 5.1 Remove Deprecated Fields/Models

After migration is verified:
1. Remove `Variation.fabricId` (use fabricColourId only)
2. Remove `Product.fabricTypeId`
3. Remove `Fabric.colorName`, `Fabric.colorHex`, `Fabric.standardColor`
4. Remove `Fabric.fabricTypeId`
5. Remove `FabricType` model entirely
6. Remove `FabricTransaction` model
7. Remove `FabricReconciliation` models
8. Remove old server functions in `fabrics.ts` and `fabricMutations.ts`

---

## Critical Files to Modify

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add new models, modify Variation |
| `client/src/server/functions/fabricColours.ts` | NEW - colour transaction/reconciliation queries |
| `client/src/server/functions/fabricColourMutations.ts` | NEW - colour transaction mutations |
| `client/src/pages/Ledgers.tsx` | Switch to FabricColourTransaction |
| `client/src/pages/FabricReconciliation.tsx` | Switch to FabricColourReconciliation |
| `client/src/components/dashboard/TopFabricsCard.tsx` | Use Material instead of FabricType |
| `server/src/scripts/migrateVariationFabricColour.ts` | NEW - data migration |
| `server/src/scripts/migrateFabricTransactions.ts` | NEW - transaction migration |

---

## Verification Steps

1. **After Phase 1:** Run `npm run db:generate` - should succeed
2. **After Phase 2:** Query `SELECT COUNT(*) FROM "FabricColourTransaction"` - should match FabricTransaction count
3. **After Phase 3:** Test Ledgers page - should show colour transactions
4. **After Phase 4:** Test full flow - create transaction, view in ledger, run reconciliation
5. **Before Phase 5:** Verify all Variations have fabricColourId populated

---

## Execution Order

1. Schema changes (Phase 1) - ~30 min
2. Data migration scripts (Phase 2) - ~1 hour
3. Server functions (Phase 3) - ~2-3 hours
4. UI updates (Phase 4) - ~2-3 hours
5. Testing and verification - ~1 hour
6. Cleanup (Phase 5) - ~1 hour (separate PR after verification period)

**Total estimated work: 1-2 days**

---

## Rollback Plan

If issues arise:
- Phase 1-2: Delete new tables, no impact on existing system
- Phase 3-4: Revert to using old functions (they still exist)
- Phase 5: Cannot rollback easily - do NOT proceed until fully verified
