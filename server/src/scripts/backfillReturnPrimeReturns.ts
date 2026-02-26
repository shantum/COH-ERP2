/**
 * Backfill Return Prime Returns
 *
 * One-time script to create line-level returns for ReturnPrimeRequests
 * that were synced but never processed (because webhooks were broken until Feb 20).
 *
 * Dry-run by default. Pass --execute to actually write.
 *
 * Usage:
 *   npx tsx src/scripts/backfillReturnPrimeReturns.ts          # dry-run
 *   npx tsx src/scripts/backfillReturnPrimeReturns.ts --execute # write to DB
 */

import { PrismaClient } from '@prisma/client';
import { matchReturnPrimeLinesToOrderLines, getMatchSummary } from '../utils/returnPrimeLineMatching.js';
import { mapReturnPrimeReason } from '../config/mappings/returnPrimeReasons.js';

const prisma = new PrismaClient();

const CHUNK_SIZE = 50;
const DRY_RUN = !process.argv.includes('--execute');

// ============================================
// STATUS MAPPING
// ============================================

/**
 * Map RP status flags to ERP returnStatus.
 * Priority: terminal states first.
 */
function mapRpStatusToErp(rp: {
    isRefunded: boolean;
    isRejected: boolean;
    isReceived: boolean;
    isInspected: boolean;
    isApproved: boolean;
}): string {
    if (rp.isRefunded) return 'refunded';
    if (rp.isRejected) return 'rejected';
    if (rp.isReceived || rp.isInspected) return 'inspected';
    if (rp.isApproved) return 'requested';
    return 'requested';
}

/**
 * Map RP status flags to returnPrimeStatus string.
 */
function mapRpPrimeStatus(rp: {
    isRefunded: boolean;
    isRejected: boolean;
    isInspected: boolean;
    isReceived: boolean;
    isApproved: boolean;
}): string {
    if (rp.isRefunded) return 'refunded';
    if (rp.isRejected) return 'rejected';
    if (rp.isInspected) return 'inspected';
    if (rp.isReceived) return 'received';
    return 'approved';
}

// ============================================
// BATCH NUMBER GENERATION
// ============================================

async function generateBatchNumber(orderId: string, orderNumber: string): Promise<string> {
    const existingBatches = await prisma.orderLine.findMany({
        where: {
            orderId,
            returnBatchNumber: { not: null },
        },
        select: { returnBatchNumber: true },
        distinct: ['returnBatchNumber'],
    });
    const sequence = existingBatches.length + 1;
    return `${orderNumber}/${sequence}`;
}

// ============================================
// LINE ITEM SHAPE FROM JSON
// ============================================

interface StoredLineItem {
    id: number | string;
    quantity: number;
    reason?: string | null;
    original_product?: {
        sku?: string | null;
        price?: number | null;
    } | null;
    shop_price?: {
        actual_amount?: number | null;
    } | null;
}

/**
 * Convert stored lineItems JSON to the ReturnPrimeLineItem shape
 * that matchReturnPrimeLinesToOrderLines expects.
 */
function normalizeLineItems(raw: unknown): Array<{
    id: string;
    shopify_line_id: string;
    sku: string | undefined;
    quantity: number;
    price: number | undefined;
    reason: string | undefined;
}> {
    if (!Array.isArray(raw)) return [];
    return (raw as StoredLineItem[]).map(li => ({
        id: String(li.id),
        shopify_line_id: String(li.id), // In RP, line id IS the Shopify line item ID
        sku: li.original_product?.sku ?? undefined,
        quantity: li.quantity,
        price: li.original_product?.price ?? li.shop_price?.actual_amount ?? undefined,
        reason: li.reason ?? undefined,
    }));
}

// ============================================
// MAIN BACKFILL
// ============================================

async function main(): Promise<void> {
    console.log(`\n=== Return Prime Backfill ${DRY_RUN ? '(DRY RUN)' : '(EXECUTE MODE)'} ===\n`);

    // Find approved RP requests that are NOT yet linked to any OrderLine
    const totalCount = await prisma.returnPrimeRequest.count({
        where: {
            isApproved: true,
            orderId: { not: null },
        },
    });

    // Get IDs of RP requests already processed (linked to OrderLines)
    const alreadyLinked = await prisma.orderLine.findMany({
        where: { returnPrimeRequestId: { not: null } },
        select: { returnPrimeRequestId: true },
        distinct: ['returnPrimeRequestId'],
    });
    const linkedIds = new Set(alreadyLinked.map(ol => ol.returnPrimeRequestId!));

    console.log(`Total approved RP requests with orderId: ${totalCount}`);
    console.log(`Already linked to OrderLines: ${linkedIds.size}`);

    const stats = {
        processed: 0,
        created: 0,
        skippedNoOrder: 0,
        skippedNoMatch: 0,
        skippedAlreadyLinked: 0,
        errors: 0,
        linesCreated: 0,
    };

    let skip = 0;
    let hasMore = true;

    while (hasMore) {
        const requests = await prisma.returnPrimeRequest.findMany({
            where: {
                isApproved: true,
                orderId: { not: null },
            },
            orderBy: { rpCreatedAt: 'asc' },
            skip,
            take: CHUNK_SIZE,
        });

        if (requests.length === 0) {
            hasMore = false;
            break;
        }

        for (const rp of requests) {
            stats.processed++;

            try {
                // Skip if already linked
                if (linkedIds.has(rp.rpRequestId)) {
                    stats.skippedAlreadyLinked++;
                    continue;
                }

                // Find the ERP order with its lines
                const order = await prisma.order.findUnique({
                    where: { id: rp.orderId! },
                    include: {
                        orderLines: {
                            include: { sku: { select: { skuCode: true } } },
                        },
                    },
                });

                if (!order) {
                    stats.skippedNoOrder++;
                    continue;
                }

                // Normalize the stored lineItems JSON
                const rpLineItems = normalizeLineItems(rp.lineItems);
                if (rpLineItems.length === 0) {
                    console.warn(`  [SKIP] ${rp.rpRequestNumber}: no line items in JSON`);
                    stats.skippedNoMatch++;
                    continue;
                }

                // Match lines
                const { matched, unmatched, alreadyReturning } = matchReturnPrimeLinesToOrderLines(
                    rpLineItems,
                    order.orderLines.map(ol => ({
                        id: ol.id,
                        shopifyLineId: ol.shopifyLineId,
                        skuId: ol.skuId,
                        qty: ol.qty,
                        returnStatus: ol.returnStatus,
                        sku: { skuCode: ol.sku.skuCode },
                    }))
                );

                if (matched.length === 0) {
                    if (unmatched.length > 0 || alreadyReturning.length > 0) {
                        console.warn(`  [SKIP] ${rp.rpRequestNumber} (${order.orderNumber}): ${getMatchSummary({ matched, unmatched, alreadyReturning })}`);
                    }
                    stats.skippedNoMatch++;
                    continue;
                }

                // Determine ERP status from RP flags
                const erpReturnStatus = mapRpStatusToErp(rp);
                const rpPrimeStatus = mapRpPrimeStatus(rp);
                const resolution = rp.requestType === 'exchange' ? 'exchange' : 'refund';
                const reason = mapReturnPrimeReason(rp.primaryReason);
                const now = new Date();

                if (DRY_RUN) {
                    console.log(`  [DRY] ${rp.rpRequestNumber} → ${order.orderNumber}: ${matched.length} lines, status=${erpReturnStatus}, rpStatus=${rpPrimeStatus}`);
                    stats.created++;
                    stats.linesCreated += matched.length;
                    continue;
                }

                // Generate batch number
                const batchNumber = await generateBatchNumber(order.id, order.orderNumber);

                // Execute in transaction
                await prisma.$transaction(async (tx) => {
                    for (const { orderLine, rpLine } of matched) {
                        await tx.orderLine.update({
                            where: { id: orderLine.id },
                            data: {
                                returnBatchNumber: batchNumber,
                                returnStatus: erpReturnStatus,
                                returnQty: rpLine.quantity,
                                returnRequestedAt: rp.approvedAt || now,

                                returnReasonCategory: reason,
                                returnReasonDetail: rpLine.reason || null,
                                returnResolution: resolution,

                                // RP tracking
                                returnPrimeRequestId: rp.rpRequestId,
                                returnPrimeRequestNumber: rp.rpRequestNumber,
                                returnPrimeStatus: rpPrimeStatus,
                                returnPrimeCreatedAt: rp.rpCreatedAt,
                                returnPrimeUpdatedAt: now,

                                // If received, set receivedAt
                                ...(rp.isReceived && rp.receivedAt ? { returnReceivedAt: rp.receivedAt } : {}),

                                // If refunded, set refund fields
                                ...(rp.isRefunded ? {
                                    returnRefundCompletedAt: rp.refundedAt || now,
                                    returnRefundMethod: 'payment_link' as const,
                                    refundedAt: rp.refundedAt || now,
                                } : {}),

                                // If rejected
                                ...(rp.isRejected ? {
                                    returnResolution: 'rejected',
                                    returnClosedReason: 'Rejected in Return Prime',
                                } : {}),
                            },
                        });

                        // Increment SKU return count
                        await tx.sku.update({
                            where: { id: orderLine.skuId },
                            data: { returnCount: { increment: rpLine.quantity } },
                        });
                    }

                    // Increment customer return count (once per batch)
                    if (order.customerId) {
                        await tx.customer.update({
                            where: { id: order.customerId },
                            data: { returnCount: { increment: 1 } },
                        });
                    }
                });

                stats.created++;
                stats.linesCreated += matched.length;

                if (stats.created % 50 === 0) {
                    console.log(`  Progress: ${stats.created} batches created (${stats.linesCreated} lines)...`);
                }
            } catch (error: unknown) {
                stats.errors++;
                const msg = error instanceof Error ? error.message : 'Unknown';
                console.error(`  [ERROR] ${rp.rpRequestNumber}: ${msg}`);
            }
        }

        skip += requests.length;
    }

    console.log('\n=== Results ===');
    console.log(`Processed:           ${stats.processed}`);
    console.log(`Created:             ${stats.created} batches (${stats.linesCreated} lines)`);
    console.log(`Skipped (linked):    ${stats.skippedAlreadyLinked}`);
    console.log(`Skipped (no order):  ${stats.skippedNoOrder}`);
    console.log(`Skipped (no match):  ${stats.skippedNoMatch}`);
    console.log(`Errors:              ${stats.errors}`);
    console.log(DRY_RUN ? '\nRe-run with --execute to apply changes.' : '\nDone!');
}

main()
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
