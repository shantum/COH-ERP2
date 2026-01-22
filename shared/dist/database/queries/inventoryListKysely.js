/**
 * Kysely Inventory List Query
 *
 * High-performance replacement for Prisma's nested includes.
 * Uses JOINs for SKU → Variation → Product hierarchy.
 *
 * Shared between Express server and TanStack Start Server Functions.
 */
import { sql } from 'kysely';
import { getKysely } from '../createKysely.js';
// ============================================
// MAIN QUERY
// ============================================
/**
 * List all active SKUs with variation/product metadata and inventory balances
 * Returns paginated rows ready for AG-Grid display
 */
export async function listInventoryKysely(params = {}) {
    const kysely = getKysely();
    const { includeCustomSkus = false, search, stockFilter = 'all', limit = 10000, offset = 0, } = params;
    // CTE: Calculate balances per SKU
    const balancesCte = kysely
        .selectFrom('InventoryTransaction')
        .select([
        'InventoryTransaction.skuId',
        sql `COALESCE(SUM(CASE WHEN "InventoryTransaction"."txnType" = 'inward' THEN "InventoryTransaction"."qty" ELSE 0 END), 0)::int`.as('totalInward'),
        sql `COALESCE(SUM(CASE WHEN "InventoryTransaction"."txnType" = 'outward' THEN "InventoryTransaction"."qty" ELSE 0 END), 0)::int`.as('totalOutward'),
    ])
        .groupBy('InventoryTransaction.skuId');
    // Main query with balance CTE
    let query = kysely
        .with('balances', () => balancesCte)
        .selectFrom('Sku')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('Product', 'Product.id', 'Variation.productId')
        .leftJoin('Fabric', 'Fabric.id', 'Variation.fabricId')
        .leftJoin('ShopifyInventoryCache', 'ShopifyInventoryCache.skuId', 'Sku.id')
        .leftJoin('balances', 'balances.skuId', 'Sku.id')
        .select([
        'Sku.id as skuId',
        'Sku.skuCode',
        'Sku.size',
        'Sku.mrp',
        'Sku.targetStockQty',
        'Sku.isCustomSku',
        'Variation.id as variationId',
        'Variation.colorName',
        'Variation.imageUrl as variationImageUrl',
        'Product.id as productId',
        'Product.name as productName',
        'Product.productType',
        'Product.gender',
        'Product.category',
        'Product.imageUrl as productImageUrl',
        'Fabric.name as fabricName',
        'ShopifyInventoryCache.availableQty as shopifyAvailableQty',
        sql `COALESCE("balances"."totalInward", 0)`.as('totalInward'),
        sql `COALESCE("balances"."totalOutward", 0)`.as('totalOutward'),
        sql `COALESCE("balances"."totalInward", 0) - COALESCE("balances"."totalOutward", 0)`.as('currentBalance'),
    ])
        .where('Sku.isActive', '=', true);
    // Filter custom SKUs
    if (!includeCustomSkus) {
        query = query.where('Sku.isCustomSku', '=', false);
    }
    // Apply search filter
    if (search) {
        const searchTerm = `%${search.toLowerCase()}%`;
        query = query.where((eb) => eb.or([
            sql `LOWER("Sku"."skuCode") LIKE ${searchTerm}`,
            sql `LOWER("Product"."name") LIKE ${searchTerm}`,
            sql `LOWER("Variation"."colorName") LIKE ${searchTerm}`,
        ]));
    }
    // Apply stock filter using whereRef with raw SQL expression
    if (stockFilter === 'in_stock') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query = query.where((eb) => eb(sql `COALESCE("balances"."totalInward", 0) - COALESCE("balances"."totalOutward", 0)`, '>', sql `0`));
    }
    else if (stockFilter === 'out_of_stock') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query = query.where((eb) => eb(sql `COALESCE("balances"."totalInward", 0) - COALESCE("balances"."totalOutward", 0)`, '<=', sql `0`));
    }
    else if (stockFilter === 'low_stock') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query = query.where((eb) => eb.and([
            eb(sql `COALESCE("balances"."totalInward", 0) - COALESCE("balances"."totalOutward", 0)`, '>', sql `0`),
            eb(sql `COALESCE("balances"."totalInward", 0) - COALESCE("balances"."totalOutward", 0)`, '<', sql `COALESCE("Sku"."targetStockQty", 10)`),
        ]));
    }
    // Count total (before pagination)
    const countQuery = query
        .clearSelect()
        .select(sql `COUNT(*)::int`.as('count'))
        .clearOrderBy();
    // Apply ordering and pagination to main query
    const paginatedQuery = query
        .orderBy('Sku.skuCode', 'asc')
        .limit(limit)
        .offset(offset);
    // Execute both queries in parallel
    const [rows, countResult] = await Promise.all([
        paginatedQuery.execute(),
        countQuery.executeTakeFirst(),
    ]);
    const totalCount = countResult?.count ?? 0;
    // Transform to response format
    const items = rows.map((row) => {
        const currentBalance = Number(row.currentBalance) || 0;
        const totalInward = Number(row.totalInward) || 0;
        const totalOutward = Number(row.totalOutward) || 0;
        const targetStockQty = row.targetStockQty || 0;
        const imageUrl = row.variationImageUrl || row.productImageUrl || null;
        return {
            skuId: row.skuId,
            skuCode: row.skuCode,
            productId: row.productId,
            productName: row.productName,
            productType: row.productType || '',
            gender: row.gender || '',
            colorName: row.colorName,
            variationId: row.variationId,
            size: row.size,
            category: row.category || '',
            imageUrl,
            currentBalance,
            reservedBalance: 0, // TODO: Calculate reserved from pending orders
            availableBalance: currentBalance,
            totalInward,
            totalOutward,
            targetStockQty,
            status: currentBalance < targetStockQty ? 'below_target' : 'ok',
            mrp: Number(row.mrp) || 0,
            shopifyQty: row.shopifyAvailableQty ?? null,
            isCustomSku: row.isCustomSku || false,
        };
    });
    return {
        items,
        pagination: {
            total: totalCount,
            limit,
            offset,
            hasMore: offset + items.length < totalCount,
        },
    };
}
//# sourceMappingURL=inventoryListKysely.js.map