# Settings Panel Redesign - Shopify Sync

## Implementation Review ✅

The sync improvements have been implemented in the backend:

| Component | Status | Notes |
|-----------|--------|-------|
| `syncWorker.js` | ✅ Complete | POPULATE and UPDATE modes implemented |
| `shopify.js` routes | ✅ Complete | API accepts `syncMode`, `staleAfterMins` |
| `schema.prisma` | ✅ Complete | `syncMode`, `staleAfterMins` fields added |
| `api.ts` | ❌ Needs Update | Still uses legacy `startSyncJob(jobType, days)` |
| `ShopifyTab.tsx` | ❌ Needs Update | No UI for sync modes |

---

## Issues Found

### 1. Frontend API Missing Sync Mode Support

**File**: `client/src/services/api.ts` line 225

```typescript
// Current (legacy)
startSyncJob: (jobType: string, days?: number) =>
    api.post('/shopify/sync/jobs/start', { jobType, days }),

// Should be
startSyncJob: (params: {
    jobType: string;
    syncMode?: 'populate' | 'update';
    days?: number;
    staleAfterMins?: number;
}) => api.post('/shopify/sync/jobs/start', params),
```

### 2. ShopifyTab Still Uses Legacy Sync

**File**: `client/src/components/settings/tabs/ShopifyTab.tsx` line 119-126

The mutation calls `shopifyApi.startSyncJob(jobType, days)` without sync mode.

---

## Proposed UI Redesign

### Replace Legacy Sync with Two Clear Actions

```
┌─────────────────────────────────────────────────────────┐
│  📦 Order Sync                                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────┐ ┌──────────────────────────┐ │
│  │  POPULATE            │ │  UPDATE                  │ │
│  │  Import New Orders   │ │  Refresh Changed Orders  │ │
│  │                      │ │                          │ │
│  │  Days: [365 ▼]       │ │  Since: [60 mins ▼]      │ │
│  │                      │ │                          │ │
│  │  Skip existing       │ │  Uses updated_at_min     │ │
│  │  orders in database  │ │  for efficiency          │ │
│  │                      │ │                          │ │
│  │  [▶ Start Populate]  │ │  [▶ Start Update]        │ │
│  └──────────────────────┘ └──────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Checklist

### Frontend API
- [ ] Update `startSyncJob` in `api.ts` to accept `syncMode` and `staleAfterMins`

### ShopifyTab.tsx
- [ ] Remove legacy "Background Order Sync" section
- [ ] Add new "Order Sync" section with two action cards:
  - **POPULATE**: Days selector + "Import New" button
  - **UPDATE**: Minutes selector + "Refresh Changed" button
- [ ] Update `startJobMutation` to pass `syncMode`
- [ ] Show sync mode in job history table

### Remove Duplicate Sections
- [ ] Remove "Sync Orders" quick sync (line ~400)
- [ ] Keep only the new two-mode sync
- [ ] Keep product sync as-is (products don't need modes)

---

## Code Changes

### [MODIFY] client/src/services/api.ts

```typescript
startSyncJob: (params: {
    jobType: string;
    syncMode?: 'populate' | 'update';
    days?: number;
    staleAfterMins?: number;
}) => api.post('/shopify/sync/jobs/start', params),
```

### [MODIFY] client/src/components/settings/tabs/ShopifyTab.tsx

1. Add state for sync mode options:
```typescript
const [populateDays, setPopulateDays] = useState(365);
const [updateMins, setUpdateMins] = useState(60);
```

2. Update mutation call:
```typescript
const startPopulateMutation = useMutation({
    mutationFn: () => shopifyApi.startSyncJob({
        jobType: 'orders',
        syncMode: 'populate',
        days: populateDays
    }),
    onSuccess: () => refetchJobs(),
});

const startUpdateMutation = useMutation({
    mutationFn: () => shopifyApi.startSyncJob({
        jobType: 'orders',
        syncMode: 'update',
        staleAfterMins: updateMins
    }),
    onSuccess: () => refetchJobs(),
});
```

3. Replace the "Background Sync Jobs" section with new UI showing two action cards.

---

## Expected Result

| Action | Use Case |
|--------|----------|
| **POPULATE** | First-time setup, importing historical orders |
| **UPDATE** | Hourly/daily refresh of orders changed in Shopify |

Both actions visible on one screen with clear descriptions. No duplicate sync options.
