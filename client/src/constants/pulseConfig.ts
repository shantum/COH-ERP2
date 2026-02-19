/**
 * Pulse configuration - table to query key mappings and timing
 *
 * Maps database table names from Postgres NOTIFY to TanStack Query keys
 * for invalidation. Uses array of arrays to support multiple query key patterns.
 */

// Debounce window for invalidations (ms)
// Prevents UI thrashing during bulk operations (Shopify sync, batch updates)
export const DEBOUNCE_MS = 1500;

// Maps database tables to TanStack Query keys to invalidate
// Note: During tRPC → Server Functions migration, both key patterns are listed
// to ensure SSE invalidation works for both code paths
export const TABLE_INVALIDATION_MAP: Record<string, string[][]> = {
    // Orders domain
    // - ['orders'] → tRPC orders.list (legacy)
    // - ['orders', 'list'] → Server Function getOrders (new)
    Order: [
        ['orders'],          // tRPC orders.list (legacy)
        ['orders', 'list'],  // Server Function key (new)
    ],
    OrderLine: [
        ['orders'],          // tRPC (legacy)
        ['orders', 'list'],  // Server Function (new)
    ],

    // Materials domain
    Material: [
        ['materialsTree'],
    ],
    Fabric: [
        ['materialsTree'],
    ],
    FabricColour: [
        ['materialsTree'],
    ],

    // Inventory domain
    InventoryTransaction: [
        ['inventoryBalance'],
        ['orders'],  // Orders show inventory status
    ],

    // Products domain
    Product: [
        ['productsTree'],
    ],
    Variation: [
        ['productsTree'],
    ],
    Sku: [
        ['productsTree'],
        ['allSkus'],
    ],

    // Finance domain
    BankTransaction: [
        ['finance', 'bank-transactions'],
        ['finance', 'summary'],
        ['finance', 'alerts'],
    ],
    Payment: [
        ['finance', 'payments'],
        ['finance', 'summary'],
        ['finance', 'alerts'],
        ['finance', 'pnl'],
        ['finance', 'cashflow'],
    ],
    Invoice: [
        ['finance', 'invoices'],
        ['finance', 'summary'],
        ['finance', 'alerts'],
        ['finance', 'pnl'],
    ],
};
