/**
 * Production utilities - shared helpers for production-related operations
 */

/**
 * Get locked production dates from system settings
 * @param {PrismaClient} prisma - Prisma client instance
 * @returns {Promise<string[]>} Array of locked date strings in YYYY-MM-DD format
 */
export async function getLockedDates(prisma) {
    const setting = await prisma.systemSetting.findUnique({
        where: { key: 'locked_production_dates' }
    });
    return setting?.value ? JSON.parse(setting.value) : [];
}

/**
 * Check if a specific date is locked for production
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Date|string} date - Date to check
 * @returns {Promise<boolean>} True if the date is locked
 */
export async function isDateLocked(prisma, date) {
    const lockedDates = await getLockedDates(prisma);
    const dateStr = typeof date === 'string' 
        ? date.split('T')[0] 
        : date.toISOString().split('T')[0];
    return lockedDates.includes(dateStr);
}

/**
 * Save locked production dates to system settings
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {string[]} lockedDates - Array of date strings in YYYY-MM-DD format
 */
export async function saveLockedDates(prisma, lockedDates) {
    await prisma.systemSetting.upsert({
        where: { key: 'locked_production_dates' },
        update: { value: JSON.stringify(lockedDates) },
        create: { key: 'locked_production_dates', value: JSON.stringify(lockedDates) }
    });
}
