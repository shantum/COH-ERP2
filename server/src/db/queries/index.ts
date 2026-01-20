/**
 * Kysely Query Exports
 *
 * High-performance queries using type-safe SQL.
 */

// Orders
export {
    listOrdersKysely,
    transformKyselyToRows,
    type OrdersListParams,
    type OrdersListResult,
    type OrderRow,
    type ViewName,
    type ShippedFilter,
    type SortField,
} from './ordersListKysely.js';

// Products
export {
    listProductsKysely,
    type ProductsListParams,
    type ProductsListResult,
    type ProductWithVariations,
    type VariationRow,
    type SkuRow,
} from './productsListKysely.js';

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

// Returns
export {
    listReturnsKysely,
    getReturnKysely,
    type ReturnsListParams,
    type ReturnLineRow,
    type ReturnsListResult,
    type ReturnDetailResult,
} from './returnsKysely.js';

// Reconciliation
export {
    getReconciliationHistoryKysely,
    getReconciliationByIdKysely,
    getSkusForReconciliationKysely,
    type ReconciliationHistoryRow,
    type ReconciliationDetailResult,
    type SkuForReconciliationRow,
} from './reconciliationKysely.js';
