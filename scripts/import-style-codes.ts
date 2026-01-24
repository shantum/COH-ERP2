/**
 * One-time script to import style codes from CSV
 *
 * Usage: npx tsx scripts/import-style-codes.ts <csv-file-path>
 *
 * CSV expected format:
 * - Column A (index 0): Barcode/SKU Code
 * - Column F (index 5): Style Code
 */

import { config } from 'dotenv';
import * as path from 'path';

// Load environment from server/.env
config({ path: path.resolve(__dirname, '../server/.env') });

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface CsvRow {
    barcode: string;
    styleCode: string;
}

function parseCSV(filePath: string): CsvRow[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const rows: CsvRow[] = [];

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Simple CSV parsing (handles basic cases)
        const cols = line.split(',');
        const barcode = cols[0]?.trim();
        const styleCode = cols[5]?.trim();

        if (barcode && styleCode) {
            rows.push({ barcode, styleCode });
        }
    }

    return rows;
}

async function importStyleCodes(csvPath: string) {
    console.log(`\nReading CSV from: ${csvPath}\n`);

    const rows = parseCSV(csvPath);
    console.log(`Found ${rows.length} rows with barcode + style code\n`);

    // Group by style code to see unique mappings
    const styleCodeMap = new Map<string, Set<string>>();
    for (const row of rows) {
        if (!styleCodeMap.has(row.styleCode)) {
            styleCodeMap.set(row.styleCode, new Set());
        }
        styleCodeMap.get(row.styleCode)!.add(row.barcode);
    }
    console.log(`Unique style codes: ${styleCodeMap.size}\n`);

    // Get all barcodes we need to look up
    const allBarcodes = rows.map(r => r.barcode);

    // Find matching SKUs with their Product IDs
    console.log('Looking up SKUs in database...');
    const skus = await prisma.sku.findMany({
        where: {
            skuCode: { in: allBarcodes },
        },
        select: {
            skuCode: true,
            variation: {
                select: {
                    productId: true,
                    product: {
                        select: {
                            id: true,
                            name: true,
                            styleCode: true,
                        },
                    },
                },
            },
        },
    });

    console.log(`Found ${skus.length} matching SKUs\n`);

    // Create barcode -> product mapping
    const barcodeToProduct = new Map<string, { id: string; name: string; currentStyleCode: string | null }>();
    for (const sku of skus) {
        barcodeToProduct.set(sku.skuCode, {
            id: sku.variation.productId,
            name: sku.variation.product.name,
            currentStyleCode: sku.variation.product.styleCode,
        });
    }

    // Build product -> style code mapping
    const productUpdates = new Map<string, { name: string; currentStyleCode: string | null; newStyleCode: string }>();
    const notFound: string[] = [];
    const conflicts: { barcode: string; styleCode: string; product: string; existingCode: string }[] = [];

    for (const row of rows) {
        const product = barcodeToProduct.get(row.barcode);
        if (!product) {
            notFound.push(row.barcode);
            continue;
        }

        // Check if product already has a different style code
        if (product.currentStyleCode && product.currentStyleCode !== row.styleCode) {
            conflicts.push({
                barcode: row.barcode,
                styleCode: row.styleCode,
                product: product.name,
                existingCode: product.currentStyleCode,
            });
            continue;
        }

        // Skip if already set to same value
        if (product.currentStyleCode === row.styleCode) {
            continue;
        }

        productUpdates.set(product.id, {
            name: product.name,
            currentStyleCode: product.currentStyleCode,
            newStyleCode: row.styleCode,
        });
    }

    // Report
    console.log('='.repeat(60));
    console.log('IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total rows in CSV: ${rows.length}`);
    console.log(`SKUs not found in DB: ${notFound.length}`);
    console.log(`Products with conflicting style codes: ${conflicts.length}`);
    console.log(`Products to update: ${productUpdates.size}`);
    console.log('='.repeat(60));

    if (notFound.length > 0 && notFound.length <= 20) {
        console.log('\nSKUs not found:');
        notFound.forEach(b => console.log(`  - ${b}`));
    } else if (notFound.length > 20) {
        console.log(`\nFirst 20 SKUs not found:`);
        notFound.slice(0, 20).forEach(b => console.log(`  - ${b}`));
        console.log(`  ... and ${notFound.length - 20} more`);
    }

    if (conflicts.length > 0) {
        console.log('\nConflicts (product already has different style code):');
        conflicts.slice(0, 10).forEach(c => {
            console.log(`  - ${c.product}: has "${c.existingCode}", CSV says "${c.styleCode}"`);
        });
        if (conflicts.length > 10) {
            console.log(`  ... and ${conflicts.length - 10} more`);
        }
    }

    if (productUpdates.size === 0) {
        console.log('\nNo products to update. Exiting.');
        return;
    }

    console.log('\nProducts to update:');
    let count = 0;
    for (const [id, update] of productUpdates) {
        if (count < 20) {
            console.log(`  - ${update.name}: ${update.currentStyleCode || '(none)'} -> ${update.newStyleCode}`);
        }
        count++;
    }
    if (count > 20) {
        console.log(`  ... and ${count - 20} more`);
    }

    // Confirm before proceeding
    console.log('\nProceed with update? (y/n)');

    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
        rl.question('> ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'y') {
        console.log('Aborted.');
        return;
    }

    // Perform updates
    console.log('\nUpdating products...');
    let updated = 0;
    let errors = 0;

    for (const [id, update] of productUpdates) {
        try {
            await prisma.product.update({
                where: { id },
                data: { styleCode: update.newStyleCode },
            });
            updated++;
        } catch (error) {
            console.error(`  Error updating ${update.name}:`, error);
            errors++;
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));
    console.log(`Successfully updated: ${updated}`);
    console.log(`Errors: ${errors}`);
    console.log('='.repeat(60));
}

// Main
const csvPath = process.argv[2];
if (!csvPath) {
    console.error('Usage: npx tsx scripts/import-style-codes.ts <csv-file-path>');
    process.exit(1);
}

const resolvedPath = path.resolve(csvPath);
if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
}

importStyleCodes(resolvedPath)
    .catch(console.error)
    .finally(() => prisma.$disconnect());
