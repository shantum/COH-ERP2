/**
 * Switch Balance (Final) to Phase 3 — ERP-based balance system.
 *
 * 1. Reads currentBalance for ALL SKUs from the ERP database
 * 2. Writes currentBalance to col F in Balance (Final)
 * 3. Updates col E formula to: =F{row} + SUMIF(Inward Live) - SUMIF(Outward Live)
 * 4. Verifies new col E matches old col E for all rows
 *
 * Live tabs are in the COH Orders Mastersheet, so Balance (Final) in Office Ledger
 * uses IMPORTRANGE to reference them. IMPORTRANGE must be pre-authorized
 * (open the Office Ledger sheet in browser and accept the IMPORTRANGE permission prompt).
 *
 * Usage: npx tsx server/scripts/switch-balance-formula.ts [--dry-run] [--skip-verify]
 *
 * --dry-run:      Print what would be written without modifying the sheet
 * --skip-verify:  Skip the verification step (comparing old vs new balance)
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';

// ── Config ──────────────────────────────────────────────
const OFFICE_LEDGER_ID = '1ZZgzu4xPXhP9ba3-liXHxj5tY0HihoEnVC9-wLijD5E';
const ORDERS_MASTERSHEET_ID = '1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo';
const KEY_PATH = resolve(import.meta.dirname, '../config/google-service-account.json');
const BALANCE_TAB = 'Balance (Final)';

const dryRun = process.argv.includes('--dry-run');
const skipVerify = process.argv.includes('--skip-verify');

// ── Main ────────────────────────────────────────────────

async function main() {
    if (dryRun) console.log('=== DRY RUN MODE — no sheet changes will be made ===\n');

    // ── Auth ────────────────────────────────────────
    const keyFile = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
    const auth = new google.auth.JWT({
        email: keyFile.client_email,
        key: keyFile.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // ── Step 1: Read current Balance (Final) ────────
    console.log('Reading Balance (Final) tab...');
    const balanceResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: OFFICE_LEDGER_ID,
        range: `'${BALANCE_TAB}'!A:F`,
        valueRenderOption: 'FORMATTED_VALUE',
    });
    const balanceRows = balanceResponse.data.values ?? [];
    console.log(`  Total rows: ${balanceRows.length}`);

    // Also read col E as calculated values to capture current balance
    const balanceCalcResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: OFFICE_LEDGER_ID,
        range: `'${BALANCE_TAB}'!E:E`,
        valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const oldBalanceValues = balanceCalcResponse.data.values ?? [];

    // Data starts at row 3 (index 2) — row 1 is header, row 2 is subheader
    const dataStartIndex = 2;

    // Collect SKU codes from col A
    const sheetSkus: Array<{ rowIndex: number; skuCode: string; oldBalance: number }> = [];
    for (let i = dataStartIndex; i < balanceRows.length; i++) {
        const skuCode = String(balanceRows[i]?.[0] ?? '').trim();
        if (!skuCode) continue;
        const oldBal = Number(oldBalanceValues[i]?.[0] ?? 0);
        sheetSkus.push({ rowIndex: i, skuCode, oldBalance: isNaN(oldBal) ? 0 : oldBal });
    }
    console.log(`  SKUs with data: ${sheetSkus.length}`);

    // ── Step 2: Get currentBalance from ERP ─────────
    console.log('\nQuerying ERP for currentBalance...');
    const prisma = new PrismaClient();

    try {
        const skuBalances = await prisma.sku.findMany({
            where: { skuCode: { in: sheetSkus.map(s => s.skuCode) } },
            select: { skuCode: true, currentBalance: true },
        });

        const erpBalanceMap = new Map<string, number>();
        for (const s of skuBalances) {
            erpBalanceMap.set(s.skuCode, s.currentBalance);
        }
        console.log(`  ERP SKUs found: ${erpBalanceMap.size}`);

        const notInErp = sheetSkus.filter(s => !erpBalanceMap.has(s.skuCode));
        if (notInErp.length > 0) {
            console.log(`  ⚠ ${notInErp.length} sheet SKUs not found in ERP (will write 0):`);
            for (const s of notInErp.slice(0, 10)) {
                console.log(`    - ${s.skuCode}`);
            }
            if (notInErp.length > 10) console.log(`    ... and ${notInErp.length - 10} more`);
        }

        // ── Step 3: Build col F values (currentBalance) ────
        // Col F spans from row 3 to end of data
        const colFValues: (number)[][] = [];
        for (let i = dataStartIndex; i < balanceRows.length; i++) {
            const skuCode = String(balanceRows[i]?.[0] ?? '').trim();
            if (!skuCode) {
                colFValues.push([0]);
                continue;
            }
            const balance = erpBalanceMap.get(skuCode) ?? 0;
            colFValues.push([balance]);
        }

        // ── Step 4: Build col E formulas ────────────────────
        // Formula: =F{row}+IFERROR(SUMIF(IMPORTRANGE(...Inward Live A:A), $A{row}, IMPORTRANGE(...Inward Live B:B)),0)
        //          -IFERROR(SUMIF(IMPORTRANGE(...Outward Live A:A), $A{row}, IMPORTRANGE(...Outward Live B:B)),0)
        const colEFormulas: string[][] = [];
        for (let i = dataStartIndex; i < balanceRows.length; i++) {
            const row = i + 1; // 1-based sheet row
            const formula = `=F${row}+IFERROR(SUMIF(IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$A:$A"),$A${row},IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$B:$B")),0)-IFERROR(SUMIF(IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$A:$A"),$A${row},IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$B:$B")),0)`;
            colEFormulas.push([formula]);
        }

        console.log(`\nPrepared ${colFValues.length} col F values and ${colEFormulas.length} col E formulas`);

        // Sample output
        const sampleIdx = 0;
        const sampleSku = sheetSkus[sampleIdx];
        if (sampleSku) {
            console.log(`\nSample (row ${sampleSku.rowIndex + 1}, SKU: ${sampleSku.skuCode}):`);
            console.log(`  Old balance (col E): ${sampleSku.oldBalance}`);
            console.log(`  ERP currentBalance (col F): ${colFValues[sampleSku.rowIndex - dataStartIndex]?.[0]}`);
            console.log(`  Formula (col E): ${colEFormulas[sampleSku.rowIndex - dataStartIndex]?.[0]?.slice(0, 80)}...`);
        }

        if (dryRun) {
            console.log('\n=== DRY RUN — no changes written ===');

            // Show balance comparison
            let matches = 0;
            let mismatches = 0;
            for (const s of sheetSkus) {
                const erpBal = erpBalanceMap.get(s.skuCode) ?? 0;
                // With empty live tabs, new formula = col F = erpBal
                if (erpBal === s.oldBalance) {
                    matches++;
                } else {
                    mismatches++;
                    if (mismatches <= 10) {
                        console.log(`  MISMATCH: ${s.skuCode} — sheet: ${s.oldBalance}, ERP: ${erpBal}, diff: ${erpBal - s.oldBalance}`);
                    }
                }
            }
            console.log(`\nBalance comparison: ${matches} match, ${mismatches} mismatch`);
            return;
        }

        // ── Step 5: Write col F (currentBalance) ────────────
        console.log('\nWriting col F (ERP currentBalance)...');
        const fRange = `'${BALANCE_TAB}'!F${dataStartIndex + 1}:F${dataStartIndex + colFValues.length}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId: OFFICE_LEDGER_ID,
            range: fRange,
            valueInputOption: 'RAW',
            requestBody: { values: colFValues },
        });
        console.log(`  Written ${colFValues.length} values to ${fRange}`);

        // ── Step 6: Write col E formulas ────────────────────
        console.log('Writing col E formulas...');
        const eRange = `'${BALANCE_TAB}'!E${dataStartIndex + 1}:E${dataStartIndex + colEFormulas.length}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId: OFFICE_LEDGER_ID,
            range: eRange,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: colEFormulas },
        });
        console.log(`  Written ${colEFormulas.length} formulas to ${eRange}`);

        // ── Step 7: Verify ──────────────────────────────────
        if (!skipVerify) {
            console.log('\nWaiting 5s for formulas to recalculate...');
            await new Promise(r => setTimeout(r, 5000));

            console.log('Reading new col E values for verification...');
            const newBalanceResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: OFFICE_LEDGER_ID,
                range: `'${BALANCE_TAB}'!E:E`,
                valueRenderOption: 'UNFORMATTED_VALUE',
            });
            const newBalanceValues = newBalanceResponse.data.values ?? [];

            let matches = 0;
            let mismatches = 0;
            const mismatchDetails: Array<{ sku: string; old: number; new: number; diff: number }> = [];

            for (const s of sheetSkus) {
                const newBal = Number(newBalanceValues[s.rowIndex]?.[0] ?? 0);
                const newBalSafe = isNaN(newBal) ? 0 : newBal;

                if (Math.abs(newBalSafe - s.oldBalance) <= 0.01) {
                    matches++;
                } else {
                    mismatches++;
                    mismatchDetails.push({
                        sku: s.skuCode,
                        old: s.oldBalance,
                        new: newBalSafe,
                        diff: newBalSafe - s.oldBalance,
                    });
                }
            }

            console.log(`\nVerification: ${matches} match, ${mismatches} mismatch out of ${sheetSkus.length}`);

            if (mismatches > 0) {
                console.log('\nMismatches (first 20):');
                for (const m of mismatchDetails.slice(0, 20)) {
                    console.log(`  ${m.sku}: old=${m.old}, new=${m.new}, diff=${m.diff}`);
                }
                if (mismatches > 20) console.log(`  ... and ${mismatches - 20} more`);

                // If IMPORTRANGE hasn't been authorized, all formulas return 0
                const allZero = mismatchDetails.every(m => m.new === 0);
                if (allZero && mismatches > 100) {
                    console.log('\n⚠ All new values are 0 — IMPORTRANGE may not be authorized yet.');
                    console.log('  Open the Office Ledger spreadsheet in a browser and accept the IMPORTRANGE prompt.');
                    console.log('  The formulas will auto-resolve once authorized.');
                }
            }
        }

        console.log('\nDone! Balance (Final) is now using Phase 3 formula.');
        console.log('Col F = ERP currentBalance (updated by worker after each ingestion cycle)');
        console.log('Col E = F + pending Inward (Live) - pending Outward (Live)');

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('Failed:', err.message ?? err);
    process.exit(1);
});
