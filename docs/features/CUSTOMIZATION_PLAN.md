# Feature: Order Line Customizations

> **Status: PLANNED** — Not yet implemented

*Custom SKU modifications with unique tracking and non-returnable flag*

---

## Overview

| Aspect | Detail |
|--------|--------|
| Goal | Allow staff to mark order lines as customized (length, size adjustments) |
| Custom SKU | Generate `{SKU}-C{XX}` format for each customization |
| Inventory | Custom items auto-allocate upon production completion |
| Returns | Customized items are non-returnable |
| Effort | ~18 hours (realistic estimate) |

---

## 1. User Flow

```
┌─────────────────────────────────────────────────────────────┐
│  OPEN ORDERS - Order Line Row                               │
│  [LMD-BLU-M]  [MIDI Dress Blue]  [Qty: 4]  [⚙️ Customize]   │
└────────────────────────────────┬────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Customization Modal                                         │
├─────────────────────────────────────────────────────────────┤
│  Type: [Length ▼]        Value: [ -2 inches ]               │
│  Notes: [Customer is 5'2, needs shorter hemline]            │
│                                                             │
│  ⚠️ This will:                                              │
│     • Generate custom SKU: LMD-BLU-M-C01                    │
│     • Require special production for all 4 units            │
│     • Make ALL units NON-RETURNABLE                         │
│                                                             │
│  ☐ I confirm these items become NON-RETURNABLE              │
│                                                             │
│  [Cancel]                      [Generate Custom SKU]        │
└─────────────────────────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Order Line (Updated)                                        │
│  [🔧 LMD-BLU-M-C01]  [MIDI Dress Blue]  [Qty: 4] [No Return]│
│  Custom: Length -2 inches                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Custom SKU Format

### Format: `{BASE_SKU}-C{XX}`

| Base SKU | Customization # | Generated Custom SKU |
|----------|-----------------|----------------------|
| LMD-BLU-M | 1st | `LMD-BLU-M-C01` |
| LMD-BLU-M | 2nd | `LMD-BLU-M-C02` |
| SNT-RED-L | 1st | `SNT-RED-L-C01` |

**Key decision:** Custom SKUs are **actual Sku records** in the database, not just strings. This enables:
- Proper inventory tracking for custom pieces
- Separate inventory view for custom items
- Full production batch support

---

## 3. Quantity Handling

### Same Customization = Same Custom SKU

When a line has qty > 1, all units share the same custom SKU:

```
Order Line: LMD-BLU-M × 4 (qty=4)
     ↓ Customize (length: -2 inches)
Custom SKU Created: LMD-BLU-M-C01
Order Line now points to: LMD-BLU-M-C01 × 4
     ↓ Production Batch
Batch: LMD-BLU-M-C01, qtyPlanned: 4
     ↓ Complete Production
Inward: 4 units of LMD-BLU-M-C01
Reserved: 4 units for order line
     ↓
Order Line: allocated (ready to pick/pack/ship)
```

### Different Customizations Needed?

If a customer needs different customizations for items in the same order:
1. Split the order line first (e.g., qty=4 → two lines of qty=2)
2. Customize each line separately with its own custom SKU

---

## 4. Database Changes

### Sku Model Updates

```prisma
model Sku {
  // Existing fields...

  // NEW: Custom SKU tracking
  isCustomSku         Boolean   @default(false)  // True for custom pieces
  parentSkuId         String?                     // Links to base SKU
  parentSku           Sku?      @relation("CustomSkus", fields: [parentSkuId], references: [id])
  customSkus          Sku[]     @relation("CustomSkus")
  customizationCount  Int       @default(0)       // Counter for next C01, C02...

  // Customization details (only set for custom SKUs)
  customizationType   String?   // 'length', 'size', 'measurements', 'other'
  customizationValue  String?   // "-2 inches"
  customizationNotes  String?
  linkedOrderLineId   String?   @unique          // The order line this was made for

  @@index([parentSkuId])
  @@index([isCustomSku])
}
```

### OrderLine Model Updates

```prisma
model OrderLine {
  // Existing fields...
  skuId               String                   // Points to custom SKU if customized

  // NEW: Customization tracking
  isCustomized        Boolean   @default(false)
  isNonReturnable     Boolean   @default(false)
  originalSkuId       String?                   // Preserves reference to base SKU
  customizedAt        DateTime?
  customizedById      String?
  customizedBy        User?     @relation("CustomizedBy", fields: [customizedById], references: [id])

  // NOTE: customizationType/Value stored on the custom Sku record
}
```

### How It Works

```
BEFORE Customization:
  OrderLine.skuId → Sku (LMD-BLU-M, isCustomSku: false)
  OrderLine.originalSkuId → null

AFTER Customization:
  OrderLine.skuId → NEW Sku (LMD-BLU-M-C01, isCustomSku: true, parentSkuId: original)
  OrderLine.originalSkuId → original SKU ID (preserved for reference/undo)
  OrderLine.isCustomized = true
  OrderLine.isNonReturnable = true
```

---

## 5. Custom SKU Creation Logic

```javascript
async function createCustomSku(prisma, baseSkuId, customizationData, orderLineId, userId) {
    return prisma.$transaction(async (tx) => {
        // 1. Get base SKU and atomically increment counter
        const baseSku = await tx.sku.update({
            where: { id: baseSkuId },
            data: { customizationCount: { increment: 1 } },
            include: { variation: true }
        });

        // 2. Generate custom SKU code
        const count = baseSku.customizationCount;
        const customCode = `${baseSku.skuCode}-C${String(count).padStart(2, '0')}`;

        // 3. Create new Sku record for custom piece
        const customSku = await tx.sku.create({
            data: {
                skuCode: customCode,
                variationId: baseSku.variationId,
                size: baseSku.size,
                mrp: baseSku.mrp,
                isActive: true,
                isCustomSku: true,
                parentSkuId: baseSkuId,
                customizationType: customizationData.type,
                customizationValue: customizationData.value,
                customizationNotes: customizationData.notes || null,
                linkedOrderLineId: orderLineId,
                fabricConsumption: baseSku.fabricConsumption,
            }
        });

        // 4. Update order line to point to custom SKU
        await tx.orderLine.update({
            where: { id: orderLineId },
            data: {
                skuId: customSku.id,
                originalSkuId: baseSkuId,  // Preserve reference
                isCustomized: true,
                isNonReturnable: true,
                customizedAt: new Date(),
                customizedById: userId
            }
        });

        return customSku;
    });
}
```

---

## 6. Undo Customization Logic

```javascript
async function removeCustomization(prisma, orderLineId) {
    return prisma.$transaction(async (tx) => {
        // 1. Get order line with custom SKU
        const orderLine = await tx.orderLine.findUnique({
            where: { id: orderLineId },
            include: { sku: true }
        });

        if (!orderLine.isCustomized || !orderLine.originalSkuId) {
            throw new Error('Line is not customized');
        }

        const customSkuId = orderLine.skuId;

        // 2. Check if custom SKU has inventory transactions
        const txnCount = await tx.inventoryTransaction.count({
            where: { skuId: customSkuId }
        });

        if (txnCount > 0) {
            throw new Error('CANNOT_UNDO_HAS_INVENTORY');
        }

        // 3. Check if production batch exists
        const batchCount = await tx.productionBatch.count({
            where: { skuId: customSkuId }
        });

        if (batchCount > 0) {
            throw new Error('CANNOT_UNDO_HAS_PRODUCTION');
        }

        // 4. Revert order line to original SKU
        await tx.orderLine.update({
            where: { id: orderLineId },
            data: {
                skuId: orderLine.originalSkuId,
                originalSkuId: null,
                isCustomized: false,
                isNonReturnable: false,
                customizedAt: null,
                customizedById: null
            }
        });

        // 5. Delete the custom SKU record
        await tx.sku.delete({ where: { id: customSkuId } });

        return { success: true };
    });
}
```

---

## 7. Separate Custom Inventory

Custom SKUs have their own inventory, separate from standard stock:

### Inventory Query Update

```javascript
// Standard inventory (exclude custom)
const standardInventory = await prisma.inventoryTransaction.groupBy({
    by: ['skuId'],
    where: {
        sku: { isCustomSku: false }  // Filter out custom
    },
    ...
});

// Custom inventory (separate view)
const customInventory = await prisma.inventoryTransaction.findMany({
    where: {
        sku: { isCustomSku: true }
    },
    include: {
        sku: {
            include: { parentSku: true }
        }
    }
});
```

### Inventory UI Changes

| Tab | Shows |
|-----|-------|
| **Inventory** (existing) | Standard SKUs only (`isCustomSku: false`) |
| **Custom Pieces** (new tab) | Custom SKUs with order linkage |

---

## 8. API Endpoints

### Add Customization

```
POST /api/orders/lines/:lineId/customize

Request:
{
  "type": "length",
  "value": "-2 inches",
  "notes": "Customer is 5'2"
}

Response (Success):
{
  "id": "line-uuid",
  "customSkuCode": "LMD-BLU-M-C01",
  "customSkuId": "custom-sku-uuid",
  "isCustomized": true,
  "isNonReturnable": true,
  "originalSkuCode": "LMD-BLU-M",
  "qty": 4
}

Response (Error - Already allocated):
{
  "error": "Cannot customize an allocated line. Unallocate first.",
  "lineStatus": "allocated"
}
```

### Remove Customization

```
DELETE /api/orders/lines/:lineId/customize

Response (Success):
{
  "id": "line-uuid",
  "skuCode": "LMD-BLU-M",
  "isCustomized": false
}

Response (Error - Has inventory):
{
  "error": "Cannot undo customization - inventory transactions exist",
  "code": "CANNOT_UNDO_HAS_INVENTORY"
}
```

---

## 9. Open Orders Grid Changes

### New Column: ✂️ (after Item)

| Width | Cell Content |
|-------|--------------|
| 80px | ⚙️ button (pending) OR `🔧 SKU-C01` badge (customized) |

### Row Styling

```css
/* Customized line */
background-color: #fff7ed;  /* Orange-50 */
border-left: 3px solid #f97316;
```

### Column Behavior Changes

| Column | Customized Line Behavior |
|--------|--------------------------|
| **Stock** | Grayed out (not applicable) |
| **Allocate** | Disabled, shows "custom" |
| **Production** | Always enabled (must produce) |

---

## 10. Production Workflow

### Standard vs Custom Flow

```
STANDARD:  Batch → Inward → Stock Pool → Manual Allocate
CUSTOM:    Batch → Inward + Reserve → Auto-Allocated
```

### Production Completion Logic

**Important:** Use `sku.isCustomSku` for detection, not just `sourceOrderLineId`:

```javascript
// On batch completion
if (batch.sku.isCustomSku && batch.sourceOrderLineId) {
    // CUSTOM: Create inward + immediately reserve all units
    await prisma.inventoryTransaction.create({
        data: {
            skuId: batch.skuId,
            txnType: 'inward',
            qty: batch.qtyCompleted,
            reason: 'production_custom',
            referenceId: batch.sourceOrderLineId,
            notes: `Custom production: ${batch.sku.skuCode}`
        }
    });

    await prisma.inventoryTransaction.create({
        data: {
            skuId: batch.skuId,
            txnType: 'reserved',
            qty: batch.qtyCompleted,
            reason: 'order_allocation',
            referenceId: batch.sourceOrderLineId
        }
    });

    await prisma.orderLine.update({
        where: { id: batch.sourceOrderLineId },
        data: { lineStatus: 'allocated', allocatedAt: new Date() }
    });
} else if (batch.sourceOrderLineId) {
    // Standard order-linked batch: just inward (staff allocates manually)
    await prisma.inventoryTransaction.create({...});
} else {
    // Standard stock production: just inward to pool
    await prisma.inventoryTransaction.create({...});
}
```

---

## 11. Returns Blocking

```javascript
// In POST /api/returns - validate each line
for (const lineData of lines) {
    const orderLine = await req.prisma.orderLine.findFirst({
        where: {
            skuId: lineData.skuId,
            order: { id: originalOrderId }
        },
        include: { sku: true }
    });

    if (orderLine?.isNonReturnable) {
        return res.status(400).json({
            error: 'Customized items cannot be returned',
            skuCode: orderLine.sku.skuCode,
            isCustomized: true
        });
    }
}
```

---

## 12. Files to Create/Modify

| File | Action | Changes |
|------|--------|---------|
| `schema.prisma` | MODIFY | Add fields to OrderLine, Sku |
| `routes/orders/mutations.js` | MODIFY | Add customize/uncustomize endpoints |
| `utils/queryPatterns.js` | MODIFY | Add createCustomSku, deleteCustomSku helpers |
| `utils/validation.js` | MODIFY | Add CustomizeLineSchema |
| `production.js` | MODIFY | Update completeBatch for custom auto-allocation |
| `returns.js` | MODIFY | Block non-returnable items |
| `inventory.js` | MODIFY | Filter custom SKUs from standard views |
| `orderHelpers.ts` | MODIFY | Add customization fields to FlattenedOrderRow |
| `types/index.ts` | MODIFY | Extend Sku, OrderLine types |
| `OrdersGrid.tsx` | MODIFY | Add column, row styling, disable allocate |
| `CustomizationModal.tsx` | **NEW** | Modal with 2-step confirmation |

---

## 13. Implementation Phases

### Phase 0: Validation (2 hrs)
- [ ] Review workflow with production team
- [ ] Confirm UI/UX flow is correct

### Phase 1a: Database (2 hrs)
- [ ] Add schema fields to Sku and OrderLine
- [ ] Run migration, verify data

### Phase 1b: Backend API (3 hrs)
- [ ] Create `createCustomSku()` helper in queryPatterns.js
- [ ] Add customize endpoint with validation
- [ ] Add uncustomize endpoint with safety checks
- [ ] Add Zod validation schema

### Phase 2: Frontend UI (4 hrs)
- [ ] Create CustomizationModal component with 2-step confirmation
- [ ] Add customize column to OrdersGrid
- [ ] Implement row styling for customized lines
- [ ] Disable allocate, always show production for custom
- [ ] Add API hooks

### Phase 3: Production Integration (2 hrs)
- [ ] Update completeBatch for auto-allocation (use `sku.isCustomSku`)
- [ ] Show customization notes on production batch view
- [ ] Include custom SKU in production print/export

### Phase 4: Returns & Inventory (1 hr)
- [ ] Block returns for non-returnable items
- [ ] Filter custom SKUs from standard inventory views

### Phase 5: Testing (4 hrs)
- [ ] Test full flow: customize → produce → auto-allocate → ship
- [ ] Test qty > 1 customization
- [ ] Test undo customization
- [ ] Test returns blocking
- [ ] Test edge cases

---

## 14. Estimated Effort

| Component | Time |
|-----------|------|
| Validation with team | 2 hrs |
| Database migration | 2 hrs |
| Backend API (customize/uncustomize) | 3 hrs |
| Production completion changes | 2 hrs |
| Returns blocking + inventory filtering | 1 hr |
| CustomizationModal component | 2.5 hrs |
| OrdersGrid integration | 1.5 hrs |
| Testing & fixes | 4 hrs |
| **Total** | **~18 hours** |

---

## 15. Edge Cases

| Scenario | Handling |
|----------|----------|
| Customize after allocation | Must unallocate first (error returned) |
| Customize shipped line | Not allowed (error returned) |
| Customize already customized line | Not allowed (error returned) |
| Undo customization | Revert to original SKU, delete custom SKU (only if no inventory/production) |
| Qty > 1 with same customization | All units share same custom SKU, single production batch |
| Qty > 1 with different customizations | Must split line first, then customize each |
| Partial production completion | Auto-allocate completed qty, line may be partially allocated |
| Order cancellation with custom items | Release reserved inventory, custom SKU remains for audit trail |
| Customer requests uncustomization | Only possible if no production started |
| Shopify-initiated return | Block at API level (check `isNonReturnable`) |
| Exchange request for custom item | Treat same as return - blocked |

---

## 16. Future Considerations

| Enhancement | Description |
|-------------|-------------|
| **Pricing adjustment** | Custom items may have different pricing (alteration fee) |
| **Fabric adjustment** | Length changes may affect fabric consumption |
| **Customer notification** | Automated email about non-returnable status |
| **Customization templates** | Save common presets (e.g., "Petite -2in") |
| **Custom SKU cleanup** | Archive old orphaned custom SKUs |
| **Shopify sync** | Mark orders with custom items in note_attributes |
