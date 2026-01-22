/**
 * Kysely Customers List Query
 *
 * High-performance replacement for Prisma's nested includes.
 * Uses the denormalized ltv/orderCount/tier fields on Customer table.
 *
 * Shared between Express server and TanStack Start Server Functions.
 */
export type CustomerTier = 'new' | 'bronze' | 'silver' | 'gold' | 'platinum';
export interface CustomersListParams {
    search?: string;
    tier?: CustomerTier | 'all';
    limit?: number;
    offset?: number;
}
export interface CustomerListItem {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    totalOrders: number;
    lifetimeValue: number;
    customerTier: CustomerTier;
    createdAt: Date;
}
export interface CustomersListResponse {
    customers: CustomerListItem[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    };
}
/**
 * List customers with search and tier filter
 * Uses denormalized ltv/orderCount/tier fields for efficiency
 */
export declare function listCustomersKysely(params?: CustomersListParams): Promise<CustomersListResponse>;
//# sourceMappingURL=customersListKysely.d.ts.map