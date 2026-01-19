/**
 * Constants for OrdersTable component
 */

// All column IDs in display order
export const ALL_COLUMN_IDS = [
    'orderInfo', 'customerInfo', 'paymentInfo', 'shipByDate',
    'tags', 'customerNotes', 'customerTags', 'productName', 'customize', 'qty', 'assignStock', 'fabricBalance',
    'workflow', 'pickPack', 'production', 'notes', 'cancelLine',
    'shopifyTracking', 'trackingInfo', 'trackingStatus',
] as const;

export type ColumnId = typeof ALL_COLUMN_IDS[number];

// Columns shown by default in Open view
export const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = [
    'orderInfo', 'customerInfo', 'paymentInfo', 'shipByDate', 'tags', 'customerNotes', 'customerTags',
    'productName', 'qty', 'assignStock', 'workflow', 'pickPack', 'production', 'notes', 'cancelLine',
    'shopifyTracking', 'trackingInfo',
];

// Default column headers
export const DEFAULT_HEADERS: Record<string, string> = {
    orderInfo: 'Order',
    customerInfo: 'Customer',
    paymentInfo: 'Payment',
    shipByDate: 'Ship By',
    tags: 'Tags',
    customerNotes: 'Order Notes',
    customerTags: 'Cust Tags',
    productName: 'Product',
    customize: 'Custom',
    qty: 'Qty/Stock',
    assignStock: 'Allocate',
    fabricBalance: 'Fabric',
    workflow: 'Workflow',
    pickPack: 'Fulfillment',
    production: 'Production',
    notes: 'Notes',
    cancelLine: 'Cance',
    shopifyTracking: 'Shopify',
    trackingInfo: 'COH AWB',
    trackingStatus: 'Tracking',
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
    customerInfo: 160,
    paymentInfo: 100,
    shipByDate: 70,
    tags: 100,
    customerNotes: 140,
    customerTags: 100,
    productName: 240,
    customize: 50,
    qty: 75,
    assignStock: 90,
    fabricBalance: 60,
    workflow: 120,
    pickPack: 160,
    production: 90,
    notes: 120,
    cancelLine: 40,
    shopifyTracking: 100,
    trackingInfo: 130,
    trackingStatus: 80,
};

// Row height for virtualization
export const ROW_HEIGHT = 40;
export const HEADER_HEIGHT = 24;

// Table ID for localStorage
export const TABLE_ID = 'ordersTable';
