/**
 * Inventory-related helpers for Optimistic Updates
 */

/**
 * Determines if a status transition affects inventory
 * Returns:
 *  - positive number: inventory is restored (freed up)
 *  - negative number: inventory is consumed (reserved)
 *  - 0: no inventory change
 */
export function calculateInventoryDelta(
    fromStatus: string,
    toStatus: string,
    qty: number
): number {
    const hasInventory = (status: string) =>
        ['allocated', 'picked', 'packed', 'shipped'].includes(status);

    const hadInventory = hasInventory(fromStatus);
    const willHaveInventory = hasInventory(toStatus);

    if (!hadInventory && willHaveInventory) {
        // Allocating: inventory consumed (reserved)
        return -qty;
    }

    if (hadInventory && !willHaveInventory) {
        // Unallocating or cancelling: inventory restored
        return qty;
    }

    // No change (e.g., picked -> packed, or pending -> pending)
    return 0;
}

/**
 * Check if a status has inventory allocated
 * Statuses with allocated inventory: allocated, picked, packed, shipped
 */
export function hasAllocatedInventory(status: string | undefined | null): boolean {
    if (!status) return false;
    return ['allocated', 'picked', 'packed', 'shipped'].includes(status);
}
