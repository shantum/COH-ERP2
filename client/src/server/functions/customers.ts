/**
 * Customers Server Functions
 *
 * TanStack Start Server Functions for customers data fetching.
 * Bypasses tRPC/Express, calls Kysely directly from the server.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

// Input validation schema
const customersListInputSchema = z.object({
    search: z.string().optional(),
    tier: z.enum(['all', 'new', 'bronze', 'silver', 'gold', 'platinum']).optional().default('all'),
    limit: z.number().int().positive().max(1000).optional().default(50),
    offset: z.number().int().nonnegative().optional().default(0),
});

export type CustomersListInput = z.infer<typeof customersListInputSchema>;

/**
 * Customer tier type
 */
export type CustomerTier = 'new' | 'bronze' | 'silver' | 'gold' | 'platinum';

/**
 * Customer list item returned by the Server Function
 */
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

/**
 * Response type matching the frontend hook expectations
 */
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
 * Server Function: Get customers list
 *
 * Fetches customers directly from database using Kysely.
 * Returns paginated items with tier filtering.
 */
export const getCustomersList = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => customersListInputSchema.parse(input))
    .handler(async ({ data }): Promise<CustomersListResponse> => {
        console.log('[Server Function] getCustomersList called with:', data);

        try {
            // Dynamic imports - only loaded on server, not bundled into client
            const { createKysely } = await import('@coh/shared/database');
            const { listCustomersKysely } = await import(
                '@coh/shared/database/queries/customersListKysely'
            );

            // Initialize Kysely singleton (safe to call multiple times)
            createKysely(process.env.DATABASE_URL);

            // Call Kysely query directly
            const result = await listCustomersKysely({
                search: data.search,
                tier: data.tier === 'all' ? undefined : data.tier,
                limit: data.limit,
                offset: data.offset,
            });

            console.log(
                '[Server Function] Query returned',
                result.customers.length,
                'customers, total:',
                result.pagination.total
            );

            return result;
        } catch (error) {
            console.error('[Server Function] Error in getCustomersList:', error);
            throw error;
        }
    });
