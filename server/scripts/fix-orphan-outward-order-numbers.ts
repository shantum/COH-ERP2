/**
 * Fix orphan outward InventoryTransactions whose orderNumber doesn't match any Order.
 *
 * Historical outward txns were stored with the sheet's order number format,
 * which may differ from the ERP's Order.orderNumber:
 *   - Myntra short:  "a5331f8c"  →  "a5331f8c-xxxx-yyyy-zzzz" (full UUID)
 *   - Myntra combo:  "35d4288c - 9659143096"  →  "35d4288c-xxxx-..." (short+btId combo)
 *   - Nykaa:         "NYK-xxx-1"  →  "NYK-xxx-1--1" (missing --1 suffix)
 *
 * This script:
 *   Step 1: Finds all orphan outward txns (orderNumber not in Order table)
 *   Step 2: Tries alternate format matching to find the real ERP order
 *   Step 3: Updates the txn's orderNumber to the real ERP value
 *   Step 4: Links unlinked OrderLines to shipped (same as link-historical-outward-to-orders.ts)
 *
 * Usage:
 *   npx tsx server/scripts/fix-orphan-outward-order-numbers.ts           # dry-run
 *   npx tsx server/scripts/fix-orphan-outward-order-numbers.ts --write   # apply changes
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const shouldWrite = process.argv.includes('--write');

async function main() {
    console.log(`Mode: ${shouldWrite ? 'WRITE' : 'DRY-RUN'}\n`);

    // ── Step 1: Find orphan txns ──────────────────────────────────────
    console.log('1. FINDING ORPHAN OUTWARD TXNS...');

    const orphanTxns = await prisma.$queryRaw<Array<{
        id: string;
        orderNumber: string;
        skuId: string;
        createdAt: Date;
    }>>`
        SELECT it.id, it."orderNumber", it."skuId", it."createdAt"
        FROM "InventoryTransaction" it
        WHERE it."txnType" = 'outward'
        AND it."orderNumber" IS NOT NULL
        AND it."orderNumber" NOT IN (SELECT "orderNumber" FROM "Order")
    `;

    console.log(`   Found ${orphanTxns.length} orphan outward txns\n`);
    if (orphanTxns.length === 0) {
        console.log('Nothing to fix.');
        return;
    }

    // ── Step 2: Load all channel orders for matching ──────────────────
    console.log('2. LOADING CHANNEL ORDERS FOR MATCHING...');

    const channelOrders = await prisma.order.findMany({
        where: { channel: { in: ['myntra', 'nykaa', 'ajio'] } },
        select: { orderNumber: true, channel: true },
    });
    console.log(`   ${channelOrders.length} channel orders loaded\n`);

    // Build lookup structures
    const exactSet = new Set(channelOrders.map(o => o.orderNumber));

    // Myntra: full UUID keyed by first 8 chars
    const myntraByShort = new Map<string, string>();
    for (const o of channelOrders) {
        if (o.channel === 'myntra' && o.orderNumber.includes('-')) {
            const short = o.orderNumber.split('-')[0];
            myntraByShort.set(short.toLowerCase(), o.orderNumber);
        }
    }

    // Nykaa: both with and without --1
    const nykaaAlternates = new Map<string, string>();
    for (const o of channelOrders) {
        if (o.channel !== 'nykaa') continue;
        if (o.orderNumber.endsWith('--1')) {
            nykaaAlternates.set(o.orderNumber.slice(0, -3), o.orderNumber);
        } else {
            nykaaAlternates.set(o.orderNumber + '--1', o.orderNumber);
        }
    }

    // ── Step 3: Try alternate matching ────────────────────────────────
    console.log('3. MATCHING ORPHAN TXNS TO ORDERS...');

    interface Fix {
        txnId: string;
        fromOrderNumber: string;
        toOrderNumber: string;
        method: string;
    }

    const fixes: Fix[] = [];
    const unmatched: string[] = [];
    const seenOrphans = new Set<string>();

    for (const txn of orphanTxns) {
        const n = txn.orderNumber;

        // Skip if already matched (same orderNumber, different txn)
        // but still record the fix for each txn
        let erpOrderNumber: string | null = null;
        let method = '';

        // Myntra short form: "a5331f8c"
        if (/^[0-9a-f]{8}$/i.test(n)) {
            const found = myntraByShort.get(n.toLowerCase());
            if (found) {
                erpOrderNumber = found;
                method = 'myntra-short→full';
            }
        }

        // Myntra combo: "35d4288c - 9659143096"
        if (!erpOrderNumber) {
            const comboMatch = n.match(/^([0-9a-f]{8})\s*-\s*\d+$/i);
            if (comboMatch) {
                const short = comboMatch[1].toLowerCase();
                const found = myntraByShort.get(short);
                if (found) {
                    erpOrderNumber = found;
                    method = 'myntra-combo→full';
                }
            }
        }

        // Nykaa without --1 → try with --1
        if (!erpOrderNumber && n.startsWith('NYK-') && !n.endsWith('--1')) {
            const found = nykaaAlternates.get(n);
            if (found) {
                erpOrderNumber = found;
                method = 'nykaa-add-suffix';
            }
        }

        // Nykaa with --1 → try without
        if (!erpOrderNumber && n.endsWith('--1')) {
            const trimmed = n.slice(0, -3);
            const found = nykaaAlternates.get(n) ?? (exactSet.has(trimmed) ? trimmed : null);
            if (found) {
                erpOrderNumber = found;
                method = 'nykaa-strip-suffix';
            }
        }

        if (erpOrderNumber) {
            fixes.push({
                txnId: txn.id,
                fromOrderNumber: n,
                toOrderNumber: erpOrderNumber,
                method,
            });
        } else {
            if (!seenOrphans.has(n)) {
                unmatched.push(n);
                seenOrphans.add(n);
            }
        }
    }

    // Summarize
    const byMethod = new Map<string, number>();
    for (const f of fixes) {
        byMethod.set(f.method, (byMethod.get(f.method) ?? 0) + 1);
    }

    console.log(`   Fixable: ${fixes.length} txns`);
    for (const [method, count] of [...byMethod.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`     ${method}: ${count}`);
    }
    console.log(`   Unmatched: ${unmatched.length} unique order numbers (${orphanTxns.length - fixes.length} txns)`);
    console.log();

    // Show samples
    if (fixes.length > 0) {
        console.log('   Sample fixes (first 15):');
        const shown = new Set<string>();
        for (const f of fixes) {
            if (shown.size >= 15) break;
            const key = `${f.fromOrderNumber}→${f.toOrderNumber}`;
            if (shown.has(key)) continue;
            shown.add(key);
            console.log(`     ${f.method.padEnd(20)} ${f.fromOrderNumber} → ${f.toOrderNumber}`);
        }
        console.log();
    }

    if (unmatched.length > 0) {
        console.log('   Sample unmatched (first 10):');
        for (const n of unmatched.slice(0, 10)) {
            console.log(`     ${n}`);
        }
        console.log();
    }

    // ── Step 4: Apply orderNumber fixes ───────────────────────────────
    if (fixes.length > 0 && shouldWrite) {
        console.log('4. UPDATING ORDER NUMBERS...');

        const BATCH_SIZE = 500;
        let totalUpdated = 0;

        for (let i = 0; i < fixes.length; i += BATCH_SIZE) {
            const batch = fixes.slice(i, i + BATCH_SIZE);
            await prisma.$transaction(
                batch.map(f => prisma.inventoryTransaction.update({
                    where: { id: f.txnId },
                    data: { orderNumber: f.toOrderNumber },
                }))
            );
            totalUpdated += batch.length;
            console.log(`   Batch ${Math.floor(i / BATCH_SIZE) + 1}: updated ${batch.length} txns (total: ${totalUpdated})`);
        }

        console.log(`   Done: ${totalUpdated} txns updated\n`);
    } else if (fixes.length > 0) {
        console.log(`4. SKIPPED (dry-run) — would update ${fixes.length} txns\n`);
    }

    // ── Step 5: Link OrderLines ───────────────────────────────────────
    console.log('5. FINDING UNLINKED ORDER LINES WITH OUTWARD EVIDENCE...');

    const linkableLines = await prisma.$queryRaw<Array<{
        line_id: string;
        order_number: string;
        sku_code: string;
        line_status: string;
        outward_date: Date;
    }>>`
        SELECT DISTINCT ON (ol.id)
            ol.id as line_id,
            o."orderNumber" as order_number,
            s."skuCode" as sku_code,
            ol."lineStatus" as line_status,
            it."createdAt" as outward_date
        FROM "OrderLine" ol
        JOIN "Order" o ON o.id = ol."orderId"
        JOIN "Sku" s ON s.id = ol."skuId"
        JOIN "InventoryTransaction" it
            ON it."orderNumber" = o."orderNumber"
            AND it."skuId" = ol."skuId"
            AND it."txnType" = 'outward'
        WHERE o.channel IN ('myntra', 'nykaa', 'ajio')
        AND ol."lineStatus" IN ('pending', 'allocated', 'picked', 'packed')
        ORDER BY ol.id, it."createdAt" ASC
    `;

    console.log(`   Lines with outward evidence + pre-ship status: ${linkableLines.length}\n`);

    if (linkableLines.length > 0) {
        // Preview
        const statusDist = new Map<string, number>();
        for (const line of linkableLines) {
            statusDist.set(line.line_status, (statusDist.get(line.line_status) ?? 0) + 1);
        }
        for (const [status, count] of [...statusDist.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`   ${status.padEnd(12)} → shipped: ${count} lines`);
        }
        console.log();

        for (const line of linkableLines.slice(0, 15)) {
            console.log(`   ${line.order_number.substring(0, 30).padEnd(32)} ${line.sku_code.padEnd(16)} ${line.line_status} → shipped`);
        }
        if (linkableLines.length > 15) {
            console.log(`   ... and ${linkableLines.length - 15} more`);
        }
        console.log();

        if (shouldWrite) {
            console.log('6. LINKING ORDER LINES...');

            const BATCH_SIZE = 500;
            let totalLinked = 0;

            for (let i = 0; i < linkableLines.length; i += BATCH_SIZE) {
                const batch = linkableLines.slice(i, i + BATCH_SIZE);
                await prisma.$transaction(
                    batch.map(line => prisma.orderLine.update({
                        where: { id: line.line_id },
                        data: {
                            lineStatus: 'shipped',
                            shippedAt: line.outward_date,
                        },
                    }))
                );
                totalLinked += batch.length;
                console.log(`   Batch ${Math.floor(i / BATCH_SIZE) + 1}: linked ${batch.length} lines (total: ${totalLinked})`);
            }
            console.log(`   Done: ${totalLinked} lines marked shipped\n`);
        } else {
            console.log(`6. SKIPPED (dry-run) — would link ${linkableLines.length} lines\n`);
        }
    }

    // ── Summary ───────────────────────────────────────────────────────
    console.log('=== SUMMARY ===');
    console.log(`Orphan txns found:        ${orphanTxns.length}`);
    console.log(`Order numbers fixed:      ${shouldWrite ? fixes.length : `${fixes.length} (pending --write)`}`);
    console.log(`Order lines linkable:     ${linkableLines.length}${shouldWrite ? ' (linked)' : ' (pending --write)'}`);
    console.log(`Unmatched (no ERP order): ${unmatched.length} unique order numbers`);

    if (!shouldWrite && (fixes.length > 0 || linkableLines.length > 0)) {
        console.log(`\nRun with --write to apply changes.`);
    }
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
