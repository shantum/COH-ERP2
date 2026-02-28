import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
// Auth handled by admin router-level guard in admin/index.ts
import { asyncHandler } from '../../middleware/asyncHandler.js';
import bcrypt from 'bcryptjs';
import { validatePassword } from '@coh/shared';
import { ValidationError, NotFoundError, ConflictError, BusinessLogicError } from '../../utils/errors.js';
import { sendInternalEmail, renderWelcomeUser, renderNewUserAdminNotice } from '../../services/email/index.js';
import { hasAdminAccessFromDb, countAdminUsers } from '@coh/shared/services/auth';
import type { CreateUserBody, UpdateUserBody, PasswordValidationResult } from './types.js';

/** Generate a strong random password: 12 chars, mixed case + digits + special */
function generatePassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const special = '!@#$%&*';
    const all = upper + lower + digits + special;

    // Ensure at least one of each category
    let password = '';
    password += upper[crypto.randomInt(upper.length)];
    password += lower[crypto.randomInt(lower.length)];
    password += digits[crypto.randomInt(digits.length)];
    password += special[crypto.randomInt(special.length)];

    // Fill remaining with random chars
    for (let i = 4; i < 12; i++) {
        password += all[crypto.randomInt(all.length)];
    }

    // Shuffle
    return password.split('').sort(() => crypto.randomInt(3) - 1).join('');
}

const router = Router();

/**
 * List all users with their roles
 * @route GET /api/admin/users
 * @returns {Object[]} users - [{ id, email, name, role, roleId, isActive, createdAt, roleName }]
 */
router.get('/users', asyncHandler(async (req: Request, res: Response) => {
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
router.get('/users/:id', asyncHandler(async (req: Request, res: Response) => {
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
router.post('/users', asyncHandler(async (req: Request, res: Response) => {
    const { email, name, phone, role = 'staff', roleId } = req.body as CreateUserBody;

    // Validate input
    if (!email || !name || !phone) {
        throw new ValidationError('Email, name, and phone are required');
    }

    // Validate phone (10-digit Indian number)
    const cleanPhone = phone.replace(/\D/g, '').replace(/^91/, '');
    if (cleanPhone.length !== 10) {
        throw new ValidationError('Phone must be a 10-digit number');
    }
    const normalizedPhone = `91${cleanPhone}`;

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
    const existingEmail = await req.prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
        throw new ConflictError('Email already in use', 'duplicate_email');
    }

    // Check if phone already exists
    const existingPhone = await req.prisma.user.findUnique({ where: { phone: normalizedPhone } });
    if (existingPhone) {
        throw new ConflictError('Phone number already in use', 'duplicate_phone');
    }

    // Auto-generate password
    const plainPassword = generatePassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    // Create user
    const user = await req.prisma.user.create({
        data: {
            email,
            password: hashedPassword,
            name,
            phone: normalizedPhone,
            role,
            roleId: roleId || null,
            mustChangePassword: false,
        },
        select: {
            id: true,
            email: true,
            name: true,
            phone: true,
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

    // Send welcome emails (async, don't block response)
    const loginUrl = process.env.NODE_ENV === 'production'
        ? 'https://erp.creaturesofhabit.in'
        : 'http://localhost:5173';

    const emailData = {
        name,
        email,
        phone: `+91 ${cleanPhone}`,
        password: plainPassword,
        loginUrl,
    };

    // Email to new user
    sendInternalEmail({
        to: email,
        subject: 'Welcome to COH ERP — Your Login Details',
        html: renderWelcomeUser(emailData),
        templateKey: 'welcome_user',
        entityType: 'User',
        entityId: user.id,
    }).catch(() => { /* logged internally */ });

    // Email to admin (Shantum)
    sendInternalEmail({
        to: 'shantum@creaturesofhabit.in',
        subject: `New ERP User: ${name}`,
        html: renderNewUserAdminNotice(emailData),
        templateKey: 'new_user_admin_notice',
        entityType: 'User',
        entityId: user.id,
    }).catch(() => { /* logged internally */ });

    // Transform to include roleName for frontend
    res.status(201).json({
        ...user,
        roleName: user.userRole?.displayName || user.role,
        generatedPassword: plainPassword,
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
router.put('/users/:id', asyncHandler(async (req: Request, res: Response) => {
    const { email, name, role, isActive, password } = req.body as UpdateUserBody;
    const id = req.params.id as string;

    // Get existing user
    const existing = await req.prisma.user.findUnique({
        where: { id },
    });

    if (!existing) {
        throw new NotFoundError('User not found', 'User', id);
    }

    // Prevent disabling or demoting the last admin-equivalent user
    const isExistingAdmin = await hasAdminAccessFromDb(req.prisma, existing.id, existing.role);

    if (isExistingAdmin && (isActive === false || (role && role !== 'admin' && role !== 'owner'))) {
        const adminCount = await countAdminUsers(req.prisma);
        if (adminCount <= 1) {
            throw new BusinessLogicError(
                isActive === false ? 'Cannot disable the last admin user' : 'Cannot change role of the last admin user',
                'last_admin_protection'
            );
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
router.delete('/users/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const user = await req.prisma.user.findUnique({
        where: { id },
    });

    if (!user) {
        throw new NotFoundError('User not found', 'User', id);
    }

    // Prevent deleting the last admin-equivalent user
    const userIsAdmin = await hasAdminAccessFromDb(req.prisma, user.id, user.role);
    if (userIsAdmin) {
        const adminCount = await countAdminUsers(req.prisma, false);
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
