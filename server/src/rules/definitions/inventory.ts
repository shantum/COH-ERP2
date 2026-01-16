/**
 * Inventory Rules
 * Rules for order line allocation/unallocation operations
 */

import { defineRule, simpleBooleanRule } from '../core/defineRule.js';
import { calculateInventoryBalance } from '../../utils/queryPatterns.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface AllocateLineData {
    line: {
        id: string;
        lineStatus: string;
        skuId: string;
        qty: number;
    };
}

interface AllocateLinesData {
    lines: Array<{
        id: string;
        lineStatus: string;
        skuId: string;
        qty: number;
    }>;
}

interface UnallocateLineData {
    line: {
        id: string;
        lineStatus: string;
    };
}

// ============================================
// ALLOCATE RULES - STATUS VALIDATION
// ============================================

/**
 * Line must be in pending status to allocate
 */
export const lineStatusMustBePending = simpleBooleanRule<AllocateLineData>({
    id: 'allocate.line_status_must_be_pending',
    name: 'Line Status Must Be Pending',
    description: 'Line must be in pending status to allocate',
    category: 'inventory',
    errorCode: 'INVALID_STATUS_FOR_ALLOCATE',
    operations: ['allocateLine'],
    condition: ({ data }) => data.line.lineStatus === 'pending',
});

/**
 * All lines must be in pending status for bulk allocation
 */
export const allLinesMustBePending = defineRule<AllocateLinesData>({
    id: 'allocate.all_lines_must_be_pending',
    name: 'All Lines Must Be Pending',
    description: 'All lines must be in pending status to allocate',
    category: 'inventory',
    errorCode: 'INVALID_STATUS_FOR_ALLOCATE',
    operations: ['allocateLine'],
    evaluate: async ({ data }) => {
        const invalidLines = data.lines.filter(l => l.lineStatus !== 'pending');
        if (invalidLines.length === 0) return true;

        const statuses = [...new Set(invalidLines.map(l => l.lineStatus))];
        return {
            passed: false,
            message: `${invalidLines.length} line(s) not in pending status (found: ${statuses.join(', ')})`,
        };
    },
});

// ============================================
// ALLOCATE RULES - STOCK VALIDATION
// ============================================

/**
 * Sufficient stock must be available for allocation
 * This is an async rule that checks inventory balance
 */
export const sufficientStockAvailable = defineRule<AllocateLineData>({
    id: 'allocate.sufficient_stock_available',
    name: 'Sufficient Stock Available',
    description: 'Insufficient stock available for allocation',
    category: 'inventory',
    phase: 'transaction', // Runs within transaction for accurate check
    errorCode: 'INSUFFICIENT_STOCK',
    operations: ['allocateLine'],
    evaluate: async ({ prisma, data }) => {
        const balance = await calculateInventoryBalance(prisma, data.line.skuId);

        if (balance.availableBalance >= data.line.qty) {
            return true;
        }

        return {
            passed: false,
            message: `Insufficient stock: ${balance.availableBalance} available, ${data.line.qty} required`,
        };
    },
});

// ============================================
// UNALLOCATE RULES
// ============================================

/**
 * Line must be allocated to unallocate
 */
export const lineMustBeAllocated = simpleBooleanRule<UnallocateLineData>({
    id: 'unallocate.line_must_be_allocated',
    name: 'Line Must Be Allocated',
    description: 'Line must be allocated to unallocate',
    category: 'inventory',
    errorCode: 'LINE_NOT_ALLOCATED',
    operations: ['unallocateLine'],
    condition: ({ data }) => data.line.lineStatus === 'allocated',
});

// ============================================
// EXPORTS
// ============================================

/**
 * All inventory rules
 */
export const inventoryRules = [
    // Allocate status rules
    lineStatusMustBePending,
    allLinesMustBePending,
    // Stock validation
    sufficientStockAvailable,
    // Unallocate rules
    lineMustBeAllocated,
];
