# Shopify Sync Architecture Improvements

## Implementation Plan

Priority-ordered improvements for efficiency, reliability, and data quality.

---

## Phase 1: Quick Wins (1-2 days)

### 1.1 Webhook Deduplication

Prevent duplicate processing when Shopify sends same webhook multiple times.

#### Schema

```prisma
model WebhookLog {
  id            String   @id  // X-Shopify-Webhook-Id header
  topic         String       // orders/create, products/update, etc.
  shopifyId     String       // Order/Product/Customer ID
  receivedAt    DateTime @default(now())
  processedAt   DateTime?
  
  @@index([shopifyId, topic])
}
```

#### Implementation

```javascript
// webhooks.js - Add to all webhook handlers
const webhookId = req.get('X-Shopify-Webhook-Id');

const exists = await req.prisma.webhookLog.findUnique({ 
    where: { id: webhookId } 
});
if (exists) {
    console.log(`Duplicate webhook ignored: ${webhookId}`);
    return res.sendStatus(200);
}

await req.prisma.webhookLog.create({
    data: { id: webhookId, topic, shopifyId: String(req.body.id) }
});

// ... process webhook ...

await req.prisma.webhookLog.update({
    where: { id: webhookId },
    data: { processedAt: new Date() }
});
```

---

### 1.2 Schema Validation with Zod

Fail fast on malformed Shopify responses.

#### Install

```bash
cd server && npm install zod
```

#### Schemas

```typescript
// server/src/schemas/shopify.js
import { z } from 'zod';

export const ShopifyOrderSchema = z.object({
    id: z.number(),
    order_number: z.number(),
    financial_status: z.string().optional(),
    fulfillment_status: z.string().nullable().optional(),
    line_items: z.array(z.object({
        id: z.number(),
        variant_id: z.number().nullable(),
        sku: z.string().nullable(),
        quantity: z.number(),
        price: z.string(),
    })),
    customer: z.object({
        id: z.number(),
        email: z.string().nullable(),
    }).nullable().optional(),
    shipping_address: z.object({
        address1: z.string().nullable(),
        city: z.string().nullable(),
        province: z.string().nullable(),
        country: z.string().nullable(),
        zip: z.string().nullable(),
    }).nullable().optional(),
});

export const ShopifyProductSchema = z.object({
    id: z.number(),
    title: z.string(),
    handle: z.string(),
    variants: z.array(z.object({
        id: z.number(),
        sku: z.string().nullable(),
        price: z.string(),
        option1: z.string().nullable(),
        option2: z.string().nullable(),
    })),
});
```

#### Usage

```javascript
import { ShopifyOrderSchema } from '../schemas/shopify.js';

export async function cacheAndProcessOrder(prisma, rawOrder, ...) {
    const validated = ShopifyOrderSchema.safeParse(rawOrder);
    if (!validated.success) {
        console.error('Invalid order schema:', validated.error.issues);
        throw new Error(`Schema validation failed: ${validated.error.issues[0].message}`);
    }
    const shopifyOrder = validated.data;
    // ... continue processing
}
```

---

## Phase 2: Reliability (3-5 days)

### 2.1 Dead Letter Queue (Failed Items)

Automatic retry with exponential backoff for failed sync items.

#### Schema

```prisma
model FailedSyncItem {
  id              String   @id @default(uuid())
  entityType      String   // 'order', 'product', 'customer'
  shopifyId       String
  rawData         String   // Complete JSON for retry
  errorMessage    String
  errorStack      String?
  retryCount      Int      @default(0)
  maxRetries      Int      @default(5)
  nextRetryAt     DateTime
  createdAt       DateTime @default(now())
  resolvedAt      DateTime?
  resolution      String?  // 'success', 'manual', 'abandoned'
  
  @@index([nextRetryAt, resolvedAt])
  @@index([entityType, shopifyId])
  @@unique([entityType, shopifyId])
}
```

#### Service

```javascript
// server/src/services/deadLetterQueue.js

export async function addToDeadLetter(prisma, entityType, shopifyId, rawData, error) {
    const existing = await prisma.failedSyncItem.findUnique({
        where: { entityType_shopifyId: { entityType, shopifyId } }
    });
    
    const retryCount = existing ? existing.retryCount + 1 : 0;
    const nextRetryAt = new Date(Date.now() + Math.pow(2, retryCount) * 60000);
    
    await prisma.failedSyncItem.upsert({
        where: { entityType_shopifyId: { entityType, shopifyId } },
        update: {
            rawData,
            errorMessage: error.message,
            errorStack: error.stack,
            retryCount,
            nextRetryAt,
        },
        create: {
            entityType,
            shopifyId,
            rawData,
            errorMessage: error.message,
            errorStack: error.stack,
            nextRetryAt,
        }
    });
}

export async function processDeadLetterQueue(prisma) {
    const items = await prisma.failedSyncItem.findMany({
        where: {
            nextRetryAt: { lte: new Date() },
            resolvedAt: null,
            retryCount: { lt: prisma.raw('maxRetries') }
        },
        take: 50
    });
    
    for (const item of items) {
        try {
            const rawData = JSON.parse(item.rawData);
            
            if (item.entityType === 'order') {
                await cacheAndProcessOrder(prisma, rawData, 'dlq_retry');
            } else if (item.entityType === 'product') {
                await cacheAndProcessProduct(prisma, rawData, 'dlq_retry');
            }
            
            await prisma.failedSyncItem.update({
                where: { id: item.id },
                data: { resolvedAt: new Date(), resolution: 'success' }
            });
        } catch (error) {
            await addToDeadLetter(prisma, item.entityType, item.shopifyId, item.rawData, error);
        }
    }
}
```

#### Cron Job

```javascript
// Run every 5 minutes
import cron from 'node-cron';
cron.schedule('*/5 * * * *', () => processDeadLetterQueue(prisma));
```

---

### 2.2 Cursor-Based Pagination

Use Shopify's `page_info` cursor for guaranteed no-gap pagination.

#### Update shopify.js

```javascript
// server/src/services/shopify.js

async getAllOrdersWithCursor(options = {}) {
    const allOrders = [];
    let pageInfo = null;

    do {
        const params = {
            limit: 250,
            status: options.status || 'any',
            ...(pageInfo ? { page_info: pageInfo } : {}),
            ...(options.created_at_min && !pageInfo ? { created_at_min: options.created_at_min } : {}),
        };

        const response = await this.client.get('/orders.json', { params });
        allOrders.push(...response.data.orders);

        // Extract next page cursor from Link header
        const linkHeader = response.headers.link;
        pageInfo = this.extractNextPageInfo(linkHeader);

    } while (pageInfo);

    return allOrders;
}

extractNextPageInfo(linkHeader) {
    if (!linkHeader) return null;
    const match = linkHeader.match(/<[^>]+page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    return match ? match[1] : null;
}
```

---

## Phase 3: Data Quality (5-7 days)

### 3.1 Data Reconciliation Service

Daily job comparing Shopify ↔ ERP counts and flagging discrepancies.

#### Schema

```prisma
model ReconciliationReport {
  id              String   @id @default(uuid())
  entityType      String   // 'orders', 'products', 'customers'
  shopifyCount    Int
  erpCount        Int
  discrepancy     Int
  status          String   // 'ok', 'warning', 'critical'
  details         String?  // JSON with missing IDs
  createdAt       DateTime @default(now())
  
  @@index([entityType, createdAt])
}
```

#### Service

```javascript
// server/src/services/reconciliation.js

export async function runReconciliation(prisma, entityType) {
    let shopifyCount, erpCount, threshold;
    
    if (entityType === 'orders') {
        shopifyCount = await shopifyClient.getOrderCount({ status: 'any' });
        erpCount = await prisma.order.count({ 
            where: { shopifyOrderId: { not: null } } 
        });
        threshold = 100;
    } else if (entityType === 'products') {
        shopifyCount = await shopifyClient.getProductCount();
        erpCount = await prisma.product.count({ 
            where: { shopifyProductId: { not: null } } 
        });
        threshold = 10;
    }
    
    const discrepancy = Math.abs(shopifyCount - erpCount);
    const status = discrepancy === 0 ? 'ok' 
        : discrepancy <= threshold ? 'warning' 
        : 'critical';
    
    const report = await prisma.reconciliationReport.create({
        data: { entityType, shopifyCount, erpCount, discrepancy, status }
    });
    
    if (status === 'critical') {
        console.error(`RECONCILIATION ALERT: ${entityType} mismatch!`, report);
        // TODO: Send Slack/email alert
    }
    
    return report;
}
```

#### API Endpoint

```javascript
// GET /api/admin/reconciliation
router.get('/reconciliation', authenticateToken, requireAdmin, async (req, res) => {
    const reports = await Promise.all([
        runReconciliation(req.prisma, 'orders'),
        runReconciliation(req.prisma, 'products'),
    ]);
    res.json(reports);
});
```

---

### 3.2 Sync Health Dashboard

Track sync health metrics for proactive monitoring.

#### Schema

```prisma
model SyncHealthMetric {
  id            String   @id @default(uuid())
  metricType    String   // 'order_lag', 'error_rate', 'webhook_latency'
  value         Float
  threshold     Float
  status        String   // 'healthy', 'warning', 'critical'
  checkedAt     DateTime @default(now())
  
  @@index([metricType, checkedAt])
}
```

#### Metrics to Track

| Metric | Calculation | Warning | Critical |
|--------|-------------|---------|----------|
| Order Lag | Shopify count - ERP count | >50 | >200 |
| Error Rate | Failed/Total in last hour | >5% | >15% |
| Webhook Latency | Avg time to process | >5s | >30s |
| DLQ Size | Unresolved failed items | >20 | >100 |

---

## Implementation Checklist

### Phase 1: Quick Wins
- [ ] Create `WebhookLog` model
- [ ] Add deduplication to webhook handlers
- [ ] Install Zod, create schemas
- [ ] Add validation to order/product processing

### Phase 2: Reliability
- [ ] Create `FailedSyncItem` model
- [ ] Implement DLQ service with retry logic
- [ ] Add cron job for DLQ processing
- [ ] Update sync services to use DLQ on errors
- [ ] Implement cursor-based pagination

### Phase 3: Data Quality
- [ ] Create `ReconciliationReport` model
- [ ] Implement reconciliation service
- [ ] Create `SyncHealthMetric` model
- [ ] Build health dashboard endpoint
- [ ] Add alerting (Slack/email)

---

## Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1 | 1-2 days | None |
| Phase 2 | 3-5 days | Phase 1 |
| Phase 3 | 5-7 days | Phase 2 |
| **Total** | **~2 weeks** | |
