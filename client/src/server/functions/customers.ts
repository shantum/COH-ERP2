/**
 * Customers Server Functions
 *
 * TanStack Start Server Functions for customers data fetching.
 * Uses Prisma for database access.
 *
 * IMPORTANT: Prisma client is dynamically imported to prevent Node.js code
 * from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';

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
 * Fetches customers directly from database using Prisma.
 * Returns paginated items with tier filtering.
 */
export const getCustomersList = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => customersListInputSchema.parse(input))
    .handler(async ({ data }): Promise<CustomersListResponse> => {
        console.log('[Server Function] getCustomersList called with:', data);

        try {
            // Dynamic import to prevent bundling Prisma into client
            const { PrismaClient } = await import('@prisma/client');

            // Use global singleton pattern
            const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
            const prisma = globalForPrisma.prisma ?? new PrismaClient();
            if (process.env.NODE_ENV !== 'production') {
                globalForPrisma.prisma = prisma;
            }

            // Build where clause
            const where: Prisma.CustomerWhereInput = {};

            // Apply search filter
            // Single word: OR across fields
            // Multi-word: AND (each word must match at least one field)
            if (data.search) {
                const words = data.search.trim().toLowerCase().split(/\s+/).filter(Boolean);

                if (words.length === 1) {
                    // Single word: OR across all searchable fields
                    const term = words[0];
                    where.OR = [
                        { email: { contains: term, mode: 'insensitive' } },
                        { firstName: { contains: term, mode: 'insensitive' } },
                        { lastName: { contains: term, mode: 'insensitive' } },
                        { phone: { contains: term } },
                    ];
                } else if (words.length > 1) {
                    // Multi-word: AND - each word must match at least one field
                    where.AND = words.map((word) => ({
                        OR: [
                            { email: { contains: word, mode: 'insensitive' as const } },
                            { firstName: { contains: word, mode: 'insensitive' as const } },
                            { lastName: { contains: word, mode: 'insensitive' as const } },
                            { phone: { contains: word } },
                        ],
                    }));
                }
            }

            // Apply tier filter
            if (data.tier && data.tier !== 'all') {
                where.tier = data.tier;
            }

            // Execute count and data queries in parallel
            const [total, customersRaw] = await Promise.all([
                prisma.customer.count({ where }),
                prisma.customer.findMany({
                    where,
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        phone: true,
                        orderCount: true,
                        ltv: true,
                        tier: true,
                        createdAt: true,
                    },
                    orderBy: { createdAt: 'desc' },
                    take: data.limit,
                    skip: data.offset,
                }),
            ]);

            // Map to result type
            const customers: CustomerListItem[] = customersRaw.map((c) => ({
                id: c.id,
                email: c.email,
                firstName: c.firstName,
                lastName: c.lastName,
                phone: c.phone,
                totalOrders: c.orderCount || 0,
                lifetimeValue: c.ltv || 0,
                customerTier: (c.tier || 'bronze') as CustomerTier,
                createdAt: c.createdAt,
            }));

            console.log(
                '[Server Function] Query returned',
                customers.length,
                'customers, total:',
                total
            );

            return {
                customers,
                pagination: {
                    total,
                    limit: data.limit,
                    offset: data.offset,
                    hasMore: data.offset + data.limit < total,
                },
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getCustomersList:', error);
            throw error;
        }
    });

const getCustomerInputSchema = z.object({
    id: z.string().uuid(),
});

/**
 * Server Function: Get single customer by ID
 *
 * Uses Kysely for high-performance query with order count and recent orders.
 */
/** Customer detail result type from Kysely query */
export interface CustomerDetailResult {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    tier: string | null;
    tags: string | null;
    createdAt: Date;
    updatedAt: Date;
    ordersCount: number;
    recentOrders: Array<{
        id: string;
        orderNumber: string;
        totalAmount: number | null;
        status: string;
        orderDate: Date;
    }>;
}

export const getCustomer = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => getCustomerInputSchema.parse(input))
    .handler(async ({ data }): Promise<CustomerDetailResult> => {
        const { getCustomerKysely } = await import('@server/db/queries/index.js');

        const customer = await getCustomerKysely(data.id);

        if (!customer) {
            throw new Error('Customer not found');
        }

        return customer;
    });

// ============================================
// CUSTOMER SEARCH - For CustomerSearch component
// ============================================

const searchCustomersInputSchema = z.object({
    search: z.string().optional(),
    limit: z.number().int().positive().max(100).optional().default(50),
});

export type SearchCustomersInput = z.infer<typeof searchCustomersInputSchema>;

/**
 * Customer search item for dropdown/autocomplete
 */
export interface CustomerSearchItem {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    tags: string | null;
}

/**
 * Server Function: Search customers for autocomplete
 *
 * Lightweight search for customer selection dropdowns.
 * Returns minimal fields needed for display.
 */
export const searchCustomers = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => searchCustomersInputSchema.parse(input))
    .handler(async ({ data }): Promise<CustomerSearchItem[]> => {
        // Dynamic import to prevent bundling Prisma into client
        const { PrismaClient } = await import('@prisma/client');

        // Use global singleton pattern
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        // Build where clause
        const where: Prisma.CustomerWhereInput = {};

        if (data.search && data.search.trim()) {
            const term = data.search.trim();
            where.OR = [
                { email: { contains: term, mode: 'insensitive' } },
                { firstName: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term } },
            ];
        }

        const customers = await prisma.customer.findMany({
            where,
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                tags: true,
            },
            orderBy: { createdAt: 'desc' },
            take: data.limit,
        });

        return customers;
    });

// ============================================
// CUSTOMER ADDRESSES - For CreateOrderModal
// ============================================

const getCustomerAddressesInputSchema = z.object({
    customerId: z.string().uuid(),
});

/**
 * Address data from past orders
 */
export interface CustomerAddress {
    first_name?: string;
    last_name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
    phone?: string;
}

/**
 * Server Function: Get customer's past addresses
 *
 * Extracts unique addresses from the customer's order history.
 * Returns deduplicated addresses sorted by most recent use.
 */
export const getCustomerAddresses = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => getCustomerAddressesInputSchema.parse(input))
    .handler(async ({ data }): Promise<CustomerAddress[]> => {
        // Dynamic import to prevent bundling Prisma into client
        const { PrismaClient } = await import('@prisma/client');

        // Use global singleton pattern
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        // Get orders with shipping addresses for this customer
        const orders = await prisma.order.findMany({
            where: {
                customerId: data.customerId,
                shippingAddress: { not: null },
            },
            select: {
                shippingAddress: true,
                orderDate: true,
            },
            orderBy: { orderDate: 'desc' },
            take: 20, // Limit to recent orders
        });

        // Parse addresses and deduplicate by address1+zip combination
        const addressMap = new Map<string, CustomerAddress>();

        for (const order of orders) {
            if (!order.shippingAddress) continue;

            try {
                const addr = JSON.parse(order.shippingAddress) as CustomerAddress;
                // Use address1+zip as unique key
                const key = `${addr.address1 || ''}|${addr.zip || ''}`;
                if (key !== '|' && !addressMap.has(key)) {
                    addressMap.set(key, addr);
                }
            } catch {
                // Skip invalid JSON
                continue;
            }
        }

        return Array.from(addressMap.values()).slice(0, 5); // Return up to 5 unique addresses
    });
