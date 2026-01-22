/**
 * Kysely Orders List Query
 *
 * High-performance replacement for Prisma's nested includes.
 * Uses CTEs and JSON aggregation for single-query data fetching.
 *
 * Shared between Express server and TanStack Start Server Functions.
 */
import { sql } from 'kysely';
import { getKysely } from '../createKysely.js';
// ============================================
// VIEW WHERE CLAUSES
// ============================================
function applyViewWhereClause(_qb, view, shippedFilter) {
    const kysely = getKysely();
    let baseQb = kysely.selectFrom('Order').select(sql `COUNT(*)::int`.as('count'));
    switch (view) {
        case 'open':
            return baseQb.where((eb) => eb.and([
                eb('Order.isArchived', '=', false),
                eb.or([
                    eb('Order.status', '=', 'open'),
                    eb.and([
                        eb('Order.releasedToShipped', '=', false),
                        eb('Order.releasedToCancelled', '=', false),
                    ]),
                ]),
            ]));
        case 'shipped':
            let shippedQb = baseQb
                .where('Order.isArchived', '=', false)
                .where('Order.releasedToShipped', '=', true);
            if (shippedFilter === 'rto') {
                return shippedQb.where('Order.trackingStatus', 'in', ['rto_in_transit', 'rto_delivered']);
            }
            else if (shippedFilter === 'cod_pending') {
                return shippedQb
                    .where('Order.paymentMethod', '=', 'COD')
                    .where('Order.trackingStatus', '=', 'delivered')
                    .where('Order.codRemittedAt', 'is', null);
            }
            return shippedQb;
        case 'cancelled':
            return baseQb
                .where('Order.isArchived', '=', false)
                .where('Order.releasedToCancelled', '=', true);
        default:
            return baseQb;
    }
}
// Version for the full query with joins
function applyViewWhereClauseToFullQuery(qb, view, shippedFilter) {
    switch (view) {
        case 'open':
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return qb.where((eb) => eb.and([
                eb('Order.isArchived', '=', false),
                eb.or([
                    eb('Order.status', '=', 'open'),
                    eb.and([
                        eb('Order.releasedToShipped', '=', false),
                        eb('Order.releasedToCancelled', '=', false),
                    ]),
                ]),
            ]));
        case 'shipped':
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let shippedQb = qb
                .where('Order.isArchived', '=', false)
                .where('Order.releasedToShipped', '=', true);
            if (shippedFilter === 'rto') {
                return shippedQb.where('Order.trackingStatus', 'in', ['rto_in_transit', 'rto_delivered']);
            }
            else if (shippedFilter === 'cod_pending') {
                return shippedQb
                    .where('Order.paymentMethod', '=', 'COD')
                    .where('Order.trackingStatus', '=', 'delivered')
                    .where('Order.codRemittedAt', 'is', null);
            }
            return shippedQb;
        case 'cancelled':
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return qb
                .where('Order.isArchived', '=', false)
                .where('Order.releasedToCancelled', '=', true);
        default:
            return qb;
    }
}
// ============================================
// MAIN QUERY
// ============================================
export async function listOrdersKysely(params) {
    const kysely = getKysely();
    const { view, page, limit, shippedFilter, search, days, sortBy } = params;
    const offset = (page - 1) * limit;
    // Calculate date filter if days specified
    let sinceDate = null;
    if (days) {
        sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);
    }
    // CTE: Line status counts per order (for fulfillment stage)
    const lineStatusCte = kysely
        .selectFrom('OrderLine')
        .select([
        'orderId',
        sql `COUNT(*)::int`.as('totalLines'),
        sql `COUNT(*) FILTER (WHERE "lineStatus" = 'pending')::int`.as('pendingCount'),
        sql `COUNT(*) FILTER (WHERE "lineStatus" = 'allocated')::int`.as('allocatedCount'),
        sql `COUNT(*) FILTER (WHERE "lineStatus" = 'picked')::int`.as('pickedCount'),
        sql `COUNT(*) FILTER (WHERE "lineStatus" = 'packed')::int`.as('packedCount'),
        sql `COUNT(*) FILTER (WHERE "lineStatus" = 'shipped')::int`.as('shippedCount'),
        sql `COUNT(*) FILTER (WHERE "lineStatus" = 'cancelled')::int`.as('cancelledCount'),
        // Compute fulfillment stage in SQL
        sql `CASE
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
        // Order fields (lean selection)
        'Order.id as orderId',
        'Order.orderNumber',
        sql `to_char("Order"."orderDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.as('orderDate'),
        sql `"Order"."shipByDate"::text`.as('shipByDate'),
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
        'Order.isOnHold',
        'Order.awbNumber as orderAwbNumber',
        'Order.courier as orderCourier',
        sql `to_char("Order"."shippedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.as('orderShippedAt'),
        'Order.trackingStatus as orderTrackingStatus',
        sql `to_char("Order"."codRemittedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.as('codRemittedAt'),
        sql `to_char("Order"."archivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.as('archivedAt'),
        // Customer fields (stats for tier display)
        'Customer.tags as customerTags',
        sql `COALESCE("Customer"."orderCount", 0)`.as('customerOrderCount'),
        sql `COALESCE("Customer"."ltv", 0)`.as('customerLtv'),
        'Customer.tier as customerTier',
        sql `COALESCE("Customer"."rtoCount", 0)`.as('customerRtoCount'),
        // Line stats from CTE
        sql `COALESCE("lineStats"."totalLines", 0)`.as('totalLines'),
        sql `COALESCE("lineStats"."fulfillmentStage", 'pending')`.as('fulfillmentStage'),
        // Shopify cache fields (lean selection)
        'ShopifyOrderCache.discountCodes',
        'ShopifyOrderCache.customerNotes',
        'ShopifyOrderCache.tags as shopifyTags',
        'ShopifyOrderCache.trackingNumber as shopifyAwb',
        'ShopifyOrderCache.trackingCompany as shopifyCourier',
        'ShopifyOrderCache.trackingUrl as shopifyTrackingUrl',
        'ShopifyOrderCache.fulfillmentStatus as shopifyStatus',
        // Enriched fields (computed in SQL)
        sql `EXTRACT(DAY FROM NOW() - "Order"."shippedAt")::int`.as('daysInTransit'),
        sql `EXTRACT(DAY FROM NOW() - "Order"."deliveredAt")::int`.as('daysSinceDelivery'),
        sql `EXTRACT(DAY FROM NOW() - "Order"."rtoInitiatedAt")::int`.as('daysInRto'),
        sql `CASE
                WHEN "Order"."rtoReceivedAt" IS NOT NULL THEN 'received'
                WHEN "Order"."rtoInitiatedAt" IS NOT NULL THEN 'in_transit'
                ELSE NULL
            END`.as('rtoStatus'),
        // Order lines as JSON array (aggregated subquery)
        sql `(
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filteredQuery = filteredQuery.where((eb) => eb.or([
            sql `LOWER("Order"."orderNumber") LIKE ${searchTerm}`,
            sql `LOWER("Order"."customerName") LIKE ${searchTerm}`,
            sql `"Order"."awbNumber" LIKE ${searchTerm}`,
            sql `LOWER("Order"."customerEmail") LIKE ${searchTerm}`,
            sql `"Order"."customerPhone" LIKE ${searchTerm}`,
        ]));
    }
    // Apply days filter
    if (sinceDate) {
        filteredQuery = filteredQuery.where('Order.orderDate', '>=', sinceDate);
    }
    // Determine sort field
    const sortField = sortBy || 'orderDate';
    const sortColumn = `Order.${sortField}`;
    // Apply sorting and pagination
    const paginatedQuery = filteredQuery
        .orderBy(sortColumn, 'desc')
        .limit(limit)
        .offset(offset);
    // Count query (parallel execution) - must apply same filters
    let countQuery = applyViewWhereClause(kysely.selectFrom('Order').select(sql `COUNT(*)::int`.as('count')), view, shippedFilter);
    // Apply search filter to count query
    if (search && search.trim()) {
        const searchTerm = `%${search.trim().toLowerCase()}%`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        countQuery = countQuery.where((eb) => eb.or([
            sql `LOWER("Order"."orderNumber") LIKE ${searchTerm}`,
            sql `LOWER("Order"."customerName") LIKE ${searchTerm}`,
            sql `"Order"."awbNumber" LIKE ${searchTerm}`,
            sql `LOWER("Order"."customerEmail") LIKE ${searchTerm}`,
            sql `"Order"."customerPhone" LIKE ${searchTerm}`,
        ]));
    }
    // Apply days filter to count query
    if (sinceDate) {
        countQuery = countQuery.where('Order.orderDate', '>=', sinceDate);
    }
    // Execute both in parallel
    const [orders, countResult] = await Promise.all([
        paginatedQuery.execute(),
        countQuery.executeTakeFirst(),
    ]);
    return {
        orders,
        totalCount: countResult?.count ?? 0,
    };
}
/**
 * Parse city from JSON shipping address
 */
function parseCity(shippingAddress) {
    if (!shippingAddress)
        return '-';
    try {
        const addr = JSON.parse(shippingAddress);
        return addr.city || '-';
    }
    catch {
        return '-';
    }
}
/**
 * Transform Kysely query results to FlattenedOrderRow format
 * Matches the structure expected by the frontend AG-Grid
 */
export function transformKyselyToRows(orders) {
    const rows = [];
    for (const order of orders) {
        // Parse orderLines JSON - handle both string and already-parsed cases
        let orderLines = [];
        if (order.orderLines) {
            if (typeof order.orderLines === 'string') {
                try {
                    orderLines = JSON.parse(order.orderLines);
                }
                catch {
                    orderLines = [];
                }
            }
            else {
                orderLines = order.orderLines;
            }
        }
        const city = parseCity(order.shippingAddress);
        const shopifyStatus = order.shopifyStatus || '-';
        // Parse customer tags - handle both string and array
        let customerTags = null;
        if (order.customerTags) {
            if (typeof order.customerTags === 'string') {
                try {
                    customerTags = JSON.parse(order.customerTags);
                }
                catch {
                    customerTags = order.customerTags.split(',').map(t => t.trim());
                }
            }
            else if (Array.isArray(order.customerTags)) {
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
            lastScanAt: null,
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
                isOnHold: order.isOnHold || false,
                orderAwbNumber: order.orderAwbNumber,
                orderCourier: order.orderCourier,
                orderShippedAt: order.orderShippedAt,
                orderTrackingStatus: order.orderTrackingStatus,
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
                isOnHold: order.isOnHold || false,
                orderAwbNumber: order.orderAwbNumber,
                orderCourier: order.orderCourier,
                orderShippedAt: order.orderShippedAt,
                orderTrackingStatus: order.orderTrackingStatus,
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
//# sourceMappingURL=ordersListKysely.js.map