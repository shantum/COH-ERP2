/**
 * Switch Inventory tab col C to use ERP-based balance.
 *
 * Current: col C = SUMIF('Office Inventory') — indirect chain through Office Ledger
 * New:     col C = R{row} + SUMIF(Inward Live) - SUMIF(Outward Live)
 *          col R = ERP currentBalance (written by worker after each ingestion cycle)
 *
 * Since Inward (Live) and Outward (Live) are in the SAME spreadsheet,
 * no IMPORTRANGE needed — formulas are fast and real-time.
 *
 * Usage: npx tsx server/scripts/switch-inventory-formula.ts [--dry-run]
 */

import 'dotenv/config';
import { google, type sheets_v4 } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';

// ── Config ──────────────────────────────────────────────
const SPREADSHEET_ID = '1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo';
const KEY_PATH = resolve(import.meta.dirname, '../config/google-service-account.json');
const INVENTORY_TAB = 'Inventory';
const DATA_START_ROW = 4; // Row 1=header labels, Row 2=sums, Row 3=column headers, Row 4+=data

const dryRun = process.argv.includes('--dry-run');

async function main() {
    if (dryRun) console.log('=== DRY RUN — no changes ===\n');

    const keyFile = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
    const auth = new google.auth.JWT({
        email: keyFile.client_email,
        key: keyFile.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // ── Step 1: Get sheet metadata ──────────────────
    console.log('Getting sheet metadata...');
    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        includeGridData: false,
    });

    const inventorySheet = spreadsheet.data.sheets?.find(
        s => s.properties?.title === INVENTORY_TAB
    );

    if (!inventorySheet?.properties) {
        throw new Error(`"${INVENTORY_TAB}" tab not found`);
    }

    const sheetId = inventorySheet.properties.sheetId!;
    const currentCols = inventorySheet.properties.gridProperties?.columnCount ?? 17;
    console.log(`  Sheet ID: ${sheetId}, current columns: ${currentCols}`);

    // ── Step 2: Expand grid if needed (add col R = index 17) ────
    const targetCols = 18; // A(0) through R(17)
    if (currentCols < targetCols) {
        console.log(`  Expanding grid from ${currentCols} to ${targetCols} columns...`);
        if (!dryRun) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    requests: [{
                        appendDimension: {
                            sheetId,
                            dimension: 'COLUMNS',
                            length: targetCols - currentCols,
                        },
                    }],
                },
            });
        }
    } else {
        console.log(`  Grid already has ${currentCols} columns (>= ${targetCols}), no expansion needed`);
    }

    // ── Step 3: Read Inventory col A (SKU codes) ────
    console.log('\nReading Inventory col A...');
    const colAResp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${INVENTORY_TAB}'!A:A`,
        valueRenderOption: 'FORMATTED_VALUE',
    });
    const allRows = colAResp.data.values ?? [];
    console.log(`  Total rows: ${allRows.length}`);

    // Also read current col C values for verification
    const colCResp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${INVENTORY_TAB}'!C:C`,
        valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const oldColC = colCResp.data.values ?? [];

    // Collect data rows (starting from DATA_START_ROW, 1-indexed = row 4, 0-indexed = 3)
    const dataStartIdx = DATA_START_ROW - 1; // 0-indexed
    const skuRows: Array<{ idx: number; skuCode: string; oldBalance: number }> = [];

    for (let i = dataStartIdx; i < allRows.length; i++) {
        const skuCode = String(allRows[i]?.[0] ?? '').trim();
        if (!skuCode) continue;
        const oldBal = Number(oldColC[i]?.[0] ?? 0);
        skuRows.push({ idx: i, skuCode, oldBalance: isNaN(oldBal) ? 0 : oldBal });
    }
    console.log(`  SKUs with data: ${skuRows.length}`);

    // ── Step 4: Get ERP currentBalance ──────────────
    console.log('\nQuerying ERP for currentBalance...');
    const prisma = new PrismaClient();

    try {
        const skuBalances = await prisma.sku.findMany({
            where: { skuCode: { in: skuRows.map(s => s.skuCode) } },
            select: { skuCode: true, currentBalance: true },
        });

        const erpMap = new Map<string, number>();
        for (const s of skuBalances) {
            erpMap.set(s.skuCode, s.currentBalance);
        }
        console.log(`  ERP SKUs found: ${erpMap.size}`);

        const notInErp = skuRows.filter(s => !erpMap.has(s.skuCode));
        if (notInErp.length > 0) {
            console.log(`  ${notInErp.length} sheet SKUs not in ERP (will write 0)`);
        }

        // ── Step 5: Build col R values (ERP currentBalance) ────
        const colRValues: number[][] = [];
        for (let i = dataStartIdx; i < allRows.length; i++) {
            const skuCode = String(allRows[i]?.[0] ?? '').trim();
            const balance = skuCode ? (erpMap.get(skuCode) ?? 0) : 0;
            colRValues.push([balance]);
        }

        // ── Step 6: Build col C formulas ────────────────────
        // Formula: =R{row} + SUMIF('Inward (Live)'!$A:$A, $A{row}, 'Inward (Live)'!$B:$B)
        //                   - SUMIF('Outward (Live)'!$A:$A, $A{row}, 'Outward (Live)'!$B:$B)
        const colCFormulas: string[][] = [];
        for (let i = dataStartIdx; i < allRows.length; i++) {
            const row = i + 1; // 1-based
            const formula = `=R${row}+SUMIF('Inward (Live)'!$A:$A,$A${row},'Inward (Live)'!$B:$B)-SUMIF('Outward (Live)'!$A:$A,$A${row},'Outward (Live)'!$B:$B)`;
            colCFormulas.push([formula]);
        }

        console.log(`\nPrepared ${colRValues.length} col R values and ${colCFormulas.length} col C formulas`);

        // Sample
        if (skuRows.length > 0) {
            const s = skuRows[0];
            console.log(`\nSample (row ${s.idx + 1}, SKU: ${s.skuCode}):`);
            console.log(`  Old col C: ${s.oldBalance}`);
            console.log(`  ERP balance (col R): ${colRValues[s.idx - dataStartIdx]?.[0]}`);
            console.log(`  Formula (col C): ${colCFormulas[s.idx - dataStartIdx]?.[0]?.slice(0, 80)}...`);
        }

        if (dryRun) {
            console.log('\n=== DRY RUN — comparing balances ===');
            let matches = 0, mismatches = 0;
            for (const s of skuRows) {
                const erpBal = erpMap.get(s.skuCode) ?? 0;
                // With empty live tabs, new C = R = erpBal
                if (erpBal === s.oldBalance) matches++;
                else {
                    mismatches++;
                    if (mismatches <= 10) {
                        console.log(`  MISMATCH: ${s.skuCode} — sheet: ${s.oldBalance}, ERP: ${erpBal}, diff: ${erpBal - s.oldBalance}`);
                    }
                }
            }
            console.log(`\nBalance comparison: ${matches} match, ${mismatches} mismatch`);
            return;
        }

        // ── Step 7: Write col R header ──────────────────
        console.log('\nWriting col R header...');
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${INVENTORY_TAB}'!R1`,
            valueInputOption: 'RAW',
            requestBody: { values: [['ERP Balance']] },
        });
        // Also write header in row 3
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${INVENTORY_TAB}'!R3`,
            valueInputOption: 'RAW',
            requestBody: { values: [['ERP Bal']] },
        });

        // ── Step 8: Write col R values ──────────────────
        console.log('Writing col R (ERP currentBalance)...');
        const rRange = `'${INVENTORY_TAB}'!R${DATA_START_ROW}:R${DATA_START_ROW + colRValues.length - 1}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: rRange,
            valueInputOption: 'RAW',
            requestBody: { values: colRValues },
        });
        console.log(`  Written ${colRValues.length} values to ${rRange}`);

        // ── Step 9: Write col C formulas ────────────────
        console.log('Writing col C formulas...');
        const cRange = `'${INVENTORY_TAB}'!C${DATA_START_ROW}:C${DATA_START_ROW + colCFormulas.length - 1}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: cRange,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: colCFormulas },
        });
        console.log(`  Written ${colCFormulas.length} formulas to ${cRange}`);

        // ── Step 10: Update col C sum in row 2 ─────────
        console.log('Updating row 2 sum formula...');
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${INVENTORY_TAB}'!C2`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['=sum(C4:C)']] },
        });

        // ── Step 11: Verify ─────────────────────────────
        console.log('\nWaiting 3s for formulas to calculate...');
        await new Promise(r => setTimeout(r, 3000));

        const newColCResp = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${INVENTORY_TAB}'!C:C`,
            valueRenderOption: 'UNFORMATTED_VALUE',
        });
        const newColC = newColCResp.data.values ?? [];

        let matches = 0, mismatches = 0;
        for (const s of skuRows) {
            const newBal = Number(newColC[s.idx]?.[0] ?? 0);
            if (Math.abs(newBal - s.oldBalance) <= 0.01) matches++;
            else {
                mismatches++;
                if (mismatches <= 10) {
                    console.log(`  MISMATCH: ${s.skuCode} — old: ${s.oldBalance}, new: ${newBal}, diff: ${newBal - s.oldBalance}`);
                }
            }
        }
        console.log(`\nVerification: ${matches} match, ${mismatches} mismatch out of ${skuRows.length}`);

        console.log('\nDone! Inventory tab is now ERP-based.');
        console.log('  Col R = ERP currentBalance (updated by worker)');
        console.log('  Col C = R + Inward (Live) - Outward (Live)');
        console.log('  Col D = allocated (from Orders from COH — unchanged)');
        console.log('  Col E = C - D (net balance — unchanged)');

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('Failed:', err.message ?? err);
    process.exit(1);
});
