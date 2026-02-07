/**
 * Google Sheets Backup Script
 *
 * Reads all configured tabs from the Office Ledger and Orders Mastersheet
 * spreadsheets and saves them as timestamped JSON files.
 *
 * Output: backups/sheets-YYYY-MM-DD-HHmmss/
 *   manifest.json + one JSON file per tab
 *
 * Usage: npx tsx server/scripts/backup-sheets.ts
 */

import { google } from 'googleapis';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ── Config ──────────────────────────────────────────────

const KEY_PATH = resolve(import.meta.dirname, '../config/google-service-account.json');
const BACKUPS_DIR = resolve(import.meta.dirname, '../../backups');

const SPREADSHEETS = {
  officeLedger: '1ZZgzu4xPXhP9ba3-liXHxj5tY0HihoEnVC9-wLijD5E',
  mastersheet: '1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo',
} as const;

interface TabConfig {
  spreadsheet: 'officeLedger' | 'mastersheet';
  tab: string;
  range: string;
  filename: string;
}

const TABS: TabConfig[] = [
  // Office Ledger
  { spreadsheet: 'officeLedger', tab: 'Inward (Final)',              range: 'A:H', filename: 'ol-inward-final' },
  { spreadsheet: 'officeLedger', tab: 'Inward (Archive)',            range: 'A:H', filename: 'ol-inward-archive' },
  { spreadsheet: 'officeLedger', tab: 'Outward',                     range: 'A:F', filename: 'ol-outward' },
  { spreadsheet: 'officeLedger', tab: 'Orders Outward',              range: 'A:B', filename: 'ol-orders-outward' },
  { spreadsheet: 'officeLedger', tab: 'Orders Outward 12728-41874',  range: 'A:O', filename: 'ol-orders-outward-old' },
  { spreadsheet: 'officeLedger', tab: 'Balance (Final)',             range: 'A:F', filename: 'ol-balance-final' },
  // Mastersheet
  { spreadsheet: 'mastersheet',  tab: 'Outward',                     range: 'A:I', filename: 'ms-outward' },
  { spreadsheet: 'mastersheet',  tab: 'Inventory',                   range: 'A:Z', filename: 'ms-inventory' },
  { spreadsheet: 'mastersheet',  tab: 'Orders from COH',             range: 'A:Z', filename: 'ms-orders-from-coh' },
];

// ── Helpers ─────────────────────────────────────────────

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    '-', pad(date.getMonth() + 1),
    '-', pad(date.getDate()),
    '-', pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

// ── Main ────────────────────────────────────────────────

async function main() {
  // Auth
  const keyFile = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
  const auth = new google.auth.JWT({
    email: keyFile.client_email,
    key: keyFile.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // Create backup directory
  const timestamp = formatTimestamp(new Date());
  const backupDir = resolve(BACKUPS_DIR, `sheets-${timestamp}`);
  mkdirSync(backupDir, { recursive: true });
  console.log(`Backup directory: ${backupDir}\n`);

  // Back up each tab
  const manifestTabs: Array<{
    spreadsheet: string;
    tab: string;
    rows: number;
    file: string;
  }> = [];
  let totalRows = 0;
  let successCount = 0;
  let failCount = 0;

  for (const config of TABS) {
    const spreadsheetId = SPREADSHEETS[config.spreadsheet];
    const range = `'${config.tab}'!${config.range}`;
    const label = `${config.spreadsheet}/${config.tab}`;

    process.stdout.write(`  Backing up ${label}...`);

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: 'FORMATTED_VALUE',
      });

      const rows = response.data.values ?? [];
      const rowCount = rows.length;
      totalRows += rowCount;
      successCount++;

      // Write tab data file
      const tabFile = `${config.filename}.json`;
      const tabData = {
        tab: config.tab,
        spreadsheet: config.spreadsheet,
        rows,
        rowCount,
      };
      writeFileSync(resolve(backupDir, tabFile), JSON.stringify(tabData, null, 2));

      manifestTabs.push({
        spreadsheet: config.spreadsheet,
        tab: config.tab,
        rows: rowCount,
        file: tabFile,
      });

      console.log(` ${rowCount} rows`);
    } catch (err: unknown) {
      failCount++;
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.log(` FAILED: ${message}`);
    }
  }

  // Write manifest
  const manifest = {
    timestamp,
    tabCount: successCount,
    totalRows,
    tabs: manifestTabs,
  };
  writeFileSync(resolve(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`Backup complete`);
  console.log(`  Tabs backed up: ${successCount}/${TABS.length}`);
  if (failCount > 0) {
    console.log(`  Tabs failed:    ${failCount}`);
  }
  console.log(`  Total rows:     ${totalRows}`);
  console.log(`  Location:       ${backupDir}`);
}

main().catch(err => {
  console.error('Backup failed:', err.message ?? err);
  process.exit(1);
});
