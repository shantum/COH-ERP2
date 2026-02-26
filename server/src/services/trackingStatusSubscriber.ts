/**
 * Tracking Status Subscriber
 *
 * Handles all DB side effects when a tracking status changes.
 * Registered as an onStatusChange callback on the TrackingCacheService.
 *
 * Extracted from trackingSync.ts — same logic, decoupled from fetch concerns.
 */

import prisma from '../lib/prisma.js';
import { recomputeOrderStatus } from '../utils/orderStatus.js';
import { updateCustomerTier } from '../utils/tierUtils.js';
import { trackingLogger } from '../utils/logger.js';
import type { TrackingStatus } from '../config/types.js';
import type { CacheEntry } from './trackingCacheService.js';

// ============================================
// TYPES
// ============================================

interface LineUpdateData {
    trackingStatus: TrackingStatus | null;
    lastTrackingUpdate: Date;
    deliveredAt?: Date;
    rtoInitiatedAt?: Date;
    rtoReceivedAt?: Date;
}

// ============================================
// MAIN CALLBACK
// ============================================

/**
 * Handle a tracking status change for an AWB.
 *
 * Called by TrackingCacheService whenever internalStatus differs from previous.
 * Performs all DB writes and side effects:
 *   1. Update OrderLine tracking fields
 *   2. Promote lineStatus shipped → delivered
 *   3. Increment customer rtoCount on first RTO
 *   4. Recompute Order.status from lines
 *   5. Update customer tier on RTO
 *   6. Log domain events
 */
export async function handleTrackingStatusChange(
    awb: string,
    entry: CacheEntry,
    previousStatus: TrackingStatus | null,
): Promise<void> {
    const { orderInfo, internalStatus, rawResponse } = entry;

    // Skip if no order context (ad-hoc lookups)
    if (!orderInfo.orderId) return;

    const lineUpdateData: LineUpdateData = {
        trackingStatus: internalStatus,
        lastTrackingUpdate: new Date(),
    };

    const lastScanDatetime = rawResponse.last_scan_details?.status_date_time;

    // Set delivery timestamp
    if (internalStatus === 'delivered') {
        lineUpdateData.deliveredAt = lastScanDatetime
            ? new Date(lastScanDatetime)
            : new Date();
    }

    // Set RTO timestamps
    const isRto = !!rawResponse.return_tracking_no
        || (rawResponse.last_scan_details?.status || '').toLowerCase().includes('rto')
        || internalStatus?.startsWith('rto_');

    if (isRto && !orderInfo.rtoInitiatedAt) {
        lineUpdateData.rtoInitiatedAt = lastScanDatetime
            ? new Date(lastScanDatetime)
            : new Date();
    }
    if (internalStatus === 'rto_delivered') {
        lineUpdateData.rtoReceivedAt = lastScanDatetime
            ? new Date(lastScanDatetime)
            : new Date();
    }

    // 1. Update all OrderLines with this AWB
    await prisma.orderLine.updateMany({
        where: { awbNumber: awb },
        data: lineUpdateData,
    });

    // 2. Promote lineStatus shipped → delivered
    if (internalStatus === 'delivered') {
        await prisma.orderLine.updateMany({
            where: { awbNumber: awb, lineStatus: 'shipped' },
            data: {
                lineStatus: 'delivered',
                deliveredAt: lineUpdateData.deliveredAt || new Date(),
            },
        });
        trackingLogger.info({ orderNumber: orderInfo.orderNumber }, 'Promoted shipped lines to delivered');
    }

    // 3. Increment customer RTO count on first RTO initiation
    const isNewRto = lineUpdateData.rtoInitiatedAt && !orderInfo.rtoInitiatedAt;
    if (isNewRto && orderInfo.customerId) {
        await prisma.customer.update({
            where: { id: orderInfo.customerId },
            data: { rtoCount: { increment: 1 } },
        });
        trackingLogger.info({ customerId: orderInfo.customerId }, 'Incremented customer rtoCount');
    }

    // 4. Recompute Order.status from lines (single source of truth)
    await recomputeOrderStatus(orderInfo.orderId);

    // 5. Update customer tier on RTO
    if (isNewRto && orderInfo.customerId) {
        await updateCustomerTier(prisma, orderInfo.customerId);
    }

    // 6. Log domain events for significant milestones
    if (internalStatus === 'delivered' || internalStatus === 'picked_up' || internalStatus === 'rto_initiated' || internalStatus === 'rto_delivered') {
        const eventMap: Record<string, string> = {
            delivered: 'shipment.delivered',
            picked_up: 'shipment.picked_up',
            rto_initiated: 'shipment.rto',
            rto_delivered: 'shipment.rto_delivered',
        };
        const summaryMap: Record<string, string> = {
            delivered: `Order #${orderInfo.orderNumber} delivered — AWB ${awb}`,
            picked_up: `Order #${orderInfo.orderNumber} picked up — AWB ${awb}`,
            rto_initiated: `RTO initiated for #${orderInfo.orderNumber} — AWB ${awb}`,
            rto_delivered: `RTO received for #${orderInfo.orderNumber} — AWB ${awb}`,
        };

        import('@coh/shared/services/eventLog').then(({ logEvent }) =>
            logEvent({
                domain: 'shipping',
                event: eventMap[internalStatus] ?? internalStatus,
                entityType: 'Order',
                entityId: orderInfo.orderId,
                summary: summaryMap[internalStatus] ?? `Tracking update: ${internalStatus}`,
                meta: { awbNumber: awb, trackingStatus: internalStatus, courier: rawResponse.logistic },
            }),
        ).catch(() => {});
    }

    trackingLogger.debug({
        awb,
        orderNumber: orderInfo.orderNumber,
        previousStatus,
        newStatus: internalStatus,
    }, 'Status change processed');
}
