import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { requireAdmin } from '../middleware/auth.js';
import { validatePassword } from '@coh/shared';
import { validateTokenVersion } from '../middleware/permissions.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router: Router = Router();

// ============================================
// REQUEST BODY INTERFACES
// ============================================

interface RegisterBody {
    email: string;
    password: string;
    name: string;
    role?: string;
}

interface LoginBody {
    email: string;
    password: string;
}

interface ChangePasswordBody {
    currentPassword: string;
    newPassword: string;
}

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
        const { email, password, name, role = 'staff' } = req.body as RegisterBody;

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
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET as string,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { expiresIn: process.env.JWT_EXPIRY || '7d' } as any
        );

        res.status(201).json({ user, token });
    })
);

// Login
router.post(
    '/login',
    asyncHandler(async (req: Request, res: Response) => {
        const { email, password } = req.body as LoginBody;

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
        const rolePermissions = new Set<string>(
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

        res.json({
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
        });
    })
);

// Get current user
router.get(
    '/me',
    asyncHandler(async (req: Request, res: Response) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            res.status(401).json({ error: 'No token provided' });
            return;
        }

        let decoded: DecodedToken;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET as string) as DecodedToken;
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
            decoded = jwt.verify(token, process.env.JWT_SECRET as string) as DecodedToken;
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

        const { currentPassword, newPassword } = req.body as ChangePasswordBody;

        // Validate input
        if (!currentPassword || !newPassword) {
            res.status(400).json({
                error: 'Current password and new password are required',
            });
            return;
        }

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

        // Hash and update new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await req.prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                mustChangePassword: false, // Clear forced password change flag
            },
        });

        res.json({ message: 'Password changed successfully' });
    })
);

export default router;
