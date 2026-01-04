# Product Sync Architecture Alignment

## Overview

Align product sync with order sync architecture: add Shopify IDs, cache layer, background processing, webhooks, and inventory sync.

---

## Current State vs Target

| Feature | Order Sync | Product (Current) | Product (Target) |
|---------|------------|-------------------|------------------|
| Shopify ID | ✅ `shopifyOrderId` | ❌ None | ✅ `shopifyProductId` |
| Cache layer | ✅ `ShopifyOrderCache` | ❌ None | ✅ `ShopifyProductCache` |
| Webhooks | ✅ orders/create, update | ❌ None | ✅ products/create, update, delete |
| Inventory sync | N/A | ✅ During product sync | ✅ + Webhooks real-time |
| Background worker | ✅ Yes | ❌ Synchronous | ✅ Yes |

---

## Schema Changes

### [MODIFY] schema.prisma

```prisma
model Product {
  shopifyProductId  String?  @unique  // NEW
  shopifyHandle     String?           // NEW
  // ... existing fields
}

model ShopifyProductCache {
  id                String    @id  // shopifyProductId
  rawData           String         // Complete Shopify product JSON
  title             String?
  handle            String?
  lastSyncedAt      DateTime  @default(now())
  processedAt       DateTime?
  processingError   String?
  
  @@index([handle])
  @@index([processedAt])
}
```

---

## Webhook Handlers

### [MODIFY] webhooks.js

Add product webhook endpoints:

```javascript
// POST /api/webhooks/products/create
router.post('/products/create', verifyShopifyWebhook, async (req, res) => {
    const shopifyProduct = req.body;
    await cacheAndProcessProduct(prisma, shopifyProduct);
    res.sendStatus(200);
});

// POST /api/webhooks/products/update
router.post('/products/update', verifyShopifyWebhook, async (req, res) => {
    const shopifyProduct = req.body;
    await cacheAndProcessProduct(prisma, shopifyProduct);
    res.sendStatus(200);
});

// POST /api/webhooks/products/delete
router.post('/products/delete', verifyShopifyWebhook, async (req, res) => {
    const shopifyProductId = String(req.body.id);
    await prisma.product.updateMany({
        where: { shopifyProductId },
        data: { isActive: false }
    });
    res.sendStatus(200);
});
```

---

## Inventory Webhook

### [NEW] Inventory Update Handler

```javascript
// POST /api/webhooks/inventory_levels/update
router.post('/inventory_levels/update', verifyShopifyWebhook, async (req, res) => {
    const { inventory_item_id, available } = req.body;
    
    // Find SKU by inventory item ID
    const sku = await prisma.sku.findFirst({
        where: { shopifyInventoryItemId: String(inventory_item_id) }
    });
    
    if (sku) {
        await prisma.shopifyInventoryCache.upsert({
            where: { skuId: sku.id },
            update: { availableQty: available, lastSynced: new Date() },
            create: { skuId: sku.id, shopifyInventoryItemId: String(inventory_item_id), availableQty: available }
        });
    }
    res.sendStatus(200);
});
```

---

## Migration Script

### [NEW] scripts/backfill-product-ids.js

One-time script to link existing products to Shopify:

```javascript
async function backfillProductIds() {
    const shopifyProducts = await shopifyClient.getAllProducts();
    
    for (const sp of shopifyProducts) {
        // Match by name
        const product = await prisma.product.findFirst({
            where: { name: sp.title, shopifyProductId: null }
        });
        
        if (product) {
            await prisma.product.update({
                where: { id: product.id },
                data: { 
                    shopifyProductId: String(sp.id),
                    shopifyHandle: sp.handle
                }
            });
            console.log(`Linked: ${sp.title}`);
        }
    }
}
```

---

## Breaking Changes

| Item | Risk | Mitigation |
|------|------|------------|
| New schema fields | ✅ Safe | Optional fields, nullable |
| Product matching logic | 🟡 Low | Fallback to name match if no ID |
| SKU lookups | ✅ Safe | Unchanged |
| Order lines | ✅ Safe | Uses SKU ID, unchanged |

---

## Implementation Checklist

### Schema
- [ ] Add `shopifyProductId`, `shopifyHandle` to Product
- [ ] Create `ShopifyProductCache` model
- [ ] Run migration

### Backend
- [ ] Update `syncSingleProduct` to use ID matching
- [ ] Create `cacheAndProcessProduct` function
- [ ] Add product webhooks (create/update/delete)
- [ ] Add inventory webhook
- [ ] Add `processProductSync` to syncWorker
- [ ] Create migration script for existing products

### Shopify Admin
- [ ] Register webhooks:
  - `products/create`
  - `products/update`
  - `products/delete`
  - `inventory_levels/update`

### Frontend
- [ ] Update Settings UI to use background product sync
