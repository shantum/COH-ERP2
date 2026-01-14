// @ts-ignore
import { PrismaClient } from '@prisma/client';
// @ts-ignore
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Debugging Login ---');

    // 1. Test Connection
    try {
        console.log('Testing DB connection...');
        await prisma.$connect();
        console.log('DB Connection successful.');
    } catch (e) {
        console.error('DB Connection Failed:', e);
        return;
    }

    // 2. Test User Fetch
    try {
        // Fetch the first active user to test
        let user = await prisma.user.findFirst({
            include: {
                userRole: true,
                permissionOverrides: true,
            },
        });

        if (!user) {
            console.log('No users found in database. Creating test user...');
            const hashedPassword = await bcrypt.hash('password123', 10);
            user = await prisma.user.create({
                data: {
                    email: 'test@example.com',
                    password: hashedPassword,
                    name: 'Test User',
                    role: 'admin',
                    isActive: true,
                },
                include: {
                    userRole: true,
                    permissionOverrides: true,
                }
            });
            console.log('Created Test User: test@example.com / password123');
        }

        console.log('Fetched User:', {
            id: user.id,
            email: user.email,
            role: user.role,
            roleId: user.roleId,
            permissionsLoaded: !!user.userRole
        });

        // 3. Test Bcrypt
        console.log('Testing bcrypt comparison...');
        // Just compare with a dummy string to see if the function actually runs (don't need true, just need no crash)
        try {
            const isMatch = await bcrypt.compare('any_password', user.password);
            console.log('Bcrypt verify executed successfully (Result: ' + isMatch + ')');
        } catch (bcryptErr) {
            console.error('Bcrypt Error:', bcryptErr);
            console.log('Bcrypt import details:', bcrypt);
        }

    } catch (e) {
        console.error('Database Operation Failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
