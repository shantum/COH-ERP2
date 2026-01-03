/**
 * Customer Sync Service
 * Shared logic for syncing customers from Shopify to ERP
 * Used by both background jobs (syncWorker.js) and direct sync routes (shopify.js)
 */

import shopifyClient from './shopify.js';

/**
 * Build customer data object from Shopify customer
 * @param {Object} shopifyCustomer - Shopify customer object
 * @returns {Object} Customer data for database
 */
export function buildCustomerData(shopifyCustomer) {
    const shopifyCustomerId = String(shopifyCustomer.id);
    const email = shopifyCustomer.email?.toLowerCase();

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
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Object} shopifyCustomer - Shopify customer data
 * @param {Object} options - Options { skipNoOrders, skipNoEmail }
 * @returns {Object} Result { action: 'created'|'updated'|'skipped', reason?: string }
 */
export async function syncSingleCustomer(prisma, shopifyCustomer, options = {}) {
    const { skipNoOrders = true, skipNoEmail = true } = options;

    // Skip customers without orders if option enabled
    if (skipNoOrders && (shopifyCustomer.orders_count || 0) === 0) {
        return { action: 'skipped', reason: 'no_orders' };
    }

    const shopifyCustomerId = String(shopifyCustomer.id);
    const email = shopifyCustomer.email?.toLowerCase();

    // Skip customers without email if option enabled
    if (skipNoEmail && !email) {
        return { action: 'skipped', reason: 'no_email' };
    }

    // Check if customer exists by shopifyCustomerId or email
    const existing = await prisma.customer.findFirst({
        where: {
            OR: [
                { shopifyCustomerId },
                ...(email ? [{ email }] : []),
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
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Object} options - Options { since_id, created_at_min, limit, skipNoOrders }
 * @returns {Object} Results { created, updated, skipped, skippedNoOrders, errors, lastSyncedId }
 */
export async function syncCustomers(prisma, options = {}) {
    const { since_id, created_at_min, limit = 50, skipNoOrders = true } = options;

    const results = {
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
            results.errors.push(`Customer ${shopifyCustomer.id}: ${error.message}`);
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
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Object} options - Options { batchSize, batchDelay, onProgress, maxErrors }
 * @returns {Object} Results { created, updated, skipped, skippedNoOrders, errors, totalFetched }
 */
export async function syncAllCustomers(prisma, options = {}) {
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
        errors: [],
        totalFetched: 0,
    };

    // Get total count first
    const totalCount = await shopifyClient.getCustomerCount();
    console.log(`Starting bulk customer sync: ${totalCount} total customers in Shopify`);

    let sinceId = null;
    let batchNumber = 0;

    while (true) {
        batchNumber++;
        const shopifyCustomers = await shopifyClient.getCustomers({
            since_id: sinceId,
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
                    results.errors.push(`Customer ${shopifyCustomer.id}: ${error.message}`);
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
