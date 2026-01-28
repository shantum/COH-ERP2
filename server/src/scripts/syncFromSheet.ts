/**
 * Google Sheets -> ERP Sync Script
 *
 * Syncs the ERP to match the Google Sheets state:
 * 1. Parse CSVs & build lookup maps
 * 2. AdminShip + release orders NOT on the sheet
 * 3. Create missing marketplace orders (Myntra, Ajio, Nykaa, Manual Exc)
 * 4. Sync notes on existing orders
 * 5. Sync order line statuses (allocated/picked/packed/shipped)
 * 6. Reconcile inventory balances
 *
 * Usage:
 *   npx tsx src/scripts/syncFromSheet.ts <orders.csv> <inventory.csv>           # Dry run (default)
 *   npx tsx src/scripts/syncFromSheet.ts <orders.csv> <inventory.csv> --execute  # Apply changes
 *
 * Run from: cd server
 */

import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { parseAllCsvs } from './lib/csvParser.js';
import {
    planShipAndRelease,
    executeShipAndRelease,
    planCreateOrders,
    executeCreateOrders,
    planSyncNotes,
    executeSyncNotes,
    planLineStatusSync,
    executeLineStatusSync,
    planProductionBatchSync,
    executeProductionBatchSync,
} from './lib/orderSync.js';
import {
    planInventoryReconcile,
    executeInventoryReconcile,
} from './lib/inventorySync.js';

// ============================================
// CONFIG
// ============================================

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');
const DRY_RUN = !EXECUTE;

// ============================================
// HELPERS
// ============================================

function header(title: string) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${title}`);
    console.log(`${'='.repeat(60)}\n`);
}

function subheader(title: string) {
    console.log(`\n--- ${title} ---\n`);
}

// ============================================
// MAIN
// ============================================

async function syncFromSheet() {
    // Parse CLI args for file paths
    const args = process.argv.filter(a => !a.startsWith('--'));
    const ordersPath = args[2] ? resolve(args[2]) : null;
    const inventoryPath = args[3] ? resolve(args[3]) : null;

    if (!ordersPath || !inventoryPath) {
        console.error('Usage: npx tsx src/scripts/syncFromSheet.ts <orders.csv> <inventory.csv> [--execute]');
        console.error('');
        console.error('Options:');
        console.error('  --execute    Apply changes (default is dry-run)');
        process.exit(1);
    }

    if (!existsSync(ordersPath)) {
        console.error(`Orders CSV not found: ${ordersPath}`);
        process.exit(1);
    }
    if (!existsSync(inventoryPath)) {
        console.error(`Inventory CSV not found: ${inventoryPath}`);
        process.exit(1);
    }

    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'EXECUTE (changes will be applied!)'}`);
    console.log(`Orders CSV: ${ordersPath}`);
    console.log(`Inventory CSV: ${inventoryPath}`);

    // Look up system/admin user for createdById on all mutations
    let systemUser = await prisma.user.findFirst({
        where: { email: 'system@coh.com' },
        select: { id: true },
    });
    if (!systemUser) {
        systemUser = await prisma.user.findFirst({
            where: { email: 'admin@coh.com' },
            select: { id: true },
        });
    }
    if (!systemUser) {
        throw new Error('No system@coh.com or admin@coh.com user found. Cannot proceed.');
    }
    const userId = systemUser.id;

    // ============================================
    // STEP 1: Parse CSVs
    // ============================================
    header('Step 1: Parse CSVs');

    const data = parseAllCsvs(ordersPath, inventoryPath);

    console.log(`Order rows parsed: ${data.orderRows.length}`);
    console.log(`Unique orders: ${data.orderNumberSet.size}`);
    console.log(`Inventory rows parsed: ${data.inventoryRows.length}`);

    // Show channel distribution
    const channelCounts = new Map<string, number>();
    for (const row of data.orderRows) {
        const ch = row.channel || 'unknown';
        channelCounts.set(ch, (channelCounts.get(ch) || 0) + 1);
    }
    subheader('Channel Distribution');
    for (const [ch, count] of [...channelCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${ch}: ${count} lines`);
    }

    // ============================================
    // STEP 2: Admin Ship + Release
    // ============================================
    header('Step 2: Ship & Release Orders NOT on Sheet');

    const shipReport = await planShipAndRelease(prisma, data.orderNumberSet);

    console.log(`Orders to release from Open view: ${shipReport.ordersToRelease.length}`);
    if (shipReport.ordersToRelease.length > 0) {
        const allCancelledCount = shipReport.ordersToRelease.filter(o => o.allCancelled).length;
        const toShipCount = shipReport.ordersToRelease.length - allCancelledCount;
        const totalLines = shipReport.ordersToRelease.reduce((s, o) => s + o.nonShippedLineCount, 0);

        console.log(`  - To admin-ship: ${toShipCount} orders (${totalLines} lines)`);
        console.log(`  - Already cancelled (just release): ${allCancelledCount} orders`);

        subheader('Sample Orders to Release');
        for (const o of shipReport.ordersToRelease.slice(0, 15)) {
            const tag = o.allCancelled ? '[CANCELLED]' : `[${o.nonShippedLineCount} lines to ship]`;
            console.log(`  ${o.orderNumber} ${tag}`);
        }
        if (shipReport.ordersToRelease.length > 15) {
            console.log(`  ... and ${shipReport.ordersToRelease.length - 15} more`);
        }
    }

    if (EXECUTE && shipReport.ordersToRelease.length > 0) {
        subheader('Executing Ship & Release');
        const result = await executeShipAndRelease(prisma, shipReport, userId);
        console.log(`  Lines shipped: ${result.shipped}`);
        console.log(`  Orders released: ${result.released}`);
        if (result.errors.length > 0) {
            console.log(`  Errors: ${result.errors.length}`);
            result.errors.slice(0, 10).forEach(e => console.log(`    - ${e}`));
        }
    }

    // ============================================
    // STEP 3: Create Missing Marketplace Orders
    // ============================================
    header('Step 3: Create Missing Marketplace Orders');

    const createReport = await planCreateOrders(prisma, data.ordersByNumber);

    console.log(`Marketplace orders to create: ${createReport.ordersToCreate.length}`);
    if (createReport.ordersToCreate.length > 0) {
        subheader('Orders to Create');
        for (const o of createReport.ordersToCreate.slice(0, 20)) {
            const exchange = o.isExchange ? ' [EXCHANGE]' : '';
            const missing = o.missingSkus.length > 0 ? ` (MISSING SKUs: ${o.missingSkus.join(', ')})` : '';
            console.log(`  ${o.orderNumber} - ${o.channel}${exchange}, ${o.lineCount} lines [${o.skuCodes.join(', ')}]${missing}`);
        }
        if (createReport.ordersToCreate.length > 20) {
            console.log(`  ... and ${createReport.ordersToCreate.length - 20} more`);
        }
    }

    if (EXECUTE && createReport.ordersToCreate.length > 0) {
        subheader('Executing Order Creation');
        const result = await executeCreateOrders(prisma, data.ordersByNumber, createReport, userId);
        console.log(`  Orders created: ${result.created}`);
        if (result.errors.length > 0) {
            console.log(`  Errors: ${result.errors.length}`);
            result.errors.slice(0, 10).forEach(e => console.log(`    - ${e}`));
        }
    }

    // ============================================
    // STEP 4: Sync Notes
    // ============================================
    header('Step 4: Sync Notes on Existing Orders');

    const notesReport = await planSyncNotes(prisma, data.ordersByNumber);

    console.log(`Orders with notes to update: ${notesReport.ordersToUpdate.length}`);
    if (notesReport.ordersToUpdate.length > 0) {
        subheader('Sample Notes Updates');
        for (const o of notesReport.ordersToUpdate.slice(0, 10)) {
            console.log(`  ${o.orderNumber}: "${o.newNotes.slice(0, 80)}${o.newNotes.length > 80 ? '...' : ''}"`);
        }
    }

    if (EXECUTE && notesReport.ordersToUpdate.length > 0) {
        subheader('Executing Notes Sync');
        const result = await executeSyncNotes(prisma, notesReport);
        console.log(`  Notes updated: ${result.updated}`);
        if (result.errors.length > 0) {
            console.log(`  Errors: ${result.errors.length}`);
            result.errors.slice(0, 5).forEach(e => console.log(`    - ${e}`));
        }
    }

    // ============================================
    // STEP 5: Sync Line Statuses
    // ============================================
    header('Step 5: Sync Order Line Statuses');

    const statusReport = await planLineStatusSync(prisma, data.ordersByNumber);

    console.log(`Status transitions planned: ${statusReport.transitions.length}`);
    console.log(`AWB-only updates: ${statusReport.awbUpdates.length}`);
    console.log(`Lines skipped: ${statusReport.skipped.length}`);

    if (statusReport.transitions.length > 0) {
        // Group transitions by type for summary
        const transitionCounts = new Map<string, number>();
        for (const t of statusReport.transitions) {
            const key = `${t.from} -> ${t.to}`;
            transitionCounts.set(key, (transitionCounts.get(key) || 0) + 1);
        }

        subheader('Transition Summary');
        for (const [key, count] of [...transitionCounts.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`  ${key}: ${count}`);
        }

        subheader('Sample Transitions');
        for (const t of statusReport.transitions.slice(0, 15)) {
            const awb = t.awb ? ` AWB=${t.awb}` : '';
            console.log(`  ${t.orderNumber}/${t.skuCode}: ${t.from} -> ${t.to}${awb}`);
        }
        if (statusReport.transitions.length > 15) {
            console.log(`  ... and ${statusReport.transitions.length - 15} more`);
        }
    }

    if (statusReport.skipped.length > 0) {
        subheader('Skipped Lines (first 10)');
        for (const s of statusReport.skipped.slice(0, 10)) {
            console.log(`  ${s.orderNumber}/${s.skuCode}: ${s.reason}`);
        }
    }

    if (EXECUTE && (statusReport.transitions.length > 0 || statusReport.awbUpdates.length > 0)) {
        subheader('Executing Line Status Sync');
        const result = await executeLineStatusSync(prisma, statusReport, userId);
        console.log(`  Transitions applied: ${result.transitioned}`);
        console.log(`  AWB updates: ${result.awbUpdated}`);
        if (result.errors.length > 0) {
            console.log(`  Errors: ${result.errors.length}`);
            result.errors.slice(0, 10).forEach(e => console.log(`    - ${e}`));
        }
    }

    // ============================================
    // STEP 6: Assign Production Batches
    // ============================================
    header('Step 6: Assign Production Batches (samplingDate)');

    const batchReport = await planProductionBatchSync(prisma, data.ordersByNumber);

    console.log(`Lines with samplingDate: ${batchReport.assignments.length + batchReport.alreadyLinked + batchReport.dateUpdates.length}`);
    console.log(`Already linked (date matches): ${batchReport.alreadyLinked}`);
    console.log(`Batches to create: ${batchReport.assignments.length}`);
    console.log(`Batch dates to update: ${batchReport.dateUpdates.length}`);
    console.log(`Skipped: ${batchReport.skipped.length}`);

    if (batchReport.assignments.length > 0) {
        // Group by date for summary
        const byDate = new Map<string, number>();
        for (const a of batchReport.assignments) {
            const d = a.samplingDate.toISOString().split('T')[0];
            byDate.set(d, (byDate.get(d) || 0) + 1);
        }

        subheader('Batches by Date');
        for (const [date, count] of [...byDate.entries()].sort()) {
            console.log(`  ${date}: ${count} batches`);
        }

        subheader('Sample Assignments');
        for (const a of batchReport.assignments.slice(0, 15)) {
            console.log(`  ${a.orderNumber}/${a.skuCode} -> ${a.samplingDate.toISOString().split('T')[0]}`);
        }
        if (batchReport.assignments.length > 15) {
            console.log(`  ... and ${batchReport.assignments.length - 15} more`);
        }
    }

    if (batchReport.dateUpdates.length > 0) {
        subheader('Batch Date Updates');
        for (const u of batchReport.dateUpdates.slice(0, 15)) {
            const oldDay = u.oldDate.toISOString().split('T')[0];
            const newDay = u.newDate.toISOString().split('T')[0];
            console.log(`  ${u.orderNumber}/${u.skuCode} (${u.batchCode || 'no-code'}): ${oldDay} -> ${newDay}`);
        }
        if (batchReport.dateUpdates.length > 15) {
            console.log(`  ... and ${batchReport.dateUpdates.length - 15} more`);
        }
    }

    if (batchReport.skipped.length > 0) {
        subheader('Skipped (first 10)');
        for (const s of batchReport.skipped.slice(0, 10)) {
            console.log(`  ${s.orderNumber}/${s.skuCode}: ${s.reason}`);
        }
    }

    if (EXECUTE && (batchReport.assignments.length > 0 || batchReport.dateUpdates.length > 0)) {
        subheader('Executing Production Batch Assignment');
        const result = await executeProductionBatchSync(prisma, batchReport);
        console.log(`  Batches created & linked: ${result.created}`);
        console.log(`  Batch dates updated: ${result.dateUpdated}`);
        if (result.errors.length > 0) {
            console.log(`  Errors: ${result.errors.length}`);
            result.errors.slice(0, 10).forEach(e => console.log(`    - ${e}`));
        }
    }

    // ============================================
    // STEP 7: Reconcile Inventory
    // ============================================
    header('Step 7: Reconcile Inventory');

    const inventoryReport = await planInventoryReconcile(prisma, data.inventoryBySkuCode);

    console.log(`Total SKUs in CSV: ${inventoryReport.summary.totalSkus}`);
    console.log(`Already in balance: ${inventoryReport.summary.skusInBalance}`);
    console.log(`Adjustments needed: ${inventoryReport.summary.adjustmentsNeeded}`);
    console.log(`SKUs not found: ${inventoryReport.skippedSkus.length}`);
    console.log(`Total inward qty: +${inventoryReport.summary.totalInward}`);
    console.log(`Total outward qty: -${inventoryReport.summary.totalOutward}`);

    if (inventoryReport.adjustments.length > 0) {
        subheader('Sample Adjustments');
        for (const a of inventoryReport.adjustments.slice(0, 20)) {
            const dir = a.delta > 0 ? '+' : '';
            console.log(`  ${a.skuCode}: ${a.currentBalance} -> ${a.targetBalance} (${dir}${a.delta} ${a.txnType})`);
        }
        if (inventoryReport.adjustments.length > 20) {
            console.log(`  ... and ${inventoryReport.adjustments.length - 20} more`);
        }
    }

    if (inventoryReport.skippedSkus.length > 0) {
        subheader('Skipped SKUs (first 10)');
        for (const s of inventoryReport.skippedSkus.slice(0, 10)) {
            console.log(`  ${s.skuCode}: ${s.reason}`);
        }
    }

    if (EXECUTE && inventoryReport.adjustments.length > 0) {
        subheader('Executing Inventory Reconciliation');
        const result = await executeInventoryReconcile(prisma, inventoryReport, userId);
        console.log(`  Adjustments applied: ${result.adjusted}`);
        if (result.errors.length > 0) {
            console.log(`  Errors: ${result.errors.length}`);
            result.errors.slice(0, 10).forEach(e => console.log(`    - ${e}`));
        }
    }

    // ============================================
    // SUMMARY
    // ============================================
    header('Summary');

    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTED'}`);
    console.log('');
    console.log(`Step 2 - Ship & Release:       ${shipReport.ordersToRelease.length} orders`);
    console.log(`Step 3 - Create Orders:         ${createReport.ordersToCreate.length} orders`);
    console.log(`Step 4 - Sync Notes:            ${notesReport.ordersToUpdate.length} orders`);
    console.log(`Step 5 - Status Transitions:    ${statusReport.transitions.length} transitions, ${statusReport.awbUpdates.length} AWB updates`);
    console.log(`Step 6 - Production Batches:    ${batchReport.assignments.length} new, ${batchReport.dateUpdates.length} date updates (${batchReport.alreadyLinked} unchanged)`);
    console.log(`Step 7 - Inventory Adjustments: ${inventoryReport.summary.adjustmentsNeeded} SKUs`);

    if (DRY_RUN) {
        console.log('\nThis was a dry run. To apply changes, run with --execute flag.');
    }

    console.log('\nDone.');
}

syncFromSheet()
    .catch((e) => {
        console.error('Sync failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
