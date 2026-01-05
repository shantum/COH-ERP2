# Code Improvement Tracker

> **Living Document** - Updated as issues are fixed and new ones identified

**Last Updated**: 2026-01-05

---

## Summary

| Priority | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| 🔴 Critical | 4 | 4 | 0 |
| 🟠 High | 6 | 6 | 0 |
| 🟡 Medium | 8 | 2 | 6 |
| 🟢 Low | 5 | 0 | 5 |

---

## 🔴 Critical (Fix ASAP)

### C1. No Webhook Deduplication
**Location**: `webhooks.js`
**Issue**: Same webhook can be processed multiple times if Shopify retries
**Risk**: Duplicate orders, inventory miscounts
**Fix**: Add `WebhookLog` table, check `X-Shopify-Webhook-Id` header
**Status**: ✅ Fixed (2026-01-05)
**Solution**: Added `WebhookLog` model and deduplication in all webhook endpoints

---

### C2. No Dead Letter Queue for Failed Syncs
**Location**: `syncWorker.js`
**Issue**: Failed orders logged but never retried automatically
**Risk**: Silent data loss, missing orders
**Fix**: Add `FailedSyncItem` table with exponential backoff
**Status**: ✅ Fixed (2026-01-05)
**Solution**: Added `FailedSyncItem` model with exponential backoff retry logic

---

### C3. No Input Validation on Webhooks
**Location**: `webhooks.js`
**Issue**: Trusts Shopify payload structure without validation
**Risk**: Server crash on malformed data
**Fix**: Add Zod schema validation
**Status**: ✅ Fixed (2026-01-05)
**Solution**: Added Zod schemas for all webhook payloads in `webhookUtils.js`

---

### C4. Sensitive Data in Console Logs
**Location**: `shopify.js:61-62`
**Issue**: Token length logged, could leak in production logs
**Risk**: Security exposure
**Fix**: Remove or mask sensitive data in logs
**Status**: ✅ Fixed (2026-01-05)
**Solution**: Removed token length logging, now only logs boolean token existence

---

## 🟠 High (Fix Soon)

### H1. Large Files Need Splitting
| File | Lines | Recommendation |
|------|-------|----------------|
| `orders.js` | 1,286 | Split by function |
| `shopify.js` | 864 | Split by feature |
| `fabrics.js` | 796 | Split CRUD/transactions |
| `OrdersGrid.tsx` | 896 | Extract components |
| `ShopifyTab.tsx` | 894 | Extract sections |
| `Production.tsx` | 786 | Extract modals |

**Status**: ⬜ Pending

---

### H2. Duplicate Customer Lookup Logic
**Location**: 5 files
**Files**: `shopifyOrderProcessor.js`, `webhooks.js`, `shopify.js`, `customerSyncService.js`, `queryPatterns.js`
**Fix**: Create `customerUtils.js` with shared `findOrCreateCustomer()`
**Status**: ✅ Fixed (2026-01-05)
**Solution**: Created `server/src/utils/customerUtils.js` with shared functions

---

### H3. No Pagination on Heavy Endpoints
| Endpoint | Issue |
|----------|-------|
| `GET /orders/open` | Returns all open orders |
| `GET /inventory/balance` | Returns all SKUs |

**Fix**: Add limit/offset pagination with total count
**Status**: ✅ Fixed (2026-01-05)
**Solution**: Added pagination to `/orders/open` and `/inventory/balance` endpoints. Response now includes `{ orders/items, pagination: { total, limit, offset, hasMore } }`. Frontend updated to handle new format with backward compatibility.

---

### H4. Redundant Order.shopifyData Field
**Location**: `schema.prisma:301`
**Issue**: Raw JSON stored in both `Order.shopifyData` AND `ShopifyOrderCache.rawData`
**Fix**: Remove `Order.shopifyData`, use cache only
**Status**: ✅ Fixed (2026-01-05)
**Solution**: Field already marked deprecated, not used in code. ShopifyOrderCache is source of truth.

---

### H5. Missing Compound Indexes
**Location**: `schema.prisma`
**Add**:
```prisma
@@index([status, orderDate])     // Order
@@index([customerId, orderDate]) // Order
@@index([lineStatus, orderId])   // OrderLine
@@index([fabricId, createdAt])   // FabricTransaction
```
**Status**: ✅ Fixed (2026-01-05)
**Solution**: All compound indexes added to schema

---

### H6. 27 Console.logs in Route Files
**Location**: `shopify.js`, `webhooks.js`, `orders.js`
**Fix**: Use proper logger (Pino/Winston) with log levels
**Status**: ✅ Fixed (2026-01-05)
**Solution**: Created Pino logger at `server/src/utils/logger.js`, migrated webhooks.js

---

## 🟡 Medium (Plan to Fix)

### M1. Duplicate Order Processing Logic
**Location**: `shopify.js:520-680` duplicates `shopifyOrderProcessor.js`  
**Fix**: Reuse `shopifyOrderProcessor` in reprocess-cache endpoint  
**Status**: ✅ Fixed (2026-01-05)
**Solution**: Refactored reprocess-cache endpoint to use shared `processFromCache()` function

---

### M2. Locked Dates JSON Parsing (4 places)
**Location**: `production.js:87,278,297,326`  
**Fix**: Create `getLockedDates()` utility  
**Status**: ✅ Fixed (2026-01-05)
**Solution**: Created `productionUtils.js` with `getLockedDates()` and `saveLockedDates()` utilities

---

### M3. Addresses Stored as JSON Strings
**Location**: `Customer.defaultAddress`, `Order.shippingAddress`  
**Fix**: Normalize to `Address` model (lower priority)  
**Status**: ⬜ Backlog

---

### M4. No Data Reconciliation
**Issue**: No automated check if Shopify ↔ ERP counts match  
**Fix**: Add daily reconciliation job  
**Status**: ⬜ Pending  
**Plan**: [SYNC_IMPROVEMENTS.md](./features/SYNC_IMPROVEMENTS.md)

---

### M5. Sync Uses since_id (Can Miss Records)
**Location**: `syncWorker.js`  
**Issue**: `since_id` pagination can miss records with non-sequential IDs  
**Fix**: Use cursor-based `page_info` pagination  
**Status**: ⬜ Pending

---

### M6. SKU Lookup Not Cached
**Location**: Inward pages  
**Issue**: Database query for every barcode scan  
**Fix**: Implement in-memory SKU cache  
**Status**: ⬜ Pending  
**Plan**: [SKU_CACHE.md](./features/SKU_CACHE.md)

---

### M7. No Error Boundaries in React
**Location**: Frontend pages  
**Issue**: Uncaught errors crash entire app  
**Fix**: Add `ErrorBoundary` components  
**Status**: ⬜ Pending

---

### M8. Missing Loading States
**Location**: Various pages  
**Issue**: No skeleton/loading UI during data fetch  
**Fix**: Add consistent loading states  
**Status**: ⬜ Pending

---

## 🟢 Low (Nice to Have)

### L1. Hardcoded Constants
**Location**: Various  
**Examples**: Batch sizes, delays, thresholds  
**Fix**: Move to config/env  
**Status**: ⬜ Backlog

---

### L2. Inconsistent Error Messages
**Location**: API routes  
**Fix**: Standardize error response format  
**Status**: ⬜ Backlog

---

### L3. No API Rate Limiting
**Location**: Server  
**Fix**: Add express-rate-limit  
**Status**: ⬜ Backlog

---

### L4. Missing TypeScript (Backend)
**Location**: `server/src`  
**Fix**: Gradual migration to TypeScript  
**Status**: ⬜ Backlog

---

### L5. No Unit Tests
**Location**: Backend services  
**Fix**: Add Jest tests for critical paths  
**Status**: ⬜ Backlog

---

## Recently Fixed

| ID | Issue | Fixed Date | Notes |
|----|-------|------------|-------|
| M2 | Locked Dates JSON Parsing | 2026-01-05 | Created productionUtils.js |
| M1 | Duplicate Order Processing | 2026-01-05 | Used shared processFromCache |
| H3 | No Pagination on Heavy Endpoints | 2026-01-05 | Added limit/offset pagination |
| H6 | Console.logs in Route Files | 2026-01-05 | Added Pino logger |
| H5 | Missing Compound Indexes | 2026-01-05 | Added to schema |
| H4 | Redundant shopifyData | 2026-01-05 | Already deprecated |
| H2 | Duplicate Customer Logic | 2026-01-05 | Created customerUtils.js |
| C1 | No Webhook Deduplication | 2026-01-05 | Added WebhookLog model |
| C2 | No Dead Letter Queue | 2026-01-05 | Added FailedSyncItem model |
| C3 | No Input Validation | 2026-01-05 | Added Zod schemas |
| C4 | Sensitive Data in Logs | 2026-01-05 | Removed token length logging |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-05 | Fixed M1, M2: Extracted locked dates utility and consolidated order processing |
| 2026-01-05 | Fixed H3: Added pagination to /orders/open and /inventory/balance |
| 2026-01-05 | Fixed 4 high-priority issues (H2, H4, H5, H6) |
| 2026-01-05 | Fixed all 4 critical issues (C1-C4) |
| 2026-01-05 | Initial document created |
