/**
 * Google Sheets Restore Script
 *
 * Reads a backup directory (created by backup-sheets.ts) and restores
 * data to Google Sheets. Defaults to dry-run for safety.
 *
 * Usage:
 *   npx tsx server/scripts/restore-sheets.ts --dir backups/sheets-2026-02-07-120000 --dry-run
 *   npx tsx server/scripts/restore-sheets.ts --dir backups/sheets-2026-02-07-120000 --tab "Inward (Final)" --dry-run
 *   npx tsx server/scripts/restore-sheets.ts --dir backups/sheets-2026-02-07-120000 --apply
 */

import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

// ── Types ──────────────────────────────────────────────

interface ManifestTab {
    spreadsheet: string;
    spreadsheetId: string;
    tab: string;
    range: string;
    rows: number;
    file: string;
}

interface Manifest {
    timestamp: string;
    tabCount: number;
    totalRows: number;
    tabs: ManifestTab[];
}

interface TabBackup {
    tab: string;
    spreadsheet: string;
    spreadsheetId: string;
    rows: string[][];
    rowCount: number;
}

interface RestoreResult {
    tab: string;
    spreadsheet: string;
    rows: number;
    status: 'success' | 'skipped' | 'error';
    message?: string;
}

// ── CLI Parsing ────────────────────────────────────────

function parseArgs(): { dir: string; tab: string | null; apply: boolean } {
    const args = process.argv.slice(2);

    let dir = '';
    let tab: string | null = null;
    let apply = false;

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--dir':
                dir = args[++i] ?? '';
                break;
            case '--tab':
                tab = args[++i] ?? '';
                break;
            case '--apply':
                apply = true;
                break;
            case '--dry-run':
                apply = false;
                break;
            default:
                console.error(`Unknown argument: ${args[i]}`);
                printUsage();
                process.exit(1);
        }
    }

    if (!dir) {
        console.error('Error: --dir <path> is required.\n');
        printUsage();
        process.exit(1);
    }

    return { dir, tab, apply };
}

function printUsage(): void {
    console.log('Usage:');
    console.log('  npx tsx server/scripts/restore-sheets.ts --dir <backup-dir> [--tab "Tab Name"] [--dry-run | --apply]');
    console.log('');
    console.log('Options:');
    console.log('  --dir <path>    Backup directory path (required)');
    console.log('  --tab <name>    Restore only this tab (optional)');
    console.log('  --dry-run       Show what would be restored without writing (default)');
    console.log('  --apply         Actually write data to sheets');
}

// ── Auth ───────────────────────────────────────────────

function createSheetsClient() {
    const KEY_PATH = resolve(import.meta.dirname, '../config/google-service-account.json');
    const keyFile = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));

    const auth = new google.auth.JWT({
        email: keyFile.client_email,
        key: keyFile.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    return google.sheets({ version: 'v4', auth });
}

// ── Restore Logic ──────────────────────────────────────

/**
 * Google Sheets API limits ~10MB per request. For large tabs we chunk
 * writes into batches of CHUNK_SIZE rows to stay well under that limit.
 */
const CHUNK_SIZE = 10_000;

async function restoreTab(
    sheets: ReturnType<typeof google.sheets>,
    backupDir: string,
    entry: ManifestTab,
    apply: boolean,
): Promise<RestoreResult> {
    const result: RestoreResult = {
        tab: entry.tab,
        spreadsheet: entry.spreadsheet,
        rows: entry.rows,
        status: 'skipped',
    };

    // Read the backup file
    const filePath = join(backupDir, entry.file);
    if (!existsSync(filePath)) {
        result.status = 'error';
        result.message = `Backup file not found: ${entry.file}`;
        return result;
    }

    const backup: TabBackup = JSON.parse(readFileSync(filePath, 'utf-8'));

    if (!backup.rows || backup.rows.length === 0) {
        result.status = 'skipped';
        result.message = 'No rows in backup';
        result.rows = 0;
        return result;
    }

    result.rows = backup.rows.length;

    console.log(`  Tab: "${entry.tab}" (${entry.spreadsheet})`);
    console.log(`    Rows to restore: ${backup.rows.length}`);
    console.log(`    Target range: '${entry.tab}'!${entry.range}`);

    if (!apply) {
        result.status = 'skipped';
        result.message = 'Dry run';
        return result;
    }

    // Clear the target range first
    const clearRange = `'${entry.tab}'!${entry.range}`;
    console.log(`    Clearing range ${clearRange}...`);
    await sheets.spreadsheets.values.clear({
        spreadsheetId: entry.spreadsheetId,
        range: clearRange,
    });

    // Write backup data in chunks
    const totalRows = backup.rows.length;
    const totalChunks = Math.ceil(totalRows / CHUNK_SIZE);

    for (let chunk = 0; chunk < totalChunks; chunk++) {
        const startIdx = chunk * CHUNK_SIZE;
        const endIdx = Math.min(startIdx + CHUNK_SIZE, totalRows);
        const chunkRows = backup.rows.slice(startIdx, endIdx);

        // Calculate the starting row number in the sheet (1-indexed)
        const startRow = startIdx + 1;
        const rangeLetter = entry.range.split(':')[0].replace(/[0-9]/g, '') || 'A';
        const endLetter = entry.range.split(':')[1]?.replace(/[0-9]/g, '') || rangeLetter;
        const writeRange = `'${entry.tab}'!${rangeLetter}${startRow}:${endLetter}${endIdx}`;

        if (totalChunks > 1) {
            console.log(`    Writing chunk ${chunk + 1}/${totalChunks} (rows ${startIdx + 1}-${endIdx}) to ${writeRange}...`);
        } else {
            console.log(`    Writing ${chunkRows.length} rows to ${writeRange}...`);
        }

        await sheets.spreadsheets.values.update({
            spreadsheetId: entry.spreadsheetId,
            range: writeRange,
            valueInputOption: 'RAW',
            requestBody: {
                values: chunkRows,
            },
        });
    }

    result.status = 'success';
    return result;
}

// ── Main ───────────────────────────────────────────────

async function main(): Promise<void> {
    const { dir, tab, apply } = parseArgs();

    const backupDir = resolve(dir);
    const manifestPath = join(backupDir, 'manifest.json');

    console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
    console.log(`Backup directory: ${backupDir}`);
    if (tab) console.log(`Filter: only tab "${tab}"`);
    console.log('');

    // ── Load manifest ──
    if (!existsSync(manifestPath)) {
        console.error(`Error: manifest.json not found in ${backupDir}`);
        process.exit(1);
    }

    const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    console.log(`Backup timestamp: ${manifest.timestamp}`);
    console.log(`Total tabs: ${manifest.tabCount}`);
    console.log(`Total rows: ${manifest.totalRows}`);
    console.log('');

    // ── Filter tabs ──
    let tabsToRestore = manifest.tabs;
    if (tab) {
        tabsToRestore = manifest.tabs.filter(t => t.tab === tab);
        if (tabsToRestore.length === 0) {
            console.error(`Error: tab "${tab}" not found in manifest.`);
            console.log('Available tabs:');
            for (const t of manifest.tabs) {
                console.log(`  - "${t.tab}" (${t.spreadsheet}, ${t.rows} rows)`);
            }
            process.exit(1);
        }
    }

    // ── Init sheets client (only if applying) ──
    const sheets = apply ? createSheetsClient() : null;

    // ── Restore each tab ──
    const results: RestoreResult[] = [];

    for (const entry of tabsToRestore) {
        try {
            const result = await restoreTab(
                sheets as ReturnType<typeof google.sheets>,
                backupDir,
                entry,
                apply,
            );
            results.push(result);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error(`    Error restoring "${entry.tab}": ${message}`);
            results.push({
                tab: entry.tab,
                spreadsheet: entry.spreadsheet,
                rows: entry.rows,
                status: 'error',
                message,
            });
        }

        console.log('');
    }

    // ── Summary ──
    console.log('='.repeat(60));
    console.log('RESTORE SUMMARY');
    console.log('='.repeat(60));

    const succeeded = results.filter(r => r.status === 'success');
    const skipped = results.filter(r => r.status === 'skipped');
    const failed = results.filter(r => r.status === 'error');

    if (succeeded.length > 0) {
        console.log(`\n  Restored (${succeeded.length}):`);
        for (const r of succeeded) {
            console.log(`    [OK] "${r.tab}" — ${r.rows} rows`);
        }
    }

    if (skipped.length > 0) {
        console.log(`\n  Skipped (${skipped.length}):`);
        for (const r of skipped) {
            console.log(`    [--] "${r.tab}" — ${r.rows} rows (${r.message ?? 'dry run'})`);
        }
    }

    if (failed.length > 0) {
        console.log(`\n  Failed (${failed.length}):`);
        for (const r of failed) {
            console.log(`    [!!] "${r.tab}" — ${r.message}`);
        }
    }

    console.log('');

    if (!apply) {
        console.log('This was a DRY RUN. No data was written.');
        console.log('Re-run with --apply to restore data to Google Sheets.');
    } else if (failed.length > 0) {
        console.log(`Completed with ${failed.length} error(s).`);
        process.exit(1);
    } else {
        console.log('All tabs restored successfully.');
    }
}

main().catch((err: unknown) => {
    console.error('Fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
});
