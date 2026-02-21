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
 * /orders?view=shipped&page=2
 */
export const OrdersSearchParams = z.object({
    /** Current view: all, in_transit, delivered, rto, or cancelled */
    view: z.enum(['all', 'in_transit', 'delivered', 'rto', 'cancelled']).catch('all'),
    /** Page number for pagination */
    page: z.coerce.number().int().positive().catch(1),
    /** Items per page (defaults to 250) */
    limit: z.coerce.number().int().positive().max(1000).optional().transform(v => v ?? 250),
    /** Search query string */
    search: z.string().optional().catch(undefined),
    /** Days filter (e.g., shipped in last N days) */
    days: z.coerce.number().int().positive().optional().catch(undefined),
    /** Sort field */
    sortBy: z.string().optional().catch(undefined),
    /** Sort direction */
    sortOrder: z.enum(['asc', 'desc']).optional().catch(undefined),
    /** Order ID for highlighting/selecting a specific order */
    orderId: z.string().optional().catch(undefined),
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
 * Supports 9 tabs: products, materials, trims, services, bom, consumption, import, fabricMapping, styleCodes
 *
 * @example
 * /products?tab=bom&id=123e4567-e89b-12d3-a456-426614174000&type=product
 */
export const ProductsSearchParams = z.object({
    /** Active tab in products page */
    tab: z.enum(['products', 'materials', 'trims', 'services', 'bom', 'consumption', 'import', 'fabricMapping', 'styleCodes']).catch('products'),
    /** View mode for products tab */
    view: z.enum(['tree', 'flat']).catch('tree'),
    /** Selected item ID for master-detail views */
    id: z.string().optional().catch(undefined),
    /** Type of selected item */
    type: z.enum(['product', 'variation', 'sku', 'material', 'fabric', 'colour']).optional().catch(undefined),
});
export type ProductsSearchParams = z.infer<typeof ProductsSearchParams>;

// ============================================
// FABRICS PAGE SEARCH PARAMS
// ============================================

/**
 * Fabrics page search params
 * 6 tabs: overview, transactions, reconciliation, invoices, trims, services
 */
export const FabricsSearchParams = z.object({
    /** Active tab */
    tab: z.enum(['overview', 'transactions', 'reconciliation', 'invoices', 'trims', 'services']).catch('overview'),
});
export type FabricsSearchParams = z.infer<typeof FabricsSearchParams>;

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
    /** Page number for pagination */
    page: z.coerce.number().int().positive().catch(1),
    /** Items per page (defaults to 100) */
    limit: z.coerce.number().int().positive().max(500).optional().transform(v => v ?? 100),
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
 * Supports 3 tabs: inward, outward, materials
 * With server-side search, filters, and pagination
 */
export const LedgersSearchParams = z.object({
    /** Active tab: inward (SKU in), outward (SKU out), materials (fabric txns) */
    tab: z.enum(['inward', 'outward', 'materials']).catch('inward'),
    /** Full-text search across SKU, product, color, order#, source/destination */
    search: z.string().optional().catch(undefined),
    /** Filter by transaction reason */
    reason: z.string().optional().catch(undefined),
    /** Filter by location: source (inward) or destination (outward) */
    location: z.string().optional().catch(undefined),
    /** Filter by data origin: sheet-imported vs app-created */
    origin: z.enum(['all', 'sheet', 'app']).catch('all'),
    /** Page number */
    page: z.coerce.number().int().positive().catch(1),
    /** Items per page (default 50) */
    limit: z.coerce.number().int().positive().max(200).optional().transform(v => v ?? 50),
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
// COSTING PAGE SEARCH PARAMS
// ============================================

/**
 * Costing page search params
 */
export const CostingSearchParams = z.object({
    /** Time period for analysis */
    period: z.enum(['7d', '30d', 'mtd']).catch('30d'),
    /** Sales channel filter */
    channel: z.enum(['all', 'shopify_online', 'marketplace']).catch('all'),
});
export type CostingSearchParams = z.infer<typeof CostingSearchParams>;

// ============================================
// CHANNELS PAGE SEARCH PARAMS
// ============================================

/**
 * Channels (Marketplace Analytics) page search params
 * Supports date range filtering, channel selection, and pagination
 *
 * @example
 * /channels?channel=myntra&range=30d&tab=overview
 */
export const ChannelsSearchParams = z.object({
    /** Active tab */
    tab: z.enum(['overview', 'orders', 'rto', 'import']).catch('overview'),
    /** Channel filter */
    channel: z.enum(['all', 'myntra', 'ajio', 'nykaa']).catch('all'),
    /** Time range preset */
    range: z.enum(['7d', '30d', '90d', 'mtd', 'custom']).catch('30d'),
    /** Start date for custom range (YYYY-MM-DD) */
    startDate: z.string().optional().catch(undefined),
    /** End date for custom range (YYYY-MM-DD) */
    endDate: z.string().optional().catch(undefined),
    /** Page number for orders table */
    page: z.coerce.number().int().positive().catch(1),
    /** Items per page */
    pageSize: z.coerce.number().int().positive().max(500).catch(50),
    /** Sort field for orders table */
    sortBy: z.string().optional().catch(undefined),
    /** Sort direction */
    sortDir: z.enum(['asc', 'desc']).catch('desc'),
    /** Fulfillment status filter */
    fulfillmentStatus: z.string().optional().catch(undefined),
    /** Order type filter (COD/Prepaid) */
    orderType: z.string().optional().catch(undefined),
    /** SKU code search */
    skuCode: z.string().optional().catch(undefined),
    /** State filter */
    state: z.string().optional().catch(undefined),
});
export type ChannelsSearchParams = z.infer<typeof ChannelsSearchParams>;

// ============================================
// STOCK REPORT PAGE SEARCH PARAMS
// ============================================

/**
 * Stock Report page search params
 * Monthly stock snapshots: Opening + Inward - Outward = Closing
 *
 * @example
 * /stock-report?year=2026&month=1&rollup=sku
 */
export const StockReportSearchParams = z.object({
    /** Year (defaults to current year) */
    year: z.coerce.number().int().positive().optional().catch(undefined),
    /** Month 1-12 (defaults to current month) */
    month: z.coerce.number().int().min(1).max(12).optional().catch(undefined),
    /** Search query for SKU/product name */
    search: z.string().optional().catch(undefined),
    /** Category/product filter */
    category: z.string().optional().catch(undefined),
    /** Rollup level: sku (individual) or product (grouped) */
    rollup: z.enum(['sku', 'product']).catch('sku'),
    /** Page number */
    page: z.coerce.number().int().positive().catch(1),
    /** Items per page */
    limit: z.coerce.number().int().positive().max(500).catch(100),
});
export type StockReportSearchParams = z.infer<typeof StockReportSearchParams>;

// ============================================
// SHOPIFY CATALOG PAGE SEARCH PARAMS
// ============================================

/**
 * Shopify Catalog monitoring page search params
 * Browse all Shopify product metadata: titles, descriptions, prices, variants
 *
 * @example
 * /shopify-catalog?status=active&search=cotton
 */
export const ShopifyCatalogSearchParams = z.object({
    /** Search by title, handle, SKU, or vendor */
    search: z.string().optional().catch(undefined),
    /** Filter by Shopify product status */
    status: z.enum(['all', 'active', 'archived', 'draft']).catch('all'),
});
export type ShopifyCatalogSearchParams = z.infer<typeof ShopifyCatalogSearchParams>;

// ============================================
// FACEBOOK FEED HEALTH PAGE SEARCH PARAMS
// ============================================

/**
 * Facebook Feed Health monitoring page search params
 * Compare the Facebook catalog XML feed against ERP + Shopify data
 *
 * @example
 * /facebook-feed-health?severity=critical&issueType=price_mismatch
 */
export const FacebookFeedHealthSearchParams = z.object({
    /** Search by title, SKU, or variant ID */
    search: z.string().optional().catch(undefined),
    /** Filter by issue severity */
    severity: z.enum(['all', 'critical', 'warning', 'info']).catch('all'),
    /** Filter by issue type */
    issueType: z.enum([
        'all',
        'price_mismatch',
        'stock_mismatch',
        'availability_wrong',
        'not_in_erp',
        'not_in_shopify_cache',
        'metadata_mismatch',
    ]).catch('all'),
});
export type FacebookFeedHealthSearchParams = z.infer<typeof FacebookFeedHealthSearchParams>;

// ============================================
// EMPTY SEARCH PARAMS (for pages without params)
// ============================================

/**
 * Empty search params for pages that don't use URL params
 * Used for Dashboard, Settings, Users, etc.
 */
export const EmptySearchParams = z.object({});
export type EmptySearchParams = z.infer<typeof EmptySearchParams>;
