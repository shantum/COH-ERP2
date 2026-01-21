/**
 * @module queryPatterns
 * Shared Prisma query patterns, transaction helpers, and inventory calculations.
 *
 * This file now re-exports from patterns/ for backward compatibility.
 * New code should import directly from patterns/ or queryPatterns.js
 *
 * Key patterns:
 * - ORDER_LIST_SELECT: Unified select for all order list views
 * - Transaction helpers: createReservedTransaction, createSaleTransaction, releaseReservedInventory
 * - Inventory balance: calculateInventoryBalance, calculateAllInventoryBalances, calculateInventoryBalancesWithLock
 * - Customer enrichment: enrichOrdersWithCustomerStats
 * - Custom SKU workflow: createCustomSku, removeCustomization
 */

// Re-export everything from patterns/
export * from './patterns/index.js';
