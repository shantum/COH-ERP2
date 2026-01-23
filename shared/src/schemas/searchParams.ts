/**
 * URL Search Parameter Schemas for COH ERP
 *
 * These Zod schemas are used for validating URL search parameters
 * in TanStack Router routes. All schemas use .catch() for graceful
 * fallback when invalid data is received (e.g., NaN, invalid enum values).
 *
 * Key patterns:
 * - z.coerce.number() for numeric params (handles string → number conversion)
 * - .catch(defaultValue) for graceful fallback on invalid input
 * - .optional() for truly optional fields
 * - Type exports via z.infer<> for type safety
 */

import { z } from 'zod';

// ============================================
// ORDERS PAGE SEARCH PARAMS
// ============================================

/**
 * Orders page search params
 * Validates view selection, pagination, and filters
 *
 * @example
 * /orders?view=shipped&page=2&shippedFilter=rto
 */
export const OrdersSearchParams = z.object({
    /** Current view: open, shipped, or cancelled */
    view: z.enum(['open', 'shipped', 'cancelled']).catch('open'),
    /** Page number for pagination */
    page: z.coerce.number().int().positive().catch(1),
    /** Items per page (Open: 500 default, Shipped/Cancelled: 100) */
    limit: z.coerce.number().int().positive().max(2000).catch(500),
    /** Search query string */
    search: z.string().optional().catch(undefined),
    /** Filter for shipped view: all, rto, cod_pending */
    shippedFilter: z.enum(['all', 'rto', 'cod_pending']).optional().catch(undefined),
    /** Days filter (e.g., shipped in last N days) */
    days: z.coerce.number().int().positive().optional().catch(undefined),
    /** Sort field */
    sortBy: z.string().optional().catch(undefined),
    /** Sort direction */
    sortOrder: z.enum(['asc', 'desc']).optional().catch(undefined),
    /** Order ID for highlighting/selecting a specific order */
    orderId: z.string().optional().catch(undefined),
    // Open view filters (URL-persisted for bookmarking/sharing)
    /** Allocation filter for Open view: all (default), allocated, pending */
    allocatedFilter: z.enum(['all', 'allocated', 'pending']).optional().catch(undefined),
    /** Production filter for Open view: all (default), scheduled, needs, ready */
    productionFilter: z.enum(['all', 'scheduled', 'needs', 'ready']).optional().catch(undefined),
    // URL-driven modal state (enables bookmarkable/shareable modals)
    /** Modal type: view, edit, ship, create, customer */
    modal: z.enum(['view', 'edit', 'ship', 'create', 'customer']).optional().catch(undefined),
    /** Modal mode (for sub-modes within modal) */
    modalMode: z.string().optional().catch(undefined),
});
export type OrdersSearchParams = z.infer<typeof OrdersSearchParams>;

// ============================================
// PRODUCTS PAGE SEARCH PARAMS
// ============================================

/**
 * Products page search params
 * Supports 8 tabs: products, materials, trims, services, bom, consumption, import, fabricMapping
 *
 * @example
 * /products?tab=bom&id=123e4567-e89b-12d3-a456-426614174000&type=product
 */
export const ProductsSearchParams = z.object({
    /** Active tab in products page */
    tab: z.enum(['products', 'materials', 'trims', 'services', 'bom', 'consumption', 'import', 'fabricMapping']).catch('products'),
    /** View mode for products tab */
    view: z.enum(['tree', 'flat']).catch('tree'),
    /** Selected item ID for master-detail views */
    id: z.string().optional().catch(undefined),
    /** Type of selected item */
    type: z.enum(['product', 'variation', 'sku', 'material', 'fabric', 'colour']).optional().catch(undefined),
});
export type ProductsSearchParams = z.infer<typeof ProductsSearchParams>;

// ============================================
// INVENTORY PAGE SEARCH PARAMS
// ============================================

/**
 * Inventory page search params
 */
export const InventorySearchParams = z.object({
    /** Search query for SKU/product name */
    search: z.string().optional().catch(undefined),
    /** Stock status filter */
    stockFilter: z.enum(['all', 'in_stock', 'low_stock', 'out_of_stock']).optional().catch(undefined),
});
export type InventorySearchParams = z.infer<typeof InventorySearchParams>;

// ============================================
// CUSTOMERS PAGE SEARCH PARAMS
// ============================================

/**
 * Customers page search params
 */
export const CustomersSearchParams = z.object({
    /** Search query for customer name/email/phone */
    search: z.string().optional().catch(undefined),
    /** Filter by customer tier */
    tier: z.enum(['all', 'new', 'bronze', 'silver', 'gold', 'platinum']).catch('all'),
    /** Page number */
    page: z.coerce.number().int().positive().catch(1),
    /** Items per page */
    limit: z.coerce.number().int().positive().max(500).catch(100),
    /** Customer view tab */
    tab: z.enum(['all', 'highValue', 'atRisk', 'returners']).optional().catch(undefined),
    /** Top N customers for high value view */
    topN: z.coerce.number().int().positive().optional().catch(undefined),
    /** Time period filter (months) for analytics */
    timePeriod: z.union([z.literal('all'), z.coerce.number().int().positive()]).optional().catch(undefined),
    // URL-driven modal state (enables bookmarkable/shareable modals)
    /** Modal type: view (customer profile), orders (order history) */
    modal: z.enum(['view', 'orders']).optional().catch(undefined),
    /** Customer ID for modal */
    customerId: z.string().optional().catch(undefined),
});
export type CustomersSearchParams = z.infer<typeof CustomersSearchParams>;

// ============================================
// PRODUCTION PAGE SEARCH PARAMS
// ============================================

/**
 * Production page search params
 */
export const ProductionSearchParams = z.object({
    /** Filter by batch status */
    status: z.enum(['all', 'planned', 'in_progress', 'completed', 'cancelled']).catch('all'),
    /** Page number */
    page: z.coerce.number().int().positive().catch(1),
    /** Items per page */
    limit: z.coerce.number().int().positive().max(500).catch(100),
    /** Production view tab */
    tab: z.enum(['schedule', 'capacity', 'tailors']).optional().catch(undefined),
});
export type ProductionSearchParams = z.infer<typeof ProductionSearchParams>;

// ============================================
// RETURNS PAGE SEARCH PARAMS
// ============================================

/**
 * Returns page search params
 */
export const ReturnsSearchParams = z.object({
    /** Filter by return status */
    status: z.enum(['all', 'pending', 'approved', 'received', 'processed', 'rejected']).catch('all'),
    /** Search query */
    search: z.string().optional().catch(undefined),
    /** Page number */
    page: z.coerce.number().int().positive().catch(1),
});
export type ReturnsSearchParams = z.infer<typeof ReturnsSearchParams>;

// ============================================
// ANALYTICS PAGE SEARCH PARAMS
// ============================================

/**
 * Analytics page search params
 */
export const AnalyticsSearchParams = z.object({
    /** Time range preset */
    range: z.enum(['7d', '30d', '90d', 'ytd', 'custom']).catch('30d'),
    /** Start date for custom range (YYYY-MM-DD) */
    startDate: z.string().optional().catch(undefined),
    /** End date for custom range (YYYY-MM-DD) */
    endDate: z.string().optional().catch(undefined),
});
export type AnalyticsSearchParams = z.infer<typeof AnalyticsSearchParams>;

// ============================================
// LEDGERS PAGE SEARCH PARAMS
// ============================================

/**
 * Ledgers page search params
 */
export const LedgersSearchParams = z.object({
    /** Transaction type filter */
    type: z.enum(['all', 'inward', 'outward', 'adjustment']).catch('all'),
    /** Search query */
    search: z.string().optional().catch(undefined),
    /** Page number */
    page: z.coerce.number().int().positive().catch(1),
});
export type LedgersSearchParams = z.infer<typeof LedgersSearchParams>;

// ============================================
// ORDER SEARCH PAGE SEARCH PARAMS
// ============================================

/**
 * Order search page search params
 */
export const OrderSearchSearchParams = z.object({
    /** Search query (order number, AWB, customer name) */
    q: z.string().optional().catch(undefined),
    /** Page number */
    page: z.coerce.number().int().positive().catch(1),
});
export type OrderSearchSearchParams = z.infer<typeof OrderSearchSearchParams>;

// ============================================
// EMPTY SEARCH PARAMS (for pages without params)
// ============================================

/**
 * Empty search params for pages that don't use URL params
 * Used for Dashboard, Settings, Users, etc.
 */
export const EmptySearchParams = z.object({});
export type EmptySearchParams = z.infer<typeof EmptySearchParams>;
