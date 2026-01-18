/**
 * Constants for OrdersTable component
 */

// All column IDs in display order (includes post-ship columns)
export const ALL_COLUMN_IDS = [
    'orderCustomer', 'shipByDate', 'paymentInfo',
    'tags', 'customerNotes', 'customerTags', 'productName', 'customize', 'qty', 'skuStock', 'fabricBalance',
    'allocate', 'production', 'notes', 'pick', 'pack', 'ship', 'cancelLine',
    'shopifyTracking', 'awb', 'courier', 'trackingStatus',
    // Post-ship columns (for shipped/archived views)
    'shippedAt', 'deliveredAt', 'deliveryDays', 'daysInTransit',
    'rtoInitiatedAt', 'daysInRto', 'daysSinceDelivery', 'codRemittedAt',
    'archivedAt', 'finalStatus',
] as const;

export type ColumnId = typeof ALL_COLUMN_IDS[number];

// Columns shown by default
export const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = [
    'orderCustomer', 'paymentInfo', 'productName',
    'qty', 'skuStock', 'allocate', 'production', 'notes', 'pick', 'pack', 'ship', 'cancelLine',
    'shopifyTracking', 'awb', 'courier', 'trackingStatus',
];

// Default column headers
export const DEFAULT_HEADERS: Record<string, string> = {
    orderCustomer: 'Order',
    shipByDate: 'Ship By',
    paymentInfo: 'Payment',
    tags: 'Tags',
    customerNotes: 'Order Notes',
    customerTags: 'Customer Tags',
    productName: 'Product',
    customize: 'Custom',
    qty: 'Qty',
    skuStock: 'Stock',
    fabricBalance: 'Fabric',
    allocate: 'Alloc',
    production: 'Production',
    notes: 'Notes',
    pick: 'Pick',
    pack: 'Pack',
    ship: 'Ship',
    cancelLine: 'Cancel',
    shopifyTracking: 'Shopify',
    awb: 'AWB',
    courier: 'Courier',
    trackingStatus: 'Tracking',
    // Post-ship columns
    shippedAt: 'Shipped',
    deliveredAt: 'Delivered',
    deliveryDays: 'Del Days',
    daysInTransit: 'Transit',
    rtoInitiatedAt: 'RTO Date',
    daysInRto: 'RTO Days',
    daysSinceDelivery: 'Since Del',
    codRemittedAt: 'COD Remitted',
    archivedAt: 'Archived',
    finalStatus: 'Status',
    actions: 'Actions',
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

// Default column widths (compact for small screens)
export const DEFAULT_COLUMN_WIDTHS: Partial<Record<ColumnId | string, number>> = {
    orderCustomer: 220,
    shipByDate: 65,
    paymentInfo: 130,
    tags: 80,
    customerNotes: 120,
    customerTags: 100,
    productName: 220,
    customize: 50,
    qty: 30,
    skuStock: 45,
    fabricBalance: 50,
    allocate: 35,
    production: 70,
    notes: 100,
    pick: 30,
    pack: 30,
    ship: 30,
    cancelLine: 35,
    shopifyTracking: 120,
    awb: 100,
    courier: 70,
    trackingStatus: 80,
    shippedAt: 70,
    deliveredAt: 70,
    deliveryDays: 50,
    daysInTransit: 50,
    rtoInitiatedAt: 70,
    daysInRto: 50,
    daysSinceDelivery: 60,
    codRemittedAt: 80,
    archivedAt: 70,
    finalStatus: 65,
};

// Row height for virtualization
export const ROW_HEIGHT = 36;
export const HEADER_HEIGHT = 24;

// Table ID for localStorage
export const TABLE_ID = 'ordersTable';
