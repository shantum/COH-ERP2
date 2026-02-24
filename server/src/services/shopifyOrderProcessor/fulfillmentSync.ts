/**
 * Fulfillment sync - maps Shopify fulfillments to OrderLines
 * Handles line-level tracking data (AWB, courier, status)
 *
 * @module services/shopifyOrderProcessor/fulfillmentSync
 */

import type { PrismaClient } from '@prisma/client';
import { syncLogger } from '../../utils/logger.js';
import type { ExtendedShopifyOrder, FulfillmentSyncResult } from './types.js';

/**
 * Map Shopify shipment_status to ERP trackingStatus
 */
export function mapShipmentStatus(shopifyStatus: string | null | undefined): string {
    const map: Record<string, string> = {
        'in_transit': 'in_transit',
        'out_for_delivery': 'out_for_delivery',
        'delivered': 'delivered',
        'failure': 'delivery_delayed',
        'attempted_delivery': 'out_for_delivery',
    };
    return shopifyStatus ? (map[shopifyStatus] || 'in_transit') : 'in_transit';
}

/**
 * Sync fulfillment data from Shopify to OrderLines
 * Maps each fulfillment's line_items to ERP OrderLines via shopifyLineId
 *
 * This enables partial shipment tracking - different lines can have different AWBs
 *
 * @param prisma - Prisma client
 * @param orderId - ERP Order ID
 * @param shopifyOrder - Raw Shopify order object
 * @returns Sync results with counts
 */
export async function syncFulfillmentsToOrderLines(
    prisma: PrismaClient,
    orderId: string,
    shopifyOrder: ExtendedShopifyOrder
): Promise<FulfillmentSyncResult> {
    const fulfillments = shopifyOrder.fulfillments || [];
    if (fulfillments.length === 0) return { synced: 0, fulfillments: 0 };

    let syncedCount = 0;

    for (const fulfillment of fulfillments) {
        const awbNumber = fulfillment.tracking_number || null;
        const courier = fulfillment.tracking_company || null;
        const trackingStatus = mapShipmentStatus(fulfillment.shipment_status);

        // CASE 1: line_items present - PRECISE sync to specific lines
        if (fulfillment.line_items?.length) {
            const shopifyLineIds = fulfillment.line_items.map((li: { id: number }) => String(li.id));

            // Sync tracking data only - ERP is source of truth for shipped status
            // lineStatus changes must go through ERP workflow (allocate > pick > pack > ship)
            const result = await prisma.orderLine.updateMany({
                where: {
                    orderId,
                    shopifyLineId: { in: shopifyLineIds },
                    lineStatus: { not: 'cancelled' },
                },
                data: {
                    awbNumber,
                    courier,
                    trackingStatus,
                }
            });

            syncedCount += result.count;
            syncLogger.info({
                orderNumber: shopifyOrder.name,
                fulfillmentId: fulfillment.id,
                lineCount: shopifyLineIds.length,
                updatedCount: result.count,
                awbNumber,
            }, 'Synced fulfillment tracking to specific lines');
        }
        // CASE 2: No line_items - FALLBACK: update all lines without AWB
        // This handles single-fulfillment orders where Shopify may omit line_items
        // Sync tracking data only - ERP is source of truth for shipped status
        else if (awbNumber) {
            const result = await prisma.orderLine.updateMany({
                where: {
                    orderId,
                    awbNumber: null, // Only update lines without existing AWB (preserve split shipments)
                    lineStatus: { not: 'cancelled' },
                },
                data: {
                    awbNumber,
                    courier,
                    trackingStatus,
                }
            });

            syncedCount += result.count;
            if (result.count > 0) {
                syncLogger.info({
                    orderNumber: shopifyOrder.name,
                    fulfillmentId: fulfillment.id,
                    updatedCount: result.count,
                    awbNumber,
                }, 'Synced fulfillment tracking via fallback (no line_items in fulfillment)');
            }
        }
    }

    // Promote shipped lines to delivered when Shopify says delivered
    // Check if any fulfillment has shipment_status 'delivered'
    const hasDeliveredFulfillment = fulfillments.some(
        f => f.shipment_status === 'delivered'
    );
    if (hasDeliveredFulfillment) {
        const promoted = await prisma.orderLine.updateMany({
            where: {
                orderId,
                lineStatus: 'shipped',
            },
            data: {
                lineStatus: 'delivered',
                deliveredAt: new Date(),
            },
        });
        if (promoted.count > 0) {
            syncLogger.info({
                orderNumber: shopifyOrder.name,
                promotedCount: promoted.count,
            }, 'Promoted shipped lines to delivered (Shopify confirmation)');
        }
    }

    return { synced: syncedCount, fulfillments: fulfillments.length };
}
