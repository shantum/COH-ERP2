/**
 * Balance Formula Management Script
 *
 * Manages the "Balance (Final)" formula on the Office Ledger Google Sheet.
 * Updates from the old 5-SUMIF formula to the new 3-SUMIF + ERP Past Balance formula.
 *
 * The offload worker ingests old data from sheets into ERP and writes a "Past Balance"
 * value to col F. This script switches the balance formula in col E to use that
 * ERP Past Balance + only recent data, instead of the original 5-SUMIF that summed
 * across all historical tabs.
 *
 * Modes:
 *   --dry-run  (DEFAULT) Print what would change, no writes
 *   --test     Write NEW formula to col G for side-by-side comparison, leave col E unchanged
 *   --apply    Switch col E to the new formula, write "ERP Past Balance" header to F2
 *   --restore  Revert col E to the original 5-SUMIF formula (rollback)
 *
 * Usage:
 *   npx tsx server/scripts/setup-balance-formula.ts             # dry-run (default)
 *   npx tsx server/scripts/setup-balance-formula.ts --dry-run   # explicit dry-run
 *   npx tsx server/scripts/setup-balance-formula.ts --test      # side-by-side in col G
 *   npx tsx server/scripts/setup-balance-formula.ts --apply     # switch col E
 *   npx tsx server/scripts/setup-balance-formula.ts --restore   # revert col E
 */

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ============================================
// AUTH
// ============================================

const KEY_PATH = resolve(import.meta.dirname, '../config/google-service-account.json');
const keyFile = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
const auth = new google.auth.JWT({
    email: keyFile.client_email,
    key: keyFile.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// ============================================
// CONSTANTS
// ============================================

const SPREADSHEET_ID = '1ZZgzu4xPXhP9ba3-liXHxj5tY0HihoEnVC9-wLijD5E';
const TAB = 'Balance (Final)';

/**
 * Original 5-SUMIF formula (row 3 template).
 * Sums across Inward (Final), Inward (Archive), Outward, Orders Outward,
 * and the old Orders Outward 12728-41874 tab.
 */
const ORIGINAL_FORMULA =
    `=SUMIF('Inward (Final)'!$A:$A,$A3,'Inward (Final)'!$B:$B)` +
    `+SUMIF('Inward (Archive)'!$A:$A,$A3,'Inward (Archive)'!$B:$B)` +
    `-SUMIF(Outward!$A:$A,$A3,Outward!$B:$B)` +
    `-SUMIF('Orders Outward'!$A:$A,$A3,'Orders Outward'!$B:$B)` +
    `-SUMIF('Orders Outward 12728-41874'!$N:$N,$A3,'Orders Outward 12728-41874'!$O:$O)`;

/**
 * New formula (row 3 template).
 * Uses ERP Past Balance from col F + only recent Inward/Outward tabs.
 * Archive and old outward data now lives in ERP.
 */
const NEW_FORMULA =
    `=F3+SUMIF('Inward (Final)'!$A:$A,$A3,'Inward (Final)'!$B:$B)` +
    `-SUMIF(Outward!$A:$A,$A3,Outward!$B:$B)` +
    `-SUMIF('Orders Outward'!$A:$A,$A3,'Orders Outward'!$B:$B)`;

// ============================================
// CLI FLAGS
// ============================================

type Mode = 'dry-run' | 'test' | 'apply' | 'restore';

const args = process.argv.slice(2);
const mode: Mode = args.includes('--restore') ? 'restore'
    : args.includes('--apply') ? 'apply'
    : args.includes('--test') ? 'test'
    : 'dry-run';

// ============================================
// FORMULA HELPERS
// ============================================

/**
 * Adjust formula row references from the row-3 template to a target row.
 * Replaces: $A3 -> $A{row}, F3 -> F{row}
 */
function formulaForRow(template: string, row: number): string {
    return template
        .replace(/\$A3/g, `$A${row}`)
        .replace(/F3/g, `F${row}`);
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
    console.log(`\nMode: ${mode.toUpperCase()}`);
    console.log(`Spreadsheet: ${SPREADSHEET_ID}`);
    console.log(`Tab: ${TAB}\n`);

    // Step 1: Read col A to determine how many rows have data
    console.log('Reading Balance (Final) column A to count data rows...');
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${TAB}'!A:A`,
        valueRenderOption: 'FORMATTED_VALUE',
    });

    const allRows = response.data.values ?? [];
    const totalRows = allRows.length;

    if (totalRows <= 2) {
        console.log('No data rows found (only header rows). Nothing to do.');
        return;
    }

    // Data starts at row 3 (rows 1-2 are headers)
    const dataRowCount = totalRows - 2;
    const firstDataRow = 3;
    const lastDataRow = totalRows;

    console.log(`Found ${dataRowCount} data rows (rows ${firstDataRow}-${lastDataRow})`);

    // Step 2: Pick the formula template based on mode
    const isRestoreMode = mode === 'restore';
    const template = isRestoreMode ? ORIGINAL_FORMULA : NEW_FORMULA;
    const formulaLabel = isRestoreMode
        ? 'ORIGINAL (5-SUMIF)'
        : 'NEW (3-SUMIF + ERP Past Balance)';

    // Step 3: Build formula values for all data rows
    const formulas: string[][] = [];
    for (let row = firstDataRow; row <= lastDataRow; row++) {
        formulas.push([formulaForRow(template, row)]);
    }

    // Preview
    console.log(`\nFormula type: ${formulaLabel}`);
    console.log(`Total formulas: ${formulas.length}`);
    console.log(`\nSample (row ${firstDataRow}): ${formulas[0][0]}`);
    if (formulas.length > 1) {
        const lastIdx = formulas.length - 1;
        console.log(`Sample (row ${lastDataRow}): ${formulas[lastIdx][0]}`);
    }

    // Step 4: Execute based on mode
    switch (mode) {
        case 'dry-run': {
            console.log('\n--- DRY RUN -- no changes made ---');
            console.log('Re-run with:');
            console.log('  --test     Write new formula to col G (side-by-side comparison)');
            console.log('  --apply    Switch col E to new formula');
            console.log('  --restore  Revert col E to original formula');
            break;
        }

        case 'test': {
            // Write "Test Balance (new formula)" header to G2
            console.log('\nWriting "Test Balance (new formula)" header to G2...');
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${TAB}'!G2`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [['Test Balance (new formula)']] },
            });
            console.log('Header written to G2.');

            // Write formulas to col G
            const testRange = `'${TAB}'!G${firstDataRow}:G${lastDataRow}`;
            console.log(`Writing ${formulas.length} formulas to ${testRange}...`);
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: testRange,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: formulas },
            });
            console.log('Done! Test formulas written to col G.');
            console.log('Compare col E (original) vs col G (new) in the sheet.');
            break;
        }

        case 'apply': {
            // Write "ERP Past Balance" header to F2
            console.log('\nWriting "ERP Past Balance" header to F2...');
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${TAB}'!F2`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [['ERP Past Balance']] },
            });
            console.log('Header written to F2.');

            // Write new formulas to col E
            const applyRange = `'${TAB}'!E${firstDataRow}:E${lastDataRow}`;
            console.log(`Writing ${formulas.length} formulas to ${applyRange}...`);
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: applyRange,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: formulas },
            });
            console.log('Done! Col E updated to new formula.');
            console.log('Balance (Final) now uses: ERP Past Balance (F) + recent Inward/Outward.');
            break;
        }

        case 'restore': {
            // Write original formulas back to col E
            const restoreRange = `'${TAB}'!E${firstDataRow}:E${lastDataRow}`;
            console.log(`\nWriting ${formulas.length} original formulas to ${restoreRange}...`);
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: restoreRange,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: formulas },
            });
            console.log('Done! Col E reverted to original 5-SUMIF formula.');
            console.log('You may also want to clear col F (ERP Past Balance) manually if needed.');
            break;
        }
    }
}

main().catch((err: unknown) => {
    console.error('Fatal error:', err instanceof Error ? err.message : err);
    process.exit(1);
});
