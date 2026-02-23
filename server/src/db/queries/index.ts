/**
 * Kysely Query Exports
 *
 * High-performance queries using type-safe SQL.
 */

// Customers
export {
    listCustomersKysely,
    getCustomerKysely,
    getCustomerStatsKysely,
    type CustomersListParams,
    type CustomersListResult,
    type CustomerListItem,
    type CustomerDetailResult,
    type CustomerStatsResult,
} from './customersListKysely.js';

// Inventory
export {
    listInventorySkusKysely,
    calculateBalancesKysely,
    type InventoryListParams,
    type InventorySkuRow,
} from './inventoryListKysely.js';

// Production
export {
    getTailorsKysely,
    getBatchesKysely,
    getBatchOrderLinesKysely,
    getCapacityKysely,
    getPendingBySkuKysely,
    type TailorRow,
    type BatchListParams,
    type BatchRow,
    type BatchOrderLineRow,
    type CapacityParams,
    type CapacityRow,
} from './productionKysely.js';

// Reconciliation
export {
    getReconciliationHistoryKysely,
    getReconciliationByIdKysely,
    getSkusForReconciliationKysely,
    type ReconciliationHistoryRow,
    type ReconciliationDetailResult,
    type SkuForReconciliationRow,
} from './reconciliationKysely.js';
