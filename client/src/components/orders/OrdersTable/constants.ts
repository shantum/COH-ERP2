/**
 * Constants for OrdersTable component
 */

// All column IDs in display order
export const ALL_COLUMN_IDS = [
    'orderInfo', 'channel', 'customerInfo', 'paymentInfo',
    'productName',
    'fulfillment', 'notes',
] as const;

export type ColumnId = typeof ALL_COLUMN_IDS[number];

// Columns shown by default
export const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = [
    'orderInfo', 'customerInfo', 'paymentInfo',
    'productName',
    'fulfillment', 'notes',
];

// Default column headers
export const DEFAULT_HEADERS: Record<string, string> = {
    orderInfo: 'Order',
    channel: 'Channel',
    customerInfo: 'Customer',
    paymentInfo: 'Payment',
    productName: 'Product',
    fulfillment: 'Fulfillment',
    notes: 'Notes',
};

// Common courier options
export const COURIER_OPTIONS = [
    'Delhivery',
    'BlueDart',
    'DTDC',
    'Ekart',
    'Xpressbees',
    'Shadowfax',
    'Ecom Express',
    'Other',
] as const;

// Default column widths
export const DEFAULT_COLUMN_WIDTHS: Partial<Record<ColumnId | string, number>> = {
    orderInfo: 130,
    channel: 65,
    customerInfo: 160,
    paymentInfo: 100,
    productName: 240,
    fulfillment: 160,
    notes: 140,
};

// Status configuration for visual display
export interface StatusConfig {
    bg: string;
    text: string;
    border: string;
    label: string;
    icon?: string;
}

export const LINE_STATUS_CONFIG: Record<string, StatusConfig> = {
    pending: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', label: 'Pending' },
    allocated: { bg: 'bg-sky-100', text: 'text-sky-700', border: 'border-sky-200', label: 'Allocated' },
    picked: { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200', label: 'Picked' },
    packed: { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-200', label: 'Packed' },
    shipped: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Shipped' },
    delivered: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200', label: 'Delivered' },
    cancelled: { bg: 'bg-red-100', text: 'text-red-600', border: 'border-red-200', label: 'Cancelled' },
};

export interface AddressData {
    first_name?: string;
    last_name?: string;
    name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
    phone?: string;
}

// Row height for virtualization
export const ROW_HEIGHT = 52;
export const HEADER_HEIGHT = 24;

// Table ID for localStorage
export const TABLE_ID = 'ordersTable';
