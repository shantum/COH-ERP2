/**
 * Analyze how outward InventoryTransactions match to ERP Orders.
 *
 * This script answers:
 * 1. How many outward txns have an orderNumber?
 * 2. What format are the order numbers in?
 * 3. How many match ERP Orders (exact vs normalized)?
 * 4. How many have matching OrderLines by SKU within the order?
 * 5. What are the edge cases (qty mismatches, partial matches)?
 *
 * Usage:
 *   npx tsx server/scripts/analyze-outward-order-matching.ts
 *   npx tsx server/scripts/analyze-outward-order-matching.ts --verbose
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const verbose = process.argv.includes('--verbose');

// ============================================
// ORDER NUMBER NORMALIZATION
// ============================================

/**
 * Normalize an order number for matching.
 * Shopify stores as "#12345", sheets may have "12345", "#12345", etc.
 */
function normalizeOrderNumber(raw: string): string {
    return raw.trim().replace(/^#/, '').toLowerCase();
}

/**
 * Classify an order number by format.
 */
function classifyOrderNumber(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return 'empty';
    // Pure numeric (possibly with # prefix)
    const stripped = trimmed.replace(/^#/, '');
    if (/^\d+$/.test(stripped)) return 'shopify_numeric';
    // Known marketplace prefixes
    if (/^FN/i.test(trimmed)) return 'flipkart';
    if (/^NYK/i.test(trimmed)) return 'nykaa';
    if (/^AMZ/i.test(trimmed)) return 'amazon';
    if (/^R\d/i.test(trimmed)) return 'return';
    if (/^EX/i.test(trimmed)) return 'exchange';
    return 'other';
}

// ============================================
// MAIN ANALYSIS
// ============================================

async function main() {
    console.log('=== Outward → Order Matching Analysis ===\n');

    // Step 1: Count outward transactions by orderNumber presence
    const [totalOutward, withOrderNumber, withoutOrderNumber] = await Promise.all([
        prisma.inventoryTransaction.count({ where: { txnType: 'outward' } }),
        prisma.inventoryTransaction.count({ where: { txnType: 'outward', orderNumber: { not: null } } }),
        prisma.inventoryTransaction.count({ where: { txnType: 'outward', orderNumber: null } }),
    ]);

    console.log('1. OUTWARD TRANSACTION OVERVIEW');
    console.log(`   Total outward txns:        ${totalOutward.toLocaleString()}`);
    console.log(`   With orderNumber:           ${withOrderNumber.toLocaleString()} (${pct(withOrderNumber, totalOutward)})`);
    console.log(`   Without orderNumber:        ${withoutOrderNumber.toLocaleString()} (${pct(withoutOrderNumber, totalOutward)})`);
    console.log();

    // Step 2: Break down by reason
    const reasonCounts = await prisma.inventoryTransaction.groupBy({
        by: ['reason'],
        where: { txnType: 'outward' },
        _count: true,
        orderBy: { _count: { reason: 'desc' } },
    });

    console.log('2. OUTWARD BY REASON');
    for (const r of reasonCounts) {
        const hasOrder = await prisma.inventoryTransaction.count({
            where: { txnType: 'outward', reason: r.reason, orderNumber: { not: null } },
        });
        console.log(`   ${(r.reason ?? 'null').padEnd(20)} ${String(r._count).padStart(8)} total  |  ${String(hasOrder).padStart(8)} with order#`);
    }
    console.log();

    // Step 3: Fetch all outward txns with order numbers
    const outwardWithOrders = await prisma.inventoryTransaction.findMany({
        where: { txnType: 'outward', orderNumber: { not: null } },
        select: {
            id: true,
            orderNumber: true,
            skuId: true,
            qty: true,
            reason: true,
            referenceId: true,
            createdAt: true,
            sku: { select: { skuCode: true } },
        },
    });

    // Step 4: Classify order number formats
    const formatCounts = new Map<string, number>();
    for (const txn of outwardWithOrders) {
        const fmt = classifyOrderNumber(txn.orderNumber!);
        formatCounts.set(fmt, (formatCounts.get(fmt) ?? 0) + 1);
    }

    console.log('3. ORDER NUMBER FORMAT DISTRIBUTION');
    const sortedFormats = [...formatCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [fmt, count] of sortedFormats) {
        console.log(`   ${fmt.padEnd(20)} ${String(count).padStart(8)} (${pct(count, outwardWithOrders.length)})`);
    }
    console.log();

    // Step 5: Build normalized order number lookup from ERP Orders
    const allOrders = await prisma.order.findMany({
        select: {
            id: true,
            orderNumber: true,
            orderLines: {
                select: {
                    id: true,
                    skuId: true,
                    qty: true,
                    lineStatus: true,
                },
            },
        },
    });

    // Map: normalizedOrderNumber → Order
    const orderMap = new Map<string, typeof allOrders[0]>();
    for (const order of allOrders) {
        const norm = normalizeOrderNumber(order.orderNumber);
        orderMap.set(norm, order);
    }

    console.log(`   ERP Orders loaded: ${allOrders.length.toLocaleString()}`);
    console.log(`   Unique normalized keys: ${orderMap.size.toLocaleString()}`);
    console.log();

    // Step 6: Match outward txns to orders
    let matchedToOrder = 0;
    let matchedToOrderLine = 0;
    let matchedToOrderLineExactQty = 0;
    let unmatchedToOrder = 0;
    let marketplaceSkipped = 0;

    // Group outward txns by normalized order number
    const txnsByNormOrder = new Map<string, typeof outwardWithOrders>();
    for (const txn of outwardWithOrders) {
        const norm = normalizeOrderNumber(txn.orderNumber!);
        const fmt = classifyOrderNumber(txn.orderNumber!);

        // Skip non-Shopify orders (can't match to ERP)
        if (fmt !== 'shopify_numeric') {
            marketplaceSkipped++;
            continue;
        }

        if (!txnsByNormOrder.has(norm)) {
            txnsByNormOrder.set(norm, []);
        }
        txnsByNormOrder.get(norm)!.push(txn);
    }

    const unmatchedOrders: string[] = [];
    const partialMatches: Array<{ orderNumber: string; txnSkus: string[]; orderSkus: string[] }> = [];
    const qtyMismatches: Array<{ orderNumber: string; sku: string; txnQty: number; orderQty: number }> = [];

    for (const [normOrder, txns] of txnsByNormOrder) {
        const order = orderMap.get(normOrder);
        if (!order) {
            unmatchedToOrder += txns.length;
            if (unmatchedOrders.length < 20) {
                unmatchedOrders.push(txns[0].orderNumber!);
            }
            continue;
        }

        matchedToOrder += txns.length;

        // Build SKU lookup for this order's lines
        const orderLinesBySkuId = new Map<string, typeof order.orderLines[0]>();
        for (const line of order.orderLines) {
            orderLinesBySkuId.set(line.skuId, line);
        }

        // Try to match each txn to an order line by SKU
        let allLinesMatched = true;
        for (const txn of txns) {
            const matchingLine = orderLinesBySkuId.get(txn.skuId);
            if (matchingLine) {
                matchedToOrderLine++;
                if (matchingLine.qty === txn.qty) {
                    matchedToOrderLineExactQty++;
                } else if (qtyMismatches.length < 20) {
                    qtyMismatches.push({
                        orderNumber: txn.orderNumber!,
                        sku: txn.sku.skuCode,
                        txnQty: txn.qty,
                        orderQty: matchingLine.qty,
                    });
                }
            } else {
                allLinesMatched = false;
            }
        }

        if (!allLinesMatched && partialMatches.length < 10) {
            partialMatches.push({
                orderNumber: txns[0].orderNumber!,
                txnSkus: txns.map(t => t.sku.skuCode),
                orderSkus: order.orderLines.map(l => l.skuId),
            });
        }
    }

    const shopifyTxns = outwardWithOrders.length - marketplaceSkipped;

    console.log('4. MATCHING RESULTS (Shopify orders only)');
    console.log(`   Shopify outward txns:       ${shopifyTxns.toLocaleString()}`);
    console.log(`   Matched to ERP Order:       ${matchedToOrder.toLocaleString()} (${pct(matchedToOrder, shopifyTxns)})`);
    console.log(`   Matched to OrderLine (SKU): ${matchedToOrderLine.toLocaleString()} (${pct(matchedToOrderLine, shopifyTxns)})`);
    console.log(`   Exact qty match:            ${matchedToOrderLineExactQty.toLocaleString()} (${pct(matchedToOrderLineExactQty, shopifyTxns)})`);
    console.log(`   No ERP Order found:         ${unmatchedToOrder.toLocaleString()} (${pct(unmatchedToOrder, shopifyTxns)})`);
    console.log(`   Marketplace (skipped):      ${marketplaceSkipped.toLocaleString()}`);
    console.log();

    // Step 7: Check unique order numbers
    const uniqueTxnOrders = new Set(outwardWithOrders.map(t => normalizeOrderNumber(t.orderNumber!)));
    const uniqueShopifyOrders = new Set(
        outwardWithOrders
            .filter(t => classifyOrderNumber(t.orderNumber!) === 'shopify_numeric')
            .map(t => normalizeOrderNumber(t.orderNumber!))
    );
    const matchedUniqueOrders = [...uniqueShopifyOrders].filter(n => orderMap.has(n));
    const unmatchedUniqueOrders = [...uniqueShopifyOrders].filter(n => !orderMap.has(n));

    console.log('5. UNIQUE ORDER NUMBERS');
    console.log(`   Unique order numbers (all): ${uniqueTxnOrders.size.toLocaleString()}`);
    console.log(`   Unique Shopify orders:      ${uniqueShopifyOrders.size.toLocaleString()}`);
    console.log(`   Matched to ERP:             ${matchedUniqueOrders.length.toLocaleString()} (${pct(matchedUniqueOrders.length, uniqueShopifyOrders.size)})`);
    console.log(`   Not in ERP:                 ${unmatchedUniqueOrders.length.toLocaleString()}`);
    console.log();

    // Step 8: For matched orders, check current lineStatus
    const lineStatuses = new Map<string, number>();
    for (const [normOrder, txns] of txnsByNormOrder) {
        const order = orderMap.get(normOrder);
        if (!order) continue;
        for (const line of order.orderLines) {
            const status = line.lineStatus || 'null';
            lineStatuses.set(status, (lineStatuses.get(status) ?? 0) + 1);
        }
    }

    console.log('6. LINE STATUS OF MATCHED ORDERS (what lineStatus do these orders currently have?)');
    const sortedStatuses = [...lineStatuses.entries()].sort((a, b) => b[1] - a[1]);
    for (const [status, count] of sortedStatuses) {
        console.log(`   ${status.padEnd(20)} ${String(count).padStart(8)}`);
    }
    console.log();

    // Step 9: Check for duplicate coverage — orders that have BOTH allocation txns AND sheet sale txns
    const ordersWithAllocation = await prisma.inventoryTransaction.findMany({
        where: {
            txnType: 'outward',
            reason: 'order_allocation',
        },
        select: { referenceId: true, skuId: true, qty: true },
    });

    // referenceId = OrderLine.id for allocations
    const allocatedLineIds = new Set(ordersWithAllocation.map(t => t.referenceId).filter(Boolean));

    // For matched orders, check if any OrderLines also have allocation txns
    let doubleCountedLines = 0;
    let doubleCountedOrders = new Set<string>();
    for (const [normOrder, txns] of txnsByNormOrder) {
        const order = orderMap.get(normOrder);
        if (!order) continue;
        for (const line of order.orderLines) {
            if (allocatedLineIds.has(line.id)) {
                // This line has BOTH an allocation AND a sheet outward for the same order
                doubleCountedLines++;
                doubleCountedOrders.add(normOrder);
            }
        }
    }

    console.log('7. DOUBLE-COUNTING RISK');
    console.log(`   OrderLines with allocation txn:  ${allocatedLineIds.size.toLocaleString()}`);
    console.log(`   Of those, also in matched orders: ${doubleCountedLines} (${doubleCountedOrders.size} unique orders)`);
    if (doubleCountedLines > 0) {
        console.log(`   ⚠️  These orders have BOTH ERP allocation AND sheet outward — potential double deduction`);
    } else {
        console.log(`   ✅ No overlap — no double-counting risk`);
    }
    console.log();

    // Step 10: Verbose output
    if (verbose) {
        if (unmatchedOrders.length > 0) {
            console.log('--- SAMPLE: Unmatched order numbers (first 20) ---');
            for (const on of unmatchedOrders) {
                console.log(`   ${on}`);
            }
            console.log();
        }

        if (qtyMismatches.length > 0) {
            console.log('--- SAMPLE: Qty mismatches (first 20) ---');
            for (const m of qtyMismatches) {
                console.log(`   Order ${m.orderNumber} / ${m.sku}: txn qty=${m.txnQty}, order qty=${m.orderQty}`);
            }
            console.log();
        }

        if (partialMatches.length > 0) {
            console.log('--- SAMPLE: Partial matches (order found but some SKUs missing, first 10) ---');
            for (const pm of partialMatches) {
                console.log(`   Order ${pm.orderNumber}:`);
                console.log(`     Txn SKUs:   ${pm.txnSkus.join(', ')}`);
                console.log(`     Order SKUs: ${pm.orderSkus.length} lines`);
            }
            console.log();
        }

        // Show unmatched unique orders (first 20)
        if (unmatchedUniqueOrders.length > 0) {
            console.log('--- SAMPLE: Unique Shopify order numbers NOT in ERP (first 20) ---');
            for (const on of unmatchedUniqueOrders.slice(0, 20)) {
                console.log(`   #${on}`);
            }
            console.log();
        }
    }

    // Summary
    console.log('=== SUMMARY ===');
    console.log();
    console.log(`Total outward txns with order#: ${withOrderNumber.toLocaleString()}`);
    console.log(`Shopify orders matchable:       ${shopifyTxns.toLocaleString()}`);
    console.log(`Match rate (txn → Order):       ${pct(matchedToOrder, shopifyTxns)}`);
    console.log(`Match rate (txn → OrderLine):   ${pct(matchedToOrderLine, shopifyTxns)}`);
    console.log(`Double-counting risk:           ${doubleCountedLines > 0 ? '⚠️ YES' : '✅ NONE'}`);
    console.log();

    if (matchedToOrder > 0) {
        console.log('→ Order number normalization (strip #) enables reliable matching.');
        console.log('→ SKU-level matching within orders works for linking txns to OrderLines.');
    }
    if (unmatchedToOrder > 0) {
        console.log(`→ ${unmatchedToOrder} Shopify txns have order numbers not found in ERP (old/deleted orders?)`);
    }
}

function pct(num: number, total: number): string {
    if (total === 0) return '0.0%';
    return `${((num / total) * 100).toFixed(1)}%`;
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
