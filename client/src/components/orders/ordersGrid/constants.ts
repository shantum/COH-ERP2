/**
 * Constants for OrdersGrid component
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

// Customer tier styles
export const TIER_STYLES = {
    NEW: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'NEW' },
    bronze: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Bronze' },
    silver: { bg: 'bg-slate-200', text: 'text-slate-700', label: 'Silver' },
    gold: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Gold' },
    platinum: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Platinum' },
} as const;

// Row status colors for styling
export const ROW_STATUS_COLORS = {
    pending: { background: '#f9fafb', border: '#d1d5db' },
    production: { background: '#fef3c7', border: '#f59e0b' },
    readyToAllocate: { background: '#f0fdf4', border: '#86efac' },
    allocated: { background: '#f3e8ff', border: '#a855f7' },
    picked: { background: '#ccfbf1', border: '#14b8a6' },
    packed: { background: '#dbeafe', border: '#3b82f6' },
    markedShipped: { background: '#bbf7d0', border: '#10b981' },
} as const;

// Status legend items for the StatusLegend component
export const STATUS_LEGEND_ITEMS = [
    { color: '#f9fafb', border: '#d1d5db', label: 'Pending (no stock)', desc: 'Waiting for inventory' },
    { color: '#fef3c7', border: '#f59e0b', label: 'In Production', desc: 'Has production date set' },
    { color: '#f0fdf4', border: '#86efac', label: 'Ready to Allocate', desc: 'Has stock available' },
    { color: '#f3e8ff', border: '#a855f7', label: 'Allocated', desc: 'Stock reserved' },
    { color: '#ccfbf1', border: '#14b8a6', label: 'Picked', desc: 'Ready to pack' },
    { color: '#dbeafe', border: '#3b82f6', label: 'Packed', desc: 'Ready to ship - enter AWB' },
    { color: '#bbf7d0', border: '#10b981', label: 'Marked Shipped', desc: 'Pending batch process' },
];
