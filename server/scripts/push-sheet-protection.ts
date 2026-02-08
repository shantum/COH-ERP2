/**
 * Creates an Apps Script project bound to the Orders Mastersheet
 * with an onEdit trigger that protects header rows and formula columns.
 *
 * Usage: npx tsx server/scripts/push-sheet-protection.ts
 */

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const KEY_PATH = resolve(import.meta.dirname, '../config/google-service-account.json');
const MASTERSHEET_ID = '1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo';

const APPS_SCRIPT_CODE = `
/**
 * Protects header rows (row 1) in live buffer tabs.
 * Also protects col C (Product Details formula) in "Inward (Live)" only.
 * "Outward (Live)" no longer has a formula in col C (layout matches Orders from COH).
 * Works even for sheet owner — reverts unauthorized edits.
 */
function onEdit(e) {
  var sheet = e.range.getSheet();
  var name = sheet.getName();

  if (name !== "Inward (Live)" && name !== "Outward (Live)") return;

  var row = e.range.getRow();
  var col = e.range.getColumn();
  var numRows = e.range.getNumRows();
  var numCols = e.range.getNumColumns();

  var isProtected = false;

  // Check if edit touches row 1 (header)
  if (row === 1) {
    isProtected = true;
  }

  // Check if edit touches col C (column 3) — only protected in Inward (Live)
  if (name === "Inward (Live)" && col <= 3 && (col + numCols - 1) >= 3) {
    isProtected = true;
  }

  if (!isProtected) return;

  // Revert the edit
  if (e.oldValue !== undefined) {
    e.range.setValue(e.oldValue);
  } else {
    // For the array formula in C1 (Inward Live only), restore it
    if (name === "Inward (Live)" && row === 1 && col <= 3 && (col + numCols - 1) >= 3) {
      var formula = '={"Product Details";ARRAYFORMULA(IF(A2:A="","",IFERROR(VLOOKUP(A2:A,Barcodes!A:E,5,FALSE),"")))}';
      sheet.getRange("C1").setFormula(formula);
    } else if (name === "Inward (Live)" && col === 3 && row > 1) {
      // Col C data rows are filled by the array formula — just clear the manual entry
      e.range.clearContent();
    } else if (row === 1) {
      // Header row — undo by restoring old value or clearing
      e.range.setValue(e.oldValue || "");
    }
  }

  SpreadsheetApp.getActive().toast(
    "This cell is protected and cannot be edited.",
    "Protected",
    3
  );
}
`;

const MANIFEST = JSON.stringify({
    timeZone: 'Asia/Kolkata',
    dependencies: {},
    exceptionLogging: 'STACKDRIVER',
    runtimeVersion: 'V8',
});

async function main() {
    const keyFile = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
    const auth = new google.auth.JWT({
        email: keyFile.client_email,
        key: keyFile.private_key,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/script.projects',
        ],
    });

    const script = google.script({ version: 'v1', auth });

    // Step 1: Create container-bound script project
    console.log('Creating Apps Script project bound to the sheet...');
    const createRes = await script.projects.create({
        requestBody: {
            title: 'Sheet Protection',
            parentId: MASTERSHEET_ID,
        },
    });

    const scriptId = createRes.data.scriptId!;
    console.log('Script project created:', scriptId);

    // Step 2: Push the code
    console.log('Pushing script code...');
    await script.projects.updateContent({
        scriptId,
        requestBody: {
            files: [
                {
                    name: 'Protection',
                    type: 'SERVER_JS',
                    source: APPS_SCRIPT_CODE,
                },
                {
                    name: 'appsscript',
                    type: 'JSON',
                    source: MANIFEST,
                },
            ],
        },
    });

    console.log('\n✓ Apps Script pushed successfully');
    console.log('  Script ID:', scriptId);
    console.log('  Edit URL: https://script.google.com/d/' + scriptId + '/edit');
    console.log('\nThe simple onEdit trigger activates automatically — no manual setup needed.');
}

main().catch((err: any) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
