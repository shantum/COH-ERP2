/**
 * Data Migration Script: Order Tracking → OrderLine
 *
 * This script migrates tracking data from Order-level fields to OrderLine-level fields.
 * It only updates OrderLines that are missing tracking data.
 *
 * Run with: npx ts-node src/scripts/migrateOrderTrackingToLines.ts
 *
 * IMPORTANT: Run this BEFORE dropping Order-level tracking columns!
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MigrationStats {
    ordersProcessed: number;
    linesUpdated: number;
    linesSkipped: number;
    errors: number;
}

async function migrateOrderTrackingToLines(): Promise<MigrationStats> {
    console.log('Starting Order tracking data migration to OrderLines...\n');

    const stats: MigrationStats = {
        ordersProcessed: 0,
        linesUpdated: 0,
        linesSkipped: 0,
        errors: 0,
    };

    // Note: This query will fail after the schema migration removes these fields
    // The script should be run BEFORE applying the migration
    const batchSize = 100;
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
        try {
            // Find orders that have tracking data at Order level
            // Using raw query since fields may not exist in Prisma types after migration
            const orders = await prisma.$queryRaw<
                Array<{
                    id: string;
                    awbNumber: string | null;
                    courier: string | null;
                    shippedAt: Date | null;
                    deliveredAt: Date | null;
                    trackingStatus: string | null;
                    lastTrackingUpdate: Date | null;
                    lastScanAt: Date | null;
                    lastScanLocation: string | null;
                    lastScanStatus: string | null;
                    courierStatusCode: string | null;
                    deliveryAttempts: number | null;
                    expectedDeliveryDate: Date | null;
                    rtoInitiatedAt: Date | null;
                    rtoReceivedAt: Date | null;
                }>
            >`
                SELECT
                    id, "awbNumber", courier, "shippedAt", "deliveredAt",
                    "trackingStatus", "lastTrackingUpdate", "lastScanAt",
                    "lastScanLocation", "lastScanStatus", "courierStatusCode",
                    "deliveryAttempts", "expectedDeliveryDate",
                    "rtoInitiatedAt", "rtoReceivedAt"
                FROM "Order"
                WHERE "awbNumber" IS NOT NULL
                   OR "trackingStatus" IS NOT NULL
                ORDER BY id
                LIMIT ${batchSize}
                OFFSET ${skip}
            `;

            if (orders.length === 0) {
                hasMore = false;
                break;
            }

            for (const order of orders) {
                try {
                    // Find OrderLines that don't have tracking data
                    const linesToUpdate = await prisma.orderLine.findMany({
                        where: {
                            orderId: order.id,
                            awbNumber: null,
                        },
                        select: { id: true },
                    });

                    if (linesToUpdate.length === 0) {
                        stats.linesSkipped += await prisma.orderLine.count({
                            where: { orderId: order.id },
                        });
                        stats.ordersProcessed++;
                        continue;
                    }

                    // Build update data (only include non-null values)
                    const updateData: Record<string, unknown> = {};

                    if (order.awbNumber) updateData.awbNumber = order.awbNumber;
                    if (order.courier) updateData.courier = order.courier;
                    if (order.shippedAt) updateData.shippedAt = order.shippedAt;
                    if (order.deliveredAt) updateData.deliveredAt = order.deliveredAt;
                    if (order.trackingStatus) updateData.trackingStatus = order.trackingStatus;
                    if (order.lastTrackingUpdate) updateData.lastTrackingUpdate = order.lastTrackingUpdate;
                    if (order.lastScanAt) updateData.lastScanAt = order.lastScanAt;
                    if (order.lastScanLocation) updateData.lastScanLocation = order.lastScanLocation;
                    if (order.lastScanStatus) updateData.lastScanStatus = order.lastScanStatus;
                    if (order.courierStatusCode) updateData.courierStatusCode = order.courierStatusCode;
                    if (order.deliveryAttempts) updateData.deliveryAttempts = order.deliveryAttempts;
                    if (order.expectedDeliveryDate) updateData.expectedDeliveryDate = order.expectedDeliveryDate;
                    if (order.rtoInitiatedAt) updateData.rtoInitiatedAt = order.rtoInitiatedAt;
                    if (order.rtoReceivedAt) updateData.rtoReceivedAt = order.rtoReceivedAt;

                    if (Object.keys(updateData).length > 0) {
                        // Update all lines missing tracking data
                        const result = await prisma.orderLine.updateMany({
                            where: {
                                id: { in: linesToUpdate.map((l) => l.id) },
                            },
                            data: updateData,
                        });

                        stats.linesUpdated += result.count;
                    }

                    stats.ordersProcessed++;
                } catch (orderError) {
                    console.error(`Error processing order ${order.id}:`, orderError);
                    stats.errors++;
                }
            }

            skip += batchSize;
            console.log(`Processed ${stats.ordersProcessed} orders, ${stats.linesUpdated} lines updated...`);
        } catch (batchError) {
            console.error('Batch error:', batchError);
            stats.errors++;
            hasMore = false;
        }
    }

    return stats;
}

async function main() {
    console.log('='.repeat(60));
    console.log('Order Tracking Migration: Order → OrderLine');
    console.log('='.repeat(60));
    console.log('');
    console.log('This script copies tracking data from Order-level fields to');
    console.log('OrderLines that are missing tracking data.');
    console.log('');
    console.log('NOTE: Run this BEFORE applying the schema migration that');
    console.log('removes Order-level tracking fields.');
    console.log('');
    console.log('='.repeat(60));
    console.log('');

    try {
        const stats = await migrateOrderTrackingToLines();

        console.log('\n' + '='.repeat(60));
        console.log('Migration Complete!');
        console.log('='.repeat(60));
        console.log(`Orders processed: ${stats.ordersProcessed}`);
        console.log(`Lines updated:    ${stats.linesUpdated}`);
        console.log(`Lines skipped:    ${stats.linesSkipped} (already had tracking data)`);
        console.log(`Errors:           ${stats.errors}`);
        console.log('='.repeat(60));
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
