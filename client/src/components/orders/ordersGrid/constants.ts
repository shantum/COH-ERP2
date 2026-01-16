/**
 * Non-styling constants for OrdersGrid component
 *
 * NOTE: Styling constants (colors, status styles) have moved to ./formatting/
 */

// All column IDs in display order (includes post-ship columns)
export const ALL_COLUMN_IDS = [
    'orderDate', 'orderAge', 'shipByDate', 'orderNumber', 'customerName', 'city', 'orderValue',
    'discountCode', 'tags', 'paymentMethod', 'rtoHistory', 'customerNotes', 'customerOrderCount',
    'customerLtv', 'customerTags', 'skuCode', 'productName', 'customize', 'qty', 'skuStock', 'fabricBalance',
    'allocate', 'production', 'notes', 'pick', 'pack', 'ship', 'cancelLine', 'shopifyStatus',
    'shopifyAwb', 'shopifyCourier', 'awb', 'courier', 'trackingStatus',
    // Post-ship columns (for shipped/archived views)
    'shippedAt', 'deliveredAt', 'deliveryDays', 'daysInTransit',
    'rtoInitiatedAt', 'daysInRto', 'daysSinceDelivery', 'codRemittedAt',
    'archivedAt', 'finalStatus',
];

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
];
