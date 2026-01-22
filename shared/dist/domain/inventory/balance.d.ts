/**
 * Inventory Balance Calculation - Pure Functions
 *
 * These functions perform balance calculations without database dependencies.
 * The database query and aggregation happens in the server layer.
 *
 * @module domain/inventory/balance
 */
/**
 * Summary of inventory transactions for a SKU.
 * This is the minimal data needed from the database to calculate balance.
 */
export interface InventoryTransactionSummary {
    totalInward: number;
    totalOutward: number;
}
/**
 * Full inventory balance with calculated fields.
 */
export interface InventoryBalance {
    totalInward: number;
    totalOutward: number;
    currentBalance: number;
    availableBalance: number;
    hasDataIntegrityIssue: boolean;
}
/**
 * Inventory balance with SKU identifier.
 */
export interface InventoryBalanceWithSkuId extends InventoryBalance {
    skuId: string;
}
/**
 * Options for balance calculation.
 */
export interface CalculateBalanceOptions {
    /**
     * Whether to allow negative balances.
     * If false, negative balances are clamped to 0.
     * Default: true (allows negative to surface data integrity issues)
     */
    allowNegative?: boolean;
}
/**
 * Summary of fabric transactions for balance calculation.
 */
export interface FabricTransactionSummary {
    totalInward: number;
    totalOutward: number;
}
/**
 * Fabric balance result.
 */
export interface FabricBalance {
    totalInward: number;
    totalOutward: number;
    currentBalance: number;
}
/**
 * Fabric balance with identifier.
 */
export interface FabricBalanceWithId extends FabricBalance {
    fabricId: string;
}
/**
 * Calculate inventory balance from transaction summary.
 * Pure function - no database dependency.
 *
 * @param summary - Transaction totals (inward and outward)
 * @param options - Calculation options
 * @returns Complete inventory balance with derived fields
 *
 * @example
 * const summary = { totalInward: 100, totalOutward: 30 };
 * const balance = calculateBalance(summary);
 * // Returns: { totalInward: 100, totalOutward: 30, currentBalance: 70, availableBalance: 70, hasDataIntegrityIssue: false }
 *
 * @example
 * // Negative balance detection
 * const summary = { totalInward: 10, totalOutward: 15 };
 * const balance = calculateBalance(summary);
 * // Returns: { ..., currentBalance: -5, hasDataIntegrityIssue: true }
 *
 * @example
 * // Clamp negative to zero
 * const balance = calculateBalance(summary, { allowNegative: false });
 * // Returns: { ..., currentBalance: 0, availableBalance: 0, hasDataIntegrityIssue: true }
 */
export declare function calculateBalance(summary: InventoryTransactionSummary, options?: CalculateBalanceOptions): InventoryBalance;
/**
 * Calculate fabric balance from transaction summary.
 * Pure function - no database dependency.
 *
 * @param summary - Fabric transaction totals
 * @returns Fabric balance with current balance
 *
 * @example
 * const summary = { totalInward: 500, totalOutward: 200 };
 * const balance = calculateFabricBalance(summary);
 * // Returns: { totalInward: 500, totalOutward: 200, currentBalance: 300 }
 */
export declare function calculateFabricBalance(summary: FabricTransactionSummary): FabricBalance;
/**
 * Check if balance is sufficient for a required quantity.
 *
 * @param balance - The inventory balance to check
 * @param requiredQty - The quantity needed
 * @returns true if available balance meets or exceeds required quantity
 *
 * @example
 * const balance = calculateBalance({ totalInward: 100, totalOutward: 30 });
 * hasEnoughStock(balance, 50); // true (70 available >= 50 required)
 * hasEnoughStock(balance, 80); // false (70 available < 80 required)
 */
export declare function hasEnoughStock(balance: InventoryBalance, requiredQty: number): boolean;
/**
 * Calculate how much more stock is needed to fulfill a quantity.
 *
 * @param balance - The inventory balance to check
 * @param requiredQty - The quantity needed
 * @returns The shortfall amount, or 0 if sufficient stock exists
 *
 * @example
 * const balance = calculateBalance({ totalInward: 100, totalOutward: 30 });
 * getShortfall(balance, 50);  // 0 (no shortfall, 70 available)
 * getShortfall(balance, 80);  // 10 (need 10 more units)
 * getShortfall(balance, 70);  // 0 (exactly enough)
 */
export declare function getShortfall(balance: InventoryBalance, requiredQty: number): number;
/**
 * Calculate the quantity that can be allocated from available stock.
 *
 * @param balance - The inventory balance
 * @param requestedQty - The quantity requested
 * @returns The quantity that can actually be allocated (capped at available)
 *
 * @example
 * const balance = calculateBalance({ totalInward: 100, totalOutward: 30 });
 * getAllocatableQuantity(balance, 50);  // 50 (all requested available)
 * getAllocatableQuantity(balance, 80);  // 70 (capped at available)
 * getAllocatableQuantity(balance, 70);  // 70 (exact match)
 */
export declare function getAllocatableQuantity(balance: InventoryBalance, requestedQty: number): number;
/**
 * Initialize an empty inventory balance with SKU ID.
 * Useful for batch processing where some SKUs may have no transactions.
 *
 * @param skuId - The SKU identifier
 * @returns Zero-initialized balance with SKU ID
 */
export declare function createEmptyBalanceWithId(skuId: string): InventoryBalanceWithSkuId;
/**
 * Initialize an empty fabric balance with fabric ID.
 *
 * @param fabricId - The fabric identifier
 * @returns Zero-initialized fabric balance with ID
 */
export declare function createEmptyFabricBalanceWithId(fabricId: string): FabricBalanceWithId;
//# sourceMappingURL=balance.d.ts.map