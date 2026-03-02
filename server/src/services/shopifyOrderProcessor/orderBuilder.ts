/**
 * Order building helpers - constructs order data from Shopify orders
 * Handles customer data, status determination, tracking, change detection, and line creation
 *
 * @module services/shopifyOrderProcessor/orderBuilder
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import shopifyClient from '../shopify/index.js';
import type { ShopifyAddress, ShopifyCustomer } from '../shopify/index.js';
import type { ShopifyCustomerData } from '../../utils/customerUtils.js';
import { detectPaymentMethod, extractInternalNote, extractUtmFields, calculateEffectiveUnitPrice } from '../../utils/shopifyHelpers.js';
import { syncLogger } from '../../utils/logger.js';
import { recomputeOrderStatus } from '../../utils/orderStatus.js';
import { deferredExecutor } from '../deferredExecutor.js';
import { generateDraftInvoice } from '../orderInvoiceGenerator.js';
import { settleOrderInvoice } from '../orderSettlement.js';
import { updateCustomerTier, incrementCustomerOrderCount } from '../../utils/tierUtils.js';
import { syncFulfillmentsToOrderLines } from './fulfillmentSync.js';
import { syncOrderToStorefront } from '../storefrontOrderSync.js';
import type {
    ExtendedShopifyOrder,
    OrderWithLines,
    OrderBuildContext,
    OrderDataPayload,
    TrackingInfo,
    ChangeDetectionResult,
    OrderLinesResult,
    SkuLookupFn,
    ProcessResult,
    FulfillmentSyncResult,
} from './types.js';

// ============================================
// CUSTOMER HELPERS
// ============================================

/**
 * Build customer data object for findOrCreateCustomer
 */
export function buildCustomerData(customer: ShopifyCustomer | undefined | null): ShopifyCustomerData | null {
    if (!customer) return null;
    return {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone,
        default_address: customer.default_address,
    };
}

/**
 * Build customer display name from shipping address or customer
 */
export function buildCustomerName(
    shippingAddress: ShopifyAddress | undefined | null,
    customer: ShopifyCustomer | undefined | null
): string {
    if (shippingAddress) {
        return `${shippingAddress.first_name || ''} ${shippingAddress.last_name || ''}`.trim() || 'Unknown';
    }
    if (customer?.first_name) {
        return `${customer.first_name} ${customer.last_name || ''}`.trim();
    }
    return 'Unknown';
}

// ============================================
// STATUS & TRACKING
// ============================================

/**
 * Determine order status with ERP precedence rules
 * - ERP-managed statuses (shipped, delivered) are preserved over Shopify
 * - ERP is source of truth: Shopify fulfillment does NOT auto-ship orders
 */
export function determineOrderStatus(
    shopifyOrder: ExtendedShopifyOrder,
    existingOrder: OrderWithLines | null
): string {
    let status: string = shopifyClient.mapOrderStatus(shopifyOrder);

    if (existingOrder) {
        const erpManagedStatuses: string[] = ['shipped', 'delivered'];
        if (erpManagedStatuses.includes(existingOrder.status) && status !== 'cancelled') {
            status = existingOrder.status;
        } else if (existingOrder.status === 'open') {
            status = 'open';
        }
    }

    return status;
}

/**
 * Extract tracking info from Shopify fulfillments
 * Note: Tracking data is now stored at OrderLine level, not Order level.
 * This function extracts from Shopify fulfillments for new orders or fallback.
 */
export function extractOrderTrackingInfo(
    shopifyOrder: ExtendedShopifyOrder,
    existingOrder: OrderWithLines | null
): TrackingInfo {
    // Tracking is now on OrderLine, get from first shipped line if exists
    const existingShippedLine = existingOrder?.orderLines?.find(l => l.shippedAt || l.awbNumber);
    let awbNumber = existingShippedLine?.awbNumber || null;
    let courier = existingShippedLine?.courier || null;
    let shippedAt = existingShippedLine?.shippedAt || null;

    if (shopifyOrder.fulfillments?.length && shopifyOrder.fulfillments.length > 0) {
        const fulfillment = shopifyOrder.fulfillments.find(f => f.tracking_number) || shopifyOrder.fulfillments[0];
        awbNumber = fulfillment.tracking_number || awbNumber;
        courier = fulfillment.tracking_company || courier;
        if (fulfillment.created_at && !shippedAt) {
            shippedAt = new Date(fulfillment.created_at);
        }
    }

    return { awbNumber, courier, shippedAt };
}

// ============================================
// ORDER DATA BUILDING
// ============================================

/**
 * Build complete order data payload for create/update
 * Note: Tracking fields (awbNumber, courier, shippedAt) are synced to OrderLines via syncFulfillmentsToOrderLines
 */
export function buildOrderData(
    ctx: OrderBuildContext,
    status: string,
    _tracking: TrackingInfo // Tracking is now on OrderLine, kept for signature compatibility
): OrderDataPayload {
    const { shopifyOrder, existingOrder, customerId } = ctx;
    const shopifyOrderId = String(shopifyOrder.id);
    const orderNumber = shopifyOrder.name || String(shopifyOrder.order_number);
    const customer = shopifyOrder.customer;
    const shippingAddress = shopifyOrder.shipping_address;

    const customerName = buildCustomerName(shippingAddress, customer);
    const paymentMethod = detectPaymentMethod(shopifyOrder, existingOrder?.paymentMethod);
    const internalNote = extractInternalNote(shopifyOrder.note_attributes);
    const utm = extractUtmFields(shopifyOrder.note_attributes);

    let internalNotes = existingOrder?.internalNotes || internalNote || null;

    // Add cancellation note if cancelled
    if (shopifyOrder.cancelled_at && !existingOrder?.internalNotes?.includes('Cancelled via Shopify')) {
        internalNotes = existingOrder?.internalNotes
            ? `${existingOrder.internalNotes}\nCancelled via Shopify at ${shopifyOrder.cancelled_at}`
            : `Cancelled via Shopify at ${shopifyOrder.cancelled_at}`;
    }

    const totalAmount = parseFloat(shopifyOrder.total_price) || 0;
    const isPrepaid = paymentMethod === 'Prepaid';

    return {
        shopifyOrderId,
        orderNumber: orderNumber || `SHOP-${shopifyOrderId.slice(-8)}`,
        channel: shopifyClient.mapOrderChannel(shopifyOrder),
        status,
        customerId,
        customerName,
        customerEmail: customer?.email || shopifyOrder.email || null,
        customerPhone: shippingAddress?.phone || customer?.phone || shopifyOrder.phone || null,
        shippingAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
        customerState: shippingAddress?.province || null,
        totalAmount,
        orderDate: shopifyOrder.created_at ? new Date(shopifyOrder.created_at) : new Date(),
        internalNotes,
        paymentMethod,
        paymentGateway: shopifyOrder.payment_gateway_names?.join(', ') || null,
        syncedAt: new Date(),
        // UTM attribution
        ...utm,
        // Prepaid: customer already paid at checkout
        ...(isPrepaid ? {
            paymentStatus: 'paid',
            paymentConfirmedAt: new Date(),
            settledAt: new Date(),
            settlementAmount: totalAmount,
            settlementRef: `PREPAID-${orderNumber || shopifyOrderId}`,
        } : {}),
    };
}

// ============================================
// CHANGE DETECTION
// ============================================

/**
 * Detect if an existing order needs update and determine change type
 * Note: awbNumber, courier are now on OrderLine, synced via syncFulfillmentsToOrderLines
 */
export function detectOrderChanges(
    existingOrder: OrderWithLines,
    orderData: OrderDataPayload,
    shopifyOrder: ExtendedShopifyOrder
): ChangeDetectionResult {
    const needsUpdate =
        existingOrder.status !== orderData.status ||
        existingOrder.paymentMethod !== orderData.paymentMethod ||
        existingOrder.customerEmail !== orderData.customerEmail ||
        existingOrder.customerPhone !== orderData.customerPhone ||
        existingOrder.totalAmount !== orderData.totalAmount ||
        existingOrder.shippingAddress !== orderData.shippingAddress;

    let changeType: ProcessResult['action'] = 'updated';
    if (shopifyOrder.cancelled_at && existingOrder.status !== 'cancelled') {
        changeType = 'cancelled';
    } else if (shopifyOrder.fulfillment_status === 'fulfilled') {
        changeType = 'fulfilled';
    }

    return { needsUpdate, changeType };
}

// ============================================
// ORDER LINES
// ============================================

/**
 * Create order lines data with SKU lookup abstraction
 * @param shopifyOrder - The Shopify order
 * @param skuLookup - Function to look up SKU by variant ID or SKU code
 * @param skipNoSku - If true, return shouldSkip when no SKUs match; if false, allow empty lines
 */
export async function createOrderLinesData(
    shopifyOrder: ExtendedShopifyOrder,
    skuLookup: SkuLookupFn,
    skipNoSku: boolean
): Promise<OrderLinesResult> {
    const lineItems = shopifyOrder.line_items || [];
    const shippingAddress = shopifyOrder.shipping_address;
    const orderLinesData: Prisma.OrderLineCreateWithoutOrderInput[] = [];

    for (const item of lineItems) {
        const shopifyVariantId = item.variant_id ? String(item.variant_id) : null;

        // Look up SKU using the provided lookup function
        const sku = await skuLookup(shopifyVariantId, item.sku || null);

        if (sku) {
            const originalPrice = parseFloat(item.price) || 0;
            const effectiveUnitPrice = calculateEffectiveUnitPrice(
                originalPrice,
                item.quantity,
                item.discount_allocations
            );

            orderLinesData.push({
                shopifyLineId: String(item.id),
                sku: { connect: { id: sku.id } },
                qty: item.quantity,
                unitPrice: effectiveUnitPrice,
                lineStatus: 'pending',
                shippingAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
            });
        }
    }

    // Handle no matching SKUs
    if (orderLinesData.length === 0 && skipNoSku) {
        return {
            orderLinesData: [],
            totalLineItems: lineItems.length,
            shouldSkip: true,
            skipReason: 'no_matching_skus',
        };
    }

    return {
        orderLinesData,
        totalLineItems: lineItems.length,
        shouldSkip: false,
    };
}

// ============================================
// ORDER MUTATIONS
// ============================================

/**
 * Handle update for an existing order
 * Returns ProcessResult if update was performed or skipped, null to continue to creation
 */
export async function handleExistingOrderUpdate(
    prisma: PrismaClient,
    existingOrder: OrderWithLines,
    orderData: OrderDataPayload,
    shopifyOrder: ExtendedShopifyOrder
): Promise<ProcessResult> {
    const { needsUpdate, changeType } = detectOrderChanges(existingOrder, orderData, shopifyOrder);

    if (needsUpdate) {
        await prisma.order.update({
            where: { id: existingOrder.id },
            data: orderData
        });

        // If order is being cancelled via Shopify, also cancel all order lines
        if (changeType === 'cancelled') {
            await prisma.orderLine.updateMany({
                where: {
                    orderId: existingOrder.id,
                    lineStatus: { not: 'cancelled' }
                },
                data: { lineStatus: 'cancelled' }
            });
        }

        const fulfillmentSync = await syncFulfillmentsToOrderLines(prisma, existingOrder.id, shopifyOrder);

        // Recompute order status from lines after any mutation
        await recomputeOrderStatus(existingOrder.id);

        return { action: changeType, orderId: existingOrder.id, fulfillmentSync };
    }

    // Even if order data hasn't changed, sync fulfillments (they may have updated)
    if (shopifyOrder.fulfillments?.length && shopifyOrder.fulfillments.length > 0) {
        const fulfillmentSync = await syncFulfillmentsToOrderLines(prisma, existingOrder.id, shopifyOrder);
        if (fulfillmentSync.synced > 0) {
            return { action: 'fulfillment_synced', orderId: existingOrder.id, fulfillmentSync };
        }
    }

    return { action: 'skipped', orderId: existingOrder.id };
}

/**
 * Create new order with lines and post-processing
 */
export async function createNewOrderWithLines(
    prisma: PrismaClient,
    orderData: OrderDataPayload,
    linesResult: OrderLinesResult,
    shopifyOrder: ExtendedShopifyOrder
): Promise<ProcessResult> {
    const newOrder = await prisma.order.create({
        data: {
            ...orderData,
            orderLines: {
                create: linesResult.orderLinesData
            }
        }
    });

    // Sync fulfillments to order lines if order came in already fulfilled
    // Guarded - fulfillment sync failure shouldn't fail order creation
    let fulfillmentSync: FulfillmentSyncResult | null = null;
    if (shopifyOrder.fulfillments?.length && shopifyOrder.fulfillments.length > 0) {
        try {
            fulfillmentSync = await syncFulfillmentsToOrderLines(prisma, newOrder.id, shopifyOrder);
        } catch (fulfillmentError: unknown) {
            syncLogger.warn({
                orderId: newOrder.id,
                shopifyOrderId: String(shopifyOrder.id),
                error: fulfillmentError instanceof Error ? fulfillmentError.message : 'Unknown error'
            }, 'Failed to sync fulfillments for new order - order was created successfully');
        }
    }

    // Prepaid: payment confirmed at checkout -> create + confirm invoice
    // COD: invoice created when remittance CSV is uploaded (remittance.ts)
    if (orderData.paymentMethod === 'Prepaid') {
        deferredExecutor.enqueue(async () => {
            try {
                await generateDraftInvoice(prisma, newOrder.id);
                const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
                if (admin) {
                    await prisma.$transaction(async (tx) => {
                        await settleOrderInvoice(tx, {
                            orderId: newOrder.id,
                            amount: orderData.totalAmount,
                            userId: admin.id,
                            settlementRef: `PREPAID-${orderData.orderNumber}`,
                        });
                    });
                }
            } catch (err: unknown) {
                syncLogger.warn({ orderId: newOrder.id, error: err instanceof Error ? err.message : String(err) },
                    'Failed to create prepaid invoice');
            }
        });
    }

    // Update customer stats: increment orderCount and update tier
    if (orderData.customerId) {
        await incrementCustomerOrderCount(prisma, orderData.customerId);
        if (orderData.totalAmount > 0) {
            await updateCustomerTier(prisma, orderData.customerId);
        }
    }

    // Lazy-link RP exchange orders: if any return lines reference this Shopify order as an exchange,
    // mark this order as exchange and link it back
    const shopifyId = String(shopifyOrder.id);
    deferredExecutor.enqueue(async () => {
        try {
            const rpExchangeLines = await prisma.orderLine.findMany({
                where: { returnPrimeExchangeShopifyOrderId: shopifyId, returnExchangeOrderId: null },
                select: { id: true, orderId: true },
            });
            if (rpExchangeLines.length > 0) {
                const originalOrderId = rpExchangeLines[0].orderId;
                await prisma.order.update({
                    where: { id: newOrder.id },
                    data: { isExchange: true, originalOrderId, channel: 'exchange' },
                });
                await prisma.orderLine.updateMany({
                    where: { id: { in: rpExchangeLines.map(l => l.id) } },
                    data: { returnExchangeOrderId: newOrder.id },
                });
                syncLogger.info({ orderId: newOrder.id, shopifyId, lines: rpExchangeLines.length },
                    'Lazy-linked RP exchange order to return lines');
            }
        } catch (err: unknown) {
            syncLogger.warn({ orderId: newOrder.id, error: err instanceof Error ? err.message : String(err) },
                'Failed to lazy-link RP exchange order');
        }
    });

    // Create synthetic checkout_completed storefront event for analytics
    // (Pixel misses purchases through Shopflo checkout)
    deferredExecutor.enqueue(async () => {
        try {
            await syncOrderToStorefront(prisma, newOrder.id);
        } catch (err: unknown) {
            syncLogger.warn({ orderId: newOrder.id, error: err instanceof Error ? err.message : String(err) },
                'Failed to sync order to storefront events');
        }
    });

    return {
        action: 'created',
        orderId: newOrder.id,
        linesCreated: linesResult.orderLinesData.length,
        totalLineItems: linesResult.totalLineItems,
        fulfillmentSync: fulfillmentSync || undefined,
    };
}
