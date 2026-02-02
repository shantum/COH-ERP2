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

// Dashboard queries
export {
    getPipelineAndPaymentSplit,
    getAllRevenueMetrics,
    getTopProductsKysely,
    getTopVariationsKysely,
    getTopCustomersKysely,
    getTopMaterialsKysely,
    getTopFabricColoursKysely,
    getDashboardAnalytics,
    // Sales analytics breakdown queries
    getSalesBreakdownByMaterial,
    getSalesBreakdownByFabric,
    getSalesBreakdownByFabricColour,
    getSalesBreakdownByChannel,
    getSalesBreakdownByStandardColor,
    type PipelineCounts,
    type PaymentSplitData,
    type RevenueMetrics,
    type AllRevenueMetrics,
    type TopProductData,
    type TopVariationData,
    type TopCustomerData,
    type TopMaterialData,
    type TopFabricColourData,
    type DashboardAnalytics,
    type SalesBreakdownRow,
} from './dashboard.js';

// Materials queries
export {
    getFabricSalesMetricsKysely,
    type FabricSalesMetrics,
} from './materials.js';

// Products queries
export {
    getVariationSalesMetricsKysely,
    getSkuSalesMetricsKysely,
    getVariationShopifyStockKysely,
    getSkuShopifyStockKysely,
    getFabricColourBalancesKysely,
    getProductShopifyStatusesKysely,
    getVariationShopifyStatusesKysely,
    type VariationSalesMetrics,
    type SkuSalesMetrics,
} from './products.js';
