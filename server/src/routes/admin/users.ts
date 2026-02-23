import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
// @ts-ignore - types are available in server context but might fail in client composite build
import bcrypt from 'bcryptjs';
import { validatePassword } from '@coh/shared';
import { ValidationError, NotFoundError, ConflictError, BusinessLogicError } from '../../utils/errors.js';
import type { CreateUserBody, UpdateUserBody, PasswordValidationResult } from './types.js';

const router = Router();

/**
 * List all users with their roles
 * @route GET /api/admin/users
 * @returns {Object[]} users - [{ id, email, name, role, roleId, isActive, createdAt, roleName }]
 */
router.get('/users', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const users = await req.prisma.user.findMany({
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            roleId: true,
            isActive: true,
            createdAt: true,
            userRole: {
                select: {
                    id: true,
                    name: true,
                    displayName: true,
                }
            },
        },
        orderBy: { createdAt: 'desc' },
    });

    // Transform to include roleName for frontend
    const usersWithRoleName = users.map(u => ({
        ...u,
        roleName: u.userRole?.displayName || u.role,
    }));

    res.json(usersWithRoleName);
}));

// Get single user
router.get('/users/:id', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const user = await req.prisma.user.findUnique({
        where: { id },
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            createdAt: true,
        },
    });

    if (!user) {
        throw new NotFoundError('User not found', 'User', id);
    }

    res.json(user);
}));

/**
 * Create new user (validates password strength)
 * @route POST /api/admin/users
 * @param {string} body.email - Unique email
 * @param {string} body.password - Password (min 8 chars, complexity required)
 * @param {string} body.name - Full name
 * @param {string} [body.role='staff'] - Legacy role ('admin' or 'staff')
 * @param {string} [body.roleId] - New permissions system role UUID
 * @returns {Object} user - Created user
 */
router.post('/users', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { email, password, name, role = 'staff', roleId } = req.body as CreateUserBody;

    // Validate input
    if (!email || !password || !name) {
        throw new ValidationError('Email, password, and name are required');
    }

    // Validate password strength
    const passwordValidation = validatePassword(password) as PasswordValidationResult;
    if (!passwordValidation.isValid) {
        throw new ValidationError(passwordValidation.errors[0]);
    }

    // Validate role (legacy string role)
    const validRoles = ['admin', 'staff'];
    if (!validRoles.includes(role)) {
        throw new ValidationError('Invalid role. Must be admin or staff');
    }

    // Validate roleId if provided
    if (roleId) {
        const roleExists = await req.prisma.role.findUnique({ where: { id: roleId } });
        if (!roleExists) {
            throw new ValidationError('Invalid roleId - role not found');
        }
    }

    // Check if email already exists
    const existing = await req.prisma.user.findUnique({ where: { email } });
    if (existing) {
        throw new ConflictError('Email already in use', 'duplicate_email');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user with roleId if provided
    const user = await req.prisma.user.create({
        data: {
            email,
            password: hashedPassword,
            name,
            role,
            roleId: roleId || null,
        },
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            roleId: true,
            isActive: true,
            createdAt: true,
            userRole: {
                select: {
                    id: true,
                    name: true,
                    displayName: true,
                }
            },
        },
    });

    // Transform to include roleName for frontend
    res.status(201).json({
        ...user,
        roleName: user.userRole?.displayName || user.role,
    });
}));

/**
 * Update user details (protects last admin)
 * @route PUT /api/admin/users/:id
 * @param {string} [body.email] - New email
 * @param {string} [body.name] - New name
 * @param {string} [body.role] - New role
 * @param {boolean} [body.isActive] - Active status
 * @param {string} [body.password] - New password (re-hashed)
 * @description Cannot disable/demote last admin user.
 */
router.put('/users/:id', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { email, name, role, isActive, password } = req.body as UpdateUserBody;
    const id = req.params.id as string;

    // Get existing user
    const existing = await req.prisma.user.findUnique({
        where: { id },
    });

    if (!existing) {
        throw new NotFoundError('User not found', 'User', id);
    }

    // Prevent disabling the last admin
    if (existing.role === 'admin' && isActive === false) {
        const adminCount = await req.prisma.user.count({
            where: { role: 'admin', isActive: true },
        });
        if (adminCount <= 1) {
            throw new BusinessLogicError('Cannot disable the last admin user', 'last_admin_protection');
        }
    }

    // Prevent changing role of last admin
    if (existing.role === 'admin' && role && role !== 'admin') {
        const adminCount = await req.prisma.user.count({
            where: { role: 'admin', isActive: true },
        });
        if (adminCount <= 1) {
            throw new BusinessLogicError('Cannot change role of the last admin user', 'last_admin_protection');
        }
    }

    // Check email uniqueness if changing
    if (email && email !== existing.email) {
        const emailExists = await req.prisma.user.findUnique({ where: { email } });
        if (emailExists) {
            throw new ConflictError('Email already in use', 'duplicate_email');
        }
    }

    // Build update data
    const updateData: {
        email?: string;
        name?: string;
        role?: string;
        isActive?: boolean;
        password?: string;
    } = {};
    if (email) updateData.email = email;
    if (name) updateData.name = name;
    if (role) updateData.role = role;
    if (typeof isActive === 'boolean') updateData.isActive = isActive;
    if (password) {
        const passwordValidation = validatePassword(password) as PasswordValidationResult;
        if (!passwordValidation.isValid) {
            throw new ValidationError(passwordValidation.errors[0]);
        }
        updateData.password = await bcrypt.hash(password, 10);
    }

    const user = await req.prisma.user.update({
        where: { id },
        data: updateData,
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            roleId: true,
            isActive: true,
            createdAt: true,
            userRole: {
                select: {
                    id: true,
                    name: true,
                    displayName: true,
                }
            },
        },
    });

    // Transform to include roleName for frontend
    res.json({
        ...user,
        roleName: user.userRole?.displayName || user.role,
    });
}));

/**
 * Delete user (protects last admin and prevents self-deletion)
 * @route DELETE /api/admin/users/:id
 * @description Cannot delete last admin or self.
 */
router.delete('/users/:id', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const user = await req.prisma.user.findUnique({
        where: { id },
    });

    if (!user) {
        throw new NotFoundError('User not found', 'User', id);
    }

    // Prevent deleting the last admin
    if (user.role === 'admin') {
        const adminCount = await req.prisma.user.count({
            where: { role: 'admin' },
        });
        if (adminCount <= 1) {
            throw new BusinessLogicError('Cannot delete the last admin user', 'last_admin_protection');
        }
    }

    // Prevent self-deletion
    if (user.id === req.user?.id) {
        throw new BusinessLogicError('Cannot delete your own account', 'self_deletion_prevention');
    }

    await req.prisma.user.delete({
        where: { id },
    });

    res.json({ message: 'User deleted successfully' });
}));

export default router;
