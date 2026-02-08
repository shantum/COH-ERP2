/**
 * Analyze historical outward transactions — extract order numbers from referenceIds
 * and match to ERP Orders.
 *
 * Historical ms-outward referenceId format:
 *   sheet:ms-outward:{SKU}:{qty}:{orderNumber}:{rowIndex}
 *
 * The order number is in segment 5 (1-indexed) of the colon-separated referenceId.
 *
 * Usage:
 *   npx tsx server/scripts/analyze-historical-order-matching.ts
 *   npx tsx server/scripts/analyze-historical-order-matching.ts --verbose
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const verbose = process.argv.includes('--verbose');

function normalizeOrderNumber(raw: string): string {
    return raw.trim().replace(/^#/, '').toLowerCase();
}

function classifyOrderNumber(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return 'empty';
    if (/^\d+$/.test(trimmed)) return 'shopify_numeric';
    if (/^[a-f0-9]{8}$/i.test(trimmed)) return 'uuid_fragment';
    if (/^FN/i.test(trimmed)) return 'flipkart';
    if (/^NYK/i.test(trimmed)) return 'nykaa';
    if (/^AMZ/i.test(trimmed)) return 'amazon';
    if (/^\d{10,}$/.test(trimmed)) return 'shopify_long_id';
    if (/^R\d/i.test(trimmed)) return 'return';
    return 'other';
}

async function main() {
    console.log('=== Historical Outward → Order Matching Analysis ===\n');

    // Step 1: Extract order numbers from ms-outward referenceIds
    console.log('1. EXTRACTING ORDER NUMBERS FROM REFERENCEIDS...');
    const historicalTxns = await prisma.$queryRawUnsafe<Array<{
        id: string;
        sku_id: string;
        sku_code: string;
        qty: number;
        reference_id: string;
        extracted_order: string;
        created_at: Date;
    }>>(
        `SELECT
            it.id,
            it."skuId" as sku_id,
            s."skuCode" as sku_code,
            it.qty,
            it."referenceId" as reference_id,
            split_part(it."referenceId", ':', 5) as extracted_order,
            it."createdAt" as created_at
        FROM "InventoryTransaction" it
        JOIN "Sku" s ON s.id = it."skuId"
        WHERE it."txnType" = 'outward'
        AND it."referenceId" LIKE 'sheet:ms-outward%'
        ORDER BY it."createdAt" ASC`
    );

    console.log(`   Total ms-outward txns: ${historicalTxns.length.toLocaleString()}\n`);

    // Step 2: Classify extracted order numbers
    const formatCounts = new Map<string, number>();
    const orderNumberTxns = new Map<string, typeof historicalTxns>(); // normalized order# → txns
    let emptyOrders = 0;

    for (const txn of historicalTxns) {
        const raw = txn.extracted_order;
        if (!raw || raw.trim() === '') {
            emptyOrders++;
            continue;
        }
        const fmt = classifyOrderNumber(raw);
        formatCounts.set(fmt, (formatCounts.get(fmt) ?? 0) + 1);

        const norm = normalizeOrderNumber(raw);
        if (!orderNumberTxns.has(norm)) {
            orderNumberTxns.set(norm, []);
        }
        orderNumberTxns.get(norm)!.push(txn);
    }

    console.log('2. ORDER NUMBER FORMAT DISTRIBUTION');
    const sortedFormats = [...formatCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [fmt, count] of sortedFormats) {
        console.log(`   ${fmt.padEnd(20)} ${String(count).padStart(8)} (${pct(count, historicalTxns.length)})`);
    }
    if (emptyOrders > 0) {
        console.log(`   empty                 ${String(emptyOrders).padStart(8)}`);
    }
    console.log();

    // Step 3: Load all ERP orders
    console.log('3. LOADING ERP ORDERS...');
    const allOrders = await prisma.order.findMany({
        select: {
            id: true,
            orderNumber: true,
            orderDate: true,
            status: true,
            orderLines: {
                select: {
                    id: true,
                    skuId: true,
                    qty: true,
                    lineStatus: true,
                    shippedAt: true,
                },
            },
        },
    });

    const orderMap = new Map<string, typeof allOrders[0]>();
    for (const order of allOrders) {
        const norm = normalizeOrderNumber(order.orderNumber);
        orderMap.set(norm, order);
    }

    console.log(`   ERP Orders: ${allOrders.length.toLocaleString()}`);
    console.log(`   Unique normalized: ${orderMap.size.toLocaleString()}`);
    console.log();

    // Step 4: Match only Shopify-numeric order numbers to ERP
    let matchedTxns = 0;
    let unmatchedTxns = 0;
    let matchedLineLevel = 0;
    let matchedExactQty = 0;
    let matchedOrders = 0;
    let unmatchedOrders = 0;
    const unmatchedSamples: string[] = [];

    const lineStatusDist = new Map<string, number>();
    const orderStatusDist = new Map<string, number>();

    // Group by unique order number for Shopify numeric only
    const shopifyGroups = new Map<string, typeof historicalTxns>();
    for (const [norm, txns] of orderNumberTxns) {
        const fmt = classifyOrderNumber(txns[0].extracted_order);
        if (fmt === 'shopify_numeric') {
            shopifyGroups.set(norm, txns);
        }
    }

    console.log('4. MATCHING SHOPIFY ORDERS TO ERP');
    console.log(`   Unique Shopify order numbers: ${shopifyGroups.size.toLocaleString()}`);

    for (const [normOrder, txns] of shopifyGroups) {
        const order = orderMap.get(normOrder);
        if (!order) {
            unmatchedTxns += txns.length;
            unmatchedOrders++;
            if (unmatchedSamples.length < 15) {
                unmatchedSamples.push(txns[0].extracted_order);
            }
            continue;
        }

        matchedTxns += txns.length;
        matchedOrders++;

        // Track order-level status
        const os = order.status || 'null';
        orderStatusDist.set(os, (orderStatusDist.get(os) ?? 0) + 1);

        // Build SKU lookup for order lines
        const linesBySkuId = new Map<string, typeof order.orderLines[0]>();
        for (const line of order.orderLines) {
            linesBySkuId.set(line.skuId, line);
        }

        // Match txn SKU to order line
        for (const txn of txns) {
            const line = linesBySkuId.get(txn.sku_id);
            if (line) {
                matchedLineLevel++;
                if (line.qty === txn.qty) matchedExactQty++;

                const ls = line.lineStatus || 'null';
                lineStatusDist.set(ls, (lineStatusDist.get(ls) ?? 0) + 1);
            }
        }
    }

    const totalShopifyTxns = matchedTxns + unmatchedTxns;
    console.log(`   Total Shopify txns:         ${totalShopifyTxns.toLocaleString()}`);
    console.log(`   Matched to ERP Order:       ${matchedTxns.toLocaleString()} (${pct(matchedTxns, totalShopifyTxns)})`);
    console.log(`   Matched to OrderLine (SKU): ${matchedLineLevel.toLocaleString()} (${pct(matchedLineLevel, totalShopifyTxns)})`);
    console.log(`   Exact qty match:            ${matchedExactQty.toLocaleString()} (${pct(matchedExactQty, totalShopifyTxns)})`);
    console.log(`   No ERP Order found:         ${unmatchedTxns.toLocaleString()} (${pct(unmatchedTxns, totalShopifyTxns)})`);
    console.log();

    console.log(`   Unique orders matched:      ${matchedOrders.toLocaleString()} / ${shopifyGroups.size.toLocaleString()}`);
    console.log(`   Unique orders unmatched:    ${unmatchedOrders.toLocaleString()}`);
    console.log();

    // Step 5: Line status distribution of matched orders
    console.log('5. LINE STATUS OF MATCHED ORDERS');
    const sortedLS = [...lineStatusDist.entries()].sort((a, b) => b[1] - a[1]);
    for (const [status, count] of sortedLS) {
        console.log(`   ${status.padEnd(20)} ${String(count).padStart(8)}`);
    }
    console.log();

    console.log('6. ORDER STATUS OF MATCHED ORDERS');
    const sortedOS = [...orderStatusDist.entries()].sort((a, b) => b[1] - a[1]);
    for (const [status, count] of sortedOS) {
        console.log(`   ${status.padEnd(20)} ${String(count).padStart(8)}`);
    }
    console.log();

    // Step 6: For matched orders, how many lines are "shipped" vs "pending"?
    // This tells us if the ERP already knows about the shipment or not
    let linesAlreadyShipped = 0;
    let linesPending = 0;
    let linesOther = 0;

    for (const [normOrder, txns] of shopifyGroups) {
        const order = orderMap.get(normOrder);
        if (!order) continue;

        for (const line of order.orderLines) {
            if (line.lineStatus === 'shipped') linesAlreadyShipped++;
            else if (line.lineStatus === 'pending') linesPending++;
            else linesOther++;
        }
    }

    console.log('7. FULFILLMENT STATUS GAP');
    console.log(`   Lines currently "shipped":  ${linesAlreadyShipped.toLocaleString()}`);
    console.log(`   Lines currently "pending":  ${linesPending.toLocaleString()}`);
    console.log(`   Lines other status:         ${linesOther.toLocaleString()}`);
    console.log(`   → ${linesPending.toLocaleString()} order lines have sheet evidence of dispatch but ERP shows "pending"`);
    console.log();

    // Step 7: Non-Shopify breakdown
    const nonShopifyCounts = new Map<string, number>();
    for (const [norm, txns] of orderNumberTxns) {
        const fmt = classifyOrderNumber(txns[0].extracted_order);
        if (fmt !== 'shopify_numeric') {
            nonShopifyCounts.set(fmt, (nonShopifyCounts.get(fmt) ?? 0) + txns.length);
        }
    }

    console.log('8. NON-SHOPIFY ORDER BREAKDOWN');
    for (const [fmt, count] of [...nonShopifyCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`   ${fmt.padEnd(20)} ${String(count).padStart(8)}`);
    }
    console.log();

    // Verbose
    if (verbose && unmatchedSamples.length > 0) {
        console.log('--- SAMPLE: Unmatched Shopify order numbers (first 15) ---');
        for (const on of unmatchedSamples) {
            console.log(`   ${on}`);
        }
        console.log();

        // Check if these are just old orders before ERP existed
        console.log('--- Checking date range of unmatched orders ---');
        const unmatchedDates = new Map<string, { min: Date; max: Date; count: number }>();
        for (const [normOrder, txns] of shopifyGroups) {
            if (!orderMap.has(normOrder)) {
                for (const txn of txns) {
                    const key = 'unmatched';
                    const existing = unmatchedDates.get(key);
                    if (!existing) {
                        unmatchedDates.set(key, { min: txn.created_at, max: txn.created_at, count: 1 });
                    } else {
                        if (txn.created_at < existing.min) existing.min = txn.created_at;
                        if (txn.created_at > existing.max) existing.max = txn.created_at;
                        existing.count++;
                    }
                }
            }
        }
        for (const [key, val] of unmatchedDates) {
            console.log(`   ${key}: ${val.count} txns, created ${val.min.toISOString().slice(0, 10)} to ${val.max.toISOString().slice(0, 10)}`);
        }
        console.log();
    }

    // Summary
    console.log('=== SUMMARY ===');
    console.log();
    console.log(`Historical ms-outward txns:    ${historicalTxns.length.toLocaleString()}`);
    console.log(`  → With extractable order#:   ${(historicalTxns.length - emptyOrders).toLocaleString()}`);
    console.log(`  → Shopify numeric:           ${totalShopifyTxns.toLocaleString()}`);
    console.log(`  → Matched to ERP Orders:     ${matchedTxns.toLocaleString()} (${pct(matchedTxns, totalShopifyTxns)})`);
    console.log(`  → Matched to OrderLines:     ${matchedLineLevel.toLocaleString()} (${pct(matchedLineLevel, totalShopifyTxns)})`);
    console.log();
    console.log(`CONCLUSION:`);
    console.log(`  ${linesPending} order lines have outward evidence in InventoryTransaction`);
    console.log(`  but currently show lineStatus="pending" in the ERP.`);
    console.log(`  These can be derived as "shipped" by matching outward txns to orders.`);
}

function pct(num: number, total: number): string {
    if (total === 0) return '0.0%';
    return `${((num / total) * 100).toFixed(1)}%`;
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
