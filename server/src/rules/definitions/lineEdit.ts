/**
 * Line Edit Rules
 * Rules for editing and adding order lines
 */

import { simpleBooleanRule, defineRule } from '../core/defineRule.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface EditLineData {
    line: {
        id: string;
        lineStatus: string;
    };
    hasQtyOrPriceChange: boolean;
}

interface AddLineData {
    order: {
        id: string;
        status: string;
    };
}

// ============================================
// EDIT LINE RULES
// ============================================

/**
 * Line must be in editable status to change qty/price
 * Notes can be edited regardless of status
 */
export const lineEditableStatus = defineRule<EditLineData>({
    id: 'lineEdit.line_editable_status',
    name: 'Line Editable Status',
    description: 'Can only edit qty/price on pending lines',
    category: 'lineEdit',
    errorCode: 'INVALID_STATUS_FOR_EDIT',
    operations: ['editLine'],
    evaluate: async ({ data }) => {
        // If not editing qty or price, allow regardless of status
        if (!data.hasQtyOrPriceChange) {
            return true;
        }

        // qty/price changes require pending status
        if (data.line.lineStatus === 'pending') {
            return true;
        }

        return {
            passed: false,
            message: `Can only edit qty/price on pending lines (current: ${data.line.lineStatus})`,
        };
    },
});

/**
 * Cannot edit shipped lines (even notes should be restricted for shipped)
 */
export const lineNotShippedForEdit = simpleBooleanRule<EditLineData>({
    id: 'lineEdit.line_not_shipped',
    name: 'Cannot Edit Shipped Line',
    description: 'Cannot edit shipped lines',
    category: 'lineEdit',
    errorCode: 'CANNOT_EDIT_SHIPPED',
    operations: ['editLine'],
    condition: ({ data }) => data.line.lineStatus !== 'shipped',
});

// ============================================
// ADD LINE RULES
// ============================================

/**
 * Order must be open to add lines
 */
export const orderOpenForAddLine = defineRule<AddLineData>({
    id: 'lineEdit.order_open_for_add_line',
    name: 'Order Must Be Open',
    description: 'Can only add lines to open orders',
    category: 'lineEdit',
    errorCode: 'INVALID_STATUS_FOR_ADD_LINE',
    operations: ['addLine'],
    evaluate: async ({ data }) => {
        if (data.order.status === 'open') {
            return true;
        }

        return {
            passed: false,
            message: `Can only add lines to open orders (current: ${data.order.status})`,
        };
    },
});

// ============================================
// EXPORTS
// ============================================

/**
 * All line edit rules
 */
export const lineEditRules = [
    // Edit rules
    lineEditableStatus,
    lineNotShippedForEdit,
    // Add rules
    orderOpenForAddLine,
];
