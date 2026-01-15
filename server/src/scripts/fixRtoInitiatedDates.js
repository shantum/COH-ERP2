/**
 * Fix rtoInitiatedAt dates that were incorrectly set to sync time
 *
 * This script re-fetches tracking data from iThink API and extracts
 * the actual RTO event date from scan history.
 *
 * Run with: node src/scripts/fixRtoInitiatedDates.js
 */

import prisma from '../lib/prisma.js';
import ithinkClient from '../services/ithinkLogistics.js';

// RTO-related status keywords to find in scan history
const RTO_KEYWORDS = ['rto', 'return to origin', 'return to shipper', 'rts'];

/**
 * Find the first RTO event in scan history
 */
function findRtoEventDate(scanHistory) {
    if (!scanHistory || !Array.isArray(scanHistory)) return null;

    // Sort by datetime ascending to find the FIRST RTO event
    const sorted = [...scanHistory].sort((a, b) =>
        new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
    );

    for (const scan of sorted) {
        const statusLower = (scan.status || '').toLowerCase();
        const remarkLower = (scan.remark || '').toLowerCase();

        const isRto = RTO_KEYWORDS.some(keyword =>
            statusLower.includes(keyword) || remarkLower.includes(keyword)
        );

        if (isRto && scan.datetime) {
            return new Date(scan.datetime);
        }
    }

    return null;
}

async function fixRtoInitiatedDates() {
    console.log('Starting RTO initiated date fix...\n');

    // Load iThink credentials
    await ithinkClient.loadFromDatabase();

    if (!ithinkClient.isConfigured()) {
        console.error('iThink Logistics not configured. Cannot fetch tracking data.');
        process.exit(1);
    }

    // Find all orders with RTO tracking status that have rtoInitiatedAt set
    const ordersWithRto = await prisma.order.findMany({
        where: {
            rtoInitiatedAt: { not: null },
            awbNumber: { not: null },
        },
        select: {
            id: true,
            orderNumber: true,
            awbNumber: true,
            rtoInitiatedAt: true,
            orderDate: true,
        },
        orderBy: { orderDate: 'desc' },
    });

    console.log(`Found ${ordersWithRto.length} orders with RTO status and AWB numbers\n`);

    if (ordersWithRto.length === 0) {
        console.log('No orders to fix.');
        return;
    }

    const results = {
        checked: 0,
        fixed: 0,
        skipped: 0,
        errors: 0,
    };

    // Process in batches of 10 (iThink API limit)
    const BATCH_SIZE = 10;

    for (let i = 0; i < ordersWithRto.length; i += BATCH_SIZE) {
        const batch = ordersWithRto.slice(i, i + BATCH_SIZE);
        const awbNumbers = batch.map(o => o.awbNumber).filter(Boolean);

        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(ordersWithRto.length / BATCH_SIZE)}`);

        try {
            // Fetch full tracking details with scan history
            const trackingResults = {};
            for (const awb of awbNumbers) {
                try {
                    const details = await ithinkClient.getTrackingStatus(awb);
                    if (details) {
                        trackingResults[awb] = details;
                    }
                } catch (e) {
                    console.warn(`  Failed to fetch tracking for AWB ${awb}: ${e.message}`);
                }
            }

            // Process each order in batch
            for (const order of batch) {
                results.checked++;

                const tracking = trackingResults[order.awbNumber];
                if (!tracking || !tracking.scanHistory) {
                    console.log(`  ${order.orderNumber}: No scan history available, skipping`);
                    results.skipped++;
                    continue;
                }

                const actualRtoDate = findRtoEventDate(tracking.scanHistory);

                if (!actualRtoDate) {
                    console.log(`  ${order.orderNumber}: No RTO event found in scan history, skipping`);
                    results.skipped++;
                    continue;
                }

                const currentDate = order.rtoInitiatedAt;
                const daysDiff = Math.abs(actualRtoDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24);

                // Only update if dates differ by more than 1 day
                if (daysDiff > 1) {
                    console.log(`  ${order.orderNumber}: Fixing ${currentDate.toISOString().split('T')[0]} → ${actualRtoDate.toISOString().split('T')[0]}`);

                    // Update Order
                    await prisma.order.update({
                        where: { id: order.id },
                        data: { rtoInitiatedAt: actualRtoDate },
                    });

                    // Update OrderLines with same AWB
                    await prisma.orderLine.updateMany({
                        where: { awbNumber: order.awbNumber },
                        data: { rtoInitiatedAt: actualRtoDate },
                    });

                    results.fixed++;
                } else {
                    console.log(`  ${order.orderNumber}: Date is correct (${actualRtoDate.toISOString().split('T')[0]})`);
                    results.skipped++;
                }
            }

            // Rate limit between batches
            if (i + BATCH_SIZE < ordersWithRto.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

        } catch (error) {
            console.error(`  Batch error: ${error.message}`);
            results.errors++;
        }
    }

    console.log('\n========================================');
    console.log('RTO Initiated Date Fix Complete');
    console.log('========================================');
    console.log(`Checked:  ${results.checked}`);
    console.log(`Fixed:    ${results.fixed}`);
    console.log(`Skipped:  ${results.skipped}`);
    console.log(`Errors:   ${results.errors}`);
}

// Run the fix
fixRtoInitiatedDates()
    .then(() => {
        console.log('\nDone.');
        process.exit(0);
    })
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
