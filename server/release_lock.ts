import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const LOCK_ID = 72707369;
    console.log(`Searching for session holding advisory lock ${LOCK_ID}...`);

    try {
        // Find the PID holding the lock
        // Cast objid to bigint/string for comparison if needed, but usually it matches directly
        const locks: any[] = await prisma.$queryRaw`
      SELECT pid, locktype, mode, granted, objid::text, classid::text
      FROM pg_locks 
      WHERE locktype = 'advisory'
      AND (objid::text = ${LOCK_ID.toString()} OR classid::text = ${LOCK_ID.toString()})
    `;

        console.log('Found locks:', locks);

        if (locks.length > 0) {
            for (const lock of locks) {
                const pid = lock.pid;
                console.log(`Terminating backend with PID ${pid} holding the lock...`);
                try {
                    const terminateResult = await prisma.$queryRaw`SELECT pg_terminate_backend(${pid}::int)`;
                    console.log(`Termination result for PID ${pid}:`, terminateResult);
                } catch (err) {
                    console.error(`Failed to terminate PID ${pid}:`, err);
                }
            }
            console.log('Finished termination attempts.');
        } else {
            // Fallback: Check if there are ANY advisory locks if the strict match failed
            console.log('No exact match found. Listing ALL current advisory locks for debugging:');
            const allLocks = await prisma.$queryRaw`
            SELECT pid, locktype, mode, granted, objid::text, classid::text
            FROM pg_locks 
            WHERE locktype = 'advisory'
        `;
            console.log(allLocks);
        }

    } catch (error) {
        console.error('Error during inspection/termination:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
