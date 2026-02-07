/**
 * Create "Inward (Live)" and "Outward (Live)" tabs in the COH Orders Mastersheet.
 *
 * These are buffer tabs where the ops team enters new inward/outward entries.
 * The sheetOffloadWorker ingests rows, creates InventoryTransactions, deletes
 * the rows, and writes the updated ERP balance back to Balance (Final) col F.
 *
 * Features:
 * - Creates tabs with frozen header rows
 * - Sets column widths for readability
 * - Adds data validation dropdowns (Source, Destination)
 * - Header row formatting (bold, background color)
 *
 * Usage: npx tsx server/scripts/create-live-tabs.ts
 */

import { google, type sheets_v4 } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Config ──────────────────────────────────────────────
const SPREADSHEET_ID = '1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo';
const KEY_PATH = resolve(import.meta.dirname, '../config/google-service-account.json');

// ── Tab Definitions ─────────────────────────────────────

const INWARD_HEADERS = [
    'SKU',              // A
    'Qty',              // B
    'Product Details',  // C
    'Inward Date',      // D
    'Source',           // E
    'Done By',          // F
    'Unique Barcode',   // G
    'Tailor Number',    // H
    'Notes',            // I
];

const INWARD_COL_WIDTHS = [
    140,  // A - SKU
    60,   // B - Qty
    200,  // C - Product Details
    110,  // D - Inward Date
    120,  // E - Source
    100,  // F - Done By
    140,  // G - Unique Barcode
    100,  // H - Tailor Number
    200,  // I - Notes
];

const INWARD_SOURCES = [
    'Production',
    'Sampling',
    'Repacking',
    'Return',
    'RTO',
    'Alteration',
    'Warehouse',
    'Adjustment',
    'Op Stock',
];

const OUTWARD_HEADERS = [
    'SKU',              // A
    'Qty',              // B
    'Product Details',  // C
    'Outward Date',     // D
    'Destination',      // E
    'Order Number',     // F
    'Sampling Date',    // G
    'Order Note',       // H
    'COH Note',         // I
    'Courier',          // J
    'AWB',              // K
    'AWB Scan',         // L
    'Notes',            // M
];

const OUTWARD_COL_WIDTHS = [
    140,  // A - SKU
    60,   // B - Qty
    200,  // C - Product Details
    110,  // D - Outward Date
    120,  // E - Destination
    120,  // F - Order Number
    110,  // G - Sampling Date
    150,  // H - Order Note
    150,  // I - COH Note
    100,  // J - Courier
    140,  // K - AWB
    140,  // L - AWB Scan
    200,  // M - Notes
];

const OUTWARD_DESTINATIONS = [
    'Customer',
    'Warehouse',
    'Tailor',
    'Damage',
    'Sampling',
    'Op Stock',
    'Adjustment',
];

// ── Header style ────────────────────────────────────────

/** Light blue background for header row */
const HEADER_BG = { red: 0.85, green: 0.92, blue: 1.0, alpha: 1.0 };

function buildHeaderFormatRequest(sheetId: number, colCount: number): sheets_v4.Schema$Request {
    return {
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: colCount,
            },
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

function buildFreezeRequest(sheetId: number): sheets_v4.Schema$Request {
    return {
        updateSheetProperties: {
            properties: {
                sheetId,
                gridProperties: { frozenRowCount: 1 },
            },
            fields: 'gridProperties.frozenRowCount',
        },
    };
}

function buildColumnWidthRequests(sheetId: number, widths: number[]): sheets_v4.Schema$Request[] {
    return widths.map((width, i) => ({
        updateDimensionProperties: {
            range: {
                sheetId,
                dimension: 'COLUMNS',
                startIndex: i,
                endIndex: i + 1,
            },
            properties: { pixelSize: width },
            fields: 'pixelSize',
        },
    }));
}

function buildDropdownValidation(
    sheetId: number,
    colIndex: number,
    values: string[]
): sheets_v4.Schema$Request {
    return {
        setDataValidation: {
            range: {
                sheetId,
                startRowIndex: 1,       // skip header
                endRowIndex: 1000,      // first 999 data rows
                startColumnIndex: colIndex,
                endColumnIndex: colIndex + 1,
            },
            rule: {
                condition: {
                    type: 'ONE_OF_LIST',
                    values: values.map(v => ({ userEnteredValue: v })),
                },
                showCustomUi: true,
                strict: false,          // allow free text too
            },
        },
    };
}

function buildDateFormatRequest(sheetId: number, colIndex: number): sheets_v4.Schema$Request {
    return {
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: 1,
                endRowIndex: 1000,
                startColumnIndex: colIndex,
                endColumnIndex: colIndex + 1,
            },
            cell: {
                userEnteredFormat: {
                    numberFormat: {
                        type: 'DATE',
                        pattern: 'dd/MM/yyyy',
                    },
                },
            },
            fields: 'userEnteredFormat.numberFormat',
        },
    };
}

function buildNumberFormatRequest(sheetId: number, colIndex: number): sheets_v4.Schema$Request {
    return {
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: 1,
                endRowIndex: 1000,
                startColumnIndex: colIndex,
                endColumnIndex: colIndex + 1,
            },
            cell: {
                userEnteredFormat: {
                    numberFormat: {
                        type: 'NUMBER',
                        pattern: '0',
                    },
                },
            },
            fields: 'userEnteredFormat.numberFormat',
        },
    };
}

// ── Main ────────────────────────────────────────────────

async function main() {
    const keyFile = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));

    const auth = new google.auth.JWT({
        email: keyFile.client_email,
        key: keyFile.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Check what tabs already exist
    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        includeGridData: false,
    });

    const existingTabs = spreadsheet.data.sheets?.map(s => s.properties?.title) ?? [];
    console.log('Existing tabs:', existingTabs.join(', '));

    const tabsToCreate: Array<{
        name: string;
        headers: string[];
        colWidths: number[];
        dropdowns: Array<{ colIndex: number; values: string[] }>;
        dateCols: number[];
        numberCols: number[];
    }> = [];

    if (existingTabs.includes('Inward (Live)')) {
        console.log('⚠ "Inward (Live)" tab already exists — skipping creation');
    } else {
        tabsToCreate.push({
            name: 'Inward (Live)',
            headers: INWARD_HEADERS,
            colWidths: INWARD_COL_WIDTHS,
            dropdowns: [{ colIndex: 4, values: INWARD_SOURCES }],  // E = Source
            dateCols: [3],    // D = Inward Date
            numberCols: [1],  // B = Qty
        });
    }

    if (existingTabs.includes('Outward (Live)')) {
        console.log('⚠ "Outward (Live)" tab already exists — skipping creation');
    } else {
        tabsToCreate.push({
            name: 'Outward (Live)',
            headers: OUTWARD_HEADERS,
            colWidths: OUTWARD_COL_WIDTHS,
            dropdowns: [{ colIndex: 4, values: OUTWARD_DESTINATIONS }],  // E = Destination
            dateCols: [3, 6],   // D = Outward Date, G = Sampling Date
            numberCols: [1],    // B = Qty
        });
    }

    if (tabsToCreate.length === 0) {
        console.log('\nNothing to do — both tabs already exist.');
        return;
    }

    // Step 1: Create the tabs
    const addRequests: sheets_v4.Schema$Request[] = tabsToCreate.map(tab => ({
        addSheet: {
            properties: {
                title: tab.name,
                gridProperties: {
                    rowCount: 1000,
                    columnCount: tab.headers.length,
                },
            },
        },
    }));

    console.log(`\nCreating ${tabsToCreate.length} tab(s)...`);

    const addResult = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests: addRequests },
    });

    // Extract sheet IDs from the response
    const sheetIdMap = new Map<string, number>();
    for (const reply of addResult.data.replies ?? []) {
        const props = reply.addSheet?.properties;
        if (props?.title && props.sheetId !== undefined && props.sheetId !== null) {
            sheetIdMap.set(props.title, props.sheetId);
        }
    }

    // Step 2: Write headers
    for (const tab of tabsToCreate) {
        console.log(`Writing headers for "${tab.name}"...`);
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${tab.name}'!A1:${String.fromCharCode(64 + tab.headers.length)}1`,
            valueInputOption: 'RAW',
            requestBody: { values: [tab.headers] },
        });
    }

    // Step 3: Apply formatting, column widths, dropdowns, date/number formats
    const formatRequests: sheets_v4.Schema$Request[] = [];

    for (const tab of tabsToCreate) {
        const sheetId = sheetIdMap.get(tab.name);
        if (sheetId === undefined) {
            console.error(`Could not find sheet ID for "${tab.name}" — skipping formatting`);
            continue;
        }

        // Header formatting
        formatRequests.push(buildHeaderFormatRequest(sheetId, tab.headers.length));

        // Freeze header row
        formatRequests.push(buildFreezeRequest(sheetId));

        // Column widths
        formatRequests.push(...buildColumnWidthRequests(sheetId, tab.colWidths));

        // Dropdowns
        for (const dd of tab.dropdowns) {
            formatRequests.push(buildDropdownValidation(sheetId, dd.colIndex, dd.values));
        }

        // Date columns
        for (const col of tab.dateCols) {
            formatRequests.push(buildDateFormatRequest(sheetId, col));
        }

        // Number columns
        for (const col of tab.numberCols) {
            formatRequests.push(buildNumberFormatRequest(sheetId, col));
        }
    }

    if (formatRequests.length > 0) {
        console.log(`Applying ${formatRequests.length} formatting requests...`);
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { requests: formatRequests },
        });
    }

    // Done
    for (const tab of tabsToCreate) {
        const sheetId = sheetIdMap.get(tab.name);
        console.log(`\n✓ "${tab.name}" created (sheetId: ${sheetId})`);
        console.log(`  Headers: ${tab.headers.join(' | ')}`);
        console.log(`  Dropdowns: ${tab.dropdowns.map(d => tab.headers[d.colIndex]).join(', ')}`);
        console.log(`  Date cols: ${tab.dateCols.map(c => tab.headers[c]).join(', ')}`);
    }

    console.log('\nDone! Tabs are ready for the ops team.');
}

main().catch(err => {
    console.error('Failed:', err.message ?? err);
    process.exit(1);
});
