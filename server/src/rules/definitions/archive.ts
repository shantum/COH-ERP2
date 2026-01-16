/**
 * Archive Rules
 * Rules for archiving and unarchiving orders
 */

import { defineRule, simpleBooleanRule } from '../core/defineRule.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface ArchiveOrderData {
    order: {
        id: string;
        status: string;
        isArchived: boolean;
    };
}

// ============================================
// TERMINAL STATUSES
// ============================================

/**
 * Statuses that are considered terminal (can be archived)
 */
export const TERMINAL_STATUSES = ['shipped', 'delivered', 'cancelled'] as const;

// ============================================
// ARCHIVE RULES
// ============================================

/**
 * Order must not already be archived
 */
export const orderNotAlreadyArchived = simpleBooleanRule<ArchiveOrderData>({
    id: 'archive.order.not_already_archived',
    name: 'Order Not Already Archived',
    description: 'Order is already archived',
    category: 'archive',
    errorCode: 'ALREADY_ARCHIVED',
    operations: ['archiveOrder'],
    condition: ({ data }) => !data.order.isArchived,
});

/**
 * Order must be in terminal state to archive
 */
export const orderTerminalStateRequired = defineRule<ArchiveOrderData>({
    id: 'archive.order.terminal_state_required',
    name: 'Terminal State Required',
    description: 'Order must be in a terminal state to archive',
    category: 'archive',
    errorCode: 'INVALID_STATUS_FOR_ARCHIVE',
    operations: ['archiveOrder'],
    evaluate: async ({ data }) => {
        if (TERMINAL_STATUSES.includes(data.order.status as typeof TERMINAL_STATUSES[number])) {
            return true;
        }
        return {
            passed: false,
            message: `Order must be in a terminal state to archive (current: ${data.order.status})`,
        };
    },
});

// ============================================
// UNARCHIVE RULES
// ============================================

/**
 * Order must be archived to unarchive
 */
export const orderMustBeArchived = simpleBooleanRule<ArchiveOrderData>({
    id: 'unarchive.order.must_be_archived',
    name: 'Order Must Be Archived',
    description: 'Order is not archived',
    category: 'archive',
    errorCode: 'NOT_ARCHIVED',
    operations: ['unarchiveOrder'],
    condition: ({ data }) => data.order.isArchived,
});

// ============================================
// EXPORTS
// ============================================

/**
 * All archive rules
 */
export const archiveRules = [
    orderNotAlreadyArchived,
    orderTerminalStateRequired,
    orderMustBeArchived,
];
