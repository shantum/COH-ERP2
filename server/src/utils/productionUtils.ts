/**
 * Production utilities - shared helpers for production-related operations
 */

import type { PrismaClient } from '@prisma/client';

/**
 * Get locked production dates from system settings
 * @param prisma - Prisma client instance
 * @returns Array of locked date strings in YYYY-MM-DD format
 */
export async function getLockedDates(prisma: PrismaClient): Promise<string[]> {
    const setting = await prisma.systemSetting.findUnique({
        where: { key: 'locked_production_dates' }
    });
    return setting?.value ? JSON.parse(setting.value) : [];
}

/**
 * Check if a specific date is locked for production
 * @param prisma - Prisma client instance
 * @param date - Date to check
 * @returns True if the date is locked
 */
export async function isDateLocked(prisma: PrismaClient, date: Date | string): Promise<boolean> {
    const lockedDates = await getLockedDates(prisma);
    const dateStr = typeof date === 'string'
        ? date.split('T')[0]
        : date.toISOString().split('T')[0];
    return lockedDates.includes(dateStr);
}

/**
 * Save locked production dates to system settings
 * @param prisma - Prisma client instance
 * @param lockedDates - Array of date strings in YYYY-MM-DD format
 */
export async function saveLockedDates(prisma: PrismaClient, lockedDates: string[]): Promise<void> {
    await prisma.systemSetting.upsert({
        where: { key: 'locked_production_dates' },
        update: { value: JSON.stringify(lockedDates) },
        create: { key: 'locked_production_dates', value: JSON.stringify(lockedDates) }
    });
}
