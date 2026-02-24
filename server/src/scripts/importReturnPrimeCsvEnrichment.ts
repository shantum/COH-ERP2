/**
 * Import Return Prime CSV Enrichment
 *
 * Usage:
 *   npx tsx src/scripts/importReturnPrimeCsvEnrichment.ts --csv /absolute/path/file.csv
 *   npx tsx src/scripts/importReturnPrimeCsvEnrichment.ts --csv /absolute/path/file.csv --dry-run
 *   npx tsx src/scripts/importReturnPrimeCsvEnrichment.ts --csv /absolute/path/file.csv --no-order-lines
 */

import { importReturnPrimeCsvEnrichment } from '../services/returnPrimeCsvEnrichment.js';

function readArg(flag: string): string | undefined {
    const index = process.argv.indexOf(flag);
    if (index === -1) return undefined;
    return process.argv[index + 1];
}

async function main(): Promise<void> {
    const csvPath = readArg('--csv');
    const dryRun = process.argv.includes('--dry-run');
    const enrichOrderLines = !process.argv.includes('--no-order-lines');

    if (!csvPath) {
        console.error('Missing required --csv argument');
        process.exit(1);
    }

    const result = await importReturnPrimeCsvEnrichment({
        csvPath,
        dryRun,
        enrichOrderLines,
    });

    console.log('\n=== Return Prime CSV Enrichment Import ===');
    console.log(`File: ${result.csvPath}`);
    console.log(`Dry run: ${result.dryRun ? 'YES' : 'NO'}`);
    console.log(`Parsed rows: ${result.parsedRows}`);
    console.log(`Valid rows: ${result.validRows}`);
    console.log(`Skipped rows: ${result.skippedRows}`);
    console.log(`Duplicate request numbers: ${result.duplicateRequestNumbers}`);
    console.log(`Distinct request numbers: ${result.distinctRequestNumbers}`);
    console.log(`Matched local ReturnPrimeRequest rows: ${result.matchedReturnPrimeRequests}`);
    console.log(`Existing enrichment rows: ${result.existingEnrichmentRows}`);
    console.log(`Created: ${result.created}`);
    console.log(`Updated: ${result.updated}`);
    console.log(`Unchanged: ${result.unchanged}`);
    console.log(`Order lines enriched: ${result.orderLinesEnriched}`);
    console.log('=========================================\n');
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Import failed:', message);
    process.exit(1);
});
