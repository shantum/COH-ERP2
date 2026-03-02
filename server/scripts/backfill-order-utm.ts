/**
 * Backfill UTM attribution fields on Order records.
 *
 * Two sources:
 * 1. Shopify note_attributes (from ShopifyOrderCache) — orders with UTM in checkout metadata
 * 2. Shopflo CSV export (--csv flag) — fills Shopflo checkout orders that lack note_attributes
 *
 * Usage:
 *   cd server && npx tsx scripts/backfill-order-utm.ts [--dry-run] [--months 3]
 *   cd server && npx tsx scripts/backfill-order-utm.ts --csv /path/to/shopflo-utm.csv [--dry-run]
 *   --months N  limits note_attributes scan to last N months (default: 3)
 *   --csv       also imports from Shopflo CSV (no date filter, uses all rows)
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');
const csvIdx = process.argv.indexOf('--csv');
const CSV_PATH = csvIdx !== -1 ? process.argv[csvIdx + 1] : null;
const monthsIdx = process.argv.indexOf('--months');
const MONTHS = monthsIdx !== -1 ? parseInt(process.argv[monthsIdx + 1], 10) : 3;
const BATCH_SIZE = 500;

interface NoteAttribute {
    name: string;
    value: string;
}

const UTM_KEYS: Record<string, string> = {
    utm_source: 'utmSource',
    utm_medium: 'utmMedium',
    utm_campaign: 'utmCampaign',
    utm_term: 'utmTerm',
    fbclid: 'fbclid',
    gclid: 'gclid',
    landing_page: 'landingPage',
    _landing_page: 'landingPage',
};

function extractUtm(noteAttributes: NoteAttribute[]): Record<string, string> | null {
    const result: Record<string, string> = {};
    let found = false;

    for (const attr of noteAttributes) {
        const key = UTM_KEYS[attr.name?.toLowerCase()];
        if (key && attr.value) {
            result[key] = attr.value;
            found = true;
        }
    }

    return found ? result : null;
}

/** Parse a CSV line that uses quoted fields */
function parseCsvLine(line: string): string[] {
    const cols: string[] = [];
    let i = 0;
    while (i < line.length) {
        if (line[i] === '"') {
            const end = line.indexOf('"', i + 1);
            cols.push(line.slice(i + 1, end === -1 ? undefined : end));
            i = end === -1 ? line.length : end + 2;
        } else {
            const end = line.indexOf(',', i);
            cols.push(line.slice(i, end === -1 ? undefined : end));
            i = end === -1 ? line.length : end + 1;
        }
    }
    return cols;
}

async function backfillFromNoteAttributes(prisma: PrismaClient) {
    const since = new Date();
    since.setMonth(since.getMonth() - MONTHS);
    console.log(`\n--- Source 1: Shopify note_attributes (last ${MONTHS} months, since ${since.toISOString().slice(0, 10)}) ---`);

    // Get orders in date range that don't have UTM yet and have a shopify cache
    const orders = await prisma.order.findMany({
        where: {
            orderDate: { gte: since },
            utmSource: null,
            shopifyOrderId: { not: null },
        },
        select: {
            id: true,
            shopifyOrderId: true,
        },
        orderBy: { orderDate: 'desc' },
    });

    console.log(`  Found ${orders.length} orders without UTM in date range`);

    let totalUpdated = 0;
    let totalWithUtm = 0;

    // Process in batches
    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);
        const cacheIds = batch.map(o => o.shopifyOrderId!);

        const caches = await prisma.shopifyOrderCache.findMany({
            where: { id: { in: cacheIds } },
            select: { id: true, noteAttributesJson: true, rawData: true },
        });

        const cacheMap = new Map(caches.map(c => [c.id, c]));

        for (const order of batch) {
            const cache = cacheMap.get(order.shopifyOrderId!);
            if (!cache) continue;

            let noteAttrs: NoteAttribute[] | null = null;
            if (cache.noteAttributesJson) {
                try { noteAttrs = JSON.parse(cache.noteAttributesJson); } catch { /* ignore */ }
            }
            if (!noteAttrs && cache.rawData) {
                try { noteAttrs = JSON.parse(cache.rawData).note_attributes ?? null; } catch { /* ignore */ }
            }
            if (!noteAttrs || noteAttrs.length === 0) continue;

            const utm = extractUtm(noteAttrs);
            if (!utm) continue;

            totalWithUtm++;
            if (!DRY_RUN) {
                await prisma.order.update({ where: { id: order.id }, data: utm });
                totalUpdated++;
            }
        }

        process.stdout.write(`\r  Processed ${Math.min(i + BATCH_SIZE, orders.length)}/${orders.length}, ${totalWithUtm} with UTM...`);
    }

    if (DRY_RUN) totalUpdated = totalWithUtm;
    console.log(`\n  Done: ${totalWithUtm} with UTM, ${totalUpdated} updated${DRY_RUN ? ' (would)' : ''}`);
    return totalUpdated;
}

async function backfillFromShopfloCsv(prisma: PrismaClient, csvPath: string) {
    console.log(`\n--- Source 2: Shopflo CSV (${csvPath}) ---`);

    const content = fs.readFileSync(csvPath, 'utf8').trim();
    const lines = content.split('\n');
    const rows = lines.slice(1).map(parseCsvLine);

    console.log(`  CSV rows: ${rows.length}`);

    // CSV columns: Order ID, Platform Order ID, Landing Page URL, Orig Referrer,
    //              UTM Source, UTM Medium, UTM Campaign, UTM Term, UTM Content
    let updated = 0;
    let skipped = 0;
    let noMatch = 0;
    let noUtm = 0;

    for (let i = 0; i < rows.length; i++) {
        const cols = rows[i];
        const shopifyId = cols[0];
        const landingPage = cols[2] || null;
        const utmSource = cols[4] || null;
        const utmMedium = cols[5] || null;
        const utmCampaign = cols[6] || null;
        const utmTerm = cols[7] || null;

        if (!shopifyId) continue;
        if (!utmSource && !landingPage) { noUtm++; continue; }

        const order = await prisma.order.findUnique({
            where: { shopifyOrderId: shopifyId },
            select: { id: true, utmSource: true },
        });

        if (!order) { noMatch++; continue; }
        if (order.utmSource) { skipped++; continue; }

        const data: Record<string, string> = {};
        if (utmSource) data.utmSource = utmSource;
        if (utmMedium) data.utmMedium = utmMedium;
        if (utmCampaign) data.utmCampaign = utmCampaign;
        if (utmTerm) data.utmTerm = utmTerm;
        if (landingPage) data.landingPage = landingPage;

        if (Object.keys(data).length === 0) { noUtm++; continue; }

        if (!DRY_RUN) {
            await prisma.order.update({ where: { id: order.id }, data });
        }
        updated++;

        if ((i + 1) % 200 === 0) process.stdout.write(`\r  Processed ${i + 1}/${rows.length}...`);
    }

    console.log(`\r  Done: ${updated} updated${DRY_RUN ? ' (would)' : ''}, ${skipped} already had UTM, ${noMatch} no DB match, ${noUtm} no UTM data`);
    return updated;
}

async function main() {
    const prisma = new PrismaClient();
    console.log(`Backfill Order UTM fields ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);

    let total = 0;

    // Always run note_attributes backfill
    total += await backfillFromNoteAttributes(prisma);

    // Optionally run Shopflo CSV backfill (fills gaps left by note_attributes)
    if (CSV_PATH) {
        if (!fs.existsSync(CSV_PATH)) {
            console.error(`CSV file not found: ${CSV_PATH}`);
            process.exit(1);
        }
        total += await backfillFromShopfloCsv(prisma, CSV_PATH);
    }

    console.log(`\n=== Total orders updated: ${total}${DRY_RUN ? ' (would update)' : ''} ===`);
    await prisma.$disconnect();
}

main().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
