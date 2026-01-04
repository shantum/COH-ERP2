/**
 * Singleton PrismaClient instance
 * Prevents multiple connections and handles SQLite connection settings
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = global;

const prisma = globalForPrisma.prisma ?? new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// Set SQLite pragmas for better concurrency (use $queryRaw for PRAGMA)
prisma.$queryRawUnsafe('PRAGMA busy_timeout = 30000;').catch(() => {});
prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;').catch(() => {});

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

export default prisma;
