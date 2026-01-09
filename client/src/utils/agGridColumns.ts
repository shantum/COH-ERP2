/**
 * AG-Grid Column Builders
 * Reusable column definition builders to reduce duplication across grid pages
 * 
 * Usage:
 * import { createSkuColumn, createAmountColumn } from '../utils/agGridColumns';
 * 
 * const columnDefs = [
 *     createSkuColumn(),
 *     createCustomerColumn(),
 *     createAmountColumn('totalAmount', 'Total'),
 * ];
 */

import type { ColDef } from 'ag-grid-community';
import { formatCurrency, formatDate, formatRelativeTime } from './agGridHelpers';

// ============================================
// BASIC COLUMNS
// ============================================

/**
 * SKU code column with optional image
 */
export const createSkuColumn = (options: Partial<ColDef> = {}): ColDef => ({
    field: 'skuCode',
    headerName: 'SKU',
    width: 120,
    pinned: 'left',
    filter: 'agTextColumnFilter',
    ...options,
});

/**
 * Customer name column
 */
export const createCustomerColumn = (options: Partial<ColDef> = {}): ColDef => ({
    field: 'customerName',
    headerName: 'Customer',
    width: 180,
    filter: 'agTextColumnFilter',
    ...options,
});

/**
 * Order number column
 */
export const createOrderNumberColumn = (options: Partial<ColDef> = {}): ColDef => ({
    field: 'orderNumber',
    headerName: 'Order #',
    width: 130,
    pinned: 'left',
    filter: 'agTextColumnFilter',
    ...options,
});

/**
 * Email column
 */
export const createEmailColumn = (field: string = 'customerEmail', options: Partial<ColDef> = {}): ColDef => ({
    field,
    headerName: 'Email',
    width: 200,
    filter: 'agTextColumnFilter',
    ...options,
});

/**
 * Phone column
 */
export const createPhoneColumn = (field: string = 'customerPhone', options: Partial<ColDef> = {}): ColDef => ({
    field,
    headerName: 'Phone',
    width: 140,
    filter: 'agTextColumnFilter',
    ...options,
});

// ============================================
// NUMERIC COLUMNS
// ============================================

/**
 * Currency/amount column with formatting
 */
export const createAmountColumn = (
    field: string,
    headerName: string,
    options: Partial<ColDef> = {}
): ColDef => ({
    field,
    headerName,
    width: 120,
    type: 'numericColumn',
    valueFormatter: (params) => formatCurrency(params.value),
    filter: 'agNumberColumnFilter',
    ...options,
});

/**
 * Quantity column
 */
export const createQuantityColumn = (
    field: string = 'qty',
    headerName: string = 'Qty',
    options: Partial<ColDef> = {}
): ColDef => ({
    field,
    headerName,
    width: 80,
    type: 'numericColumn',
    filter: 'agNumberColumnFilter',
    ...options,
});

/**
 * Generic number column
 */
export const createNumberColumn = (
    field: string,
    headerName: string,
    options: Partial<ColDef> = {}
): ColDef => ({
    field,
    headerName,
    width: 100,
    type: 'numericColumn',
    filter: 'agNumberColumnFilter',
    ...options,
});

// ============================================
// DATE COLUMNS
// ============================================

/**
 * Date column with formatting
 */
export const createDateColumn = (
    field: string,
    headerName: string,
    options: Partial<ColDef> = {}
): ColDef => ({
    field,
    headerName,
    width: 140,
    valueFormatter: (params) => formatDate(params.value),
    filter: 'agDateColumnFilter',
    ...options,
});

/**
 * Relative time column (e.g., "2 days ago")
 */
export const createRelativeDateColumn = (
    field: string,
    headerName: string,
    options: Partial<ColDef> = {}
): ColDef => ({
    field,
    headerName,
    width: 140,
    valueFormatter: (params) => formatRelativeTime(params.value),
    filter: 'agDateColumnFilter',
    ...options,
});

// ============================================
// STATUS & BADGE COLUMNS
// ============================================

/**
 * Status column with badge rendering
 */
export const createStatusColumn = (
    field: string = 'status',
    headerName: string = 'Status',
    options: Partial<ColDef> = {}
): ColDef => ({
    field,
    headerName,
    width: 130,
    cellRenderer: 'StatusBadge',
    filter: 'agTextColumnFilter',
    ...options,
});

/**
 * Tracking status column
 */
export const createTrackingStatusColumn = (options: Partial<ColDef> = {}): ColDef => ({
    field: 'trackingStatus',
    headerName: 'Tracking',
    width: 140,
    cellRenderer: 'TrackingStatusBadge',
    filter: 'agTextColumnFilter',
    ...options,
});

/**
 * Payment method column
 */
export const createPaymentMethodColumn = (options: Partial<ColDef> = {}): ColDef => ({
    field: 'paymentMethod',
    headerName: 'Payment',
    width: 110,
    cellRenderer: (params: any) => {
        const method = params.value;
        const colorClass = method === 'COD' ? 'text-orange-600' : 'text-green-600';
        return `<span class="${colorClass} font-medium">${method || '-'}</span>`;
    },
    filter: 'agTextColumnFilter',
    ...options,
});

// ============================================
// BOOLEAN COLUMNS
// ============================================

/**
 * Boolean column with checkmark/cross
 */
export const createBooleanColumn = (
    field: string,
    headerName: string,
    options: Partial<ColDef> = {}
): ColDef => ({
    field,
    headerName,
    width: 100,
    cellRenderer: (params: any) => {
        return params.value
            ? '<span class="text-green-600">✓</span>'
            : '<span class="text-gray-400">✗</span>';
    },
    filter: 'agSetColumnFilter',
    ...options,
});

// ============================================
// SPECIAL COLUMNS
// ============================================

/**
 * AWB/Tracking number column
 */
export const createAwbColumn = (options: Partial<ColDef> = {}): ColDef => ({
    field: 'awbNumber',
    headerName: 'AWB',
    width: 150,
    filter: 'agTextColumnFilter',
    ...options,
});

/**
 * Courier column
 */
export const createCourierColumn = (options: Partial<ColDef> = {}): ColDef => ({
    field: 'courier',
    headerName: 'Courier',
    width: 120,
    filter: 'agTextColumnFilter',
    ...options,
});

/**
 * Notes/comments column
 */
export const createNotesColumn = (
    field: string = 'internalNotes',
    headerName: string = 'Notes',
    options: Partial<ColDef> = {}
): ColDef => ({
    field,
    headerName,
    width: 200,
    filter: 'agTextColumnFilter',
    wrapText: true,
    autoHeight: true,
    ...options,
});

/**
 * Actions column (for buttons)
 */
export const createActionsColumn = (
    cellRenderer: any,
    options: Partial<ColDef> = {}
): ColDef => ({
    headerName: 'Actions',
    width: 120,
    pinned: 'right',
    cellRenderer,
    sortable: false,
    filter: false,
    ...options,
});

// ============================================
// TIER/PRIORITY COLUMNS
// ============================================

/**
 * Customer tier column with color coding
 */
export const createTierColumn = (options: Partial<ColDef> = {}): ColDef => ({
    field: 'customerTier',
    headerName: 'Tier',
    width: 100,
    cellRenderer: (params: any) => {
        const tier = params.value;
        const colors: Record<string, string> = {
            platinum: 'bg-purple-100 text-purple-800',
            gold: 'bg-yellow-100 text-yellow-800',
            silver: 'bg-gray-100 text-gray-800',
            bronze: 'bg-orange-100 text-orange-800',
        };
        const colorClass = colors[tier] || 'bg-gray-100 text-gray-600';
        return `<span class="px-2 py-1 rounded text-xs font-medium ${colorClass}">${tier || '-'}</span>`;
    },
    filter: 'agSetColumnFilter',
    ...options,
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Create a set of common order columns
 */
export const createOrderColumns = (): ColDef[] => [
    createOrderNumberColumn(),
    createCustomerColumn(),
    createDateColumn('orderDate', 'Order Date'),
    createAmountColumn('totalAmount', 'Total'),
    createPaymentMethodColumn(),
    createStatusColumn(),
];

/**
 * Create a set of common SKU columns
 */
export const createSkuColumns = (): ColDef[] => [
    createSkuColumn(),
    createQuantityColumn(),
    createAmountColumn('unitPrice', 'Price'),
];
