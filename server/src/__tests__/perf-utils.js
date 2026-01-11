/**
 * Performance Test Utilities
 *
 * Provides:
 * - Data seeding utilities for different scales
 * - Timing measurement helpers
 * - Threshold checking with warnings
 */

import { PrismaClient } from '@prisma/client';

// ============================================
// SCALE CONFIGURATIONS
// ============================================

export const SCALE_CONFIGS = {
    SMALL: {
        name: 'SMALL',
        skuCount: 100,
        transactionCount: 1000,
        orderCount: 100,
        orderLineCount: 200,
    },
    MEDIUM: {
        name: 'MEDIUM',
        skuCount: 1000,
        transactionCount: 50000,
        orderCount: 2000,
        orderLineCount: 5000,
    },
};

// ============================================
// PERFORMANCE THRESHOLDS (in ms)
// Based on initial baseline measurements on development machine
// These are warning thresholds - tests pass but warn if exceeded
// Adjust based on your hardware and database performance
// ============================================

export const THRESHOLDS = {
    SMALL: {
        singleBalanceCalc: 500,     // ~250-350ms observed
        bulkBalanceCalc: 500,       // ~250ms observed
        productionComplete: 500,    // Estimate
        quickInward: 500,           // ~250ms observed
        rtoInward: 500,             // Estimate
        allocation: 1500,           // ~1000ms observed (includes order+line creation)
        unallocation: 700,          // ~500ms observed
    },
    MEDIUM: {
        singleBalanceCalc: 1000,    // Scaled from SMALL
        bulkBalanceCalc: 3000,      // Scaled for 1K SKUs
        productionComplete: 1000,   // Estimate
        quickInward: 1000,          // Estimate
        rtoInward: 1000,            // Estimate
        allocation: 2000,           // Scaled from SMALL
        unallocation: 1500,         // Scaled from SMALL
    },
};

// ============================================
// PRISMA CLIENT
// ============================================

let prismaInstance = null;

export function getPrismaClient() {
    if (!prismaInstance) {
        prismaInstance = new PrismaClient({
            datasources: {
                db: {
                    url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
                },
            },
        });
    }
    return prismaInstance;
}

export async function disconnectPrisma() {
    if (prismaInstance) {
        await prismaInstance.$disconnect();
        prismaInstance = null;
    }
}

// ============================================
// TIMING UTILITIES
// ============================================

/**
 * Measure operation execution time over multiple iterations
 * @param {string} name - Operation name for logging
 * @param {Function} fn - Async function to measure
 * @param {number} iterations - Number of iterations (default: 5)
 * @returns {Object} Timing results { avg, min, max, times }
 */
export async function measureOperation(name, fn, iterations = 5) {
    const times = [];

    // Warm-up run (not counted)
    await fn();

    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await fn();
        const elapsed = performance.now() - start;
        times.push(elapsed);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    console.log(
        `[PERF] ${name}: avg=${avg.toFixed(2)}ms, min=${min.toFixed(2)}ms, max=${max.toFixed(2)}ms`
    );

    return { avg, min, max, times, name };
}

/**
 * Check if result exceeds threshold and log warning
 * Tests still pass - this is informational only
 * @param {Object} result - Result from measureOperation
 * @param {number} threshold - Threshold in ms
 * @param {string} operationName - Name for warning message
 */
export function checkThreshold(result, threshold, operationName) {
    if (result.avg > threshold) {
        console.warn(
            `⚠️  ${operationName} exceeded threshold: ${result.avg.toFixed(2)}ms > ${threshold}ms`
        );
        return false;
    }
    return true;
}

// ============================================
// DATA GENERATION UTILITIES
// ============================================

/**
 * Generate unique IDs for test data
 */
let idCounter = 0;
export function generateId(prefix = 'perf') {
    return `${prefix}-${Date.now()}-${++idCounter}`;
}

/**
 * Generate test SKU data
 */
export function generateSkuData(count, variationId) {
    const skus = [];
    for (let i = 0; i < count; i++) {
        skus.push({
            id: generateId('sku'),
            skuCode: `PERF-SKU-${i}-${Date.now()}`,
            variationId,
            size: ['XS', 'S', 'M', 'L', 'XL'][i % 5],
            fabricConsumption: 1.5,
            mrp: 1000 + (i * 10),
            isActive: true,
        });
    }
    return skus;
}

/**
 * Generate test inventory transaction data
 */
export function generateTransactionData(skuIds, count, userId) {
    const transactions = [];
    const txnTypes = ['inward', 'outward', 'reserved'];
    const reasons = ['production', 'sale', 'order_allocation', 'adjustment'];

    for (let i = 0; i < count; i++) {
        const skuId = skuIds[i % skuIds.length];
        const txnType = txnTypes[i % 3];
        const reason = txnType === 'inward' ? 'production' :
            txnType === 'outward' ? 'sale' : 'order_allocation';

        transactions.push({
            id: generateId('txn'),
            skuId,
            txnType,
            qty: Math.floor(Math.random() * 10) + 1,
            reason,
            createdById: userId,
        });
    }
    return transactions;
}

/**
 * Generate test order data
 */
export function generateOrderData(count) {
    const orders = [];
    for (let i = 0; i < count; i++) {
        orders.push({
            id: generateId('order'),
            orderNumber: `PERF-ORD-${i}-${Date.now()}`,
            customerName: `Test Customer ${i}`,
            customerEmail: `customer${i}@test.com`,
            status: 'open',
            totalAmount: 1000 + (i * 100),
            channel: 'test',
        });
    }
    return orders;
}

/**
 * Generate test order line data
 */
export function generateOrderLineData(orderIds, skuIds, count) {
    const lines = [];
    for (let i = 0; i < count; i++) {
        lines.push({
            id: generateId('line'),
            orderId: orderIds[i % orderIds.length],
            skuId: skuIds[i % skuIds.length],
            qty: 1,
            unitPrice: 1000,
            lineStatus: 'pending',
        });
    }
    return lines;
}

// ============================================
// DATA SEEDING
// ============================================

/**
 * Seed test data at specified scale
 * Returns created IDs for use in tests
 */
export async function seedTestData(prisma, scale) {
    const config = SCALE_CONFIGS[scale];
    console.log(`[PERF] Seeding ${scale} scale data: ${config.skuCount} SKUs, ${config.transactionCount} transactions...`);

    const startTime = performance.now();

    // Create a test user
    const user = await prisma.user.upsert({
        where: { email: 'perf-test@test.com' },
        update: {},
        create: {
            id: generateId('user'),
            email: 'perf-test@test.com',
            password: 'hashed-password',
            name: 'Performance Test User',
            role: 'staff',
            updatedAt: new Date(),
        },
    });

    // Create a fabric type
    const fabricType = await prisma.fabricType.upsert({
        where: { name: 'Perf Test Fabric Type' },
        update: {},
        create: {
            id: generateId('ft'),
            name: 'Perf Test Fabric Type',
            unit: 'meter',
        },
    });

    // Create a fabric
    const fabric = await prisma.fabric.upsert({
        where: {
            id: 'perf-fabric-1',
        },
        update: {},
        create: {
            id: 'perf-fabric-1',
            fabricTypeId: fabricType.id,
            name: 'Perf Test Fabric',
            colorName: 'Test Color',
        },
    });

    // Create a product
    const product = await prisma.product.upsert({
        where: { styleCode: 'PERF-TEST' },
        update: {},
        create: {
            id: generateId('product'),
            name: 'Performance Test Product',
            styleCode: 'PERF-TEST',
            category: 'dress',
            productType: 'basic',
        },
    });

    // Create a variation
    const variation = await prisma.variation.upsert({
        where: {
            productId_colorName: {
                productId: product.id,
                colorName: 'Perf Test Color',
            },
        },
        update: {},
        create: {
            id: generateId('variation'),
            productId: product.id,
            colorName: 'Perf Test Color',
            fabricId: fabric.id,
        },
    });

    // Create SKUs in batches
    const skuData = generateSkuData(config.skuCount, variation.id);
    const skuIds = skuData.map(s => s.id);

    // Use createMany for efficiency (skip duplicates)
    await prisma.sku.createMany({
        data: skuData,
        skipDuplicates: true,
    });

    // Create inventory transactions in batches
    const txnData = generateTransactionData(skuIds, config.transactionCount, user.id);
    const batchSize = 5000;
    for (let i = 0; i < txnData.length; i += batchSize) {
        const batch = txnData.slice(i, i + batchSize);
        await prisma.inventoryTransaction.createMany({
            data: batch,
            skipDuplicates: true,
        });
    }

    // Create orders
    const orderData = generateOrderData(config.orderCount);
    const orderIds = orderData.map(o => o.id);
    await prisma.order.createMany({
        data: orderData,
        skipDuplicates: true,
    });

    // Create order lines
    const lineData = generateOrderLineData(orderIds, skuIds, config.orderLineCount);
    const lineIds = lineData.map(l => l.id);
    await prisma.orderLine.createMany({
        data: lineData,
        skipDuplicates: true,
    });

    const elapsed = performance.now() - startTime;
    console.log(`[PERF] Seeded ${scale} data in ${elapsed.toFixed(2)}ms`);

    return {
        userId: user.id,
        skuIds,
        orderIds,
        lineIds,
        variationId: variation.id,
        fabricId: fabric.id,
        productId: product.id,
    };
}

/**
 * Clean up test data
 */
export async function cleanupTestData(prisma, seedResult) {
    console.log('[PERF] Cleaning up test data...');
    const startTime = performance.now();

    try {
        // First: Delete all order lines with PERF prefix orders
        await prisma.orderLine.deleteMany({
            where: { order: { orderNumber: { startsWith: 'PERF-' } } },
        });

        // Second: Delete orders with PERF prefix
        await prisma.order.deleteMany({
            where: { orderNumber: { startsWith: 'PERF-' } },
        });

        // Delete transactions for test SKUs
        if (seedResult.skuIds?.length) {
            await prisma.inventoryTransaction.deleteMany({
                where: { skuId: { in: seedResult.skuIds } },
            });
        }

        // Delete production batches for test SKUs
        if (seedResult.skuIds?.length) {
            await prisma.productionBatch.deleteMany({
                where: { skuId: { in: seedResult.skuIds } },
            });
        }

        // Now safe to delete SKUs
        if (seedResult.skuIds?.length) {
            await prisma.sku.deleteMany({
                where: { id: { in: seedResult.skuIds } },
            });
        }

        // Clean up variation, product, fabric (ignore errors)
        if (seedResult.variationId) {
            await prisma.variation.deleteMany({
                where: { id: seedResult.variationId },
            }).catch(() => {});
        }
    } catch (error) {
        console.error('[PERF] Cleanup error (non-fatal):', error.message);
    }

    const elapsed = performance.now() - startTime;
    console.log(`[PERF] Cleanup completed in ${elapsed.toFixed(2)}ms`);
}

/**
 * Create a single order line for allocation testing
 * Returns a fresh line that can be allocated
 */
export async function createTestOrderLine(prisma, skuId, userId) {
    const order = await prisma.order.create({
        data: {
            id: generateId('order'),
            orderNumber: `PERF-ALLOC-${Date.now()}`,
            customerName: 'Allocation Test Customer',
            status: 'open',
            totalAmount: 1000,
            channel: 'test',
        },
    });

    const line = await prisma.orderLine.create({
        data: {
            id: generateId('line'),
            orderId: order.id,
            skuId,
            qty: 1,
            unitPrice: 1000,
            lineStatus: 'pending',
        },
    });

    return { order, line };
}

/**
 * Create a production batch for testing
 */
export async function createTestProductionBatch(prisma, skuId) {
    return prisma.productionBatch.create({
        data: {
            id: generateId('batch'),
            batchCode: `PERF-BATCH-${Date.now()}`,
            skuId,
            qtyPlanned: 10,
            qtyCompleted: 0,
            priority: 'stock_replenishment',
            status: 'in_progress',
        },
    });
}
