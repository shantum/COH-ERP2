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
export const TABLE_INVALIDATION_MAP: Record<string, string[][]> = {
    // Orders domain
    Order: [
        ['orders'],         // tRPC orders.list
    ],
    OrderLine: [
        ['orders'],
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
};
