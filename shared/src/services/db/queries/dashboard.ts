/**
 * Kysely Dashboard Queries
 *
 * High-performance dashboard queries using type-safe SQL aggregation.
 * All aggregations done at DB level - no loading data into memory.
 *
 * ⚠️  DYNAMIC IMPORTS ONLY - DO NOT USE STATIC IMPORTS ⚠️
 * Uses `await import('kysely')` for sql template tag.
 * Static imports would break client bundling. See services/index.ts for details.
 *
 * Performance characteristics:
 * - Pipeline counts: Single query with FILTER clause (replaces 5 separate COUNT queries)
 * - Revenue metrics: Single query with FILTER for all periods (replaces 12+ queries)
 * - Top products: GROUP BY with LIMIT at DB level (replaces loading all OrderLines)
 * - Top customers: JOIN + GROUP BY at DB level
 * - Top materials: Multi-JOIN aggregation at DB level
 */

import { getKysely } from '../kysely.js';
import { getISTMidnightAsUTC, getISTMonthStartAsUTC, getISTMonthEndAsUTC, getISTDayOfMonth, getISTDaysInMonth } from '../../../utils/dateHelpers.js';

// ============================================
// OUTPUT TYPES
// ============================================

export interface PipelineCounts {
    totalOrders: number;
    pendingLines: number;
    allocatedLines: number;
    pickedLines: number;
    packedLines: number;
    totalUnits: number;
}

export interface PaymentSplitData {
    codCount: number;
    codAmount: number;
    prepaidCount: number;
    prepaidAmount: number;
}

export interface RevenueMetrics {
    total: number;
    orderCount: number;
    newCustomers: number;
    returningCustomers: number;
}

export interface AllRevenueMetrics {
    today: RevenueMetrics & { change: number | null };
    yesterday: RevenueMetrics;
    last7Days: RevenueMetrics;
    last30Days: RevenueMetrics;
    thisMonth: RevenueMetrics & { change: number | null };
    lastMonth: RevenueMetrics;
}

export interface TopProductData {
    id: string;
    name: string;
    imageUrl: string | null;
    units: number;
    revenue: number;
    orderCount: number;
}

export interface TopProductWithVariations extends TopProductData {
    variations: Array<{ colorName: string; units: number }>;
}

export interface TopVariationData {
    id: string;
    productName: string;
    colorName: string;
    imageUrl: string | null;
    units: number;
    revenue: number;
    orderCount: number;
}

export interface TopCustomerData {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    tier: string | null;
    units: number;
    revenue: number;
    orderCount: number;
}

export interface TopMaterialData {
    id: string;
    name: string;
    units: number;
    revenue: number;
    orderCount: number;
    productCount: number;
}

export interface TopFabricColourData {
    id: string;
    colourName: string;
    colourHex: string | null;
    fabricName: string;
    materialName: string;
    units: number;
    revenue: number;
    orderCount: number;
    productCount: number;
}

// ============================================
// PIPELINE & PAYMENT SPLIT QUERIES
// ============================================

/**
 * Get pipeline counts and payment split in a single optimized query
 *
 * Uses PostgreSQL FILTER clause for conditional aggregation.
 * Replaces 7+ separate COUNT queries with 1 query.
 */
export async function getPipelineAndPaymentSplit(): Promise<{
    pipeline: PipelineCounts;
    paymentSplit: PaymentSplitData;
}> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await db
        .selectFrom('Order')
        .leftJoin('OrderLine', 'OrderLine.orderId', 'Order.id')
        .select([
            // Pipeline counts
            sql<number>`COUNT(DISTINCT "Order"."id")::int`.as('totalOrders'),
            sql<number>`COUNT("OrderLine"."id") FILTER (WHERE "OrderLine"."lineStatus" = 'pending')::int`.as('pendingLines'),
            sql<number>`COUNT("OrderLine"."id") FILTER (WHERE "OrderLine"."lineStatus" = 'allocated')::int`.as('allocatedLines'),
            sql<number>`COUNT("OrderLine"."id") FILTER (WHERE "OrderLine"."lineStatus" = 'picked')::int`.as('pickedLines'),
            sql<number>`COUNT("OrderLine"."id") FILTER (WHERE "OrderLine"."lineStatus" = 'packed')::int`.as('packedLines'),
            sql<number>`COALESCE(SUM("OrderLine"."qty"), 0)::int`.as('totalUnits'),
            // Payment split
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."paymentMethod" = 'COD')::int`.as('codCount'),
            sql<number>`COALESCE(SUM("Order"."totalAmount") FILTER (WHERE "Order"."paymentMethod" = 'COD'), 0)::numeric`.as('codAmount'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."paymentMethod" != 'COD')::int`.as('prepaidCount'),
            sql<number>`COALESCE(SUM("Order"."totalAmount") FILTER (WHERE "Order"."paymentMethod" != 'COD'), 0)::numeric`.as('prepaidAmount'),
        ])
        .where('Order.isArchived', '=', false)
        .where((eb) =>
            eb.or([
                eb('Order.status', '=', 'open'),
                eb.and([
                    eb('Order.releasedToShipped', '=', false),
                    eb('Order.releasedToCancelled', '=', false),
                ]),
            ])
        )
        .executeTakeFirst();

    return {
        pipeline: {
            totalOrders: result?.totalOrders ?? 0,
            pendingLines: result?.pendingLines ?? 0,
            allocatedLines: result?.allocatedLines ?? 0,
            pickedLines: result?.pickedLines ?? 0,
            packedLines: result?.packedLines ?? 0,
            totalUnits: result?.totalUnits ?? 0,
        },
        paymentSplit: {
            codCount: result?.codCount ?? 0,
            codAmount: Number(result?.codAmount ?? 0),
            prepaidCount: result?.prepaidCount ?? 0,
            prepaidAmount: Number(result?.prepaidAmount ?? 0),
        },
    };
}

// ============================================
// REVENUE QUERIES
// ============================================

/**
 * Get all revenue metrics in a single query using FILTER
 *
 * Replaces 12+ separate queries (6 periods × 2 queries each) with 1 query.
 * Uses PostgreSQL FILTER clause for conditional aggregation by date range.
 */
export async function getAllRevenueMetrics(): Promise<AllRevenueMetrics> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    // Calculate all date ranges
    const todayStart = getISTMidnightAsUTC(0);
    const yesterdayStart = getISTMidnightAsUTC(-1);
    const last7DaysStart = getISTMidnightAsUTC(-7);
    const last30DaysStart = getISTMidnightAsUTC(-30);
    const thisMonthStart = getISTMonthStartAsUTC(0);
    const lastMonthStart = getISTMonthStartAsUTC(-1);
    const lastMonthEnd = getISTMonthEndAsUTC(-1);

    const result = await db
        .selectFrom('Order')
        .leftJoin('Customer', 'Customer.id', 'Order.customerId')
        .select([
            // Today
            sql<number>`COALESCE(SUM("Order"."totalAmount") FILTER (WHERE "Order"."orderDate" >= ${todayStart}), 0)::numeric`.as('todayTotal'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${todayStart})::int`.as('todayCount'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${todayStart} AND "Customer"."orderCount" = 1)::int`.as('todayNew'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${todayStart} AND "Customer"."orderCount" > 1)::int`.as('todayReturning'),

            // Yesterday
            sql<number>`COALESCE(SUM("Order"."totalAmount") FILTER (WHERE "Order"."orderDate" >= ${yesterdayStart} AND "Order"."orderDate" < ${todayStart}), 0)::numeric`.as('yesterdayTotal'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${yesterdayStart} AND "Order"."orderDate" < ${todayStart})::int`.as('yesterdayCount'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${yesterdayStart} AND "Order"."orderDate" < ${todayStart} AND "Customer"."orderCount" = 1)::int`.as('yesterdayNew'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${yesterdayStart} AND "Order"."orderDate" < ${todayStart} AND "Customer"."orderCount" > 1)::int`.as('yesterdayReturning'),

            // Last 7 days
            sql<number>`COALESCE(SUM("Order"."totalAmount") FILTER (WHERE "Order"."orderDate" >= ${last7DaysStart}), 0)::numeric`.as('last7Total'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${last7DaysStart})::int`.as('last7Count'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${last7DaysStart} AND "Customer"."orderCount" = 1)::int`.as('last7New'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${last7DaysStart} AND "Customer"."orderCount" > 1)::int`.as('last7Returning'),

            // Last 30 days
            sql<number>`COALESCE(SUM("Order"."totalAmount") FILTER (WHERE "Order"."orderDate" >= ${last30DaysStart}), 0)::numeric`.as('last30Total'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${last30DaysStart})::int`.as('last30Count'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${last30DaysStart} AND "Customer"."orderCount" = 1)::int`.as('last30New'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${last30DaysStart} AND "Customer"."orderCount" > 1)::int`.as('last30Returning'),

            // This month
            sql<number>`COALESCE(SUM("Order"."totalAmount") FILTER (WHERE "Order"."orderDate" >= ${thisMonthStart}), 0)::numeric`.as('thisMonthTotal'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${thisMonthStart})::int`.as('thisMonthCount'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${thisMonthStart} AND "Customer"."orderCount" = 1)::int`.as('thisMonthNew'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${thisMonthStart} AND "Customer"."orderCount" > 1)::int`.as('thisMonthReturning'),

            // Last month
            sql<number>`COALESCE(SUM("Order"."totalAmount") FILTER (WHERE "Order"."orderDate" >= ${lastMonthStart} AND "Order"."orderDate" <= ${lastMonthEnd}), 0)::numeric`.as('lastMonthTotal'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${lastMonthStart} AND "Order"."orderDate" <= ${lastMonthEnd})::int`.as('lastMonthCount'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${lastMonthStart} AND "Order"."orderDate" <= ${lastMonthEnd} AND "Customer"."orderCount" = 1)::int`.as('lastMonthNew'),
            sql<number>`COUNT(DISTINCT "Order"."id") FILTER (WHERE "Order"."orderDate" >= ${lastMonthStart} AND "Order"."orderDate" <= ${lastMonthEnd} AND "Customer"."orderCount" > 1)::int`.as('lastMonthReturning'),
        ])
        .where('Order.releasedToCancelled', '=', false)
        .where('Order.totalAmount', '>', 0)
        .executeTakeFirst();

    const todayTotal = Number(result?.todayTotal ?? 0);
    const yesterdayTotal = Number(result?.yesterdayTotal ?? 0);
    const thisMonthTotal = Number(result?.thisMonthTotal ?? 0);
    const lastMonthTotal = Number(result?.lastMonthTotal ?? 0);

    // Calculate change percentages (vs comparable prior period)
    const pctChange = (current: number, previous: number) =>
        previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;

    const todayChange = pctChange(todayTotal, yesterdayTotal);

    // This month vs last month (pro-rated: compare daily run rate)
    const daysElapsed = getISTDayOfMonth();
    const daysInPrevMonth = getISTDaysInMonth(-1);
    const thisMonthDailyRate = daysElapsed > 0 ? thisMonthTotal / daysElapsed : 0;
    const lastMonthDailyRate = daysInPrevMonth > 0 ? lastMonthTotal / daysInPrevMonth : 0;
    const thisMonthChange = pctChange(thisMonthDailyRate, lastMonthDailyRate);

    return {
        today: {
            total: todayTotal,
            orderCount: result?.todayCount ?? 0,
            newCustomers: result?.todayNew ?? 0,
            returningCustomers: result?.todayReturning ?? 0,
            change: todayChange,
        },
        yesterday: {
            total: yesterdayTotal,
            orderCount: result?.yesterdayCount ?? 0,
            newCustomers: result?.yesterdayNew ?? 0,
            returningCustomers: result?.yesterdayReturning ?? 0,
        },
        last7Days: {
            total: Number(result?.last7Total ?? 0),
            orderCount: result?.last7Count ?? 0,
            newCustomers: result?.last7New ?? 0,
            returningCustomers: result?.last7Returning ?? 0,
        },
        last30Days: {
            total: Number(result?.last30Total ?? 0),
            orderCount: result?.last30Count ?? 0,
            newCustomers: result?.last30New ?? 0,
            returningCustomers: result?.last30Returning ?? 0,
        },
        thisMonth: {
            total: thisMonthTotal,
            orderCount: result?.thisMonthCount ?? 0,
            newCustomers: result?.thisMonthNew ?? 0,
            returningCustomers: result?.thisMonthReturning ?? 0,
            change: thisMonthChange,
        },
        lastMonth: {
            total: lastMonthTotal,
            orderCount: result?.lastMonthCount ?? 0,
            newCustomers: result?.lastMonthNew ?? 0,
            returningCustomers: result?.lastMonthReturning ?? 0,
        },
    };
}

// ============================================
// TOP PRODUCTS QUERIES
// ============================================

/**
 * Get top products by units sold
 *
 * Uses GROUP BY at database level instead of loading all OrderLines.
 * Single query replaces findMany + JS aggregation.
 */
export async function getTopProductsKysely(
    startDate: Date,
    endDate: Date | null,
    limit = 15
): Promise<TopProductData[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    let query = db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .innerJoin('Sku', 'Sku.id', 'OrderLine.skuId')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('Product', 'Product.id', 'Variation.productId')
        .select([
            'Product.id',
            'Product.name',
            'Product.imageUrl',
            sql<number>`SUM("OrderLine"."qty")::int`.as('units'),
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('revenue'),
            sql<number>`COUNT(DISTINCT "OrderLine"."orderId")::int`.as('orderCount'),
        ])
        .where('Order.orderDate', '>=', startDate)
        .where('OrderLine.lineStatus', '!=', 'cancelled');

    if (endDate) {
        query = query.where('Order.orderDate', '<', endDate);
    }

    const rows = await query
        .groupBy(['Product.id', 'Product.name', 'Product.imageUrl'])
        .orderBy(sql`SUM("OrderLine"."qty")`, 'desc')
        .limit(limit)
        .execute();

    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        imageUrl: r.imageUrl,
        units: r.units ?? 0,
        revenue: Number(r.revenue ?? 0),
        orderCount: r.orderCount ?? 0,
    }));
}

/**
 * Get top variations (product + color) by units sold
 */
export async function getTopVariationsKysely(
    startDate: Date,
    endDate: Date | null,
    limit = 15
): Promise<TopVariationData[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    let query = db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .innerJoin('Sku', 'Sku.id', 'OrderLine.skuId')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('Product', 'Product.id', 'Variation.productId')
        .select([
            'Variation.id',
            'Product.name as productName',
            'Variation.colorName',
            sql<string | null>`COALESCE("Variation"."imageUrl", "Product"."imageUrl")`.as('imageUrl'),
            sql<number>`SUM("OrderLine"."qty")::int`.as('units'),
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('revenue'),
            sql<number>`COUNT(DISTINCT "OrderLine"."orderId")::int`.as('orderCount'),
        ])
        .where('Order.orderDate', '>=', startDate)
        .where('OrderLine.lineStatus', '!=', 'cancelled');

    if (endDate) {
        query = query.where('Order.orderDate', '<', endDate);
    }

    const rows = await query
        .groupBy(['Variation.id', 'Product.name', 'Variation.colorName', 'Variation.imageUrl', 'Product.imageUrl'])
        .orderBy(sql`SUM("OrderLine"."qty")`, 'desc')
        .limit(limit)
        .execute();

    return rows.map((r) => ({
        id: r.id,
        productName: r.productName,
        colorName: r.colorName,
        imageUrl: r.imageUrl,
        units: r.units ?? 0,
        revenue: Number(r.revenue ?? 0),
        orderCount: r.orderCount ?? 0,
    }));
}

// ============================================
// TOP CUSTOMERS QUERY
// ============================================

/**
 * Get top customers by revenue
 *
 * Uses GROUP BY at database level instead of loading all OrderLines.
 */
export async function getTopCustomersKysely(
    startDate: Date,
    endDate: Date | null,
    limit = 10
): Promise<TopCustomerData[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    let query = db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .innerJoin('Customer', 'Customer.id', 'Order.customerId')
        .select([
            'Customer.id',
            sql<string>`COALESCE(NULLIF(CONCAT("Customer"."firstName", ' ', "Customer"."lastName"), ' '), 'Unknown')`.as('name'),
            'Customer.email',
            'Customer.phone',
            'Customer.tier',
            sql<number>`SUM("OrderLine"."qty")::int`.as('units'),
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('revenue'),
            sql<number>`COUNT(DISTINCT "OrderLine"."orderId")::int`.as('orderCount'),
        ])
        .where('Order.orderDate', '>=', startDate)
        .where('OrderLine.lineStatus', '!=', 'cancelled');

    if (endDate) {
        query = query.where('Order.orderDate', '<', endDate);
    }

    const rows = await query
        .groupBy(['Customer.id', 'Customer.firstName', 'Customer.lastName', 'Customer.email', 'Customer.phone', 'Customer.tier'])
        .orderBy(sql`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")`, 'desc')
        .limit(limit)
        .execute();

    return rows.map((r) => ({
        id: r.id,
        name: r.name ?? 'Unknown',
        email: r.email,
        phone: r.phone,
        tier: r.tier,
        units: r.units ?? 0,
        revenue: Number(r.revenue ?? 0),
        orderCount: r.orderCount ?? 0,
    }));
}

// ============================================
// TOP MATERIALS QUERIES
// ============================================

/**
 * Get top materials by revenue
 *
 * Uses multi-JOIN aggregation at database level.
 */
export async function getTopMaterialsKysely(
    startDate: Date,
    endDate: Date | null,
    limit = 15
): Promise<TopMaterialData[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    // Join through VariationBomLine to get fabric (Variation.fabricColourId was removed)
    let query = db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .innerJoin('Sku', 'Sku.id', 'OrderLine.skuId')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('VariationBomLine', (join) =>
            join
                .onRef('VariationBomLine.variationId', '=', 'Variation.id')
                .on('VariationBomLine.fabricColourId', 'is not', null)
        )
        .innerJoin('FabricColour', 'FabricColour.id', 'VariationBomLine.fabricColourId')
        .innerJoin('Fabric', 'Fabric.id', 'FabricColour.fabricId')
        .innerJoin('Material', 'Material.id', 'Fabric.materialId')
        .select([
            'Material.id',
            'Material.name',
            sql<number>`SUM("OrderLine"."qty")::int`.as('units'),
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('revenue'),
            sql<number>`COUNT(DISTINCT "OrderLine"."orderId")::int`.as('orderCount'),
            sql<number>`COUNT(DISTINCT "Variation"."productId")::int`.as('productCount'),
        ])
        .where('Order.orderDate', '>=', startDate)
        .where('OrderLine.lineStatus', '!=', 'cancelled');

    if (endDate) {
        query = query.where('Order.orderDate', '<', endDate);
    }

    const rows = await query
        .groupBy(['Material.id', 'Material.name'])
        .orderBy(sql`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")`, 'desc')
        .limit(limit)
        .execute();

    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        units: r.units ?? 0,
        revenue: Number(r.revenue ?? 0),
        orderCount: r.orderCount ?? 0,
        productCount: r.productCount ?? 0,
    }));
}

/**
 * Get top fabrics by revenue (mid-tier: e.g. "Linen 60 Lea")
 */
export async function getTopFabricsKysely(
    startDate: Date,
    endDate: Date | null,
    limit = 15
): Promise<Array<TopMaterialData & { materialName: string }>> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    let query = db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .innerJoin('Sku', 'Sku.id', 'OrderLine.skuId')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('VariationBomLine', (join) =>
            join
                .onRef('VariationBomLine.variationId', '=', 'Variation.id')
                .on('VariationBomLine.fabricColourId', 'is not', null)
        )
        .innerJoin('FabricColour', 'FabricColour.id', 'VariationBomLine.fabricColourId')
        .innerJoin('Fabric', 'Fabric.id', 'FabricColour.fabricId')
        .innerJoin('Material', 'Material.id', 'Fabric.materialId')
        .select([
            'Fabric.id',
            'Fabric.name',
            'Material.name as materialName',
            sql<number>`SUM("OrderLine"."qty")::int`.as('units'),
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('revenue'),
            sql<number>`COUNT(DISTINCT "OrderLine"."orderId")::int`.as('orderCount'),
            sql<number>`COUNT(DISTINCT "Variation"."productId")::int`.as('productCount'),
        ])
        .where('Order.orderDate', '>=', startDate)
        .where('OrderLine.lineStatus', '!=', 'cancelled');

    if (endDate) {
        query = query.where('Order.orderDate', '<', endDate);
    }

    const rows = await query
        .groupBy(['Fabric.id', 'Fabric.name', 'Material.name'])
        .orderBy(sql`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")`, 'desc')
        .limit(limit)
        .execute();

    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        materialName: r.materialName,
        units: r.units ?? 0,
        revenue: Number(r.revenue ?? 0),
        orderCount: r.orderCount ?? 0,
        productCount: r.productCount ?? 0,
    }));
}

/**
 * Get top fabric colours by revenue
 */
export async function getTopFabricColoursKysely(
    startDate: Date,
    endDate: Date | null,
    limit = 15
): Promise<TopFabricColourData[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    // Join through VariationBomLine to get fabric (Variation.fabricColourId was removed)
    let query = db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .innerJoin('Sku', 'Sku.id', 'OrderLine.skuId')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('VariationBomLine', (join) =>
            join
                .onRef('VariationBomLine.variationId', '=', 'Variation.id')
                .on('VariationBomLine.fabricColourId', 'is not', null)
        )
        .innerJoin('FabricColour', 'FabricColour.id', 'VariationBomLine.fabricColourId')
        .innerJoin('Fabric', 'Fabric.id', 'FabricColour.fabricId')
        .innerJoin('Material', 'Material.id', 'Fabric.materialId')
        .select([
            'FabricColour.id',
            'FabricColour.colourName',
            'FabricColour.colourHex',
            'Fabric.name as fabricName',
            'Material.name as materialName',
            sql<number>`SUM("OrderLine"."qty")::int`.as('units'),
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('revenue'),
            sql<number>`COUNT(DISTINCT "OrderLine"."orderId")::int`.as('orderCount'),
            sql<number>`COUNT(DISTINCT "Variation"."productId")::int`.as('productCount'),
        ])
        .where('Order.orderDate', '>=', startDate)
        .where('OrderLine.lineStatus', '!=', 'cancelled');

    if (endDate) {
        query = query.where('Order.orderDate', '<', endDate);
    }

    const rows = await query
        .groupBy(['FabricColour.id', 'FabricColour.colourName', 'FabricColour.colourHex', 'Fabric.name', 'Material.name'])
        .orderBy(sql`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")`, 'desc')
        .limit(limit)
        .execute();

    return rows.map((r) => ({
        id: r.id,
        colourName: r.colourName,
        colourHex: r.colourHex,
        fabricName: r.fabricName,
        materialName: r.materialName,
        units: r.units ?? 0,
        revenue: Number(r.revenue ?? 0),
        orderCount: r.orderCount ?? 0,
        productCount: r.productCount ?? 0,
    }));
}

// ============================================
// COMBINED DASHBOARD QUERY
// ============================================

/**
 * Full dashboard data type
 */
export interface DashboardAnalytics {
    pipeline: PipelineCounts;
    paymentSplit: PaymentSplitData;
    revenue: AllRevenueMetrics;
    topProducts: TopProductData[];
}

/**
 * Get all dashboard analytics in optimized parallel queries
 *
 * Executes 3 queries in parallel:
 * 1. Pipeline counts + payment split
 * 2. Revenue metrics for all periods
 * 3. Top products (last 30 days)
 *
 * Total: 3 queries instead of 21+
 */
export async function getDashboardAnalytics(): Promise<DashboardAnalytics> {
    const last30DaysStart = getISTMidnightAsUTC(-30);

    const [pipelineAndPayment, revenue, topProducts] = await Promise.all([
        getPipelineAndPaymentSplit(),
        getAllRevenueMetrics(),
        getTopProductsKysely(last30DaysStart, null, 6),
    ]);

    return {
        pipeline: pipelineAndPayment.pipeline,
        paymentSplit: pipelineAndPayment.paymentSplit,
        revenue,
        topProducts,
    };
}

// ============================================
// SALES ANALYTICS BREAKDOWN QUERIES
// ============================================

export interface SalesBreakdownRow {
    key: string;
    label: string;
    units: number;
    revenue: number;
    orderCount: number;
}

/**
 * Get sales breakdown by material
 * Joins through VariationBomLine to get material from BOM
 */
export async function getSalesBreakdownByMaterial(
    startDate: Date,
    endDate: Date,
    lineStatusFilter: 'all' | 'shipped' | 'delivered' = 'all'
): Promise<SalesBreakdownRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    let query = db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .innerJoin('Sku', 'Sku.id', 'OrderLine.skuId')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('VariationBomLine', (join) =>
            join
                .onRef('VariationBomLine.variationId', '=', 'Variation.id')
                .on('VariationBomLine.fabricColourId', 'is not', null)
        )
        .innerJoin('FabricColour', 'FabricColour.id', 'VariationBomLine.fabricColourId')
        .innerJoin('Fabric', 'Fabric.id', 'FabricColour.fabricId')
        .innerJoin('Material', 'Material.id', 'Fabric.materialId')
        .select([
            'Material.id as key',
            'Material.name as label',
            sql<number>`SUM("OrderLine"."qty")::int`.as('units'),
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('revenue'),
            sql<number>`COUNT(DISTINCT "OrderLine"."orderId")::int`.as('orderCount'),
        ])
        .where('Order.orderDate', '>=', startDate)
        .where('Order.orderDate', '<=', endDate)
        .where('Order.status', '!=', 'cancelled')
        .where('OrderLine.lineStatus', '!=', 'cancelled');

    // Apply line status filter
    if (lineStatusFilter === 'delivered') {
        query = query.where('OrderLine.lineStatus', '=', 'delivered');
    } else if (lineStatusFilter === 'shipped') {
        query = query.where('OrderLine.lineStatus', 'in', ['shipped', 'delivered']);
    }

    const rows = await query
        .groupBy(['Material.id', 'Material.name'])
        .orderBy(sql`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")`, 'desc')
        .execute();

    return rows.map((r) => ({
        key: r.key,
        label: r.label,
        units: r.units ?? 0,
        revenue: Number(r.revenue ?? 0),
        orderCount: r.orderCount ?? 0,
    }));
}

/**
 * Get sales breakdown by fabric
 * Joins through VariationBomLine to get fabric from BOM
 */
export async function getSalesBreakdownByFabric(
    startDate: Date,
    endDate: Date,
    lineStatusFilter: 'all' | 'shipped' | 'delivered' = 'all'
): Promise<SalesBreakdownRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    let query = db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .innerJoin('Sku', 'Sku.id', 'OrderLine.skuId')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('VariationBomLine', (join) =>
            join
                .onRef('VariationBomLine.variationId', '=', 'Variation.id')
                .on('VariationBomLine.fabricColourId', 'is not', null)
        )
        .innerJoin('FabricColour', 'FabricColour.id', 'VariationBomLine.fabricColourId')
        .innerJoin('Fabric', 'Fabric.id', 'FabricColour.fabricId')
        .innerJoin('Material', 'Material.id', 'Fabric.materialId')
        .select([
            'Fabric.id as key',
            sql<string>`"Fabric"."name" || ' (' || "Material"."name" || ')'`.as('label'),
            sql<number>`SUM("OrderLine"."qty")::int`.as('units'),
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('revenue'),
            sql<number>`COUNT(DISTINCT "OrderLine"."orderId")::int`.as('orderCount'),
        ])
        .where('Order.orderDate', '>=', startDate)
        .where('Order.orderDate', '<=', endDate)
        .where('Order.status', '!=', 'cancelled')
        .where('OrderLine.lineStatus', '!=', 'cancelled');

    // Apply line status filter
    if (lineStatusFilter === 'delivered') {
        query = query.where('OrderLine.lineStatus', '=', 'delivered');
    } else if (lineStatusFilter === 'shipped') {
        query = query.where('OrderLine.lineStatus', 'in', ['shipped', 'delivered']);
    }

    const rows = await query
        .groupBy(['Fabric.id', 'Fabric.name', 'Material.name'])
        .orderBy(sql`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")`, 'desc')
        .execute();

    return rows.map((r) => ({
        key: r.key,
        label: r.label,
        units: r.units ?? 0,
        revenue: Number(r.revenue ?? 0),
        orderCount: r.orderCount ?? 0,
    }));
}

/**
 * Get sales breakdown by fabric colour
 * Joins through VariationBomLine to get fabric colour from BOM
 */
export async function getSalesBreakdownByFabricColour(
    startDate: Date,
    endDate: Date,
    lineStatusFilter: 'all' | 'shipped' | 'delivered' = 'all'
): Promise<SalesBreakdownRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    let query = db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .innerJoin('Sku', 'Sku.id', 'OrderLine.skuId')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('VariationBomLine', (join) =>
            join
                .onRef('VariationBomLine.variationId', '=', 'Variation.id')
                .on('VariationBomLine.fabricColourId', 'is not', null)
        )
        .innerJoin('FabricColour', 'FabricColour.id', 'VariationBomLine.fabricColourId')
        .innerJoin('Fabric', 'Fabric.id', 'FabricColour.fabricId')
        .innerJoin('Material', 'Material.id', 'Fabric.materialId')
        .select([
            'FabricColour.id as key',
            sql<string>`"FabricColour"."colourName" || ' - ' || "Fabric"."name" || ' (' || "Material"."name" || ')'`.as('label'),
            sql<number>`SUM("OrderLine"."qty")::int`.as('units'),
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('revenue'),
            sql<number>`COUNT(DISTINCT "OrderLine"."orderId")::int`.as('orderCount'),
        ])
        .where('Order.orderDate', '>=', startDate)
        .where('Order.orderDate', '<=', endDate)
        .where('Order.status', '!=', 'cancelled')
        .where('OrderLine.lineStatus', '!=', 'cancelled');

    // Apply line status filter
    if (lineStatusFilter === 'delivered') {
        query = query.where('OrderLine.lineStatus', '=', 'delivered');
    } else if (lineStatusFilter === 'shipped') {
        query = query.where('OrderLine.lineStatus', 'in', ['shipped', 'delivered']);
    }

    const rows = await query
        .groupBy(['FabricColour.id', 'FabricColour.colourName', 'Fabric.name', 'Material.name'])
        .orderBy(sql`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")`, 'desc')
        .execute();

    return rows.map((r) => ({
        key: r.key,
        label: r.label,
        units: r.units ?? 0,
        revenue: Number(r.revenue ?? 0),
        orderCount: r.orderCount ?? 0,
    }));
}

/**
 * Get sales breakdown by channel (order source)
 */
export async function getSalesBreakdownByChannel(
    startDate: Date,
    endDate: Date,
    lineStatusFilter: 'all' | 'shipped' | 'delivered' = 'all'
): Promise<SalesBreakdownRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    let query = db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .select([
            sql<string>`COALESCE("Order"."channel", 'direct')`.as('key'),
            sql<string>`INITCAP(COALESCE("Order"."channel", 'direct'))`.as('label'),
            sql<number>`SUM("OrderLine"."qty")::int`.as('units'),
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('revenue'),
            sql<number>`COUNT(DISTINCT "OrderLine"."orderId")::int`.as('orderCount'),
        ])
        .where('Order.orderDate', '>=', startDate)
        .where('Order.orderDate', '<=', endDate)
        .where('Order.status', '!=', 'cancelled')
        .where('OrderLine.lineStatus', '!=', 'cancelled');

    // Apply line status filter
    if (lineStatusFilter === 'delivered') {
        query = query.where('OrderLine.lineStatus', '=', 'delivered');
    } else if (lineStatusFilter === 'shipped') {
        query = query.where('OrderLine.lineStatus', 'in', ['shipped', 'delivered']);
    }

    const rows = await query
        .groupBy(sql`COALESCE("Order"."channel", 'direct')`)
        .orderBy(sql`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")`, 'desc')
        .execute();

    return rows.map((r) => ({
        key: r.key,
        label: r.label,
        units: r.units ?? 0,
        revenue: Number(r.revenue ?? 0),
        orderCount: r.orderCount ?? 0,
    }));
}

/**
 * Get sales breakdown by standard color
 * Joins through VariationBomLine to get standardColor from FabricColour
 */
export async function getSalesBreakdownByStandardColor(
    startDate: Date,
    endDate: Date,
    lineStatusFilter: 'all' | 'shipped' | 'delivered' = 'all'
): Promise<SalesBreakdownRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    let query = db
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .innerJoin('Sku', 'Sku.id', 'OrderLine.skuId')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('VariationBomLine', (join) =>
            join
                .onRef('VariationBomLine.variationId', '=', 'Variation.id')
                .on('VariationBomLine.fabricColourId', 'is not', null)
        )
        .innerJoin('FabricColour', 'FabricColour.id', 'VariationBomLine.fabricColourId')
        .select([
            sql<string>`COALESCE("FabricColour"."standardColour", 'unspecified')`.as('key'),
            sql<string>`INITCAP(COALESCE("FabricColour"."standardColour", 'unspecified'))`.as('label'),
            sql<number>`SUM("OrderLine"."qty")::int`.as('units'),
            sql<number>`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")::numeric`.as('revenue'),
            sql<number>`COUNT(DISTINCT "OrderLine"."orderId")::int`.as('orderCount'),
        ])
        .where('Order.orderDate', '>=', startDate)
        .where('Order.orderDate', '<=', endDate)
        .where('Order.status', '!=', 'cancelled')
        .where('OrderLine.lineStatus', '!=', 'cancelled');

    // Apply line status filter
    if (lineStatusFilter === 'delivered') {
        query = query.where('OrderLine.lineStatus', '=', 'delivered');
    } else if (lineStatusFilter === 'shipped') {
        query = query.where('OrderLine.lineStatus', 'in', ['shipped', 'delivered']);
    }

    const rows = await query
        .groupBy(sql`COALESCE("FabricColour"."standardColour", 'unspecified')`)
        .orderBy(sql`SUM("OrderLine"."qty" * "OrderLine"."unitPrice")`, 'desc')
        .execute();

    return rows.map((r) => ({
        key: r.key,
        label: r.label,
        units: r.units ?? 0,
        revenue: Number(r.revenue ?? 0),
        orderCount: r.orderCount ?? 0,
    }));
}
