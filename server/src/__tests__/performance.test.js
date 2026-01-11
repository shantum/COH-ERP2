/**
 * Performance Benchmark Tests
 *
 * Measures execution time of critical inventory operations against real database.
 * Uses warning thresholds - tests pass but warn if thresholds exceeded.
 *
 * Run with: npm test -- --testPathPattern="performance"
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import {
    SCALE_CONFIGS,
    THRESHOLDS,
    getPrismaClient,
    disconnectPrisma,
    measureOperation,
    checkThreshold,
    seedTestData,
    cleanupTestData,
    cleanupAllPerfData,
    createTestOrderLine,
    createTestProductionBatch,
    generateId,
} from './perf-utils.js';
import {
    calculateInventoryBalance,
    calculateAllInventoryBalances,
    createReservedTransaction,
    releaseReservedInventory,
    TXN_TYPE,
    TXN_REASON,
} from '../utils/queryPatterns.js';

// Increase timeout for performance tests
jest.setTimeout(120000); // 2 minutes

describe('Performance Benchmarks', () => {
    let prisma;

    beforeAll(async () => {
        prisma = getPrismaClient();
        // Clean up any leftover data from previous interrupted tests
        await cleanupAllPerfData(prisma);
    });

    afterAll(async () => {
        await disconnectPrisma();
    });

    // ============================================
    // SMALL SCALE TESTS
    // ============================================

    describe('SMALL Scale (100 SKUs, 1K transactions)', () => {
        let seedResult;
        const scale = 'SMALL';
        const thresholds = THRESHOLDS[scale];

        beforeAll(async () => {
            seedResult = await seedTestData(prisma, scale);
        });

        afterAll(async () => {
            await cleanupTestData(prisma, seedResult);
        });

        describe('Balance Calculations', () => {
            it('measures single SKU balance calculation', async () => {
                const skuId = seedResult.skuIds[0];

                const result = await measureOperation(
                    `calculateInventoryBalance (${scale})`,
                    () => calculateInventoryBalance(prisma, skuId)
                );

                checkThreshold(result, thresholds.singleBalanceCalc, `Single balance calc (${scale})`);
                expect(result.avg).toBeGreaterThan(0);
            });

            it('measures bulk balance calculation (all SKUs)', async () => {
                const result = await measureOperation(
                    `calculateAllInventoryBalances (${scale})`,
                    () => calculateAllInventoryBalances(prisma, seedResult.skuIds)
                );

                checkThreshold(result, thresholds.bulkBalanceCalc, `Bulk balance calc (${scale})`);
                expect(result.avg).toBeGreaterThan(0);
            });

            it('measures balance for SKU with high transaction volume', async () => {
                // Pick a SKU that has many transactions
                const skuId = seedResult.skuIds[0];

                // Add extra transactions to this SKU
                const extraTxns = [];
                for (let i = 0; i < 100; i++) {
                    extraTxns.push({
                        id: generateId('extra-txn'),
                        skuId,
                        txnType: i % 2 === 0 ? 'inward' : 'reserved',
                        qty: 1,
                        reason: i % 2 === 0 ? 'production' : 'order_allocation',
                        createdById: seedResult.userId,
                    });
                }
                await prisma.inventoryTransaction.createMany({ data: extraTxns });

                const result = await measureOperation(
                    `calculateInventoryBalance high-volume (${scale})`,
                    () => calculateInventoryBalance(prisma, skuId)
                );

                // Should still be fast even with more transactions
                checkThreshold(result, thresholds.singleBalanceCalc * 2, `High-volume balance (${scale})`);
                expect(result.avg).toBeGreaterThan(0);

                // Cleanup extra transactions
                await prisma.inventoryTransaction.deleteMany({
                    where: { id: { in: extraTxns.map(t => t.id) } },
                });
            });
        });

        describe('Inward Operations', () => {
            it('measures quick inward transaction creation', async () => {
                const skuId = seedResult.skuIds[0];
                const createdIds = [];

                const result = await measureOperation(
                    `quick-inward (${scale})`,
                    async () => {
                        const txn = await prisma.inventoryTransaction.create({
                            data: {
                                id: generateId('perf-inward'),
                                skuId,
                                txnType: TXN_TYPE.INWARD,
                                qty: 5,
                                reason: TXN_REASON.PRODUCTION,
                                createdById: seedResult.userId,
                            },
                        });
                        createdIds.push(txn.id);
                        return txn;
                    }
                );

                checkThreshold(result, thresholds.quickInward, `Quick inward (${scale})`);
                expect(result.avg).toBeGreaterThan(0);

                // Cleanup
                await prisma.inventoryTransaction.deleteMany({
                    where: { id: { in: createdIds } },
                });
            });

            it('measures inward + balance update cycle', async () => {
                const skuId = seedResult.skuIds[1];
                const createdIds = [];

                const result = await measureOperation(
                    `inward + balance cycle (${scale})`,
                    async () => {
                        // Create inward transaction
                        const txn = await prisma.inventoryTransaction.create({
                            data: {
                                id: generateId('perf-cycle'),
                                skuId,
                                txnType: TXN_TYPE.INWARD,
                                qty: 3,
                                reason: TXN_REASON.PRODUCTION,
                                createdById: seedResult.userId,
                            },
                        });
                        createdIds.push(txn.id);

                        // Calculate updated balance
                        const balance = await calculateInventoryBalance(prisma, skuId);
                        return { txn, balance };
                    }
                );

                // Combined should be within 2x single operation
                checkThreshold(
                    result,
                    thresholds.quickInward + thresholds.singleBalanceCalc,
                    `Inward + balance (${scale})`
                );
                expect(result.avg).toBeGreaterThan(0);

                // Cleanup
                await prisma.inventoryTransaction.deleteMany({
                    where: { id: { in: createdIds } },
                });
            });
        });

        describe('Inward Hub Operations (Realistic User Flow)', () => {
            /**
             * SCAN LOOKUP: Measures SKU lookup speed
             * This is what happens when user scans a barcode in the inward hub
             */
            it('measures scan lookup performance', async () => {
                // Get an existing SKU code from seeded data
                const sku = await prisma.sku.findFirst({
                    where: { id: seedResult.skuIds[0] },
                    select: { skuCode: true, id: true },
                });

                const result = await measureOperation(
                    `scan lookup (${scale})`,
                    async () => {
                        // Simulate what /scan-lookup endpoint does:
                        // 1. Find SKU by code
                        // skuCode doubles as barcode (see schema comment)
                        const foundSku = await prisma.sku.findFirst({
                            where: { skuCode: sku.skuCode },
                            include: {
                                variation: {
                                    include: { product: true },
                                },
                            },
                        });

                        // 2. Check for pending sources (production batches)
                        const pendingBatch = await prisma.productionBatch.findFirst({
                            where: {
                                skuId: foundSku.id,
                                status: { in: ['planned', 'in_progress'] },
                            },
                            orderBy: { batchDate: 'asc' },
                        });

                        // 3. Get current balance
                        const balance = await calculateInventoryBalance(prisma, foundSku.id);

                        return { sku: foundSku, pendingBatch, balance };
                    }
                );

                // Scan lookup should be fast for good UX (< 500ms)
                checkThreshold(result, 500, `Scan lookup (${scale})`);
                expect(result.avg).toBeGreaterThan(0);
            });

            /**
             * QUICK INWARD WITH BATCH MATCHING: Simulates production inward
             * User scans SKU, enters qty, submits - system auto-matches batch
             */
            it('measures quick inward with auto-batch matching', async () => {
                const skuId = seedResult.skuIds[6];
                const createdBatches = [];
                const createdTxns = [];

                // Pre-create production batches to match against
                for (let i = 0; i < 3; i++) {
                    const batch = await prisma.productionBatch.create({
                        data: {
                            id: generateId('batch'),
                            batchCode: `PERF-BATCH-${i}-${Date.now()}`,
                            skuId,
                            qtyPlanned: 10,
                            qtyCompleted: 0,
                            status: 'planned',
                            priority: 'stock_replenishment',
                        },
                    });
                    createdBatches.push(batch.id);
                }

                const result = await measureOperation(
                    `quick inward with batch match (${scale})`,
                    async () => {
                        // Simulate what /quick-inward does:
                        // 1. Create inward transaction
                        const txn = await prisma.inventoryTransaction.create({
                            data: {
                                id: generateId('inward'),
                                skuId,
                                txnType: 'inward',
                                qty: 3,
                                reason: 'production',
                                createdById: seedResult.userId,
                            },
                        });
                        createdTxns.push(txn.id);

                        // 2. Auto-match oldest pending batch (FIFO)
                        const batch = await prisma.productionBatch.findFirst({
                            where: {
                                skuId,
                                status: { in: ['planned', 'in_progress'] },
                            },
                            orderBy: { createdAt: 'asc' },
                        });

                        if (batch) {
                            const newCompleted = Math.min(batch.qtyCompleted + 3, batch.qtyPlanned);
                            await prisma.productionBatch.update({
                                where: { id: batch.id },
                                data: {
                                    qtyCompleted: newCompleted,
                                    status: newCompleted >= batch.qtyPlanned ? 'completed' : 'in_progress',
                                },
                            });
                        }

                        // 3. Return updated balance
                        const balance = await calculateInventoryBalance(prisma, skuId);
                        return { txn, batch, balance };
                    }
                );

                // Quick inward should be fast (< 750ms for good UX)
                checkThreshold(result, 750, `Quick inward with batch (${scale})`);
                expect(result.avg).toBeGreaterThan(0);

                // Cleanup
                await prisma.inventoryTransaction.deleteMany({
                    where: { id: { in: createdTxns } },
                });
                await prisma.productionBatch.deleteMany({
                    where: { id: { in: createdBatches } },
                });
            });

            /**
             * RAPID SCANS: Simulates warehouse worker scanning multiple items quickly
             * Measures throughput for high-volume inward operations
             */
            it('measures rapid scan-and-inward cycle (5 items)', async () => {
                const skuId = seedResult.skuIds[7];
                const createdTxns = [];

                // Pre-create a production batch
                const batch = await prisma.productionBatch.create({
                    data: {
                        id: generateId('batch'),
                        batchCode: `PERF-RAPID-${Date.now()}`,
                        skuId,
                        qtyPlanned: 100,
                        qtyCompleted: 0,
                        status: 'planned',
                        priority: 'stock_replenishment',
                    },
                });

                const start = performance.now();

                // Simulate 5 rapid scans (worker scanning items quickly)
                for (let i = 0; i < 5; i++) {
                    // 1. Lookup SKU (fast - cached in real app)
                    const sku = await prisma.sku.findUnique({
                        where: { id: skuId },
                        select: { id: true, skuCode: true },
                    });

                    // 2. Create inward
                    const txn = await prisma.inventoryTransaction.create({
                        data: {
                            id: generateId('rapid'),
                            skuId: sku.id,
                            txnType: 'inward',
                            qty: 1,
                            reason: 'production',
                            createdById: seedResult.userId,
                        },
                    });
                    createdTxns.push(txn.id);

                    // 3. Update batch
                    await prisma.productionBatch.update({
                        where: { id: batch.id },
                        data: { qtyCompleted: { increment: 1 }, status: 'in_progress' },
                    });
                }

                const elapsed = performance.now() - start;
                const perScan = elapsed / 5;

                console.log(`[PERF] rapid 5 inwards (${scale}): ${elapsed.toFixed(2)}ms total, ${perScan.toFixed(2)}ms per scan`);

                // Each scan should be < 400ms for good throughput
                if (perScan > 400) {
                    console.warn(`⚠️  Inward per scan too slow: ${perScan.toFixed(2)}ms > 400ms`);
                }
                expect(perScan).toBeLessThan(1500);

                // Cleanup
                await prisma.inventoryTransaction.deleteMany({
                    where: { id: { in: createdTxns } },
                });
                await prisma.productionBatch.delete({
                    where: { id: batch.id },
                });
            });
        });

        describe('Allocation Operations', () => {
            /**
             * REALISTIC TEST: Measures allocation of pre-existing lines
             * This simulates the actual user experience - clicking checkboxes
             * on order lines that already exist (synced from Shopify)
             */
            it('measures single line allocation (realistic - pre-existing lines)', async () => {
                const skuId = seedResult.skuIds[2];
                const createdOrders = [];
                const createdLines = [];
                const createdTxns = [];

                // FIRST: Create enough inward stock for allocations
                // Use large buffer to account for seeded outward/reserved transactions
                const stockTxn = await prisma.inventoryTransaction.create({
                    data: {
                        id: generateId('stock'),
                        skuId,
                        txnType: 'inward',
                        qty: 100, // Large buffer for seeded data interference
                        reason: 'production',
                        createdById: seedResult.userId,
                    },
                });
                createdTxns.push(stockTxn.id);

                // PRE-CREATE 8 pending lines (6 needed: 1 warm-up + 5 iterations, plus buffer)
                const pendingLines = [];
                for (let i = 0; i < 8; i++) {
                    const { order, line } = await createTestOrderLine(prisma, skuId, seedResult.userId);
                    createdOrders.push(order.id);
                    createdLines.push(line.id);
                    pendingLines.push(line);
                }

                // Measure ONLY the allocation operation (not line creation)
                const result = await measureOperation(
                    `allocation (${scale})`,
                    async () => {
                        const line = pendingLines.shift();
                        if (!line) return null;

                        // This is what the API endpoint does:
                        // 1. Check balance
                        const balance = await calculateInventoryBalance(prisma, line.skuId);
                        if (balance.availableBalance < line.qty) {
                            throw new Error('Insufficient stock');
                        }

                        // 2. Create reserved transaction
                        await createReservedTransaction(prisma, {
                            skuId: line.skuId,
                            qty: line.qty,
                            orderLineId: line.id,
                            userId: seedResult.userId,
                        });

                        // 3. Update line status
                        return await prisma.orderLine.update({
                            where: { id: line.id },
                            data: { lineStatus: 'allocated', allocatedAt: new Date() },
                        });
                    }
                );

                checkThreshold(result, thresholds.allocation, `Allocation (${scale})`);
                expect(result.avg).toBeGreaterThan(0);

                // Cleanup
                await prisma.inventoryTransaction.deleteMany({
                    where: { id: { in: createdTxns } },
                });
                await prisma.inventoryTransaction.deleteMany({
                    where: { referenceId: { in: createdLines }, txnType: 'reserved' },
                });
                await prisma.orderLine.deleteMany({
                    where: { id: { in: createdLines } },
                });
                await prisma.order.deleteMany({
                    where: { id: { in: createdOrders } },
                });
            });

            /**
             * RAPID CLICKS TEST: Simulates user quickly clicking multiple checkboxes
             * Measures sequential single-line allocations without iteration overhead
             */
            it('measures rapid sequential allocations (5 clicks)', async () => {
                const skuId = seedResult.skuIds[5];
                const createdOrders = [];
                const createdLines = [];
                const createdTxns = [];

                // Create enough stock for 5 allocations (large buffer for seeded data)
                const stockTxn = await prisma.inventoryTransaction.create({
                    data: {
                        id: generateId('stock'),
                        skuId,
                        txnType: 'inward',
                        qty: 100, // Large buffer for seeded data interference
                        reason: 'production',
                        createdById: seedResult.userId,
                    },
                });
                createdTxns.push(stockTxn.id);

                // Pre-create 5 pending lines
                for (let i = 0; i < 5; i++) {
                    const { order, line } = await createTestOrderLine(prisma, skuId, seedResult.userId);
                    createdOrders.push(order.id);
                    createdLines.push(line.id);
                }

                // Measure 5 rapid allocations (simulating fast checkbox clicks)
                const start = performance.now();

                for (const lineId of createdLines) {
                    const line = await prisma.orderLine.findUnique({
                        where: { id: lineId },
                        select: { id: true, skuId: true, qty: true },
                    });

                    await createReservedTransaction(prisma, {
                        skuId: line.skuId,
                        qty: line.qty,
                        orderLineId: line.id,
                        userId: seedResult.userId,
                    });

                    await prisma.orderLine.update({
                        where: { id: line.id },
                        data: { lineStatus: 'allocated', allocatedAt: new Date() },
                    });
                }

                const elapsed = performance.now() - start;
                const perClick = elapsed / 5;

                console.log(`[PERF] rapid 5 allocations (${scale}): ${elapsed.toFixed(2)}ms total, ${perClick.toFixed(2)}ms per click`);

                // Should be < 500ms per click for good UX
                if (perClick > 500) {
                    console.warn(`⚠️  Allocation per click too slow: ${perClick.toFixed(2)}ms > 500ms`);
                }
                expect(perClick).toBeLessThan(2000); // Fail if extremely slow

                // Cleanup
                await prisma.inventoryTransaction.deleteMany({
                    where: { id: { in: createdTxns } },
                });
                await prisma.inventoryTransaction.deleteMany({
                    where: { referenceId: { in: createdLines }, txnType: 'reserved' },
                });
                await prisma.orderLine.deleteMany({
                    where: { id: { in: createdLines } },
                });
                await prisma.order.deleteMany({
                    where: { id: { in: createdOrders } },
                });
            });

            it('measures unallocation', async () => {
                const skuId = seedResult.skuIds[3];
                const createdOrders = [];
                const createdLines = [];

                // Pre-create allocated lines
                const allocatedLines = [];
                for (let i = 0; i < 6; i++) {
                    const { order, line } = await createTestOrderLine(prisma, skuId, seedResult.userId);
                    createdOrders.push(order.id);
                    createdLines.push(line.id);

                    await createReservedTransaction(prisma, {
                        skuId,
                        qty: 1,
                        orderLineId: line.id,
                        userId: seedResult.userId,
                    });

                    await prisma.orderLine.update({
                        where: { id: line.id },
                        data: { lineStatus: 'allocated' },
                    });

                    allocatedLines.push(line);
                }

                const result = await measureOperation(
                    `unallocation (${scale})`,
                    async () => {
                        const line = allocatedLines.shift();
                        if (!line) return null;

                        // Release reservation
                        await releaseReservedInventory(prisma, line.id);

                        // Update line status
                        await prisma.orderLine.update({
                            where: { id: line.id },
                            data: { lineStatus: 'pending', allocatedAt: null },
                        });

                        return line;
                    }
                );

                checkThreshold(result, thresholds.unallocation, `Unallocation (${scale})`);
                expect(result.avg).toBeGreaterThan(0);

                // Cleanup remaining
                await prisma.inventoryTransaction.deleteMany({
                    where: {
                        referenceId: { in: createdLines },
                        txnType: 'reserved',
                    },
                });
                await prisma.orderLine.deleteMany({
                    where: { id: { in: createdLines } },
                });
                await prisma.order.deleteMany({
                    where: { id: { in: createdOrders } },
                });
            });

            it('measures bulk allocation (10 lines)', async () => {
                const skuId = seedResult.skuIds[4];
                const createdOrders = [];
                const createdLines = [];

                // Create 10 pending lines
                const pendingLines = [];
                for (let i = 0; i < 10; i++) {
                    const { order, line } = await createTestOrderLine(prisma, skuId, seedResult.userId);
                    createdOrders.push(order.id);
                    createdLines.push(line.id);
                    pendingLines.push(line);
                }

                // Measure OPTIMIZED bulk allocation using createMany + updateMany
                const start = performance.now();

                await prisma.$transaction(async (tx) => {
                    const timestamp = new Date();

                    // Batch create all transactions in single INSERT
                    const txnData = pendingLines.map(line => ({
                        id: generateId('bulk-alloc'),
                        skuId,
                        txnType: TXN_TYPE.RESERVED,
                        qty: 1,
                        reason: TXN_REASON.ORDER_ALLOCATION,
                        referenceId: line.id,
                        createdById: seedResult.userId,
                    }));

                    await tx.inventoryTransaction.createMany({
                        data: txnData,
                    });

                    // Batch update all line statuses in single UPDATE
                    await tx.orderLine.updateMany({
                        where: { id: { in: createdLines } },
                        data: { lineStatus: 'allocated', allocatedAt: timestamp },
                    });
                }, { timeout: 30000 });

                const elapsed = performance.now() - start;
                console.log(`[PERF] bulk allocation 10 lines (${scale}): ${elapsed.toFixed(2)}ms`);

                // Check threshold - with batch ops, should be much faster
                if (elapsed > thresholds.allocation * 5) {
                    console.warn(`⚠️  Bulk allocation 10 lines (${scale}) exceeded threshold: ${elapsed.toFixed(2)}ms > ${thresholds.allocation * 5}ms`);
                }
                expect(elapsed).toBeGreaterThan(0);

                // Cleanup
                await prisma.inventoryTransaction.deleteMany({
                    where: { referenceId: { in: createdLines } },
                });
                await prisma.orderLine.deleteMany({
                    where: { id: { in: createdLines } },
                });
                await prisma.order.deleteMany({
                    where: { id: { in: createdOrders } },
                });
            });
        });
    });

    // ============================================
    // MEDIUM SCALE TESTS
    // Skip by default - run explicitly with: npm test -- --testPathPatterns="performance" --testNamePattern="MEDIUM"
    // ============================================

    describe.skip('MEDIUM Scale (1K SKUs, 50K transactions)', () => {
        let seedResult;
        const scale = 'MEDIUM';
        const thresholds = THRESHOLDS[scale];

        beforeAll(async () => {
            seedResult = await seedTestData(prisma, scale);
        }, 300000); // 5 minutes for seeding

        afterAll(async () => {
            await cleanupTestData(prisma, seedResult);
        }, 180000); // 3 minutes for cleanup

        describe('Balance Calculations', () => {
            it('measures single SKU balance calculation', async () => {
                const skuId = seedResult.skuIds[0];

                const result = await measureOperation(
                    `calculateInventoryBalance (${scale})`,
                    () => calculateInventoryBalance(prisma, skuId)
                );

                checkThreshold(result, thresholds.singleBalanceCalc, `Single balance calc (${scale})`);
                expect(result.avg).toBeGreaterThan(0);
            });

            it('measures bulk balance calculation (all 1K SKUs)', async () => {
                const result = await measureOperation(
                    `calculateAllInventoryBalances (${scale})`,
                    () => calculateAllInventoryBalances(prisma, seedResult.skuIds),
                    3 // Fewer iterations for large dataset
                );

                checkThreshold(result, thresholds.bulkBalanceCalc, `Bulk balance calc (${scale})`);
                expect(result.avg).toBeGreaterThan(0);
            });

            it('measures bulk balance without SKU filter (all transactions)', async () => {
                const result = await measureOperation(
                    `calculateAllInventoryBalances unfiltered (${scale})`,
                    () => calculateAllInventoryBalances(prisma),
                    3
                );

                // Unfiltered should still be reasonable
                checkThreshold(
                    result,
                    thresholds.bulkBalanceCalc * 2,
                    `Unfiltered bulk balance (${scale})`
                );
                expect(result.avg).toBeGreaterThan(0);
            });
        });

        describe('Inward Operations', () => {
            it('measures quick inward at medium scale', async () => {
                const skuId = seedResult.skuIds[500]; // Middle of the range
                const createdIds = [];

                const result = await measureOperation(
                    `quick-inward (${scale})`,
                    async () => {
                        const txn = await prisma.inventoryTransaction.create({
                            data: {
                                id: generateId('med-inward'),
                                skuId,
                                txnType: TXN_TYPE.INWARD,
                                qty: 5,
                                reason: TXN_REASON.PRODUCTION,
                                createdById: seedResult.userId,
                            },
                        });
                        createdIds.push(txn.id);
                        return txn;
                    }
                );

                checkThreshold(result, thresholds.quickInward, `Quick inward (${scale})`);
                expect(result.avg).toBeGreaterThan(0);

                // Cleanup
                await prisma.inventoryTransaction.deleteMany({
                    where: { id: { in: createdIds } },
                });
            });

            it('measures inward + balance update cycle at scale', async () => {
                const skuId = seedResult.skuIds[501];
                const createdIds = [];

                const result = await measureOperation(
                    `inward + balance cycle (${scale})`,
                    async () => {
                        const txn = await prisma.inventoryTransaction.create({
                            data: {
                                id: generateId('med-cycle'),
                                skuId,
                                txnType: TXN_TYPE.INWARD,
                                qty: 3,
                                reason: TXN_REASON.PRODUCTION,
                                createdById: seedResult.userId,
                            },
                        });
                        createdIds.push(txn.id);

                        const balance = await calculateInventoryBalance(prisma, skuId);
                        return { txn, balance };
                    }
                );

                checkThreshold(
                    result,
                    thresholds.quickInward + thresholds.singleBalanceCalc,
                    `Inward + balance (${scale})`
                );
                expect(result.avg).toBeGreaterThan(0);

                // Cleanup
                await prisma.inventoryTransaction.deleteMany({
                    where: { id: { in: createdIds } },
                });
            });
        });

        describe('Allocation Operations', () => {
            it('measures allocation at medium scale', async () => {
                const skuId = seedResult.skuIds[600];
                const createdOrders = [];
                const createdLines = [];
                const createdTxns = [];

                const result = await measureOperation(
                    `allocation (${scale})`,
                    async () => {
                        const { order, line } = await createTestOrderLine(prisma, skuId, seedResult.userId);
                        createdOrders.push(order.id);
                        createdLines.push(line.id);

                        const txn = await createReservedTransaction(prisma, {
                            skuId,
                            qty: line.qty,
                            orderLineId: line.id,
                            userId: seedResult.userId,
                        });
                        createdTxns.push(txn.id);

                        await prisma.orderLine.update({
                            where: { id: line.id },
                            data: { lineStatus: 'allocated', allocatedAt: new Date() },
                        });

                        return { line, txn };
                    }
                );

                checkThreshold(result, thresholds.allocation, `Allocation (${scale})`);
                expect(result.avg).toBeGreaterThan(0);

                // Cleanup
                await prisma.inventoryTransaction.deleteMany({
                    where: { id: { in: createdTxns } },
                });
                await prisma.orderLine.deleteMany({
                    where: { id: { in: createdLines } },
                });
                await prisma.order.deleteMany({
                    where: { id: { in: createdOrders } },
                });
            });
        });
    });

    // ============================================
    // COMPARISON SUMMARY
    // ============================================

    describe('Scale Comparison Summary', () => {
        it('logs performance comparison between scales', () => {
            console.log('\n========================================');
            console.log('PERFORMANCE BENCHMARK SUMMARY');
            console.log('========================================');
            console.log('Thresholds (warnings only - tests still pass):');
            console.log('\nSMALL Scale (100 SKUs, 1K transactions):');
            Object.entries(THRESHOLDS.SMALL).forEach(([op, threshold]) => {
                console.log(`  ${op}: < ${threshold}ms`);
            });
            console.log('\nMEDIUM Scale (1K SKUs, 50K transactions):');
            Object.entries(THRESHOLDS.MEDIUM).forEach(([op, threshold]) => {
                console.log(`  ${op}: < ${threshold}ms`);
            });
            console.log('========================================\n');

            expect(true).toBe(true);
        });
    });
});
