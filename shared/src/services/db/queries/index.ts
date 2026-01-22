/**
 * Kysely Query Functions - Barrel Export
 *
 * High-performance query functions using Kysely and Prisma.
 * These can be imported from Server Functions.
 *
 * Usage:
 *   import { getCustomerKysely, listInventorySkusKysely } from '@coh/shared/services/db/queries';
 *
 * Note: Output types (CustomerDetailResult, InventorySkuRow, etc.) are defined in schemas/
 * and should be imported from there to avoid conflicts.
 */

// Customer queries
export {
    getCustomerKysely,
    type CustomerDetailParams,
} from './customers.js';

// Inventory queries
export {
    listInventorySkusKysely,
    calculateInventoryBalance,
    calculateAllInventoryBalances,
    type InventoryListParams,
    type InventoryBalanceWithSkuId,
} from './inventory.js';
