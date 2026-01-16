/**
 * Fulfillment Stage Enrichment
 * Calculate fulfillment stage based on order line statuses
 */

import type { FulfillmentStage } from './types.js';
import type { OrderLineForFulfillment } from '../patterns/types.js';

/**
 * Calculate fulfillment stage based on order line statuses
 */
export function calculateFulfillmentStage(orderLines: OrderLineForFulfillment[]): FulfillmentStage {
    if (!orderLines || orderLines.length === 0) return 'pending';

    const lineStatuses = orderLines.map((l) => l.lineStatus);

    if (lineStatuses.every((s) => s === 'packed')) {
        return 'ready_to_ship';
    }
    if (lineStatuses.some((s) => ['picked', 'packed'].includes(s as string))) {
        return 'in_progress';
    }
    if (lineStatuses.every((s) => s === 'allocated')) {
        return 'allocated';
    }
    return 'pending';
}
