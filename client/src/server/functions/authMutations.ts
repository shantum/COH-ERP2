/**
 * Auth Mutations - TanStack Start Server Functions
 *
 * Phase 1 mutations - Simple CRUD with NO SSE broadcasting and NO cache invalidation.
 *
 * Mutations:
 * - changePassword: Update authenticated user's password
 */
'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware, type AuthUser } from '../middleware/auth';
import { validatePassword } from '@coh/shared';
import type { PrismaClient } from '@prisma/client';

// Type for bcrypt module (dynamic import)
interface BcryptModule {
    compare(data: string, encrypted: string): Promise<boolean>;
    hash(data: string, saltOrRounds: number): Promise<string>;
}

// ============================================
// INPUT SCHEMAS (Zod is source of truth)
// ============================================

/**
 * Change password input schema
 * Matches tRPC auth.changePassword input
 */
const ChangePasswordInputSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(1, 'New password is required'),
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;

// ============================================
// CHANGE PASSWORD MUTATION
// ============================================

/**
 * Change password for authenticated user
 *
 * Validates:
 * - Token version for session invalidation
 * - Password strength requirements (8+ chars, uppercase, lowercase, number, special)
 * - Current password correctness
 *
 * On success:
 * - Updates password hash
 * - Clears mustChangePassword flag
 */
export const changePassword = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): ChangePasswordInput => ChangePasswordInputSchema.parse(input)
    )
    .handler(
        async ({
            data,
            context,
        }: {
            data: ChangePasswordInput;
            context: { user: AuthUser };
        }) => {
            const { currentPassword, newPassword } = data;
            const user = context.user;

            // Dynamic Prisma import to prevent bundling into client
            const { PrismaClient } = await import('@prisma/client');
            const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
            const prisma = globalForPrisma.prisma ?? new PrismaClient();
            if (process.env.NODE_ENV !== 'production') {
                globalForPrisma.prisma = prisma;
            }

            // Dynamic bcrypt import (Node.js only)
            // @ts-expect-error - bcryptjs is available on server via dynamic import
            const bcrypt = (await import('bcryptjs')) as unknown as BcryptModule;

            // Validate token version for immediate session invalidation
            if (user.tokenVersion !== undefined) {
                const dbUser = await prisma.user.findUnique({
                    where: { id: user.id },
                    select: { tokenVersion: true },
                });
                if (!dbUser || dbUser.tokenVersion !== user.tokenVersion) {
                    throw new Error('Session invalidated. Please login again.');
                }
            }

            // Validate password strength
            const passwordValidation = validatePassword(newPassword);
            if (!passwordValidation.isValid) {
                throw new Error(passwordValidation.errors[0]);
            }

            // Get user with password for verification
            const dbUser = await prisma.user.findUnique({
                where: { id: user.id },
            });

            if (!dbUser) {
                throw new Error('User not found');
            }

            // Verify current password
            const validPassword = await bcrypt.compare(currentPassword, dbUser.password);
            if (!validPassword) {
                throw new Error('Current password is incorrect');
            }

            // Hash and update new password
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    password: hashedPassword,
                    mustChangePassword: false, // Clear forced password change flag
                },
            });

            return { message: 'Password changed successfully' };
        }
    );
