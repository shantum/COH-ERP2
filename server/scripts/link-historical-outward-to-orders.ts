/**
 * Link historical outward InventoryTransactions to their OrderLines.
 *
 * Now that orderNumber is backfilled on historical ms-outward transactions,
 * this script finds OrderLines that have outward evidence but still show
 * a pre-ship lineStatus (pending, allocated, picked, packed) and updates
 * them to 'shipped'.
 *
 * Only updates lines where:
 * - A matching outward InventoryTransaction exists (by orderNumber + skuId)
 * - lineStatus is NOT already 'shipped' or 'cancelled'
 *
 * Non-destructive: only updates pre-ship statuses. Skips shipped/cancelled.
 *
 * Usage:
 *   npx tsx server/scripts/link-historical-outward-to-orders.ts              # dry-run
 *   npx tsx server/scripts/link-historical-outward-to-orders.ts --write      # apply
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const shouldWrite = process.argv.includes('--write');

const LINKABLE_STATUSES = ['pending', 'allocated', 'picked', 'packed'];

async function main() {
    console.log(`Mode: ${shouldWrite ? 'WRITE' : 'DRY-RUN'}\n`);

    // Step 1: Find all unique orderNumbers from outward transactions
    console.log('1. COUNTING OUTWARD TRANSACTIONS WITH ORDER NUMBERS...');
    const outwardCount = await prisma.inventoryTransaction.count({
        where: {
            txnType: 'outward',
            orderNumber: { not: null },
        },
    });
    console.log(`   Total outward txns with orderNumber: ${outwardCount.toLocaleString()}\n`);

    // Step 2: Find OrderLines in linkable statuses whose orders have matching outward txns
    console.log('2. FINDING ORDER LINES WITH OUTWARD EVIDENCE BUT PRE-SHIP STATUS...');

    // Use raw SQL for this complex join query
    const linkableLines = await prisma.$queryRawUnsafe<Array<{
        line_id: string;
        order_id: string;
        order_number: string;
        sku_id: string;
        sku_code: string;
        line_qty: number;
        line_status: string;
        outward_qty: number;
        outward_date: Date;
    }>>(
        `SELECT DISTINCT ON (ol.id)
            ol.id as line_id,
            o.id as order_id,
            o."orderNumber" as order_number,
            ol."skuId" as sku_id,
            s."skuCode" as sku_code,
            ol.qty as line_qty,
            ol."lineStatus" as line_status,
            it.qty as outward_qty,
            it."createdAt" as outward_date
        FROM "OrderLine" ol
        JOIN "Order" o ON o.id = ol."orderId"
        JOIN "Sku" s ON s.id = ol."skuId"
        JOIN "InventoryTransaction" it
            ON it."orderNumber" = o."orderNumber"
            AND it."skuId" = ol."skuId"
            AND it."txnType" = 'outward'
        WHERE ol."lineStatus" IN ('pending', 'allocated', 'picked', 'packed')
        ORDER BY ol.id, it."createdAt" ASC`
    );

    console.log(`   Lines with outward evidence + pre-ship status: ${linkableLines.length}\n`);

    if (linkableLines.length === 0) {
        console.log('Nothing to link. All order lines with outward evidence are already shipped/cancelled.');
        return;
    }

    // Step 3: Show preview
    console.log('3. PREVIEW (first 20):');
    const statusDist = new Map<string, number>();
    for (const line of linkableLines) {
        statusDist.set(line.line_status, (statusDist.get(line.line_status) ?? 0) + 1);
    }

    for (const [status, count] of [...statusDist.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`   ${status.padEnd(12)} → shipped: ${count} lines`);
    }
    console.log();

    for (const line of linkableLines.slice(0, 20)) {
        console.log(`   Order #${line.order_number}  ${line.sku_code.padEnd(20)}  ${line.line_status.padEnd(10)} → shipped  (outward qty: ${line.outward_qty}, date: ${line.outward_date.toISOString().slice(0, 10)})`);
    }
    if (linkableLines.length > 20) {
        console.log(`   ... and ${linkableLines.length - 20} more`);
    }
    console.log();

    // Step 4: Validate — check for quantity mismatches
    let qtyMatches = 0;
    let qtyMismatches = 0;
    for (const line of linkableLines) {
        if (line.line_qty === line.outward_qty) {
            qtyMatches++;
        } else {
            qtyMismatches++;
        }
    }
    console.log('4. QUANTITY VALIDATION:');
    console.log(`   Exact qty match:    ${qtyMatches}`);
    console.log(`   Qty mismatch:       ${qtyMismatches} (will still link — outward evidence is sufficient)`);
    console.log();

    if (!shouldWrite) {
        console.log(`--- DRY-RUN complete. ${linkableLines.length} lines would be updated. Use --write to apply. ---`);
        return;
    }

    // Step 5: Apply updates
    console.log('5. APPLYING UPDATES...');

    const updates = linkableLines.map(line =>
        prisma.orderLine.update({
            where: { id: line.line_id },
            data: {
                lineStatus: 'shipped',
                shippedAt: line.outward_date,
            },
        })
    );

    // Chunk into batches of 500 for transaction limits
    const BATCH_SIZE = 500;
    let totalUpdated = 0;

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        await prisma.$transaction(batch);
        totalUpdated += batch.length;
        console.log(`   Batch ${Math.floor(i / BATCH_SIZE) + 1}: updated ${batch.length} lines (total: ${totalUpdated})`);
    }

    console.log(`\n   Total updated: ${totalUpdated}\n`);

    // Step 6: Verification
    console.log('6. VERIFICATION:');

    const remainingLinkable = await prisma.$queryRawUnsafe<Array<{ cnt: string }>>(
        `SELECT COUNT(*)::text as cnt
        FROM "OrderLine" ol
        JOIN "Order" o ON o.id = ol."orderId"
        JOIN "InventoryTransaction" it
            ON it."orderNumber" = o."orderNumber"
            AND it."skuId" = ol."skuId"
            AND it."txnType" = 'outward'
        WHERE ol."lineStatus" IN ('pending', 'allocated', 'picked', 'packed')`
    );

    const totalShipped = await prisma.orderLine.count({
        where: { lineStatus: 'shipped' },
    });

    console.log(`   Lines still in pre-ship status with outward evidence: ${remainingLinkable[0]?.cnt ?? '?'}`);
    console.log(`   Total shipped lines: ${totalShipped.toLocaleString()}`);
    console.log('\nDone.');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
