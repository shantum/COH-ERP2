# Shopify Order Sync - Three Mode Architecture

## Overview

Replace current sync logic with three distinct modes optimized for different use cases.

| Mode | Use Case | Speed | Data Coverage |
|------|----------|-------|---------------|
| **DEEP** | Initial setup, data recovery | Slow (~30min) | All orders |
| **QUICK** | Daily catch-up | Fast (~1min) | Missing orders only |
| **UPDATE** | Hourly refresh | Fast (~1min) | Changed orders only |

---

## Mode 1: DEEP SYNC (Initial Import)

**Purpose**: Import ALL orders from Shopify. Use for first-time setup or data recovery.

### Behavior
- Fetch all orders using `since_id` pagination
- Batch size: **250** (max Shopify allows)
- Process every order (upsert)
- Full checkpointing for resume capability
- Aggressive memory management

### API Parameters
```javascript
{
  syncMode: 'deep',
  days: 365  // or null for all time
}
```

### Implementation
```javascript
if (syncMode === 'deep') {
    this.batchSize = 250;
    this.batchDelay = 1500;  // Longer delay for memory
    
    // Fetch all orders from Shopify
    // Process every order (create or update)
    // No skip logic - we want everything
}
```

### Memory Safeguards
- GC every 3 batches
- Prisma disconnect every 5 batches
- 1.5s delay between batches

---

## Mode 2: QUICK SYNC (Missing Orders)

**Purpose**: Fast catch-up sync. Fetches orders newer than the most recent in DB.

### Behavior
- Find most recent `orderDate` in database
- Fetch orders created after that date
- Skip orders that already exist (by shopifyOrderId)
- Much faster than DEEP since we only fetch new data

### API Parameters
```javascript
{
  syncMode: 'quick'
}
```

### Implementation
```javascript
if (syncMode === 'quick') {
    this.batchSize = 250;
    this.batchDelay = 500;
    
    // Find latest order date in DB
    const latestOrder = await prisma.order.findFirst({
        where: { shopifyOrderId: { not: null } },
        orderBy: { orderDate: 'desc' },
        select: { orderDate: true }
    });
    
    // Fetch only orders created after this date
    const createdAtMin = latestOrder?.orderDate?.toISOString();
    
    // Load existing IDs for skip check
    const existingIds = new Set(
        (await prisma.order.findMany({
            where: { shopifyOrderId: { not: null } },
            select: { shopifyOrderId: true }
        })).map(o => o.shopifyOrderId)
    );
    
    // Fetch and process, skipping existing
    for (const order of shopifyOrders) {
        if (existingIds.has(String(order.id))) continue;
        await this.syncSingleOrder(order);
    }
}
```

### Why This Is Safe
- Uses `created_at_min` to reduce API calls
- Still loads `existingIds` to skip already-synced orders
- No orders missed even if IDs are non-sequential

---

## Mode 3: UPDATE SYNC (Refresh Changed)

**Purpose**: Re-sync orders that have been modified in Shopify (e.g., fulfillment, payment changes).

### Behavior
- Use Shopify's `updated_at_min` parameter
- Only fetch orders modified since threshold
- Update all matching orders in DB (no skip)

### API Parameters
```javascript
{
  syncMode: 'update',
  staleAfterMins: 60  // Fetch orders updated in last 60 mins
}
```

### Implementation
```javascript
if (syncMode === 'update') {
    this.batchSize = 250;
    this.batchDelay = 500;
    
    const threshold = new Date();
    threshold.setMinutes(threshold.getMinutes() - job.staleAfterMins);
    
    // Fetch only orders updated since threshold
    const shopifyOrders = await shopifyClient.getOrders({
        updated_at_min: threshold.toISOString(),
        status: 'any',
        limit: 250
    });
    
    // Process all - they all need updating
    for (const order of shopifyOrders) {
        await this.syncSingleOrder(order);
    }
}
```

---

## Comparison

| Aspect | DEEP | QUICK | UPDATE |
|--------|------|-------|--------|
| API Filter | none / created_at_min | created_at_min | updated_at_min |
| Skip Logic | None (upsert all) | Skip existing | None (update all) |
| Batch Size | 250 | 250 | 250 |
| Expected API Calls | ~240 (60K orders) | ~5 (new only) | ~1-5 |
| Expected Time | 30+ min | <1 min | <1 min |
| Memory Risk | High | Low | Low |

---

## UI Design

```
┌─────────────────────────────────────────────────────────────┐
│  📦 Order Sync                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [DEEP SYNC]          [QUICK SYNC]        [UPDATE SYNC]    │
│  Initial Import       Missing Orders      Changed Orders    │
│                                                             │
│  ⚠️ Slow, use for     ✅ Recommended      ✅ Run hourly     │
│  first-time setup     for daily use                        │
│                                                             │
│  Days: [All Time ▼]                       Since: [60min ▼] │
│                                                             │
│  [▶ Start Deep Sync]  [▶ Quick Sync]      [▶ Refresh]      │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Checklist

### Backend
- [ ] Add `syncMode: 'deep' | 'quick' | 'update'` validation
- [ ] Implement DEEP mode with batch 250, aggressive memory management
- [ ] Implement QUICK mode with `created_at_min` + skip existing
- [ ] Implement UPDATE mode with `updated_at_min`
- [ ] Remove old POPULATE mode

### Frontend
- [ ] Update `api.ts` to support new modes
- [ ] Redesign ShopifyTab with 3 action cards
- [ ] Add tooltips explaining each mode

### Schema
- [ ] Update SyncJob.syncMode enum values
