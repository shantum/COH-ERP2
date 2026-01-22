/**
 * URL Search Parameter Schemas for COH ERP
 *
 * These Zod schemas are used for validating URL search parameters
 * in TanStack Router routes. All schemas use .catch() for graceful
 * fallback when invalid data is received (e.g., NaN, invalid enum values).
 *
 * Key patterns:
 * - z.coerce.number() for numeric params (handles string → number conversion)
 * - .catch(defaultValue) for graceful fallback on invalid input
 * - .optional() for truly optional fields
 * - Type exports via z.infer<> for type safety
 */
import { z } from 'zod';
/**
 * Orders page search params
 * Validates view selection, pagination, and filters
 *
 * @example
 * /orders?view=shipped&page=2&shippedFilter=rto
 */
export declare const OrdersSearchParams: z.ZodObject<{
    view: z.ZodCatch<z.ZodEnum<{
        open: "open";
        shipped: "shipped";
        cancelled: "cancelled";
    }>>;
    page: z.ZodCatch<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodCatch<z.ZodCoercedNumber<unknown>>;
    search: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    shippedFilter: z.ZodCatch<z.ZodOptional<z.ZodEnum<{
        rto: "rto";
        all: "all";
        cod_pending: "cod_pending";
    }>>>;
    days: z.ZodCatch<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    sortBy: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    sortOrder: z.ZodCatch<z.ZodOptional<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>>;
    orderId: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    allocatedFilter: z.ZodCatch<z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        allocated: "allocated";
        all: "all";
    }>>>;
    productionFilter: z.ZodCatch<z.ZodOptional<z.ZodEnum<{
        all: "all";
        scheduled: "scheduled";
        needs: "needs";
        ready: "ready";
    }>>>;
    modal: z.ZodCatch<z.ZodOptional<z.ZodEnum<{
        customer: "customer";
        view: "view";
        edit: "edit";
        ship: "ship";
        create: "create";
    }>>>;
    modalMode: z.ZodCatch<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type OrdersSearchParams = z.infer<typeof OrdersSearchParams>;
/**
 * Products page search params
 * Supports 8 tabs: products, materials, trims, services, bom, consumption, import, fabricMapping
 *
 * @example
 * /products?tab=bom&id=123e4567-e89b-12d3-a456-426614174000&type=product
 */
export declare const ProductsSearchParams: z.ZodObject<{
    tab: z.ZodCatch<z.ZodEnum<{
        products: "products";
        materials: "materials";
        trims: "trims";
        services: "services";
        bom: "bom";
        consumption: "consumption";
        import: "import";
        fabricMapping: "fabricMapping";
    }>>;
    view: z.ZodCatch<z.ZodEnum<{
        tree: "tree";
        flat: "flat";
    }>>;
    id: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    type: z.ZodCatch<z.ZodOptional<z.ZodEnum<{
        product: "product";
        sku: "sku";
        variation: "variation";
        fabric: "fabric";
        material: "material";
        colour: "colour";
    }>>>;
}, z.core.$strip>;
export type ProductsSearchParams = z.infer<typeof ProductsSearchParams>;
/**
 * Inventory page search params
 */
export declare const InventorySearchParams: z.ZodObject<{
    search: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    page: z.ZodCatch<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodCatch<z.ZodCoercedNumber<unknown>>;
    stockFilter: z.ZodCatch<z.ZodOptional<z.ZodEnum<{
        all: "all";
        in_stock: "in_stock";
        low_stock: "low_stock";
        out_of_stock: "out_of_stock";
    }>>>;
}, z.core.$strip>;
export type InventorySearchParams = z.infer<typeof InventorySearchParams>;
/**
 * Customers page search params
 */
export declare const CustomersSearchParams: z.ZodObject<{
    search: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    tier: z.ZodCatch<z.ZodEnum<{
        all: "all";
        new: "new";
        bronze: "bronze";
        silver: "silver";
        gold: "gold";
        platinum: "platinum";
    }>>;
    page: z.ZodCatch<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodCatch<z.ZodCoercedNumber<unknown>>;
    tab: z.ZodCatch<z.ZodOptional<z.ZodEnum<{
        all: "all";
        highValue: "highValue";
        atRisk: "atRisk";
        returners: "returners";
    }>>>;
    topN: z.ZodCatch<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    timePeriod: z.ZodCatch<z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"all">, z.ZodCoercedNumber<unknown>]>>>;
    modal: z.ZodCatch<z.ZodOptional<z.ZodEnum<{
        orders: "orders";
        view: "view";
    }>>>;
    customerId: z.ZodCatch<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type CustomersSearchParams = z.infer<typeof CustomersSearchParams>;
/**
 * Production page search params
 */
export declare const ProductionSearchParams: z.ZodObject<{
    status: z.ZodCatch<z.ZodEnum<{
        cancelled: "cancelled";
        in_progress: "in_progress";
        planned: "planned";
        completed: "completed";
        all: "all";
    }>>;
    page: z.ZodCatch<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodCatch<z.ZodCoercedNumber<unknown>>;
    tab: z.ZodCatch<z.ZodOptional<z.ZodEnum<{
        schedule: "schedule";
        capacity: "capacity";
        tailors: "tailors";
    }>>>;
}, z.core.$strip>;
export type ProductionSearchParams = z.infer<typeof ProductionSearchParams>;
/**
 * Returns page search params
 */
export declare const ReturnsSearchParams: z.ZodObject<{
    status: z.ZodCatch<z.ZodEnum<{
        pending: "pending";
        received: "received";
        rejected: "rejected";
        all: "all";
        approved: "approved";
        processed: "processed";
    }>>;
    search: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    page: z.ZodCatch<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type ReturnsSearchParams = z.infer<typeof ReturnsSearchParams>;
/**
 * Analytics page search params
 */
export declare const AnalyticsSearchParams: z.ZodObject<{
    range: z.ZodCatch<z.ZodEnum<{
        custom: "custom";
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
        ytd: "ytd";
    }>>;
    startDate: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    endDate: z.ZodCatch<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type AnalyticsSearchParams = z.infer<typeof AnalyticsSearchParams>;
/**
 * Ledgers page search params
 */
export declare const LedgersSearchParams: z.ZodObject<{
    type: z.ZodCatch<z.ZodEnum<{
        inward: "inward";
        outward: "outward";
        adjustment: "adjustment";
        all: "all";
    }>>;
    search: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    page: z.ZodCatch<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type LedgersSearchParams = z.infer<typeof LedgersSearchParams>;
/**
 * Order search page search params
 */
export declare const OrderSearchSearchParams: z.ZodObject<{
    q: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    page: z.ZodCatch<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type OrderSearchSearchParams = z.infer<typeof OrderSearchSearchParams>;
/**
 * Empty search params for pages that don't use URL params
 * Used for Dashboard, Settings, Users, etc.
 */
export declare const EmptySearchParams: z.ZodObject<{}, z.core.$strip>;
export type EmptySearchParams = z.infer<typeof EmptySearchParams>;
//# sourceMappingURL=searchParams.d.ts.map