/**
 * One-time migration: Align Outward (Live) layout with Orders from COH.
 *
 * Steps:
 * 1. Read existing Outward (Live) rows (if any) — remap old format to new
 * 2. Write new header row (A1:AE1) matching Orders from COH headers
 * 3. Re-write remapped data rows
 * 4. Update Inventory tab col C formula (Outward Live cols A→G, B→I)
 * 5. Update Balance (Final) col E formula (same column shift)
 *
 * Old layout: A=SKU, B=Qty, C=Product, D=Date, E=Destination, F=Order#,
 *   G=SamplingDate, H=OrderNote, I=COHNote, J=Courier, K=AWB, L=AWBScan, M=Notes, N=OrderDate
 *
 * New layout: Matches Orders from COH (A-AD) + AE=Outward Date
 *   A=OrderDate, B=Order#, C=Name, D=City, E=Mob, F=Channel, G=SKU, H=ProductName,
 *   I=Qty, J=Status, K=OrderNote, L=COHNote, ... Z=Courier, AA=AWB, AC=AWBScan, AE=OutwardDate
 *
 * Usage: npx tsx server/scripts/migrate-outward-live-layout.ts [--dry-run]
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Config ──────────────────────────────────────────────
const ORDERS_MASTERSHEET_ID = '1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo';
const OFFICE_LEDGER_ID = '1ZZgzu4xPXhP9ba3-liXHxj5tY0HihoEnVC9-wLijD5E';
const KEY_PATH = resolve(import.meta.dirname, '../config/google-service-account.json');

const OUTWARD_LIVE_TAB = 'Outward (Live)';
const INVENTORY_TAB = 'Inventory';
const BALANCE_TAB = 'Balance (Final)';

const dryRun = process.argv.includes('--dry-run');

// New header row for Outward (Live) — matches Orders from COH + Outward Date
const NEW_HEADERS = [
    'Order Date',       // A
    'Order #',          // B
    'Name',             // C
    'City',             // D
    'Mob',              // E
    'Channel',          // F
    'SKU',              // G
    'Product Name',     // H
    'Qty',              // I
    'Status',           // J
    'Order Note',       // K
    'COH Note',         // L
    'Qty Balance',      // M
    'Assigned',         // N
    'Picked',           // O
    'Order Age',        // P
    'source_',          // Q
    'samplingDate',     // R
    'Fabric Stock',     // S
    '',                 // T (empty)
    'Packed',           // U
    '',                 // V (empty)
    '',                 // W (empty)
    'Shipped',          // X
    'Shopify Status',   // Y
    'Courier',          // Z
    'AWB',              // AA
    'Ready To Ship',    // AB
    'AWB Scan',         // AC
    'Outward Done',     // AD
    'Outward Date',     // AE
];

// Old column indices (current Outward Live format)
const OLD = {
    SKU: 0,         // A
    QTY: 1,         // B
    PRODUCT: 2,     // C
    DATE: 3,        // D
    DESTINATION: 4, // E
    ORDER_NO: 5,    // F
    SAMPLING_DATE: 6, // G
    ORDER_NOTE: 7,  // H
    COH_NOTE: 8,    // I
    COURIER: 9,     // J
    AWB: 10,        // K
    AWB_SCAN: 11,   // L
    NOTES: 12,      // M
    ORDER_DATE: 13, // N
};

// New column indices (matching Orders from COH)
const NEW = {
    ORDER_DATE: 0,      // A
    ORDER_NO: 1,        // B
    SKU: 6,             // G
    PRODUCT: 7,         // H
    QTY: 8,             // I
    ORDER_NOTE: 10,     // K
    COH_NOTE: 11,       // L
    SAMPLING_DATE: 17,  // R
    COURIER: 25,        // Z
    AWB: 26,            // AA
    AWB_SCAN: 28,       // AC
    OUTWARD_DATE: 30,   // AE
};

async function main() {
    if (dryRun) console.log('=== DRY RUN — no changes ===\n');

    const keyFile = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
    const auth = new google.auth.JWT({
        email: keyFile.client_email,
        key: keyFile.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // ── Step 1: Read existing Outward (Live) data ────────
    console.log('Reading existing Outward (Live) data...');
    const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: ORDERS_MASTERSHEET_ID,
        range: `'${OUTWARD_LIVE_TAB}'!A:N`,
        valueRenderOption: 'FORMATTED_VALUE',
    });
    const existingRows = resp.data.values ?? [];
    const dataRows = existingRows.length > 1 ? existingRows.slice(1) : [];
    console.log(`  Found ${dataRows.length} existing data rows`);

    // ── Step 2: Remap old rows to new layout ──────────────
    const remappedRows: string[][] = [];
    for (const row of dataRows) {
        const sku = String(row[OLD.SKU] ?? '').trim();
        if (!sku) continue; // Skip empty rows

        // Create a 31-column row (A-AE)
        const newRow: string[] = new Array(31).fill('');

        // Remap fields from old positions to new positions
        newRow[NEW.ORDER_DATE] = String(row[OLD.ORDER_DATE] ?? '');   // N→A (order date)
        newRow[NEW.ORDER_NO] = String(row[OLD.ORDER_NO] ?? '');       // F→B (order number)
        newRow[NEW.SKU] = sku;                                         // A→G (SKU)
        newRow[NEW.PRODUCT] = String(row[OLD.PRODUCT] ?? '');          // C→H (product name)
        newRow[NEW.QTY] = String(row[OLD.QTY] ?? '');                  // B→I (qty)
        newRow[NEW.ORDER_NOTE] = String(row[OLD.ORDER_NOTE] ?? '');    // H→K (order note)
        newRow[NEW.COH_NOTE] = String(row[OLD.COH_NOTE] ?? '');        // I→L (COH note)
        newRow[NEW.SAMPLING_DATE] = String(row[OLD.SAMPLING_DATE] ?? ''); // G→R (sampling date)
        newRow[NEW.COURIER] = String(row[OLD.COURIER] ?? '');          // J→Z (courier)
        newRow[NEW.AWB] = String(row[OLD.AWB] ?? '');                  // K→AA (AWB)
        newRow[NEW.AWB_SCAN] = String(row[OLD.AWB_SCAN] ?? '');       // L→AC (AWB scan)
        newRow[NEW.OUTWARD_DATE] = String(row[OLD.DATE] ?? '');        // D→AE (outward date)

        remappedRows.push(newRow);
    }

    console.log(`  Remapped ${remappedRows.length} non-empty rows to new layout`);

    if (remappedRows.length > 0) {
        console.log('\nSample remapped row:');
        const s = remappedRows[0];
        console.log(`  A (Order Date): "${s[0]}"`);
        console.log(`  B (Order #):    "${s[1]}"`);
        console.log(`  G (SKU):        "${s[6]}"`);
        console.log(`  H (Product):    "${s[7]}"`);
        console.log(`  I (Qty):        "${s[8]}"`);
        console.log(`  Z (Courier):    "${s[25]}"`);
        console.log(`  AA (AWB):       "${s[26]}"`);
        console.log(`  AE (Outward Date): "${s[30]}"`);
    }

    if (dryRun) {
        console.log('\n=== DRY RUN — would write headers + remapped data + updated formulas ===');
        console.log(`  Headers: 1 row, ${NEW_HEADERS.length} columns`);
        console.log(`  Data: ${remappedRows.length} rows`);
        console.log('  Inventory formulas: ~6,510 rows');
        console.log('  Balance formulas: ~6,510 rows');
        return;
    }

    // ── Step 3: Clear and write new data ──────────────────
    console.log('\nClearing Outward (Live) tab...');
    await sheets.spreadsheets.values.clear({
        spreadsheetId: ORDERS_MASTERSHEET_ID,
        range: `'${OUTWARD_LIVE_TAB}'!A:AE`,
    });

    // Write header
    console.log('Writing new header row...');
    await sheets.spreadsheets.values.update({
        spreadsheetId: ORDERS_MASTERSHEET_ID,
        range: `'${OUTWARD_LIVE_TAB}'!A1:AE1`,
        valueInputOption: 'RAW',
        requestBody: { values: [NEW_HEADERS] },
    });

    // Write remapped data
    if (remappedRows.length > 0) {
        console.log(`Writing ${remappedRows.length} remapped rows...`);
        await sheets.spreadsheets.values.update({
            spreadsheetId: ORDERS_MASTERSHEET_ID,
            range: `'${OUTWARD_LIVE_TAB}'!A2:AE${remappedRows.length + 1}`,
            valueInputOption: 'RAW',
            requestBody: { values: remappedRows },
        });
    }

    console.log('Outward (Live) layout migrated successfully.');

    // ── Step 4: Update Inventory tab col C formulas ───────
    console.log('\nUpdating Inventory tab col C formulas...');
    const invResp = await sheets.spreadsheets.values.get({
        spreadsheetId: ORDERS_MASTERSHEET_ID,
        range: `'${INVENTORY_TAB}'!A:A`,
        valueRenderOption: 'FORMATTED_VALUE',
    });
    const invRows = invResp.data.values ?? [];
    const invDataStart = 3; // 0-indexed (row 4, 1-indexed)

    const colCFormulas: string[][] = [];
    for (let i = invDataStart; i < invRows.length; i++) {
        const row = i + 1; // 1-based
        const formula = `=R${row}+SUMIF('Inward (Live)'!$A:$A,$A${row},'Inward (Live)'!$B:$B)-SUMIF('Outward (Live)'!$G:$G,$A${row},'Outward (Live)'!$I:$I)`;
        colCFormulas.push([formula]);
    }

    if (colCFormulas.length > 0) {
        const cRange = `'${INVENTORY_TAB}'!C${invDataStart + 1}:C${invDataStart + colCFormulas.length}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId: ORDERS_MASTERSHEET_ID,
            range: cRange,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: colCFormulas },
        });
        console.log(`  Updated ${colCFormulas.length} Inventory col C formulas (Outward cols G:G, I:I)`);
    }

    // ── Step 5: Update Balance (Final) col E formulas ─────
    console.log('\nUpdating Balance (Final) col E formulas...');
    const balResp = await sheets.spreadsheets.values.get({
        spreadsheetId: OFFICE_LEDGER_ID,
        range: `'${BALANCE_TAB}'!A:A`,
        valueRenderOption: 'FORMATTED_VALUE',
    });
    const balRows = balResp.data.values ?? [];
    const balDataStart = 2; // 0-indexed (row 3, 1-indexed)

    const colEFormulas: string[][] = [];
    for (let i = balDataStart; i < balRows.length; i++) {
        const row = i + 1; // 1-based
        const formula = `=F${row}+IFERROR(SUMIF(IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$A:$A"),$A${row},IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$B:$B")),0)-IFERROR(SUMIF(IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$G:$G"),$A${row},IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$I:$I")),0)`;
        colEFormulas.push([formula]);
    }

    if (colEFormulas.length > 0) {
        const eRange = `'${BALANCE_TAB}'!E${balDataStart + 1}:E${balDataStart + colEFormulas.length}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId: OFFICE_LEDGER_ID,
            range: eRange,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: colEFormulas },
        });
        console.log(`  Updated ${colEFormulas.length} Balance (Final) col E formulas (Outward cols G:G, I:I)`);
    }

    console.log('\nMigration complete!');
    console.log('  1. Outward (Live) headers and data migrated to new layout');
    console.log('  2. Inventory tab col C formulas updated');
    console.log('  3. Balance (Final) col E formulas updated');
    console.log('\nNext steps:');
    console.log('  - Spot-check 10 SKU balances in Inventory tab and Balance (Final)');
    console.log('  - Deploy code changes');
    console.log('  - Test copy-paste workflow from Orders from COH to Outward (Live)');
}

main().catch(err => {
    console.error('Failed:', err.message ?? err);
    process.exit(1);
});
