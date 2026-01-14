import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Dropping ShopifyOrderCache table...');
    try {
        await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "ShopifyOrderCache" CASCADE;');
        console.log('Successfully dropped ShopifyOrderCache table.');
    } catch (e) {
        console.error('Error dropping table:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
