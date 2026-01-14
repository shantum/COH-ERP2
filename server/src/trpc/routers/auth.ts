/**
 * Auth tRPC Router
 * Authentication procedures matching Express auth endpoints
 *
 * Procedures:
 * - login: Public mutation for email/password authentication
 * - me: Protected query for current user info
 * - changePassword: Protected mutation for password updates
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
// @ts-ignore - types are available in server context but might fail in client composite build
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { router, publicProcedure, protectedProcedure } from '../index.js';
import { validatePassword } from '@coh/shared';
import { validateTokenVersion } from '../../middleware/permissions.js';

/**
 * Login procedure
 * Authenticates user with email/password and returns JWT token
 */
const login = publicProcedure
    .input(
        z.object({
            email: z.string().email('Invalid email format'),
            password: z.string().min(1, 'Password is required'),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { email, password } = input;

        // Find user with role and permission overrides
        const user = await ctx.prisma.user.findUnique({
            where: { email },
            include: {
                userRole: true,
                permissionOverrides: true,
            },
        });

        if (!user) {
            throw new TRPCError({
                code: 'UNAUTHORIZED',
                message: 'Invalid credentials',
            });
        }

        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            throw new TRPCError({
                code: 'UNAUTHORIZED',
                message: 'Invalid credentials',
            });
        }

        // Check if active
        if (!user.isActive) {
            throw new TRPCError({
                code: 'UNAUTHORIZED',
                message: 'Account is disabled',
            });
        }

        // Generate token with tokenVersion for immediate invalidation
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role, // Keep for backward compatibility
                roleId: user.roleId,
                tokenVersion: user.tokenVersion, // For instant logout on permission change
            },
            process.env.JWT_SECRET as string,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { expiresIn: process.env.JWT_EXPIRY || '7d' } as any
        );

        // Calculate effective permissions (role + overrides)
        const rolePermissions = new Set(
            Array.isArray(user.userRole?.permissions)
                ? (user.userRole.permissions as string[])
                : []
        );

        for (const override of user.permissionOverrides || []) {
            if (override.granted) {
                rolePermissions.add(override.permission);
            } else {
                rolePermissions.delete(override.permission);
            }
        }

        return {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                roleId: user.roleId,
                roleName: user.userRole?.displayName || null,
                mustChangePassword: user.mustChangePassword,
            },
            // Include effective permissions (role + overrides) for frontend authorization
            permissions: Array.from(rolePermissions),
            token,
        };
    });

/**
 * Me procedure
 * Returns current authenticated user with permissions
 */
const me = protectedProcedure.query(async ({ ctx }) => {
    // Validate token version for immediate session invalidation
    if (ctx.user.tokenVersion !== undefined) {
        const isValid = await validateTokenVersion(
            ctx.prisma,
            ctx.user.id,
            ctx.user.tokenVersion
        );
        if (!isValid) {
            throw new TRPCError({
                code: 'FORBIDDEN',
                message: 'Session invalidated. Please login again.',
            });
        }
    }

    const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        include: {
            userRole: true,
            permissionOverrides: true,
        },
    });

    if (!user) {
        throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'User not found',
        });
    }

    // Calculate effective permissions (role + overrides)
    const rolePermissions = new Set(
        Array.isArray(user.userRole?.permissions)
            ? (user.userRole.permissions as string[])
            : []
    );

    for (const override of user.permissionOverrides || []) {
        if (override.granted) {
            rolePermissions.add(override.permission);
        } else {
            rolePermissions.delete(override.permission);
        }
    }

    return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        roleId: user.roleId,
        roleName: user.userRole?.displayName || null,
        permissions: Array.from(rolePermissions),
        mustChangePassword: user.mustChangePassword,
    };
});

/**
 * Change password procedure
 * Allows authenticated users to change their password
 */
const changePassword = protectedProcedure
    .input(
        z.object({
            currentPassword: z.string().min(1, 'Current password is required'),
            newPassword: z.string().min(1, 'New password is required'),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { currentPassword, newPassword } = input;

        // Validate token version for immediate session invalidation
        if (ctx.user.tokenVersion !== undefined) {
            const isValid = await validateTokenVersion(
                ctx.prisma,
                ctx.user.id,
                ctx.user.tokenVersion
            );
            if (!isValid) {
                throw new TRPCError({
                    code: 'FORBIDDEN',
                    message: 'Session invalidated. Please login again.',
                });
            }
        }

        // Validate password strength
        const passwordValidation = validatePassword(newPassword) as {
            isValid: boolean;
            errors: string[];
        };
        if (!passwordValidation.isValid) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: passwordValidation.errors[0],
            });
        }

        // Get user with password
        const user = await ctx.prisma.user.findUnique({
            where: { id: ctx.user.id },
        });

        if (!user) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'User not found',
            });
        }

        // Verify current password
        const validPassword = await bcrypt.compare(
            currentPassword,
            user.password
        );
        if (!validPassword) {
            throw new TRPCError({
                code: 'UNAUTHORIZED',
                message: 'Current password is incorrect',
            });
        }

        // Hash and update new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await ctx.prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                mustChangePassword: false, // Clear forced password change flag
            },
        });

        return { message: 'Password changed successfully' };
    });

/**
 * Auth router - combines all auth procedures
 */
export const authRouter = router({
    login,
    me,
    changePassword,
});
