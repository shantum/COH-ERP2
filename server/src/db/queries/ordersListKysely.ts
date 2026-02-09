/**
 * Kysely Orders List Query
 *
 * High-performance replacement for Prisma's nested includes.
 * Uses CTEs and JSON aggregation for single-query data fetching.
 *
 * Follows the three directives:
 * - D1: Types from DB, no manual interfaces
 * - D2: All JOINs use indexed FKs (verified in schema)
 * - D3: Lean payload - only fields used by frontend
 */

import { sql, type SqlBool } from 'kysely';
import { kysely } from '../index.js';

// ============================================
// TYPES (inferred from query, per Directive 1)
// ============================================

/**
 * View names matching the existing tRPC router
 */
export type ViewName = 'open' | 'shipped' | 'cancelled';

/**
 * Shipped view sub-filters
 */
export type ShippedFilter = 'all' | 'rto' | 'cod_pending';

/**
 * Sort fields supported by the query
 * Note: Order.shippedAt no longer exists (migrated to OrderLine level)
 */
export type SortField = 'orderDate' | 'archivedAt' | 'createdAt';

/**
 * Query parameters
 */
export interface OrdersListParams {
    view: ViewName;
    page: number;
    limit: number;
    shippedFilter?: ShippedFilter;
    search?: string;
    days?: number;
    sortBy?: SortField;
}

// ============================================
// VIEW WHERE CLAUSES
// ============================================

// Note: applyViewWhereClause uses inferred eb types from Kysely.
// applyViewWhereClauseToFullQuery uses `as never` casts because
// the generic T erases Kysely's table-aware .where() overloads.

function applyViewWhereClause(
    qb: ReturnType<typeof kysely.selectFrom<'Order'>>,
    view: ViewName,
    shippedFilter?: ShippedFilter
) {
    switch (view) {
        case 'open':
            return qb.where((eb) =>
                eb.and([
                    eb('Order.isArchived', '=', false),
                    eb.or([
                        eb('Order.status', '=', 'open'),
                        eb.and([
                            eb('Order.releasedToShipped', '=', false),
                            eb('Order.releasedToCancelled', '=', false),
                        ]),
                    ]),
                ])
            );

        case 'shipped':
            let shippedQb = qb
                .where('Order.isArchived', '=', false)
                .where('Order.releasedToShipped', '=', true);

            if (shippedFilter === 'rto') {
                // Filter orders that have at least one line with RTO tracking status
                return shippedQb.where(
                    sql`EXISTS (SELECT 1 FROM "OrderLine" WHERE "orderId" = "Order".id AND "trackingStatus" IN ('rto_in_transit', 'rto_delivered'))`,
                    '=',
                    sql`true`
                );
            } else if (shippedFilter === 'cod_pending') {
                // Filter COD orders with at least one delivered line awaiting remittance
                return shippedQb
                    .where('Order.paymentMethod', '=', 'COD')
                    .where(
                        sql`EXISTS (SELECT 1 FROM "OrderLine" WHERE "orderId" = "Order".id AND "trackingStatus" = 'delivered')`,
                        '=',
                        sql`true`
                    )
                    .where('Order.codRemittedAt', 'is', null);
            }
            return shippedQb;

        case 'cancelled':
            return qb
                .where('Order.isArchived', '=', false)
                .where('Order.releasedToCancelled', '=', true);

        default:
            return qb;
    }
}

// Version for the full query with joins (uses same logic but different base type).
// Generic T erases Kysely's table-aware .where() overloads after joins; `as never` casts are required in each branch.
function applyViewWhereClauseToFullQuery<T extends { where(...args: never[]): T }>(
    qb: T,
    view: ViewName,
    shippedFilter?: ShippedFilter
): T {
    // All branches use `as never` casts because generic T cannot carry Kysely's column-specific .where() signatures
    switch (view) {
        case 'open':
            return qb.where(((eb: { and: (c: unknown[]) => unknown; or: (c: unknown[]) => unknown; (...a: unknown[]): unknown }) =>
                eb.and([
                    eb('Order.isArchived', '=', false),
                    eb.or([
                        eb('Order.status', '=', 'open'),
                        eb.and([
                            eb('Order.releasedToShipped', '=', false),
                            eb('Order.releasedToCancelled', '=', false),
                        ]),
                    ]),
                ])
            ) as never) as unknown as T;

        case 'shipped': {
            const shippedBase = qb
                .where('Order.isArchived' as never, '=' as never, false as never)
                .where('Order.releasedToShipped' as never, '=' as never, true as never);

            if (shippedFilter === 'rto') {
                return shippedBase.where(
                    sql`EXISTS (SELECT 1 FROM "OrderLine" WHERE "orderId" = "Order".id AND "trackingStatus" IN ('rto_in_transit', 'rto_delivered'))` as never,
                    '=' as never,
                    sql`true` as never
                ) as unknown as T;
            } else if (shippedFilter === 'cod_pending') {
                return shippedBase
                    .where('Order.paymentMethod' as never, '=' as never, 'COD' as never)
                    .where(
                        sql`EXISTS (SELECT 1 FROM "OrderLine" WHERE "orderId" = "Order".id AND "trackingStatus" = 'delivered')` as never,
                        '=' as never,
                        sql`true` as never
                    )
                    .where('Order.codRemittedAt' as never, 'is' as never, null as never) as unknown as T;
            }
            return shippedBase as unknown as T;
        }

        case 'cancelled':
            return qb
                .where('Order.isArchived' as never, '=' as never, false as never)
                .where('Order.releasedToCancelled' as never, '=' as never, true as never) as unknown as T;

        default:
            return qb;
    }
}

// ============================================
// MAIN QUERY
// ============================================

export async function listOrdersKysely(params: OrdersListParams) {
    const { view, page, limit, shippedFilter, search, days, sortBy } = params;
    const offset = (page - 1) * limit;

    // Calculate date filter if days specified
    let sinceDate: Date | null = null;
    if (days) {
        sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);
    }

    // CTE: Line status counts per order (for fulfillment stage)
    const lineStatusCte = kysely
        .selectFrom('OrderLine')
        .select([
            'orderId',
            sql<number>`COUNT(*)::int`.as('totalLines'),
            sql<number>`COUNT(*) FILTER (WHERE "lineStatus" = 'pending')::int`.as('pendingCount'),
            sql<number>`COUNT(*) FILTER (WHERE "lineStatus" = 'allocated')::int`.as('allocatedCount'),
            sql<number>`COUNT(*) FILTER (WHERE "lineStatus" = 'picked')::int`.as('pickedCount'),
            sql<number>`COUNT(*) FILTER (WHERE "lineStatus" = 'packed')::int`.as('packedCount'),
            sql<number>`COUNT(*) FILTER (WHERE "lineStatus" = 'shipped')::int`.as('shippedCount'),
            sql<number>`COUNT(*) FILTER (WHERE "lineStatus" = 'cancelled')::int`.as('cancelledCount'),
            // Compute fulfillment stage in SQL
            sql<string>`CASE
                WHEN COUNT(*) FILTER (WHERE "lineStatus" = 'packed') = COUNT(*)
                     AND COUNT(*) > 0 THEN 'ready_to_ship'
                WHEN COUNT(*) FILTER (WHERE "lineStatus" IN ('picked', 'packed')) > 0 THEN 'in_progress'
                WHEN COUNT(*) FILTER (WHERE "lineStatus" = 'allocated') = COUNT(*)
                     AND COUNT(*) > 0 THEN 'allocated'
                ELSE 'pending'
            END`.as('fulfillmentStage'),
        ])
        .groupBy('orderId');

    // Main query with CTEs
    const query = kysely
        .with('lineStats', () => lineStatusCte)
        .selectFrom('Order')
        .leftJoin('Customer', 'Customer.id', 'Order.customerId')
        .leftJoin('ShopifyOrderCache', 'ShopifyOrderCache.id', 'Order.shopifyOrderId')
        .leftJoin('lineStats', 'lineStats.orderId', 'Order.id')
        .select([
            // Order fields (lean selection per Directive 3)
            'Order.id as orderId',
            'Order.orderNumber',
            sql<string>`to_char("Order"."orderDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.as('orderDate'),
            sql<string>`"Order"."shipByDate"::text`.as('shipByDate'),
            'Order.customerName',
            'Order.customerEmail',
            'Order.customerPhone',
            'Order.customerId',
            'Order.shippingAddress',
            'Order.totalAmount',
            'Order.paymentMethod',
            'Order.channel',
            'Order.internalNotes',
            'Order.status as orderStatus',
            'Order.isArchived',
            'Order.releasedToShipped',
            'Order.releasedToCancelled',
            'Order.isExchange',
            sql<string>`to_char("Order"."codRemittedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.as('codRemittedAt'),
            sql<string>`to_char("Order"."archivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.as('archivedAt'),

            // Customer fields (stats for tier display)
            'Customer.tags as customerTags',
            sql<number>`COALESCE("Customer"."orderCount", 0)`.as('customerOrderCount'),
            sql<number>`COALESCE("Customer"."ltv", 0)`.as('customerLtv'),
            'Customer.tier as customerTier',
            sql<number>`COALESCE("Customer"."rtoCount", 0)`.as('customerRtoCount'),

            // Line stats from CTE
            sql<number>`COALESCE("lineStats"."totalLines", 0)`.as('totalLines'),
            sql<string>`COALESCE("lineStats"."fulfillmentStage", 'pending')`.as('fulfillmentStage'),

            // Shopify cache fields (lean selection)
            'ShopifyOrderCache.discountCodes',
            'ShopifyOrderCache.customerNotes',
            'ShopifyOrderCache.tags as shopifyTags',
            'ShopifyOrderCache.trackingNumber as shopifyAwb',
            'ShopifyOrderCache.trackingCompany as shopifyCourier',
            'ShopifyOrderCache.trackingUrl as shopifyTrackingUrl',
            'ShopifyOrderCache.fulfillmentStatus as shopifyStatus',

            // Enriched fields (computed from OrderLine subqueries)
            sql<number>`EXTRACT(DAY FROM NOW() - (SELECT MIN("shippedAt") FROM "OrderLine" WHERE "orderId" = "Order".id))::int`.as('daysInTransit'),
            sql<number>`EXTRACT(DAY FROM NOW() - (SELECT MAX("deliveredAt") FROM "OrderLine" WHERE "orderId" = "Order".id))::int`.as('daysSinceDelivery'),
            sql<number>`EXTRACT(DAY FROM NOW() - (SELECT MIN("rtoInitiatedAt") FROM "OrderLine" WHERE "orderId" = "Order".id))::int`.as('daysInRto'),
            sql<string>`CASE
                WHEN EXISTS (SELECT 1 FROM "OrderLine" WHERE "orderId" = "Order".id AND "rtoReceivedAt" IS NOT NULL) THEN 'received'
                WHEN EXISTS (SELECT 1 FROM "OrderLine" WHERE "orderId" = "Order".id AND "rtoInitiatedAt" IS NOT NULL) THEN 'in_transit'
                ELSE NULL
            END`.as('rtoStatus'),

            // Order lines as JSON array (aggregated subquery)
            sql<string>`(
                SELECT COALESCE(json_agg(
                    json_build_object(
                        'lineId', ol.id,
                        'lineStatus', ol."lineStatus",
                        'qty', ol.qty,
                        'unitPrice', ol."unitPrice",
                        'lineNotes', COALESCE(ol.notes, ''),
                        'lineAwbNumber', ol."awbNumber",
                        'lineCourier', ol.courier,
                        'lineShippedAt', to_char(ol."shippedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                        'lineDeliveredAt', to_char(ol."deliveredAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                        'lineTrackingStatus', ol."trackingStatus",
                        'isCustomized', ol."isCustomized",
                        'productionBatchId', ol."productionBatchId",
                        'skuId', ol."skuId",
                        'sku', json_build_object(
                            'skuCode', s."skuCode",
                            'size', s.size,
                            'isCustomSku', s."isCustomSku",
                            'customizationType', s."customizationType",
                            'customizationValue', s."customizationValue",
                            'customizationNotes', s."customizationNotes"
                        ),
                        'variation', json_build_object(
                            'colorName', v."colorName",
                            'colorHex', v."colorHex",
                            'imageUrl', v."imageUrl"
                        ),
                        'product', json_build_object(
                            'name', p.name,
                            'imageUrl', p."imageUrl"
                        ),
                        'productionBatch', CASE WHEN pb.id IS NOT NULL THEN
                            json_build_object(
                                'id', pb.id,
                                'batchCode', pb."batchCode",
                                'batchDate', pb."batchDate"::text,
                                'status', pb.status
                            )
                        ELSE NULL END
                    ) ORDER BY ol.id
                ), '[]'::json)
                FROM "OrderLine" ol
                INNER JOIN "Sku" s ON s.id = ol."skuId"
                INNER JOIN "Variation" v ON v.id = s."variationId"
                INNER JOIN "Product" p ON p.id = v."productId"
                LEFT JOIN "ProductionBatch" pb ON pb.id = ol."productionBatchId"
                WHERE ol."orderId" = "Order".id
            )`.as('orderLines'),
        ]);

    // Apply view-specific where clause
    let filteredQuery = applyViewWhereClauseToFullQuery(query, view, shippedFilter);

    // Apply search filter (case-insensitive search across multiple fields)
    if (search && search.trim()) {
        const searchTerm = `%${search.trim().toLowerCase()}%`;
        filteredQuery = filteredQuery.where((eb) =>
            eb.or([
                sql<SqlBool>`LOWER("Order"."orderNumber") LIKE ${searchTerm}`,
                sql<SqlBool>`LOWER("Order"."customerName") LIKE ${searchTerm}`,
                sql<SqlBool>`EXISTS (SELECT 1 FROM "OrderLine" WHERE "orderId" = "Order".id AND "awbNumber" LIKE ${searchTerm})`,
                sql<SqlBool>`LOWER("Order"."customerEmail") LIKE ${searchTerm}`,
                sql<SqlBool>`"Order"."customerPhone" LIKE ${searchTerm}`,
            ])
        ) as typeof filteredQuery;
    }

    // Apply days filter
    if (sinceDate) {
        filteredQuery = filteredQuery.where('Order.orderDate', '>=', sinceDate) as typeof filteredQuery;
    }

    // Determine sort field (shippedAt removed - now at OrderLine level)
    const sortField = sortBy || 'orderDate';
    const sortColumn = `Order.${sortField}` as 'Order.orderDate' | 'Order.archivedAt' | 'Order.createdAt';

    // Apply sorting and pagination
    const paginatedQuery = filteredQuery
        .orderBy(sortColumn, 'desc')
        .limit(limit)
        .offset(offset);

    // Count query (parallel execution) - must apply same filters
    let countQuery = applyViewWhereClause(
        kysely.selectFrom('Order').select(sql<number>`COUNT(*)::int`.as('count')),
        view,
        shippedFilter
    );

    // Apply search filter to count query
    if (search && search.trim()) {
        const searchTerm = `%${search.trim().toLowerCase()}%`;
        countQuery = countQuery.where((eb) =>
            eb.or([
                sql<SqlBool>`LOWER("Order"."orderNumber") LIKE ${searchTerm}`,
                sql<SqlBool>`LOWER("Order"."customerName") LIKE ${searchTerm}`,
                sql<SqlBool>`EXISTS (SELECT 1 FROM "OrderLine" WHERE "orderId" = "Order".id AND "awbNumber" LIKE ${searchTerm})`,
                sql<SqlBool>`LOWER("Order"."customerEmail") LIKE ${searchTerm}`,
                sql<SqlBool>`"Order"."customerPhone" LIKE ${searchTerm}`,
            ])
        ) as typeof countQuery;
    }

    // Apply days filter to count query
    if (sinceDate) {
        countQuery = countQuery.where('Order.orderDate', '>=', sinceDate) as typeof countQuery;
    }

    // Execute both in parallel
    const [orders, countResult] = await Promise.all([
        paginatedQuery.execute(),
        countQuery.executeTakeFirst() as Promise<{ count: number } | undefined>,
    ]);

    return {
        orders,
        totalCount: countResult?.count ?? 0,
    };
}

// ============================================
// RESULT TYPE (inferred from query)
// ============================================

/**
 * Inferred result type from the query
 * Use this for type-safe access to query results
 */
export type OrdersListResult = Awaited<ReturnType<typeof listOrdersKysely>>;
export type OrderRow = OrdersListResult['orders'][number];

// ============================================
// ROW TRANSFORMER (Kysely → FlattenedOrderRow)
// ============================================

/**
 * OrderLine shape from JSON aggregation
 */
interface KyselyOrderLine {
    lineId: string;
    lineStatus: string | null;
    qty: number;
    unitPrice: number;
    lineNotes: string;
    lineAwbNumber: string | null;
    lineCourier: string | null;
    lineShippedAt: string | null;
    lineDeliveredAt: string | null;
    lineTrackingStatus: string | null;
    isCustomized: boolean;
    productionBatchId: string | null;
    skuId: string;
    sku: {
        skuCode: string;
        size: string;
        isCustomSku: boolean;
        customizationType: string | null;
        customizationValue: string | null;
        customizationNotes: string | null;
    };
    variation: {
        colorName: string | null;
        colorHex: string | null;
        imageUrl: string | null;
    };
    product: {
        name: string;
        imageUrl: string | null;
    };
    productionBatch: {
        id: string;
        batchCode: string;
        batchDate: string | null;
        status: string;
    } | null;
}

/**
 * Parse city from JSON shipping address
 */
function parseCity(shippingAddress: string | null | undefined): string {
    if (!shippingAddress) return '-';
    try {
        const addr = JSON.parse(shippingAddress);
        return addr.city || '-';
    } catch {
        return '-';
    }
}

/**
 * Transform Kysely query results to FlattenedOrderRow format
 * Matches the structure expected by the frontend AG-Grid
 */
export function transformKyselyToRows(orders: OrderRow[]) {
    const rows: Array<{
        orderId: string;
        orderNumber: string;
        orderDate: string;
        shipByDate: string | null;
        customerName: string;
        customerEmail: string | null;
        customerPhone: string | null;
        customerId: string | null;
        city: string;
        customerOrderCount: number;
        customerLtv: number;
        customerTier: string | null;
        customerRtoCount: number;
        totalAmount: number | null;
        paymentMethod: string | null;
        channel: string | null;
        internalNotes: string | null;
        orderStatus: string;
        isArchived: boolean;
        releasedToShipped: boolean;
        releasedToCancelled: boolean;
        isExchange: boolean;
        productName: string;
        colorName: string;
        colorHex: string | null;
        imageUrl: string | null;
        size: string;
        skuCode: string;
        skuId: string | null;
        qty: number;
        lineId: string | null;
        lineStatus: string | null;
        lineNotes: string;
        unitPrice: number;
        skuStock: number;
        fabricBalance: number;
        shopifyStatus: string;
        productionBatch: {
            id: string;
            batchCode: string;
            batchDate: string | null;
            status: string;
        } | null;
        productionBatchId: string | null;
        productionDate: string | null;
        isFirstLine: boolean;
        totalLines: number;
        fulfillmentStage: string | null;
        // Order reference with parsed orderLines for client compatibility
        order: {
            id: string;
            orderNumber: string;
            orderLines: Array<{
                id: string;
                lineStatus: string | null;
                qty: number;
                unitPrice: number;
                notes: string | null;
                awbNumber: string | null;
                courier: string | null;
                shippedAt: string | null;
                deliveredAt: string | null;
                trackingStatus: string | null;
                isCustomized: boolean;
                productionBatchId: string | null;
                skuId: string;
            }>;
            lastScanAt?: string | null;
        };
        isCustomized: boolean;
        isNonReturnable: boolean;
        customSkuCode: string | null;
        customizationType: string | null;
        customizationValue: string | null;
        customizationNotes: string | null;
        originalSkuCode: string | null;
        lineShippedAt: string | null;
        lineDeliveredAt: string | null;
        lineTrackingStatus: string | null;
        lineAwbNumber: string | null;
        lineCourier: string | null;
        daysInTransit: number | null;
        daysSinceDelivery: number | null;
        daysInRto: number | null;
        rtoStatus: string | null;
        discountCodes: string | null;
        customerNotes: string | null;
        shopifyTags: string | null;
        shopifyAwb: string | null;
        shopifyCourier: string | null;
        shopifyTrackingUrl: string | null;
        customerTags: string[] | null;
    }> = [];

    for (const order of orders) {
        // Parse orderLines JSON - handle both string and already-parsed cases
        let orderLines: KyselyOrderLine[] = [];
        if (order.orderLines) {
            if (typeof order.orderLines === 'string') {
                try {
                    orderLines = JSON.parse(order.orderLines);
                } catch {
                    orderLines = [];
                }
            } else {
                orderLines = order.orderLines as unknown as KyselyOrderLine[];
            }
        }

        const city = parseCity(order.shippingAddress);
        const shopifyStatus = order.shopifyStatus || '-';

        // Parse customer tags - handle both string and array
        let customerTags: string[] | null = null;
        if (order.customerTags) {
            if (typeof order.customerTags === 'string') {
                try {
                    customerTags = JSON.parse(order.customerTags);
                } catch {
                    customerTags = order.customerTags.split(',').map(t => t.trim());
                }
            } else if (Array.isArray(order.customerTags)) {
                customerTags = order.customerTags;
            }
        }

        // Build order reference with parsed orderLines for client compatibility
        const orderRef = {
            id: order.orderId,
            orderNumber: order.orderNumber,
            orderLines: orderLines.map(line => ({
                id: line.lineId,
                lineStatus: line.lineStatus,
                qty: line.qty,
                unitPrice: line.unitPrice,
                notes: line.lineNotes || null,
                awbNumber: line.lineAwbNumber,
                courier: line.lineCourier,
                shippedAt: line.lineShippedAt,
                deliveredAt: line.lineDeliveredAt,
                trackingStatus: line.lineTrackingStatus,
                isCustomized: line.isCustomized,
                productionBatchId: line.productionBatchId,
                skuId: line.skuId,
            })),
            lastScanAt: null as string | null,
        };

        // Handle orders with no lines
        if (orderLines.length === 0) {
            rows.push({
                orderId: order.orderId,
                orderNumber: order.orderNumber,
                orderDate: order.orderDate || '',
                shipByDate: order.shipByDate,
                customerName: order.customerName,
                customerEmail: order.customerEmail,
                customerPhone: order.customerPhone,
                customerId: order.customerId,
                city,
                customerOrderCount: order.customerOrderCount ?? 0,
                customerLtv: order.customerLtv ?? 0,
                customerTier: order.customerTier,
                customerRtoCount: order.customerRtoCount ?? 0,
                totalAmount: order.totalAmount ? Number(order.totalAmount) : null,
                paymentMethod: order.paymentMethod,
                channel: order.channel,
                internalNotes: order.internalNotes,
                orderStatus: order.orderStatus || 'pending',
                isArchived: order.isArchived || false,
                releasedToShipped: order.releasedToShipped || false,
                releasedToCancelled: order.releasedToCancelled || false,
                isExchange: order.isExchange || false,
                productName: '(no items)',
                colorName: '-',
                colorHex: null,
                imageUrl: null,
                size: '-',
                skuCode: '-',
                skuId: null,
                qty: 0,
                lineId: null,
                lineStatus: null,
                lineNotes: '',
                unitPrice: 0,
                skuStock: 0,
                fabricBalance: 0,
                shopifyStatus,
                productionBatch: null,
                productionBatchId: null,
                productionDate: null,
                isFirstLine: true,
                totalLines: 0,
                fulfillmentStage: null,
                order: orderRef,
                isCustomized: false,
                isNonReturnable: false,
                customSkuCode: null,
                customizationType: null,
                customizationValue: null,
                customizationNotes: null,
                originalSkuCode: null,
                lineShippedAt: null,
                lineDeliveredAt: null,
                lineTrackingStatus: null,
                lineAwbNumber: null,
                lineCourier: null,
                daysInTransit: order.daysInTransit,
                daysSinceDelivery: order.daysSinceDelivery,
                daysInRto: order.daysInRto,
                rtoStatus: order.rtoStatus,
                discountCodes: order.discountCodes,
                customerNotes: order.customerNotes,
                shopifyTags: order.shopifyTags,
                shopifyAwb: order.shopifyAwb,
                shopifyCourier: order.shopifyCourier,
                shopifyTrackingUrl: order.shopifyTrackingUrl,
                customerTags,
            });
            continue;
        }

        // Create a row for each order line
        for (let i = 0; i < orderLines.length; i++) {
            const line = orderLines[i];
            const isFirstLine = i === 0;

            rows.push({
                orderId: order.orderId,
                orderNumber: order.orderNumber,
                orderDate: order.orderDate || '',
                shipByDate: order.shipByDate,
                customerName: order.customerName,
                customerEmail: order.customerEmail,
                customerPhone: order.customerPhone,
                customerId: order.customerId,
                city,
                customerOrderCount: order.customerOrderCount ?? 0,
                customerLtv: order.customerLtv ?? 0,
                customerTier: order.customerTier,
                customerRtoCount: order.customerRtoCount ?? 0,
                totalAmount: order.totalAmount ? Number(order.totalAmount) : null,
                paymentMethod: order.paymentMethod,
                channel: order.channel,
                internalNotes: order.internalNotes,
                orderStatus: order.orderStatus || 'pending',
                isArchived: order.isArchived || false,
                releasedToShipped: order.releasedToShipped || false,
                releasedToCancelled: order.releasedToCancelled || false,
                isExchange: order.isExchange || false,
                productName: line.product?.name || '(unknown)',
                colorName: line.variation?.colorName || '-',
                colorHex: line.variation?.colorHex || null,
                imageUrl: line.variation?.imageUrl || line.product?.imageUrl || null,
                size: line.sku?.size || '-',
                skuCode: line.sku?.skuCode || '-',
                skuId: line.skuId,
                qty: line.qty,
                lineId: line.lineId,
                lineStatus: line.lineStatus,
                lineNotes: line.lineNotes || '',
                unitPrice: line.unitPrice,
                skuStock: 0, // Filled by inventory cache later
                fabricBalance: 0,
                shopifyStatus,
                productionBatch: line.productionBatch,
                productionBatchId: line.productionBatchId,
                productionDate: line.productionBatch?.batchDate || null,
                isFirstLine,
                totalLines: order.totalLines ?? orderLines.length,
                fulfillmentStage: order.fulfillmentStage,
                order: orderRef,
                isCustomized: line.isCustomized || false,
                isNonReturnable: line.isCustomized || false,
                customSkuCode: line.sku?.isCustomSku ? line.sku.skuCode : null,
                customizationType: line.sku?.customizationType || null,
                customizationValue: line.sku?.customizationValue || null,
                customizationNotes: line.sku?.customizationNotes || null,
                originalSkuCode: null, // Not tracked in current query
                lineShippedAt: line.lineShippedAt,
                lineDeliveredAt: line.lineDeliveredAt,
                lineTrackingStatus: line.lineTrackingStatus,
                lineAwbNumber: line.lineAwbNumber,
                lineCourier: line.lineCourier,
                daysInTransit: order.daysInTransit,
                daysSinceDelivery: order.daysSinceDelivery,
                daysInRto: order.daysInRto,
                rtoStatus: order.rtoStatus,
                discountCodes: order.discountCodes,
                customerNotes: order.customerNotes,
                shopifyTags: order.shopifyTags,
                shopifyAwb: order.shopifyAwb,
                shopifyCourier: order.shopifyCourier,
                shopifyTrackingUrl: order.shopifyTrackingUrl,
                customerTags,
            });
        }
    }

    return rows;
}
