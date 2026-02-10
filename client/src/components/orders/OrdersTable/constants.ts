/**
 * Constants for OrdersTable component
 */

// All column IDs in display order
export const ALL_COLUMN_IDS = [
    'orderInfo', 'channel', 'customerInfo', 'paymentInfo',
    'productName', 'qty', 'unitPrice', 'cost', 'margin', 'fabricColour', 'fabricBalance',
    'trackingInfo', 'trackingStatus', 'notes',
] as const;

export type ColumnId = typeof ALL_COLUMN_IDS[number];

// Columns shown by default
export const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = [
    'orderInfo', 'channel', 'customerInfo', 'paymentInfo',
    'productName', 'qty', 'unitPrice', 'cost', 'margin', 'fabricColour', 'fabricBalance',
    'trackingInfo', 'trackingStatus', 'notes',
];

// Default column headers
export const DEFAULT_HEADERS: Record<string, string> = {
    orderInfo: 'Order',
    channel: 'Channel',
    customerInfo: 'Customer',
    paymentInfo: 'Payment',
    productName: 'Product',
    qty: 'Qty',
    unitPrice: 'Price',
    cost: 'Cost',
    margin: 'Margin',
    fabricColour: 'Fabric',
    fabricBalance: 'Fab Bal',
    trackingInfo: 'AWB',
    trackingStatus: 'Tracking',
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
    qty: 50,
    unitPrice: 75,
    cost: 75,
    margin: 55,
    fabricColour: 100,
    fabricBalance: 60,
    trackingInfo: 130,
    trackingStatus: 80,
    notes: 120,
};

// Row height for virtualization
export const ROW_HEIGHT = 40;
export const HEADER_HEIGHT = 24;

// Table ID for localStorage
export const TABLE_ID = 'ordersTable';
