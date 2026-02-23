import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { validatePassword } from '@coh/shared';
import { validateTokenVersion } from '../middleware/permissions.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router: Router = Router();

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET env var is required');
const JWT_SECRET = process.env.JWT_SECRET;

// ============================================
// REQUEST BODY SCHEMAS (Zod runtime validation)
// ============================================

const RegisterBodySchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
    name: z.string().min(1, 'Name is required'),
    role: z.string().optional().default('staff'),
});

const LoginBodySchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
});

const ChangePasswordBodySchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(1, 'New password is required'),
});

// ============================================
// JWT PAYLOAD INTERFACE (for decoded tokens)
// ============================================

interface DecodedToken {
    id: string;
    email: string;
    role: string;
    roleId?: string;
    tokenVersion?: number;
    iat?: number;
    exp?: number;
}

// ============================================
// ROUTES
// ============================================

// Register new user (Admin only - use admin/users endpoint for user management)
router.post(
    '/register',
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
        const parseResult = RegisterBodySchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid request body' });
            return;
        }
        const { email, password, name, role } = parseResult.data;

        // Check if user exists
        const existing = await req.prisma.user.findUnique({ where: { email } });
        if (existing) {
            res.status(400).json({ error: 'User already exists' });
            return;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const user = await req.prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                role,
            },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
            },
        });

        // Generate token (expiry configurable via JWT_EXPIRY env var)
        const signOptions: SignOptions = { expiresIn: (process.env.JWT_EXPIRY || '7d') as SignOptions['expiresIn'] };
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, tokenVersion: 0 },
            JWT_SECRET,
            signOptions
        );

        res.status(201).json({ user, token });
    })
);

// Login
router.post(
    '/login',
    asyncHandler(async (req: Request, res: Response) => {
        const parseResult = LoginBodySchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid request body' });
            return;
        }
        const { email, password } = parseResult.data;

        // Find user with role and permission overrides
        const user = await req.prisma.user.findUnique({
            where: { email },
            include: {
                userRole: true,
                permissionOverrides: true,
            },
        });
        if (!user) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }

        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }

        // Check if active
        if (!user.isActive) {
            res.status(401).json({ error: 'Account is disabled' });
            return;
        }

        // Generate token with tokenVersion for immediate invalidation
        const loginSignOptions: SignOptions = { expiresIn: (process.env.JWT_EXPIRY || '7d') as SignOptions['expiresIn'] };
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role, // Keep for backward compatibility
                roleId: user.roleId,
                tokenVersion: user.tokenVersion, // For instant logout on permission change
            },
            JWT_SECRET,
            loginSignOptions
        );

        // Calculate effective permissions (role + overrides)
        const rolePermissions = new Set<string>(
            Array.isArray(user.userRole?.permissions)
                ? (user.userRole.permissions as string[])
                : []
        );

        // Legacy admin users without a role get wildcard access
        if (user.role === 'admin' && !user.roleId) {
            rolePermissions.add('*');
        }

        for (const override of user.permissionOverrides || []) {
            if (override.granted) {
                rolePermissions.add(override.permission);
            } else {
                rolePermissions.delete(override.permission);
            }
        }

        // Set auth token as HttpOnly cookie for Server Functions
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            path: '/',
        });

        res.json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                roleId: user.roleId,
                roleName: user.userRole?.displayName || null,
                extraAccess: Array.isArray(user.extraAccess) ? user.extraAccess : [],
                mustChangePassword: user.mustChangePassword,
            },
            // Include effective permissions (role + overrides) for frontend authorization
            permissions: Array.from(rolePermissions),
            // Still return token in response for backward compatibility (tRPC still needs it during migration)
            token,
        });
    })
);

// Logout - clear auth cookie
router.post(
    '/logout',
    asyncHandler(async (_req: Request, res: Response) => {
        res.clearCookie('auth_token', { path: '/' });
        res.json({ success: true });
    })
);

// Get current user
// Supports both Authorization header (legacy/tRPC) and auth_token cookie (SSR/Server Functions)
router.get(
    '/me',
    asyncHandler(async (req: Request, res: Response) => {
        // Try Authorization header first (for tRPC/legacy), then cookie (for SSR)
        const authHeader = req.headers['authorization'];
        const headerToken = authHeader && authHeader.split(' ')[1];
        const cookieToken = req.cookies?.auth_token;
        const token = headerToken || cookieToken;

        if (!token) {
            res.status(401).json({ error: 'No token provided' });
            return;
        }

        let decoded: DecodedToken;
        try {
            decoded = jwt.verify(token, JWT_SECRET) as DecodedToken;
        } catch {
            res.status(401).json({ error: 'Invalid token' });
            return;
        }

        // Validate token version for immediate session invalidation
        if (decoded.tokenVersion !== undefined) {
            const isValid = await validateTokenVersion(
                req.prisma,
                decoded.id,
                decoded.tokenVersion
            );
            if (!isValid) {
                res.status(403).json({
                    error: 'Session invalidated. Please login again.',
                });
                return;
            }
        }

        const user = await req.prisma.user.findUnique({
            where: { id: decoded.id },
            include: {
                userRole: true,
                permissionOverrides: true,
            },
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // Calculate effective permissions (role + overrides)
        const rolePermissions = new Set<string>(
            Array.isArray(user.userRole?.permissions)
                ? (user.userRole.permissions as string[])
                : []
        );

        // Legacy admin users without a role get wildcard access
        if (user.role === 'admin' && !user.roleId) {
            rolePermissions.add('*');
        }

        for (const override of user.permissionOverrides || []) {
            if (override.granted) {
                rolePermissions.add(override.permission);
            } else {
                rolePermissions.delete(override.permission);
            }
        }

        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            roleId: user.roleId,
            roleName: user.userRole?.displayName || null,
            permissions: Array.from(rolePermissions),
            extraAccess: Array.isArray(user.extraAccess) ? user.extraAccess : [],
            mustChangePassword: user.mustChangePassword,
        });
    })
);

// Change password
router.post(
    '/change-password',
    asyncHandler(async (req: Request, res: Response) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            res.status(401).json({ error: 'No token provided' });
            return;
        }

        let decoded: DecodedToken;
        try {
            decoded = jwt.verify(token, JWT_SECRET) as DecodedToken;
        } catch (error) {
            if (error instanceof Error && error.name === 'JsonWebTokenError') {
                res.status(401).json({ error: 'Invalid token' });
                return;
            }
            throw error;
        }

        // Validate token version for immediate session invalidation
        if (decoded.tokenVersion !== undefined) {
            const isValid = await validateTokenVersion(
                req.prisma,
                decoded.id,
                decoded.tokenVersion
            );
            if (!isValid) {
                res.status(403).json({
                    error: 'Session invalidated. Please login again.',
                });
                return;
            }
        }

        const parseResult = ChangePasswordBodySchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid request body' });
            return;
        }
        const { currentPassword, newPassword } = parseResult.data;

        // Validate password strength
        const passwordValidation = validatePassword(newPassword) as {
            isValid: boolean;
            errors: string[];
        };
        if (!passwordValidation.isValid) {
            res.status(400).json({ error: passwordValidation.errors[0] });
            return;
        }

        // Get user with password
        const user = await req.prisma.user.findUnique({
            where: { id: decoded.id },
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            res.status(401).json({ error: 'Current password is incorrect' });
            return;
        }

        // Hash and update new password, increment tokenVersion to invalidate all existing sessions
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await req.prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                mustChangePassword: false,
                tokenVersion: { increment: 1 },
            },
        });

        res.json({ message: 'Password changed successfully' });
    })
);

export default router;
