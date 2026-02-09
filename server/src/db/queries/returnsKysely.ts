/**
 * Kysely Returns Queries
 *
 * High-performance queries for return request management.
 * Replaces Prisma nested includes with efficient JOINs.
 *
 * All public exports are validated against Zod schemas to catch schema drift.
 */

import { sql } from 'kysely';
import { kysely } from '../index.js';
import {
    returnsListResultSchema,
    returnDetailResultSchema,
    type ReturnsListResult,
    type ReturnDetailResult,
    type ReturnLineRow,
} from '@coh/shared';

// ============================================
// ROW TYPES (for typed query results after joins)
// ============================================

/** Shape of a row from the list returns main query */
interface ReturnListRow {
    id: string;
    requestNumber: string;
    requestType: string;
    status: string;
    reason: string | null;
    customerNotes: string | null;
    createdAt: Date;
    orderId: string | null;
    orderNumber: string | null;
    orderDate: Date | null;
    customerId: string | null;
    customerFirstName: string | null;
    customerLastName: string | null;
    customerEmail: string | null;
}

/** Shape of a row from the return lines query */
interface ReturnLineQueryRow {
    id: string;
    requestId: string;
    skuId: string;
    skuCode: string;
    skuSize: string;
    qty: number;
    reason: string | null;
    itemCondition: string | null;
    productId: string | null;
    productName: string | null;
    colorName: string | null;
}

/** Shape of a row from the detail return request query */
interface ReturnDetailRow {
    id: string;
    requestNumber: string;
    requestType: string;
    status: string;
    reason: string | null;
    customerNotes: string | null;
    resolutionNotes: string | null;
    createdAt: Date;
    updatedAt: Date;
    originalOrderId: string | null;
    originalOrderNumber: string | null;
    originalOrderDate: Date | null;
    originalOrderTotal: number | null;
    originalOrderAddress: string | null;
    exchangeOrderId: string | null;
    exchangeOrderNumber: string | null;
    exchangeOrderDate: Date | null;
    customerId: string | null;
    customerFirstName: string | null;
    customerLastName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    shippingId: string | null;
    shippingAwb: string | null;
    shippingCourier: string | null;
    shippingStatus: string | null;
}

/** Shape of a row from the detail lines query */
interface DetailLineRow {
    id: string;
    skuId: string;
    skuCode: string;
    skuSize: string;
    qty: number;
    reason: string | null;
    itemCondition: string | null;
    processingAction: string | null;
    productId: string | null;
    productName: string | null;
    productImageUrl: string | null;
    colorName: string | null;
    exchangeSkuId: string | null;
    exchangeSkuCode: string | null;
    exchangeSkuSize: string | null;
}

/** Shape of a row from the status history query */
interface StatusHistoryRow {
    id: string;
    fromStatus: string;
    toStatus: string;
    notes: string | null;
    createdAt: Date;
    changedByName: string | null;
}

// ============================================
// INPUT TYPES
// ============================================

export interface ReturnsListParams {
    status?: string;
    page?: number;
    limit?: number;
}

// Re-export output types from schemas
export type { ReturnsListResult, ReturnDetailResult, ReturnLineRow };

// ============================================
// QUERIES
// ============================================

/**
 * List return requests with pagination
 */
export async function listReturnsKysely(
    params: ReturnsListParams
): Promise<ReturnsListResult> {
    const { status, page = 1, limit = 20 } = params;
    const offset = (page - 1) * limit;

    // Build count query
    let countQuery = kysely
        .selectFrom('ReturnRequest')
        .select(sql<number>`count(*)::int`.as('count'));

    if (status) {
        countQuery = countQuery.where('ReturnRequest.status', '=', status) as typeof countQuery;
    }

    const countResult = await countQuery.executeTakeFirst();
    const total = countResult?.count ?? 0;

    // Build main query - type assertion needed: Kysely loses column tracking after multiple leftJoin aliases
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely cannot infer select columns across 3+ leftJoins with aliases
    const mainQuery = (kysely
        .selectFrom('ReturnRequest')
        .leftJoin('Order', 'Order.id', 'ReturnRequest.originalOrderId')
        .leftJoin('Customer', 'Customer.id', 'ReturnRequest.customerId') as any)
        .select([
            'ReturnRequest.id',
            'ReturnRequest.requestNumber',
            'ReturnRequest.requestType',
            'ReturnRequest.status',
            'ReturnRequest.reason',
            'ReturnRequest.customerNotes',
            'ReturnRequest.createdAt',
            'ReturnRequest.originalOrderId as orderId',
            'Order.orderNumber',
            'Order.orderDate',
            'ReturnRequest.customerId',
            'Customer.firstName as customerFirstName',
            'Customer.lastName as customerLastName',
            'Customer.email as customerEmail',
        ]);

    if (status) {
        mainQuery.where('ReturnRequest.status', '=', status);
    }

    const returnRows: ReturnListRow[] = await mainQuery
        .orderBy('ReturnRequest.createdAt', 'desc')
        .limit(limit)
        .offset(offset)
        .execute();

    if (returnRows.length === 0) {
        const result = {
            items: [],
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
        return returnsListResultSchema.parse(result);
    }

    // Get return IDs for fetching lines
    const returnIds = returnRows.map((r) => r.id).filter(Boolean);

    if (returnIds.length === 0) {
        const result = {
            items: [],
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
        return returnsListResultSchema.parse(result);
    }

    // Fetch lines with SKU/product info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely cannot infer select columns across 4 joins with aliases
    const lines: ReturnLineQueryRow[] = await (kysely
        .selectFrom('ReturnRequestLine')
        .innerJoin('Sku', 'Sku.id', 'ReturnRequestLine.skuId')
        .leftJoin('Variation', 'Variation.id', 'Sku.variationId')
        .leftJoin('Product', 'Product.id', 'Variation.productId') as any)
        .select([
            'ReturnRequestLine.id',
            'ReturnRequestLine.requestId',
            'ReturnRequestLine.skuId',
            'Sku.skuCode',
            'Sku.size as skuSize',
            'ReturnRequestLine.qty',
            'ReturnRequestLine.reason',
            'ReturnRequestLine.itemCondition',
            'Product.id as productId',
            'Product.name as productName',
            'Variation.colorName',
        ])
        .where('ReturnRequestLine.requestId', 'in', returnIds)
        .execute();

    // Build lines lookup
    const linesByReturn = new Map<string, ReturnLineRow[]>();
    for (const line of lines) {
        if (!line.requestId) continue;
        const list = linesByReturn.get(line.requestId) || [];
        list.push({
            id: line.id,
            requestId: line.requestId,
            skuId: line.skuId,
            skuCode: line.skuCode,
            skuSize: line.skuSize,
            qty: line.qty,
            reason: line.reason,
            itemCondition: line.itemCondition,
            productId: line.productId,
            productName: line.productName,
            colorName: line.colorName,
        });
        linesByReturn.set(line.requestId, list);
    }

    // Assemble results
    const items = returnRows.map((r) => ({
        id: r.id,
        requestNumber: r.requestNumber,
        requestType: r.requestType,
        status: r.status,
        reason: r.reason,
        customerNotes: r.customerNotes,
        createdAt: r.createdAt as Date,
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        orderDate: r.orderDate as Date | null,
        customerId: r.customerId,
        customerFirstName: r.customerFirstName,
        customerLastName: r.customerLastName,
        customerEmail: r.customerEmail,
        lines: linesByReturn.get(r.id) || [],
    }));

    const result = {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };

    // Validate output against Zod schema
    return returnsListResultSchema.parse(result);
}

/**
 * Get single return request by ID with full details
 */
export async function getReturnKysely(id: string): Promise<ReturnDetailResult | null> {
    // Get main return request - type assertion needed: Kysely cannot infer columns across 5 leftJoins with aliases
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely loses table-aware types after aliased joins (OriginalOrder, ExchangeOrder)
    const returnReq: ReturnDetailRow | undefined = await (kysely
        .selectFrom('ReturnRequest')
        .leftJoin('Order as OriginalOrder', 'OriginalOrder.id', 'ReturnRequest.originalOrderId')
        .leftJoin('Order as ExchangeOrder', 'ExchangeOrder.id', 'ReturnRequest.exchangeOrderId')
        .leftJoin('Customer', 'Customer.id', 'ReturnRequest.customerId')
        .leftJoin('ReturnShipping', 'ReturnShipping.requestId', 'ReturnRequest.id') as any)
        .select([
            'ReturnRequest.id',
            'ReturnRequest.requestNumber',
            'ReturnRequest.requestType',
            'ReturnRequest.status',
            'ReturnRequest.reason',
            'ReturnRequest.customerNotes',
            'ReturnRequest.resolutionNotes',
            'ReturnRequest.createdAt',
            'ReturnRequest.updatedAt',
            // Original order
            'OriginalOrder.id as originalOrderId',
            'OriginalOrder.orderNumber as originalOrderNumber',
            'OriginalOrder.orderDate as originalOrderDate',
            'OriginalOrder.totalAmount as originalOrderTotal',
            'OriginalOrder.shippingAddress as originalOrderAddress',
            // Exchange order
            'ExchangeOrder.id as exchangeOrderId',
            'ExchangeOrder.orderNumber as exchangeOrderNumber',
            'ExchangeOrder.orderDate as exchangeOrderDate',
            // Customer
            'Customer.id as customerId',
            'Customer.firstName as customerFirstName',
            'Customer.lastName as customerLastName',
            'Customer.email as customerEmail',
            'Customer.phone as customerPhone',
            // Shipping
            'ReturnShipping.id as shippingId',
            'ReturnShipping.awbNumber as shippingAwb',
            'ReturnShipping.courier as shippingCourier',
            'ReturnShipping.status as shippingStatus',
        ])
        .where('ReturnRequest.id', '=', id)
        .executeTakeFirst();

    if (!returnReq) return null;

    // Get lines with SKU/product info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely cannot infer columns across 5 joins with aliased tables (ExchangeSku)
    const lines: DetailLineRow[] = await (kysely
        .selectFrom('ReturnRequestLine')
        .innerJoin('Sku', 'Sku.id', 'ReturnRequestLine.skuId')
        .leftJoin('Variation', 'Variation.id', 'Sku.variationId')
        .leftJoin('Product', 'Product.id', 'Variation.productId')
        .leftJoin('Sku as ExchangeSku', 'ExchangeSku.id', 'ReturnRequestLine.exchangeSkuId') as any)
        .select([
            'ReturnRequestLine.id',
            'ReturnRequestLine.skuId',
            'Sku.skuCode',
            'Sku.size as skuSize',
            'ReturnRequestLine.qty',
            'ReturnRequestLine.reason',
            'ReturnRequestLine.itemCondition',
            'ReturnRequestLine.processingAction',
            'Product.id as productId',
            'Product.name as productName',
            'Product.imageUrl as productImageUrl',
            'Variation.colorName',
            'ExchangeSku.id as exchangeSkuId',
            'ExchangeSku.skuCode as exchangeSkuCode',
            'ExchangeSku.size as exchangeSkuSize',
        ])
        .where('ReturnRequestLine.requestId', '=', id)
        .execute();

    // Get status history
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely loses table-aware types after leftJoin with alias
    const history: StatusHistoryRow[] = await (kysely
        .selectFrom('ReturnStatusHistory')
        .leftJoin('User', 'User.id', 'ReturnStatusHistory.changedById') as any)
        .select([
            'ReturnStatusHistory.id',
            'ReturnStatusHistory.fromStatus',
            'ReturnStatusHistory.toStatus',
            'ReturnStatusHistory.notes',
            'ReturnStatusHistory.createdAt',
            'User.name as changedByName',
        ])
        .where('ReturnStatusHistory.requestId', '=', id)
        .orderBy('ReturnStatusHistory.createdAt', 'asc')
        .execute();

    // Assemble result
    const result = {
        id: returnReq.id,
        requestNumber: returnReq.requestNumber,
        requestType: returnReq.requestType,
        status: returnReq.status,
        reason: returnReq.reason,
        customerNotes: returnReq.customerNotes,
        resolutionNotes: returnReq.resolutionNotes,
        createdAt: returnReq.createdAt,
        updatedAt: returnReq.updatedAt,
        originalOrder: returnReq.originalOrderId
            ? {
                  id: returnReq.originalOrderId,
                  orderNumber: returnReq.originalOrderNumber,
                  orderDate: returnReq.originalOrderDate,
                  totalAmount: returnReq.originalOrderTotal,
                  shippingAddress: returnReq.originalOrderAddress,
              }
            : null,
        exchangeOrder: returnReq.exchangeOrderId
            ? {
                  id: returnReq.exchangeOrderId,
                  orderNumber: returnReq.exchangeOrderNumber,
                  orderDate: returnReq.exchangeOrderDate,
              }
            : null,
        customer: returnReq.customerId
            ? {
                  id: returnReq.customerId,
                  firstName: returnReq.customerFirstName,
                  lastName: returnReq.customerLastName,
                  email: returnReq.customerEmail,
                  phone: returnReq.customerPhone,
              }
            : null,
        shipping: returnReq.shippingId
            ? {
                  id: returnReq.shippingId,
                  awbNumber: returnReq.shippingAwb,
                  courier: returnReq.shippingCourier,
                  status: returnReq.shippingStatus,
              }
            : null,
        lines: lines.map((l) => ({
            id: l.id,
            skuId: l.skuId,
            skuCode: l.skuCode,
            size: l.skuSize,
            qty: l.qty,
            reason: l.reason,
            itemCondition: l.itemCondition,
            processingAction: l.processingAction,
            sku: {
                id: l.skuId,
                skuCode: l.skuCode,
                size: l.skuSize,
                variation: {
                    colorName: l.colorName,
                    product: {
                        id: l.productId,
                        name: l.productName,
                        imageUrl: l.productImageUrl,
                    },
                },
            },
            exchangeSku: l.exchangeSkuId
                ? {
                      id: l.exchangeSkuId,
                      skuCode: l.exchangeSkuCode,
                      size: l.exchangeSkuSize,
                  }
                : null,
        })),
        statusHistory: history.map((h) => ({
            id: h.id,
            fromStatus: h.fromStatus,
            toStatus: h.toStatus,
            notes: h.notes,
            createdAt: h.createdAt,
            changedBy: h.changedByName ? { name: h.changedByName } : null,
        })),
    };

    // Validate output against Zod schema
    return returnDetailResultSchema.parse(result);
}
