# Database Analysis & Recommendations

## Executive Summary

COH-ERP2 uses **SQLite** with Prisma ORM. For your scale (60K orders, multi-user Railway deployment), **migrating to PostgreSQL is strongly recommended**.

---

## Current Schema Stats

| Metric | Value |
|--------|-------|
| Total Models | 34 |
| Total Indexes | 49 |
| Schema Lines | 672 |
| JSON-as-String Fields | 8+ |
| Composite Unique | 1 |

---

## SQLite vs PostgreSQL Evaluation

| Factor | SQLite | PostgreSQL | Winner |
|--------|--------|------------|--------|
| **Concurrent writes** | Single writer lock | MVCC (multi-writer) | ✅ PG |
| **Railway deployment** | File-based (ephemeral risk) | Managed service | ✅ PG |
| **JSON queries** | No native support | `jsonb` with operators | ✅ PG |
| **Full-text search** | Basic | Advanced (`tsvector`) | ✅ PG |
| **Scaling** | ~100GB practical limit | Terabytes | ✅ PG |
| **Backups** | Manual file copy | Automated (Railway) | ✅ PG |
| **Setup complexity** | Zero config | Needs connection URL | SQLite |
| **Cost** | Free | ~$5-20/month | SQLite |

### Verdict: **Migrate to PostgreSQL**

Your 60K order volume and Railway deployment make SQLite risky:
- Railway containers are ephemeral (SQLite file can be lost)
- Multiple API requests cause write contention
- JSON fields can't be queried efficiently

---

## Schema Improvement Recommendations

### 🔴 Critical

#### 1. Remove Redundant `Order.shopifyData`
Already identified in data audit. Raw data exists in `ShopifyOrderCache.rawData`.

**Action**: Drop column after migration (saves ~50% order storage)

#### 2. Add Missing Indexes

```prisma
// High-traffic query patterns missing indexes:

model Order {
  @@index([orderDate, status])     // Dashboard date range queries
  @@index([shopifyOrderId])        // Already has @unique, OK
}

model OrderLine {
  @@index([lineStatus, orderId])   // Fulfillment filters
}

model FabricTransaction {
  @@index([fabricId, createdAt])   // Ledger queries
}

model InventoryTransaction {
  @@index([skuId, createdAt])      // Stock history
}
```

#### 3. Switch JSON Strings to JSONB (PostgreSQL)

```prisma
// Change from:
shippingAddress String?   // JSON as string

// To (PostgreSQL):
shippingAddress Json?     // Native JSONB
```

**Benefits**:
- Query inside JSON: `WHERE shipping->>'city' = 'Mumbai'`
- 30-50% smaller storage (compressed)
- Partial indexing on JSON paths

---

### 🟡 Recommended

#### 4. Add Enum Types (PostgreSQL)

```prisma
enum OrderStatus {
  open
  shipped
  delivered
  cancelled
  returned
}

model Order {
  status OrderStatus @default(open)  // Type-safe, faster queries
}
```

**Candidates**:
- Order.status, OrderLine.lineStatus
- FabricTransaction.txnType, reason
- ReturnRequest.status, reasonCategory

#### 5. Normalize Addresses

Current: JSON strings in 4+ tables
Better: Dedicated `Address` model

```prisma
model Address {
  id        String @id @default(uuid())
  line1     String
  line2     String?
  city      String
  state     String
  pincode   String
  country   String @default("India")
  phone     String?
  
  @@index([pincode])
  @@index([city])
}
```

#### 6. Add Composite Indexes for Common Queries

```prisma
model Order {
  @@index([status, orderDate])        // Open orders by date
  @@index([customerId, orderDate])    // Customer order history
}

model ProductionBatch {
  @@index([status, batchDate])        // Today's production
}
```

---

### 🟢 Nice to Have

#### 7. Use `BigInt` for Shopify IDs

Shopify IDs can exceed JavaScript's safe integer limit:

```prisma
model Order {
  shopifyOrderId BigInt? @unique  // Instead of String
}
```

#### 8. Add Soft Deletes Consistently

Currently mixed: some have `isActive`, some have `isArchived`.

```prisma
// Standardize:
deletedAt DateTime?  // null = active, timestamp = soft deleted
```

---

## Migration Path: SQLite → PostgreSQL

### Step 1: Update Schema

```prisma
datasource db {
  provider = "postgresql"  // Changed from "sqlite"
  url      = env("DATABASE_URL")
}
```

### Step 2: Railway Setup

1. Add PostgreSQL plugin in Railway dashboard
2. Copy `DATABASE_URL` to environment variables
3. Format: `postgresql://user:pass@host:5432/dbname`

### Step 3: Migrate Data

```bash
# Export from SQLite
npx prisma db pull
npx prisma migrate dev --name init_postgres

# OR use pg_dump if you have existing PostgreSQL backup
```

### Step 4: Update Code

Only JSON handling needs changes:
- `JSON.parse(row.shippingAddress)` → `row.shippingAddress` (native)

---

## Performance Projections

| Metric | SQLite (Current) | PostgreSQL (Projected) |
|--------|------------------|----------------------|
| Concurrent users | 1-3 | 50+ |
| Order sync speed | ~50/min | ~200/min |
| Dashboard load | 2-3s | <500ms |
| Write contention | Frequent locks | Rare |

---

## Implementation Priority

1. **Immediate**: Migrate to PostgreSQL on Railway
2. **Week 1**: Add missing indexes
3. **Week 2**: Convert JSON strings to native JSONB
4. **Month 1**: Add enums for type safety
5. **Future**: Address normalization
