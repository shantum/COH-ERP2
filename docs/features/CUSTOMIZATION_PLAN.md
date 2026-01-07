# Feature: Order Line Customizations

> **Status: PLANNED** — Not yet implemented

*Custom SKU modifications with unique tracking and non-returnable flag*

---

## Overview

| Aspect | Detail |
|--------|--------|
| Goal | Allow staff to mark order lines as customized (length, size adjustments) |
| Custom SKU | Generate `{SKU}-C{XX}` format for each custom piece |
| Inventory | Custom items auto-allocate upon production completion |
| Returns | Customized items are non-returnable |
| Effort | ~14 hours |

---

## 1. User Flow

```
┌─────────────────────────────────────────────────────────────┐
│  OPEN ORDERS - Order Line Row                               │
│  [LMD-BLU-M]  [MIDI Dress Blue]  [Qty: 1]  [⚙️ Customize]    │
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
│     • Require special production                            │
│     • Make item NON-RETURNABLE                              │
│                                                             │
│  [Cancel]                         [Save Customization]      │
└─────────────────────────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Order Line (Updated)                                        │
│  [🔧 LMD-BLU-M-C01]  [MIDI Dress Blue]  [ No Return]       │
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

## 3. Database Changes

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
  customizedAt        DateTime?
  customizedBy        String?
  
  // NOTE: customizationType/Value now stored on the custom Sku record
}
```

### How It Works

```
BEFORE Customization:
  OrderLine.skuId → Sku (LMD-BLU-M, isCustomSku: false)

AFTER Customization:
  OrderLine.skuId → NEW Sku (LMD-BLU-M-C01, isCustomSku: true, parentSkuId: original)
  OrderLine.isCustomized = true
```

---

## 4. Custom SKU Creation Logic

```javascript
async function createCustomSku(prisma, baseSkuId, customizationData, orderLineId) {
    // 1. Get base SKU and increment counter
    const baseSku = await prisma.sku.update({
        where: { id: baseSkuId },
        data: { customizationCount: { increment: 1 } },
        include: { variation: true }
    });
    
    // 2. Generate custom SKU code
    const count = baseSku.customizationCount;
    const customCode = `${baseSku.skuCode}-C${String(count).padStart(2, '0')}`;
    
    // 3. Create new Sku record for custom piece
    const customSku = await prisma.sku.create({
        data: {
            skuCode: customCode,
            variationId: baseSku.variationId,
            size: baseSku.size,
            isCustomSku: true,
            parentSkuId: baseSkuId,
            customizationType: customizationData.type,
            customizationValue: customizationData.value,
            customizationNotes: customizationData.notes,
            linkedOrderLineId: orderLineId,
            // Copy other relevant fields from base SKU
            fabricConsumption: baseSku.fabricConsumption,
        }
    });
    
    // 4. Update order line to point to custom SKU
    await prisma.orderLine.update({
        where: { id: orderLineId },
        data: {
            skuId: customSku.id,
            isCustomized: true,
            isNonReturnable: true,
            customizedAt: new Date()
        }
    });
    
    return customSku;
}
```

---

## 5. Separate Custom Inventory

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

## 6. API Endpoints

### Add Customization

```
POST /api/orders/lines/:lineId/customize

Request:
{
  "type": "length",
  "value": "-2 inches",
  "notes": "Customer is 5'2"
}

Response:
{
  "id": "line-uuid",
  "customSkuCode": "LMD-BLU-M-C01",
  "isCustomized": true,
  "isNonReturnable": true
}
```

### Remove Customization

```
DELETE /api/orders/lines/:lineId/customize

Response:
{
  "id": "line-uuid",
  "isCustomized": false,
  "customSkuCode": null
}
```

---

## 7. Open Orders Grid Changes

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

## 8. Production Workflow

### Standard vs Custom Flow

```
STANDARD:  Batch → Inward → Stock Pool → Manual Allocate
CUSTOM:    Batch → Inward + Reserve → Auto-Allocated
```

### Production Completion Logic

```javascript
if (batch.sourceOrderLineId) {
    // CUSTOM: Create inward + immediately reserve
    await prisma.inventoryTransaction.create({
        data: {
            skuId: batch.skuId,
            txnType: 'inward',
            qty: batch.qtyCompleted,
            reason: 'production_custom',
            linkedOrderLineId: batch.sourceOrderLineId,
            notes: `Custom: ${orderLine.customSkuCode}`
        }
    });
    
    await prisma.inventoryTransaction.create({
        data: {
            skuId: batch.skuId,
            txnType: 'reserved',
            qty: batch.qtyCompleted,
            reason: 'order_allocation',
            orderLineId: batch.sourceOrderLineId
        }
    });
    
    await prisma.orderLine.update({
        where: { id: batch.sourceOrderLineId },
        data: { lineStatus: 'allocated', allocatedAt: new Date() }
    });
} else {
    // STANDARD: Just inward to pool
    await prisma.inventoryTransaction.create({...});
}
```

---

## 9. Returns Blocking

```javascript
// In POST /api/returns
if (orderLine.isNonReturnable) {
    return res.status(400).json({
        error: 'Customized items cannot be returned',
        customSkuCode: orderLine.customSkuCode
    });
}
```

---

## 10. Files to Create/Modify

| File | Action | Changes |
|------|--------|---------|
| `schema.prisma` | MODIFY | Add fields to OrderLine, Sku, InventoryTransaction |
| `routes/orders/mutations.js` | MODIFY | Add customize/uncustomize endpoints |
| `production.js` | MODIFY | Update completeBatch for custom items |
| `returns.js` | MODIFY | Block non-returnable items |
| `orderHelpers.ts` | MODIFY | Add customization fields to FlattenedOrderRow |
| `OrdersGrid.tsx` | MODIFY | Add column, row styling, disable allocate |
| `CustomizationModal.tsx` | **NEW** | Modal for adding customization |

---

## 11. Implementation Phases

### Phase 1: Database & Backend (Day 1)
- [ ] Add schema fields, run migration
- [ ] Create customize endpoint with SKU generation
- [ ] Update production completion logic
- [ ] Block returns for customized items

### Phase 2: Orders UI (Day 2)
- [ ] Create CustomizationModal component
- [ ] Add customize column to OrdersGrid
- [ ] Implement row styling for customized lines
- [ ] Disable allocate, always show production for custom

### Phase 3: Production & Verification (Day 3)
- [ ] Show customization notes on production batch view
- [ ] Include custom SKU in production print/export
- [ ] Test full flow: customize → produce → auto-allocate → ship
- [ ] Test returns blocking

---

## 12. Estimated Effort

| Component | Time |
|-----------|------|
| Database migration | 1 hr |
| Backend API (customize endpoint) | 2 hrs |
| Production completion changes | 2 hrs |
| Returns blocking | 30 min |
| CustomizationModal component | 2 hrs |
| OrdersGrid integration | 2 hrs |
| Production view updates | 1.5 hrs |
| Testing & fixes | 3 hrs |
| **Total** | **~14 hours** |

---

## 13. Edge Cases

| Scenario | Handling |
|----------|----------|
| Customize after allocation | Must unallocate first |
| Customize shipped line | Not allowed |
| Undo customization | Clear fields, keep SKU counter (no reuse) |
| Qty > 1 customized | Each unit gets same custom SKU (single piece per custom) |
| Partial production | Rare - assume 1:1 for custom orders |
