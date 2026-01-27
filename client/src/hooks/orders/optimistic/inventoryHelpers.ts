/**
 * Inventory-related helpers for Optimistic Updates
 * Re-exports from @coh/shared for consistency.
 */

export { calculateInventoryDelta } from '@coh/shared/domain';

// Client-side hasAllocatedInventory includes 'shipped' for display purposes
export { statusShowsInventoryAllocated as hasAllocatedInventory } from '@coh/shared/domain';
