/**
 * Product Sync Service — SKU Sync
 */

import type { PrismaClient } from '@prisma/client';
import type { ShopifyVariantWithInventory, SyncResult } from './types.js';
import { normalizeSize } from './variantUtils.js';

/**
 * Sync a single SKU from Shopify variant
 */
export async function syncSingleSku(
    prisma: PrismaClient,
    variant: ShopifyVariantWithInventory,
    variationId: string,
    productHandle: string,
    colorName: string,
    sizeKey: 'option1' | 'option2' | 'option3' = 'option2'
): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0 };

    const shopifyVariantId = String(variant.id);
    const sizeValue = variant[sizeKey];
    const skuCode = variant.sku?.trim() ||
        `${productHandle}-${colorName}-${sizeValue || 'OS'}`.replace(/\s+/g, '-').toUpperCase();
    const rawSize = sizeValue || 'One Size';
    const size = normalizeSize(rawSize);

    // Check if SKU exists by shopifyVariantId or skuCode
    let sku = await prisma.sku.findFirst({
        where: {
            OR: [
                { shopifyVariantId },
                { skuCode },
            ],
        },
    });

    if (sku) {
        // Update existing SKU
        // If Shopify now has a proper SKU (barcode) and our stored code is a slug fallback, update it
        const shopifySku = variant.sku?.trim();
        const shouldUpdateSkuCode = shopifySku && shopifySku !== sku.skuCode && /[a-zA-Z].*-/.test(sku.skuCode);
        // MRP = compare_at_price (original retail) if set, otherwise selling price
        const sellingPrice = parseFloat(variant.price) || 0;
        const compareAtPrice = parseFloat(variant.compare_at_price || '') || 0;
        const shopifyMrp = compareAtPrice > 0 ? compareAtPrice : sellingPrice;
        const newMrp = shopifyMrp > 0 ? shopifyMrp : sku.mrp;
        // sellingPrice only stored when discounted (compare_at_price is set and price < compare_at_price)
        const isDiscounted = compareAtPrice > 0 && sellingPrice > 0 && sellingPrice < compareAtPrice;
        await prisma.sku.update({
            where: { id: sku.id },
            data: {
                ...(shouldUpdateSkuCode ? { skuCode: shopifySku } : {}),
                // Fix variationId if SKU was stuck on wrong variation from old syncs
                ...(sku.variationId !== variationId ? { variationId } : {}),
                shopifyVariantId,
                shopifyInventoryItemId: variant.inventory_item_id ? String(variant.inventory_item_id) : null,
                mrp: newMrp,
                sellingPrice: isDiscounted ? sellingPrice : null,
            },
        });

        // Update Shopify inventory cache
        if (variant.inventory_item_id && typeof variant.inventory_quantity === 'number') {
            await prisma.shopifyInventoryCache.upsert({
                where: { skuId: sku.id },
                update: {
                    shopifyInventoryItemId: String(variant.inventory_item_id),
                    availableQty: variant.inventory_quantity,
                    lastSynced: new Date(),
                },
                create: {
                    skuId: sku.id,
                    shopifyInventoryItemId: String(variant.inventory_item_id),
                    availableQty: variant.inventory_quantity,
                },
            });
        }
        result.updated++;
    } else {
        // Create new SKU
        const createSellingPrice = parseFloat(variant.price) || 0;
        const createCompareAtPrice = parseFloat(variant.compare_at_price || '') || 0;
        const createMrp = createCompareAtPrice > 0 ? createCompareAtPrice : createSellingPrice;
        const createIsDiscounted = createCompareAtPrice > 0 && createSellingPrice > 0 && createSellingPrice < createCompareAtPrice;
        const newSku = await prisma.sku.create({
            data: {
                variationId,
                skuCode,
                size,
                mrp: createMrp,
                ...(createIsDiscounted ? { sellingPrice: createSellingPrice } : {}),
                targetStockQty: 10,
                shopifyVariantId,
                shopifyInventoryItemId: variant.inventory_item_id ? String(variant.inventory_item_id) : null,
            },
        });

        // Create Shopify inventory cache
        if (variant.inventory_item_id && typeof variant.inventory_quantity === 'number') {
            await prisma.shopifyInventoryCache.create({
                data: {
                    skuId: newSku.id,
                    shopifyInventoryItemId: String(variant.inventory_item_id),
                    availableQty: variant.inventory_quantity,
                },
            });
        }
        result.created++;
    }

    return result;
}
