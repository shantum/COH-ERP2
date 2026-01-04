# Feature: Fabric Stock Reconciliation

*Physical inventory count system with mismatch adjustment*

---

## Overview

| Aspect | Detail |
|--------|--------|
| Goal | Reconcile physical fabric quantities against system stock |
| Process | Input physical count → Compare → Adjust mismatches |
| Adjustments | Inward/Outward with reasons (shrinkage, wastage, damaged, found) |
| Frequency | Routine (weekly/monthly) |
| UI | Dedicated Fabric Reconciliation page |
| Effort | ~10 hours |

---

## 1. User Flow

```
┌─────────────────────────────────────────────────────────────┐
│  FABRIC RECONCILIATION PAGE                                  │
├─────────────────────────────────────────────────────────────┤
│  [Start New Reconciliation]     Last: 15 Dec 2025           │
└────────────────────────────────┬────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Physical Count Entry                                │
├─────────────────────────────────────────────────────────────┤
│  Fabric              │ System Qty │ Physical Qty │ Variance  │
│  ────────────────────┼────────────┼──────────────┼───────────│
│  Wildflower Blue     │   45.2m    │ [  43.5  ]   │  -1.7m ⚠️ │
│  Dusty Rose Linen    │   28.0m    │ [  28.0  ]   │   0.0m ✓  │
│  Forest Green Silk   │   12.8m    │ [  15.0  ]   │  +2.2m 🔍 │
└─────────────────────────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Resolve Variances                                   │
├─────────────────────────────────────────────────────────────┤
│  Wildflower Blue: -1.7m                                      │
│  Reason: [Shrinkage ▼]  Notes: [____________]               │
│                                                             │
│  Forest Green Silk: +2.2m                                    │
│  Reason: [Found/Uncounted ▼]  Notes: [Was in Box B12]       │
└─────────────────────────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 3: Review & Submit                                     │
├─────────────────────────────────────────────────────────────┤
│  Summary:                                                    │
│  • 2 adjustments to be made                                  │
│  • Net change: +0.5m                                         │
│                                                             │
│  [Cancel]                         [Submit Reconciliation]   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Adjustment Reasons

### For Shortages (Physical < System)

| Reason | Code | Description |
|--------|------|-------------|
| Shrinkage | `shrinkage` | Fabric contracted during storage |
| Wastage | `wastage` | Cutting waste, unusable scraps |
| Damaged | `damaged` | Water damage, stains, tears |
| Theft/Loss | `loss` | Unexplained loss |
| Measurement Error | `measurement_error` | Previous count was wrong |

### For Overages (Physical > System)

| Reason | Code | Description |
|--------|------|-------------|
| Found | `found` | Previously uncounted stock found |
| Supplier Bonus | `supplier_bonus` | Extra fabric from supplier |
| Measurement Error | `measurement_error` | Previous count was wrong |

---

## 3. Database Changes

### New Model: FabricReconciliation

```prisma
model FabricReconciliation {
  id            String    @id @default(uuid())
  reconcileDate DateTime  @default(now())
  status        String    @default("draft")  // draft, submitted, approved
  notes         String?
  createdBy     String?
  approvedBy    String?
  approvedAt    DateTime?
  
  items         FabricReconciliationItem[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model FabricReconciliationItem {
  id                String    @id @default(uuid())
  reconciliationId  String
  reconciliation    FabricReconciliation @relation(...)
  
  fabricId          String
  fabric            Fabric    @relation(...)
  
  systemQty         Float                 // Qty as per system at time of count
  physicalQty       Float                 // Qty counted physically
  variance          Float                 // physicalQty - systemQty
  adjustmentReason  String?               // shrinkage, wastage, found, etc.
  notes             String?
  
  // Reference to created transaction
  txnId             String?   @unique
  transaction       FabricTransaction? @relation(...)
}
```

### FabricTransaction Reason Updates

```prisma
// Add new reasons to existing FabricTransaction
reason: 'reconciliation_shrinkage' | 'reconciliation_wastage' | 
        'reconciliation_damaged' | 'reconciliation_found' | ...
```

---

## 4. API Endpoints

### Start Reconciliation

```
POST /api/fabric/reconciliation/start

Response:
{
  "id": "recon-uuid",
  "status": "draft",
  "items": [
    {
      "fabricId": "fab-1",
      "fabricName": "Wildflower Blue",
      "systemQty": 45.2,
      "physicalQty": null,
      "variance": null
    },
    ...
  ]
}
```

### Update Physical Quantities

```
PUT /api/fabric/reconciliation/:id

Request:
{
  "items": [
    { "fabricId": "fab-1", "physicalQty": 43.5, "adjustmentReason": "shrinkage", "notes": "" },
    { "fabricId": "fab-2", "physicalQty": 28.0 },
    { "fabricId": "fab-3", "physicalQty": 15.0, "adjustmentReason": "found", "notes": "Box B12" }
  ]
}
```

### Submit Reconciliation

```
POST /api/fabric/reconciliation/:id/submit

Response:
{
  "id": "recon-uuid",
  "status": "submitted",
  "adjustmentsMade": 2,
  "transactions": [
    { "fabricId": "fab-1", "txnType": "outward", "qty": 1.7, "reason": "reconciliation_shrinkage" },
    { "fabricId": "fab-3", "txnType": "inward", "qty": 2.2, "reason": "reconciliation_found" }
  ]
}
```

### Get Reconciliation History

```
GET /api/fabric/reconciliation/history?limit=10

Response:
{
  "reconciliations": [
    { "id": "...", "date": "2025-12-15", "itemsCount": 25, "adjustments": 3, "status": "submitted" },
    ...
  ]
}
```

---

## 5. Backend Logic

### Submit Reconciliation

```javascript
async function submitReconciliation(prisma, reconciliationId, userId) {
    const recon = await prisma.fabricReconciliation.findUnique({
        where: { id: reconciliationId },
        include: { items: true }
    });
    
    const transactions = [];
    
    for (const item of recon.items) {
        if (item.variance === 0 || item.variance === null) continue;
        
        const txnType = item.variance > 0 ? 'inward' : 'outward';
        const qty = Math.abs(item.variance);
        const reason = `reconciliation_${item.adjustmentReason}`;
        
        // Create fabric transaction
        const txn = await prisma.fabricTransaction.create({
            data: {
                fabricId: item.fabricId,
                txnType,
                qty,
                reason,
                notes: `Reconciliation: ${item.notes || ''}`,
                createdBy: userId
            }
        });
        
        transactions.push(txn);
        
        // Link transaction to reconciliation item
        await prisma.fabricReconciliationItem.update({
            where: { id: item.id },
            data: { txnId: txn.id }
        });
    }
    
    // Mark reconciliation as submitted
    await prisma.fabricReconciliation.update({
        where: { id: reconciliationId },
        data: { status: 'submitted' }
    });
    
    return transactions;
}
```

---

## 6. UI Components

### New Page: FabricReconciliation.tsx

```
client/src/pages/FabricReconciliation.tsx  (~300 lines)
```

### Page Structure

```typescript
// Tabs
<Tabs>
  <Tab label="New Reconciliation" />
  <Tab label="History" />
</Tabs>

// New Reconciliation View
<ReconciliationTable 
  items={items}
  onPhysicalQtyChange={...}
  onReasonChange={...}
/>

// History View
<ReconciliationHistory reconciliations={history} />
```

### Table Columns

| Column | Width | Content |
|--------|-------|---------|
| Fabric | 200px | Fabric name + type |
| System Qty | 100px | Read-only, calculated balance |
| Physical Qty | 120px | Editable input |
| Variance | 100px | Auto-calculated, color-coded |
| Reason | 150px | Dropdown (required if variance ≠ 0) |
| Notes | flex | Optional text |

### Visual Indicators

| Variance | Display |
|----------|---------|
| 0 | ✓ Green check |
| Negative | ⚠️ Orange warning |
| Positive | 🔍 Blue info |

---

## 7. Navigation

Add to Settings or as standalone page:

```
/app/fabric-reconciliation
```

Or under Fabrics section:

```
Fabrics → Reconciliation (new tab)
```

---

## 8. Files to Create/Modify

| File | Action | Changes |
|------|--------|---------|
| `schema.prisma` | MODIFY | Add FabricReconciliation, FabricReconciliationItem |
| `fabrics.js` | MODIFY | Add reconciliation endpoints |
| `FabricReconciliation.tsx` | **NEW** | Full reconciliation page |
| `App.tsx` | MODIFY | Add route |
| `Navigation` | MODIFY | Add menu item |

---

## 9. Implementation Phases

### Phase 1: Database & Backend (Day 1)
- [ ] Add schema models, run migration
- [ ] Create start reconciliation endpoint
- [ ] Create update/submit endpoints
- [ ] Add history endpoint

### Phase 2: UI (Day 2)
- [ ] Create FabricReconciliation page
- [ ] Build editable table with variance calculation
- [ ] Add reason dropdown with validation
- [ ] Implement submit flow with confirmation

### Phase 3: Polish (Day 3)
- [ ] Add history tab
- [ ] Export reconciliation report
- [ ] Add last reconciliation date per fabric
- [ ] Test full flow

---

## 10. Estimated Effort

| Component | Time |
|-----------|------|
| Database migration | 45 min |
| Backend API endpoints | 2 hrs |
| FabricReconciliation page | 3 hrs |
| Table with editable inputs | 2 hrs |
| History view | 1 hr |
| Testing & fixes | 1.5 hrs |
| **Total** | **~10 hours** |

---

## 11. Future Enhancements

| Enhancement | Description |
|-------------|-------------|
| Barcode scanning | Scan fabric barcodes for faster entry |
| Partial reconciliation | Reconcile specific fabric types only |
| Approval workflow | Manager approval before adjustments |
| Scheduled reminders | Notify when reconciliation is due |
| Variance alerts | Flag fabrics with frequent discrepancies |
