/**
 * Seed Default Roles
 * Run this after migration to create built-in roles
 * 
 * Usage: npx prisma db seed
 * Or: node server/prisma/seed-roles.js
 */

import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLES } from '../src/utils/permissions.js';

const prisma = new PrismaClient();

async function seedRoles() {
    console.log('Seeding default roles...');

    for (const [name, config] of Object.entries(DEFAULT_ROLES)) {
        const existing = await prisma.role.findUnique({ where: { name } });

        if (existing) {
            console.log(`  Role '${name}' already exists, updating permissions...`);
            await prisma.role.update({
                where: { name },
                data: {
                    displayName: config.displayName,
                    description: config.description,
                    permissions: config.permissions,
                    isBuiltIn: config.isBuiltIn,
                },
            });
        } else {
            console.log(`  Creating role '${name}'...`);
            await prisma.role.create({
                data: {
                    name,
                    displayName: config.displayName,
                    description: config.description,
                    permissions: config.permissions,
                    isBuiltIn: config.isBuiltIn,
                },
            });
        }
    }

    console.log('✓ Default roles seeded');
}

async function migrateExistingUsers() {
    console.log('\nMigrating existing users...');

    // Get role IDs
    const ownerRole = await prisma.role.findUnique({ where: { name: 'owner' } });
    const viewerRole = await prisma.role.findUnique({ where: { name: 'viewer' } });

    if (!ownerRole || !viewerRole) {
        console.error('Required roles not found. Run seedRoles first.');
        return;
    }

    // Migrate admin users to owner role
    const adminCount = await prisma.user.updateMany({
        where: { role: 'admin', roleId: null },
        data: { roleId: ownerRole.id },
    });
    console.log(`  Migrated ${adminCount.count} admin users to 'owner' role`);

    // Migrate staff users to viewer role
    const staffCount = await prisma.user.updateMany({
        where: { role: 'staff', roleId: null },
        data: { roleId: viewerRole.id },
    });
    console.log(`  Migrated ${staffCount.count} staff users to 'viewer' role`);

    console.log('✓ User migration complete');
}

async function main() {
    try {
        await seedRoles();
        await migrateExistingUsers();
    } catch (error) {
        console.error('Seed error:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

main();
