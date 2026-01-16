/**
 * Line Status Counts Enrichment
 * Calculate status breakdown for order lines
 */

import type { LineStatusCounts } from './types.js';
import type { OrderLineForFulfillment } from '../patterns/types.js';

/**
 * Calculate line status counts for an order
 */
export function calculateLineStatusCounts(orderLines: OrderLineForFulfillment[]): LineStatusCounts {
    if (!orderLines || orderLines.length === 0) {
        return { totalLines: 0, pendingLines: 0, allocatedLines: 0, pickedLines: 0, packedLines: 0 };
    }

    const lineStatuses = orderLines.map((l) => l.lineStatus);

    return {
        totalLines: orderLines.length,
        pendingLines: lineStatuses.filter((s) => s === 'pending').length,
        allocatedLines: lineStatuses.filter((s) => s === 'allocated').length,
        pickedLines: lineStatuses.filter((s) => s === 'picked').length,
        packedLines: lineStatuses.filter((s) => s === 'packed').length,
    };
}
