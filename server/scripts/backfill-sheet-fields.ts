/**
 * Backfill missing fields on sheet-imported InventoryTransactions.
 *
 * The original ingest scripts only stored skuId, qty, reason, referenceId, notes, createdAt.
 * They did NOT extract:
 *   - Inward: source (col E), performedBy/doneBy (col F), tailorNumber (col H)
 *   - Outward (OL): destination (col E)  — only 142 of 11K have it
 *   - Outward (Mastersheet): orderNumber (col B)  — 37K already backfilled by order-linking script
 *
 * This script re-reads the Google Sheets and updates existing DB records by matching referenceId.
 *
 * Usage:
 *   tsx backfill-sheet-fields.ts              # Dry-run — show what would be updated
 *   tsx backfill-sheet-fields.ts --write      # Actually update DB
 */

import 'dotenv/config';
import { readRange } from '../src/services/googleSheetsClient.js';
import {
    OFFICE_LEDGER_ID,
    LEDGER_TABS,
    INWARD_COLS,
    OUTWARD_COLS,
    REF_PREFIX,
} from '../src/config/sync/sheets.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalizeSku(val: string | undefined): string {
    if (!val) return '';
    return val.trim().replace(/,/g, '');
}

function parseQty(val: string | undefined): number {
    if (!val?.trim()) return 0;
    const num = Math.round(Number(val.trim()));
    return num > 0 ? num : 0;
}

interface InwardUpdate {
    referenceId: string;
    source: string;
    performedBy: string;
    tailorNumber: string;
    repackingBarcode: string;
}

interface OutwardUpdate {
    referenceId: string;
    destination: string;
}

async function main() {
    const mode = process.argv.includes('--write') ? 'write' : 'dry-run';
    console.log(`Mode: ${mode.toUpperCase()}\n`);

    // ═══════════════════════════════════════
    // INWARD BACKFILL: source, performedBy, tailorNumber
    // ═══════════════════════════════════════

    const inwardUpdates: InwardUpdate[] = [];

    // 1. Inward (Final)
    {
        console.log('═══════════════════════════════════════');
        console.log('  INWARD (FINAL) — Reading sheet...');
        console.log('═══════════════════════════════════════\n');

        const rows = await readRange(OFFICE_LEDGER_ID, `'${LEDGER_TABS.INWARD_FINAL}'!A:H`);
        console.log(`Total rows: ${rows.length - 1}\n`);

        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const sku = normalizeSku(String(r[INWARD_COLS.SKU] ?? ''));
            const qty = parseQty(String(r[INWARD_COLS.QTY] ?? ''));
            const dateRaw = String(r[INWARD_COLS.DATE] ?? '').trim();
            const source = String(r[INWARD_COLS.SOURCE] ?? '').trim();
            const doneBy = String(r[INWARD_COLS.DONE_BY] ?? '').trim();
            const barcode = String(r[INWARD_COLS.BARCODE] ?? '').trim();
            const tailor = String(r[INWARD_COLS.TAILOR] ?? '').trim();

            if (!sku || qty === 0) continue;

            // Only add if there's at least one field to backfill
            if (!source && !doneBy && !tailor && !barcode) continue;

            const referenceId = `${REF_PREFIX.INWARD_FINAL}:${sku}:${qty}:${dateRaw}:${i}`;
            inwardUpdates.push({ referenceId, source, performedBy: doneBy, tailorNumber: tailor, repackingBarcode: barcode });
        }

        console.log(`  Rows with backfill data: ${inwardUpdates.length}`);
    }

    // 2. Inward (Archive)
    {
        console.log('\n═══════════════════════════════════════');
        console.log('  INWARD (ARCHIVE) — Reading sheet...');
        console.log('═══════════════════════════════════════\n');

        const rows = await readRange(OFFICE_LEDGER_ID, `'${LEDGER_TABS.INWARD_ARCHIVE}'!A:H`);
        console.log(`Total rows: ${rows.length - 1}\n`);

        const archiveStart = inwardUpdates.length;

        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const sku = normalizeSku(String(r[INWARD_COLS.SKU] ?? ''));
            const qty = parseQty(String(r[INWARD_COLS.QTY] ?? ''));
            const dateRaw = String(r[INWARD_COLS.DATE] ?? '').trim();
            const source = String(r[INWARD_COLS.SOURCE] ?? '').trim();
            const doneBy = String(r[INWARD_COLS.DONE_BY] ?? '').trim();
            const barcode = String(r[INWARD_COLS.BARCODE] ?? '').trim();
            const tailor = String(r[INWARD_COLS.TAILOR] ?? '').trim();

            if (!sku || qty === 0) continue;
            if (!source && !doneBy && !tailor && !barcode) continue;

            const referenceId = `${REF_PREFIX.INWARD_ARCHIVE}:${sku}:${qty}:${dateRaw}:${i}`;
            inwardUpdates.push({ referenceId, source, performedBy: doneBy, tailorNumber: tailor, repackingBarcode: barcode });
        }

        console.log(`  Rows with backfill data: ${inwardUpdates.length - archiveStart}`);
    }

    // Show samples
    console.log('\n--- INWARD SAMPLES ---');
    for (const u of inwardUpdates.slice(0, 5)) {
        console.log(`  ref=${u.referenceId.slice(0, 60)}...  source="${u.source}"  by="${u.performedBy}"  tailor="${u.tailorNumber}"  barcode="${u.repackingBarcode}"`);
    }

    // Field coverage stats
    const withSource = inwardUpdates.filter(u => u.source).length;
    const withPerformedBy = inwardUpdates.filter(u => u.performedBy).length;
    const withTailor = inwardUpdates.filter(u => u.tailorNumber).length;
    const withBarcode = inwardUpdates.filter(u => u.repackingBarcode).length;
    console.log(`\nInward field coverage: source=${withSource}  performedBy=${withPerformedBy}  tailorNumber=${withTailor}  repackingBarcode=${withBarcode}  (out of ${inwardUpdates.length})`);

    // ═══════════════════════════════════════
    // OUTWARD BACKFILL: destination (OL Outward tab only)
    // ═══════════════════════════════════════

    const outwardUpdates: OutwardUpdate[] = [];

    {
        console.log('\n═══════════════════════════════════════');
        console.log('  OUTWARD (OL) — Reading sheet...');
        console.log('═══════════════════════════════════════\n');

        const rows = await readRange(OFFICE_LEDGER_ID, `'${LEDGER_TABS.OUTWARD}'!A:F`);
        console.log(`Total rows: ${rows.length - 1}\n`);

        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const sku = normalizeSku(String(r[OUTWARD_COLS.SKU] ?? ''));
            const qty = parseQty(String(r[OUTWARD_COLS.QTY] ?? ''));
            const dateRaw = String(r[OUTWARD_COLS.DATE] ?? '').trim();
            const dest = String(r[OUTWARD_COLS.DESTINATION] ?? '').trim();

            if (!sku || qty === 0) continue;
            if (!dest) continue;

            const referenceId = `${REF_PREFIX.OUTWARD}:${sku}:${qty}:${dateRaw}:${i}`;
            outwardUpdates.push({ referenceId, destination: dest });
        }

        console.log(`  Rows with destination: ${outwardUpdates.length}`);
    }

    // Show samples
    console.log('\n--- OUTWARD SAMPLES ---');
    for (const u of outwardUpdates.slice(0, 5)) {
        console.log(`  ref=${u.referenceId.slice(0, 60)}...  dest="${u.destination}"`);
    }

    // ═══════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════
    console.log('\n═══════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════');
    console.log(`  Inward updates: ${inwardUpdates.length}`);
    console.log(`  Outward updates: ${outwardUpdates.length}`);
    console.log(`  Total: ${inwardUpdates.length + outwardUpdates.length}\n`);

    if (mode === 'dry-run') {
        console.log('--- DRY RUN — pass --write to update DB ---');
        await prisma.$disconnect();
        return;
    }

    // ═══════════════════════════════════════
    // WRITE MODE — Update DB records (raw SQL batch)
    // ═══════════════════════════════════════
    console.log('═══════════════════════════════════════');
    console.log('  UPDATING DATABASE (raw SQL batch)');
    console.log('═══════════════════════════════════════\n');

    // Use raw SQL UPDATE ... FROM (VALUES ...) for bulk updates
    // Each batch updates up to CHUNK_SIZE rows in a single SQL statement
    const CHUNK_SIZE = 500;
    let inwardUpdated = 0;
    let inwardNotFound = 0;

    for (let i = 0; i < inwardUpdates.length; i += CHUNK_SIZE) {
        const chunk = inwardUpdates.slice(i, i + CHUNK_SIZE);

        // Build VALUES list: ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ...
        const params: string[] = [];
        const placeholders: string[] = [];
        for (const update of chunk) {
            const idx = params.length;
            placeholders.push(`($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`);
            params.push(
                update.referenceId,
                update.source || '',
                update.performedBy || '',
                update.tailorNumber || '',
                update.repackingBarcode || '',
            );
        }

        // Single UPDATE statement — $executeRawUnsafe returns affected row count
        const affected = await prisma.$executeRawUnsafe(`
            UPDATE "InventoryTransaction" AS t
            SET
                "source" = CASE WHEN v.src != '' THEN v.src ELSE t."source" END,
                "performedBy" = CASE WHEN v.perf != '' THEN v.perf ELSE t."performedBy" END,
                "tailorNumber" = CASE WHEN v.tailor != '' THEN v.tailor ELSE t."tailorNumber" END,
                "repackingBarcode" = CASE WHEN v.barcode != '' THEN v.barcode ELSE t."repackingBarcode" END
            FROM (VALUES ${placeholders.join(', ')}) AS v(ref, src, perf, tailor, barcode)
            WHERE t."referenceId" = v.ref
        `, ...params);

        inwardUpdated += affected;
        inwardNotFound += chunk.length - affected;

        if (i % 5000 < CHUNK_SIZE) {
            console.log(`  Inward progress: ${Math.min(i + CHUNK_SIZE, inwardUpdates.length)}/${inwardUpdates.length} (updated: ${inwardUpdated})`);
        }
    }

    console.log(`\nInward: updated=${inwardUpdated}, not found=${inwardNotFound}`);

    // Batch outward updates
    let outwardUpdated = 0;
    let outwardNotFound = 0;

    for (let i = 0; i < outwardUpdates.length; i += CHUNK_SIZE) {
        const chunk = outwardUpdates.slice(i, i + CHUNK_SIZE);

        const params: string[] = [];
        const placeholders: string[] = [];
        for (const update of chunk) {
            const idx = params.length;
            placeholders.push(`($${idx + 1}, $${idx + 2})`);
            params.push(update.referenceId, update.destination);
        }

        const affected = await prisma.$executeRawUnsafe(`
            UPDATE "InventoryTransaction" AS t
            SET "destination" = v.dest
            FROM (VALUES ${placeholders.join(', ')}) AS v(ref, dest)
            WHERE t."referenceId" = v.ref
        `, ...params);

        outwardUpdated += affected;
        outwardNotFound += chunk.length - affected;

        if (i % 5000 < CHUNK_SIZE) {
            console.log(`  Outward progress: ${Math.min(i + CHUNK_SIZE, outwardUpdates.length)}/${outwardUpdates.length} (updated: ${outwardUpdated})`);
        }
    }

    console.log(`\nOutward: updated=${outwardUpdated}, not found=${outwardNotFound}`);

    // Verify
    const verifySource = await prisma.inventoryTransaction.count({
        where: { notes: { startsWith: '[sheet-offload]' }, source: { not: null } }
    });
    const verifyPerformed = await prisma.inventoryTransaction.count({
        where: { notes: { startsWith: '[sheet-offload]' }, performedBy: { not: null } }
    });
    const verifyTailor = await prisma.inventoryTransaction.count({
        where: { notes: { startsWith: '[sheet-offload]' }, tailorNumber: { not: null } }
    });
    const verifyDest = await prisma.inventoryTransaction.count({
        where: { notes: { startsWith: '[sheet-offload]' }, destination: { not: null } }
    });
    const verifyBarcode = await prisma.inventoryTransaction.count({
        where: { notes: { startsWith: '[sheet-offload]' }, repackingBarcode: { not: null } }
    });

    console.log(`\n=== VERIFICATION ===`);
    console.log(`  source: ${verifySource}`);
    console.log(`  performedBy: ${verifyPerformed}`);
    console.log(`  tailorNumber: ${verifyTailor}`);
    console.log(`  repackingBarcode: ${verifyBarcode}`);
    console.log(`  destination: ${verifyDest}`);

    await prisma.$disconnect();
}

main().catch((err: unknown) => {
    console.error('Fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
});
