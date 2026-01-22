/**
 * Customer Sync Service
 * Shared logic for syncing customers from Shopify to ERP
 * Used by both background jobs (syncWorker.ts) and direct sync routes (shopify.js)
 */

import { PrismaClient } from '@prisma/client';
import type { ShopifyCustomer } from './shopify.js';
import shopifyClient from './shopify.js';

// ============================================
// TYPES & INTERFACES
// ============================================

/**
 * Options for syncing a single customer
 */
export interface SyncSingleCustomerOptions {
    skipNoOrders?: boolean;
    skipNoEmail?: boolean;
}

/**
 * Result of syncing a single customer
 */
export interface SyncSingleCustomerResult {
    action: 'created' | 'updated' | 'skipped';
    reason?: 'no_orders' | 'no_email';
}

/**
 * Options for syncing multiple customers
 */
export interface SyncCustomersOptions {
    since_id?: string;
    created_at_min?: string;
    limit?: number;
    skipNoOrders?: boolean;
}

/**
 * Results of syncing multiple customers
 */
export interface SyncCustomersResults {
    created: number;
    updated: number;
    skipped: number;
    skippedNoOrders: number;
    errors: string[];
    totalFetched: number;
    lastSyncedId: string | null;
}

/**
 * Progress callback for bulk sync operations
 */
export type ProgressCallback = (progress: {
    batch: number;
    fetched: number;
    total: number;
    created: number;
    updated: number;
}) => void;

/**
 * Options for syncing all customers (bulk)
 */
export interface SyncAllCustomersOptions {
    batchSize?: number;
    batchDelay?: number;
    onProgress?: ProgressCallback;
    maxErrors?: number;
}

/**
 * Results of bulk customer sync
 */
export interface SyncAllCustomersResults {
    totalCount: number;
    results: {
        created: number;
        updated: number;
        skipped: number;
        skippedNoOrders: number;
        errors: string[];
        totalFetched: number;
    };
}

/**
 * Customer data object for database operations
 */
export interface CustomerData {
    shopifyCustomerId: string;
    email: string;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    defaultAddress: string | null;
    tags: string | null;
    acceptsMarketing: boolean;
}

// ============================================
// FUNCTIONS
// ============================================

/**
 * Build customer data object from Shopify customer
 * @param shopifyCustomer - Shopify customer object
 * @returns Customer data for database
 * @throws Error if customer email is missing (required for database)
 */
export function buildCustomerData(shopifyCustomer: ShopifyCustomer): CustomerData {
    const shopifyCustomerId = String(shopifyCustomer.id);
    const email = shopifyCustomer.email?.toLowerCase();

    if (!email) {
        throw new Error(`Customer ${shopifyCustomer.id} has no email address`);
    }

    return {
        shopifyCustomerId,
        email,
        phone: shopifyCustomer.phone || null,
        firstName: shopifyCustomer.first_name || null,
        lastName: shopifyCustomer.last_name || null,
        defaultAddress: shopifyCustomer.default_address
            ? JSON.stringify(shopifyClient.formatAddress(shopifyCustomer.default_address))
            : null,
        tags: shopifyCustomer.tags || null,
        acceptsMarketing: shopifyCustomer.accepts_marketing || false,
    };
}

/**
 * Sync a single customer from Shopify to the database
 * @param prisma - Prisma client instance
 * @param shopifyCustomer - Shopify customer data
 * @param options - Options { skipNoOrders, skipNoEmail }
 * @returns Result { action: 'created'|'updated'|'skipped', reason?: string }
 */
export async function syncSingleCustomer(
    prisma: PrismaClient,
    shopifyCustomer: ShopifyCustomer,
    options: SyncSingleCustomerOptions = {}
): Promise<SyncSingleCustomerResult> {
    const { skipNoOrders = true } = options;

    // Skip customers without orders if option enabled
    if (skipNoOrders && (shopifyCustomer.orders_count || 0) === 0) {
        return { action: 'skipped', reason: 'no_orders' };
    }

    const shopifyCustomerId = String(shopifyCustomer.id);
    const email = shopifyCustomer.email?.toLowerCase();

    // Skip customers without email (email is required in database)
    if (!email) {
        return { action: 'skipped', reason: 'no_email' };
    }

    // Check if customer exists by shopifyCustomerId or email
    const existing = await prisma.customer.findFirst({
        where: {
            OR: [
                { shopifyCustomerId },
                { email },
            ],
        },
    });

    const customerData = buildCustomerData(shopifyCustomer);

    if (existing) {
        await prisma.customer.update({
            where: { id: existing.id },
            data: customerData,
        });
        return { action: 'updated' };
    } else {
        await prisma.customer.create({ data: customerData });
        return { action: 'created' };
    }
}

/**
 * Sync customers from Shopify with pagination
 * @param prisma - Prisma client instance
 * @param options - Options { since_id, created_at_min, limit, skipNoOrders }
 * @returns Results { created, updated, skipped, skippedNoOrders, errors, lastSyncedId }
 */
export async function syncCustomers(
    prisma: PrismaClient,
    options: SyncCustomersOptions = {}
): Promise<SyncCustomersResults> {
    const { since_id, created_at_min, limit = 50, skipNoOrders = true } = options;

    const results: SyncCustomersResults = {
        created: 0,
        updated: 0,
        skipped: 0,
        skippedNoOrders: 0,
        errors: [],
        totalFetched: 0,
        lastSyncedId: null,
    };

    // Fetch customers from Shopify
    const shopifyCustomers = await shopifyClient.getCustomers({
        since_id,
        created_at_min,
        limit,
    });

    results.totalFetched = shopifyCustomers.length;

    for (const shopifyCustomer of shopifyCustomers) {
        try {
            const result = await syncSingleCustomer(prisma, shopifyCustomer, { skipNoOrders });

            if (result.action === 'created') {
                results.created++;
            } else if (result.action === 'updated') {
                results.updated++;
            } else if (result.action === 'skipped') {
                if (result.reason === 'no_orders') {
                    results.skippedNoOrders++;
                } else {
                    results.skipped++;
                    if (result.reason === 'no_email') {
                        results.errors.push(`Customer ${shopifyCustomer.id}: No email address`);
                    }
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            results.errors.push(`Customer ${shopifyCustomer.id}: ${errorMessage}`);
            results.skipped++;
        }
    }

    if (shopifyCustomers.length > 0) {
        results.lastSyncedId = String(shopifyCustomers[shopifyCustomers.length - 1].id);
    }

    return results;
}

/**
 * Sync ALL customers from Shopify (paginated bulk sync)
 * @param prisma - Prisma client instance
 * @param options - Options { batchSize, batchDelay, onProgress, maxErrors }
 * @returns Results { created, updated, skipped, skippedNoOrders, errors, totalFetched }
 */
export async function syncAllCustomers(
    prisma: PrismaClient,
    options: SyncAllCustomersOptions = {}
): Promise<SyncAllCustomersResults> {
    const {
        batchSize = 250,
        batchDelay = 300,
        onProgress,
        maxErrors = 50,
    } = options;

    const results = {
        created: 0,
        updated: 0,
        skipped: 0,
        skippedNoOrders: 0,
        errors: [] as string[],
        totalFetched: 0,
    };

    // Get total count first
    const totalCount = await shopifyClient.getCustomerCount();
    console.log(`Starting bulk customer sync: ${totalCount} total customers in Shopify`);

    let sinceId: string | null = null;
    let batchNumber = 0;

    while (true) {
        batchNumber++;
        const shopifyCustomers = await shopifyClient.getCustomers({
            since_id: sinceId ?? undefined,
            limit: batchSize,
        });

        if (shopifyCustomers.length === 0) break;

        results.totalFetched += shopifyCustomers.length;
        console.log(`Processing batch ${batchNumber}: ${shopifyCustomers.length} customers (${results.totalFetched}/${totalCount})`);

        for (const shopifyCustomer of shopifyCustomers) {
            try {
                const result = await syncSingleCustomer(prisma, shopifyCustomer, { skipNoOrders: true });

                if (result.action === 'created') {
                    results.created++;
                } else if (result.action === 'updated') {
                    results.updated++;
                } else if (result.action === 'skipped') {
                    if (result.reason === 'no_orders') {
                        results.skippedNoOrders++;
                    } else {
                        results.skipped++;
                    }
                }
            } catch (error) {
                if (results.errors.length < maxErrors) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    results.errors.push(`Customer ${shopifyCustomer.id}: ${errorMessage}`);
                }
                results.skipped++;
            }
        }

        // Report progress if callback provided
        if (onProgress) {
            onProgress({
                batch: batchNumber,
                fetched: results.totalFetched,
                total: totalCount,
                created: results.created,
                updated: results.updated,
            });
        }

        sinceId = String(shopifyCustomers[shopifyCustomers.length - 1].id);

        // Rate limit delay
        await new Promise(resolve => setTimeout(resolve, batchDelay));

        if (shopifyCustomers.length < batchSize) break;
    }

    console.log(`Bulk customer sync completed:`, results);
    return { totalCount, results };
}
