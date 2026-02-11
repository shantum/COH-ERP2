/**
 * Create "Fabric Inward (Live)" tab in the COH Orders Mastersheet.
 *
 * Dependent dropdowns: Material → Fabric → Colour
 *   - Pick Material → only fabrics for that material show in col B
 *   - Pick Fabric  → only colours for that material+fabric show in col C
 *   - B is blocked until A is filled; C is blocked until B is filled
 *   - Fabric Code auto-fills in D when all three match
 *
 * Uses an Apps Script (onEdit trigger) bound to the spreadsheet to set
 * dependent dropdown validation dynamically per-row. The script is deployed
 * via the Apps Script API.
 *
 * Layout:
 *   A: Material  (dropdown)
 *   B: Fabric    (dependent dropdown — set by Apps Script)
 *   C: Colour    (dependent dropdown — set by Apps Script)
 *   D: Fabric Code (auto-fill)
 *   E: Qty       (team enters)
 *   F: Unit      (auto-fill)
 *   G: Cost Per Unit (team enters ₹)
 *   H: Supplier  (free text)
 *   I: Date      (DD/MM/YYYY)
 *   J: Notes     (optional)
 *   K: Status    (ERP writes: ok / error / DONE:{refId})
 *
 * Usage: npx tsx server/scripts/create-fabric-inward-tab.ts
 */

import { google, type sheets_v4 } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Config ──────────────────────────────────────────────
const SPREADSHEET_ID = '1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo';
const KEY_PATH = resolve(import.meta.dirname, '../config/google-service-account.json');
const TAB_NAME = 'Fabric Inward (Live)';
const HELPER_TAB_NAME = 'FI Helpers';

const HEADERS = [
    'Material',       // A (dropdown)
    'Fabric',         // B (dependent dropdown — Apps Script)
    'Colour',         // C (dependent dropdown — Apps Script)
    'Fabric Code',    // D (auto-fill)
    'Qty',            // E
    'Unit',           // F (auto-fill)
    'Cost Per Unit',  // G
    'Supplier',       // H
    'Date',           // I
    'Notes',          // J
    'Status',         // K
];

const COL_WIDTHS = [
    130, 130, 130, 140, 70, 70, 100, 150, 110, 200, 180,
];

const HEADER_BG = { red: 0.90, green: 0.85, blue: 1.0, alpha: 1.0 };

// ── Apps Script code ────────────────────────────────────
// This gets deployed as a bound script on the spreadsheet.
// Simple onEdit trigger — no special permissions needed.
const APPS_SCRIPT_CODE = `
/**
 * Dependent dropdowns for Fabric Inward (Live) tab.
 * When Material (col A) changes → set Fabric dropdown (col B) to matching fabrics.
 * When Fabric (col B) changes → set Colour dropdown (col C) to matching colours.
 * Clears downstream columns when upstream changes.
 */
function onEdit(e) {
  var sheet = e.source.getActiveSheet();
  if (sheet.getName() !== 'Fabric Inward (Live)') return;

  var row = e.range.getRow();
  var col = e.range.getColumn();
  if (row < 2) return; // skip header

  var fbSheet = e.source.getSheetByName('Fabric Balances');
  if (!fbSheet) return;

  // Read Fabric Balances data (cached per edit for speed)
  var fbData = fbSheet.getDataRange().getValues();
  // cols: 0=Code, 1=Material, 2=Fabric, 3=Colour, 4=Unit

  if (col === 1) {
    // Material changed — update Fabric dropdown, clear Fabric + Colour
    sheet.getRange(row, 2).clearContent().clearDataValidations();
    sheet.getRange(row, 3).clearContent().clearDataValidations();

    var material = String(e.value || '').trim();
    if (!material) return;

    // Unique fabrics for this material
    var fabricSet = {};
    for (var i = 1; i < fbData.length; i++) {
      if (String(fbData[i][1]).trim() === material && fbData[i][2]) {
        fabricSet[String(fbData[i][2]).trim()] = true;
      }
    }
    var fabrics = Object.keys(fabricSet).sort();

    if (fabrics.length > 0) {
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(fabrics, true)
        .setAllowInvalid(false)
        .build();
      sheet.getRange(row, 2).setDataValidation(rule);
    }
  }

  if (col === 2) {
    // Fabric changed — update Colour dropdown, clear Colour
    sheet.getRange(row, 3).clearContent().clearDataValidations();

    var material2 = String(sheet.getRange(row, 1).getValue() || '').trim();
    var fabric = String(e.value || '').trim();
    if (!material2 || !fabric) return;

    // Unique colours for this material + fabric
    var colourSet = {};
    for (var j = 1; j < fbData.length; j++) {
      if (String(fbData[j][1]).trim() === material2 &&
          String(fbData[j][2]).trim() === fabric &&
          fbData[j][3]) {
        colourSet[String(fbData[j][3]).trim()] = true;
      }
    }
    var colours = Object.keys(colourSet).sort();

    if (colours.length > 0) {
      var rule2 = SpreadsheetApp.newDataValidation()
        .requireValueInList(colours, true)
        .setAllowInvalid(false)
        .build();
      sheet.getRange(row, 3).setDataValidation(rule2);
    }
  }
}
`.trim();

// ── Format helpers ──────────────────────────────────────

function buildHeaderFormat(sheetId: number, colCount: number): sheets_v4.Schema$Request {
    return {
        repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
            cell: {
                userEnteredFormat: {
                    backgroundColor: HEADER_BG,
                    textFormat: { bold: true, fontSize: 10 },
                    horizontalAlignment: 'CENTER',
                    verticalAlignment: 'MIDDLE',
                },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
    };
}

function buildFreeze(sheetId: number): sheets_v4.Schema$Request {
    return {
        updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
        },
    };
}

function buildColWidths(sheetId: number, widths: number[]): sheets_v4.Schema$Request[] {
    return widths.map((width, i) => ({
        updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS' as const, startIndex: i, endIndex: i + 1 },
            properties: { pixelSize: width },
            fields: 'pixelSize',
        },
    }));
}

function buildNumFormat(sheetId: number, col: number, type: string, pattern: string): sheets_v4.Schema$Request {
    return {
        repeatCell: {
            range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: col, endColumnIndex: col + 1 },
            cell: { userEnteredFormat: { numberFormat: { type, pattern } } },
            fields: 'userEnteredFormat.numberFormat',
        },
    };
}

function buildGrayBg(sheetId: number, col: number): sheets_v4.Schema$Request {
    return {
        repeatCell: {
            range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: col, endColumnIndex: col + 1 },
            cell: { userEnteredFormat: { backgroundColor: { red: 0.95, green: 0.95, blue: 0.95, alpha: 1.0 } } },
            fields: 'userEnteredFormat.backgroundColor',
        },
    };
}

// ── Main ────────────────────────────────────────────────

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
    const sheets = google.sheets({ version: 'v4', auth });

    // ── Get existing spreadsheet info ──
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const existingSheets = spreadsheet.data.sheets ?? [];

    // ── Delete old tabs + old named ranges ──
    const deleteReqs: sheets_v4.Schema$Request[] = [];

    for (const tabName of [TAB_NAME, HELPER_TAB_NAME]) {
        const existing = existingSheets.find(s => s.properties?.title === tabName);
        if (existing?.properties?.sheetId !== undefined) {
            console.log(`Deleting existing "${tabName}"...`);
            deleteReqs.push({ deleteSheet: { sheetId: existing.properties.sheetId } });
        }
    }

    // Clean up old named ranges from previous approach
    for (const nr of (spreadsheet.data.namedRanges ?? [])) {
        if (nr.name?.startsWith('FI_M_') || nr.name?.startsWith('FI_MF_')) {
            deleteReqs.push({ deleteNamedRange: { namedRangeId: nr.namedRangeId! } });
        }
    }

    if (deleteReqs.length > 0) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { requests: deleteReqs },
        });
        console.log(`Cleaned up ${deleteReqs.length} old tabs/named ranges`);
    }

    // ── Create helper tab (unique materials for col A dropdown) ──
    console.log(`\nCreating "${HELPER_TAB_NAME}" (hidden)...`);
    const helperResult = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [{
                addSheet: {
                    properties: {
                        title: HELPER_TAB_NAME,
                        gridProperties: { rowCount: 200, columnCount: 1 },
                        hidden: true,
                    },
                },
            }],
        },
    });
    console.log(`Helper tab created (sheetId: ${helperResult.data.replies?.[0]?.addSheet?.properties?.sheetId})`);

    // Write unique materials formula
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${HELPER_TAB_NAME}'!A1:A2`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [
                ['Material'],
                [`=SORT(UNIQUE(FILTER('Fabric Balances'!B2:B, 'Fabric Balances'!B2:B<>"")))`],
            ],
        },
    });

    // ── Create main tab ──
    console.log(`\nCreating "${TAB_NAME}"...`);
    const addResult = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [{
                addSheet: {
                    properties: {
                        title: TAB_NAME,
                        gridProperties: { rowCount: 1000, columnCount: HEADERS.length },
                    },
                },
            }],
        },
    });
    const sheetId = addResult.data.replies?.[0]?.addSheet?.properties?.sheetId;
    if (sheetId == null) throw new Error('Failed to get main tab sheetId');
    console.log(`Tab created (sheetId: ${sheetId})`);

    // Headers
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${TAB_NAME}'!A1:K1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
    });

    // Auto-fill formulas (Fabric Code + Unit)
    console.log('Writing auto-fill formulas...');
    const codeFormulas: string[][] = [];
    const unitFormulas: string[][] = [];
    for (let row = 2; row <= 200; row++) {
        codeFormulas.push([
            `=IFERROR(INDEX(FILTER('Fabric Balances'!A:A, 'Fabric Balances'!B:B=A${row}, 'Fabric Balances'!C:C=B${row}, 'Fabric Balances'!D:D=C${row}), 1), "")`,
        ]);
        unitFormulas.push([
            `=IFERROR(VLOOKUP(D${row},'Fabric Balances'!A:E,5,FALSE),"")`,
        ]);
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${TAB_NAME}'!D2:D200`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: codeFormulas },
    });
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${TAB_NAME}'!F2:F200`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: unitFormulas },
    });

    // ── Formatting + Material dropdown ──
    console.log('Applying formatting...');
    const requests: sheets_v4.Schema$Request[] = [];

    requests.push(buildHeaderFormat(sheetId, HEADERS.length));
    requests.push(buildFreeze(sheetId));
    requests.push(...buildColWidths(sheetId, COL_WIDTHS));
    requests.push(buildNumFormat(sheetId, 4, 'NUMBER', '0.##'));       // Qty
    requests.push(buildNumFormat(sheetId, 6, 'NUMBER', '#,##0.00'));   // Cost Per Unit
    requests.push(buildNumFormat(sheetId, 8, 'DATE', 'dd/MM/yyyy'));   // Date
    requests.push(buildGrayBg(sheetId, 3));  // Fabric Code (auto-fill)
    requests.push(buildGrayBg(sheetId, 5));  // Unit (auto-fill)

    // Material dropdown (col A) — static list from helper tab
    requests.push({
        setDataValidation: {
            range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 1 },
            rule: {
                condition: {
                    type: 'ONE_OF_RANGE',
                    values: [{ userEnteredValue: `='${HELPER_TAB_NAME}'!A2:A200` }],
                },
                showCustomUi: true,
                strict: false,
            },
        },
    });

    // No data validation for B and C initially — the Apps Script sets it per-row
    // when the user picks Material (A) and Fabric (B).

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests },
    });

    // ── Deploy Apps Script for dependent dropdowns ──
    console.log('\nDeploying Apps Script for dependent dropdowns...');
    try {
        const script = google.script({ version: 'v1', auth });

        const project = await script.projects.create({
            requestBody: {
                title: 'Fabric Inward Dependent Dropdowns',
                parentId: SPREADSHEET_ID,
            },
        });

        const scriptId = project.data.scriptId;
        console.log(`Apps Script project created (scriptId: ${scriptId})`);

        await script.projects.updateContent({
            scriptId: scriptId!,
            requestBody: {
                files: [
                    {
                        name: 'Code',
                        type: 'SERVER_JS',
                        source: APPS_SCRIPT_CODE,
                    },
                    {
                        name: 'appsscript',
                        type: 'JSON',
                        source: JSON.stringify({
                            timeZone: 'Asia/Kolkata',
                            exceptionLogging: 'STACKDRIVER',
                        }),
                    },
                ],
            },
        });

        console.log('Apps Script deployed! Dependent dropdowns are active.');
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`\n⚠ Could not deploy Apps Script automatically: ${message}`);
        console.log('\nTo enable dependent dropdowns, add this script manually:');
        console.log('1. Open the spreadsheet');
        console.log('2. Extensions → Apps Script');
        console.log('3. Delete any existing code');
        console.log('4. Paste the following code and save:\n');
        console.log('─'.repeat(60));
        console.log(APPS_SCRIPT_CODE);
        console.log('─'.repeat(60));
    }

    console.log(`\nDone! "${TAB_NAME}" is ready.`);
    console.log(`  Col A: Material dropdown`);
    console.log(`  Col B: Fabric (filtered by material — set on edit by Apps Script)`);
    console.log(`  Col C: Colour (filtered by material+fabric — set on edit by Apps Script)`);
    console.log(`  Col D: Fabric Code (auto-fill when A+B+C match)`);
    console.log(`  Col F: Unit (auto-fill from Fabric Code)`);
}

main().catch(err => {
    console.error('Failed:', err.message ?? err);
    process.exit(1);
});
