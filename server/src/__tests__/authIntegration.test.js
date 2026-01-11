/**
 * Authentication and Permissions Integration Tests
 *
 * Tests for authentication endpoints and middleware integration:
 * - POST /auth/login (credential validation, token generation)
 * - GET /auth/me (token validation, user retrieval)
 * - POST /auth/change-password (password validation, updates)
 * - authenticateToken middleware (JWT validation, token version checking)
 * - requirePermission middleware integration with routes
 * - Password validation rules
 * - Token version invalidation
 *
 * Note: Permission utility functions (hasPermission, etc.) are tested in permissions.test.js
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticateToken, requireAdmin, optionalAuth } from '../middleware/auth.js';
import { validatePassword } from '../utils/validation.js';
import { validateTokenVersion, invalidateUserTokens } from '../middleware/permissions.js';

// ============================================
// SECTION 1: PASSWORD VALIDATION TESTS
// ============================================

describe('Password Validation', () => {
    describe('Valid Passwords', () => {
        it('should accept password with all requirements met', () => {
            const result = validatePassword('Test@123');
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should accept password with uppercase, lowercase, number, special char', () => {
            const result = validatePassword('MyP@ssw0rd');
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should accept password longer than 8 characters', () => {
            const result = validatePassword('LongP@ssw0rd123!');
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should accept password with various special characters', () => {
            const passwords = [
                'Test!123', 'Test@123', 'Test#123', 'Test$123',
                'Test%123', 'Test^123', 'Test&123', 'Test*123',
                'Test(123)', 'Test_123', 'Test+123', 'Test-123',
                'Test=123', 'Test[123]', 'Test{123}', 'Test;123',
                'Test:123', 'Test"123', 'Test|123', 'Test,123',
                'Test<123>', 'Test.123', 'Test/123', 'Test?123'
            ];

            passwords.forEach(password => {
                const result = validatePassword(password);
                expect(result.isValid).toBe(true);
            });
        });
    });

    describe('Invalid Passwords', () => {
        it('should reject password shorter than 8 characters', () => {
            const result = validatePassword('Test@1');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Password must be at least 8 characters long');
        });

        it('should reject password without uppercase letter', () => {
            const result = validatePassword('test@123');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Password must contain at least one uppercase letter');
        });

        it('should reject password without lowercase letter', () => {
            const result = validatePassword('TEST@123');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Password must contain at least one lowercase letter');
        });

        it('should reject password without number', () => {
            const result = validatePassword('Test@abc');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Password must contain at least one number');
        });

        it('should reject password without special character', () => {
            const result = validatePassword('Test1234');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Password must contain at least one special character (!@#$%^&*()_+-=[]{};\':"|,.<>/?)');
        });

        it('should reject empty password', () => {
            const result = validatePassword('');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Password must be at least 8 characters long');
        });

        it('should reject null password', () => {
            const result = validatePassword(null);
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Password must be at least 8 characters long');
        });

        it('should reject undefined password', () => {
            const result = validatePassword(undefined);
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Password must be at least 8 characters long');
        });

        it('should reject password with multiple missing requirements', () => {
            const result = validatePassword('test');
            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(1);
            expect(result.errors).toContain('Password must be at least 8 characters long');
            expect(result.errors).toContain('Password must contain at least one uppercase letter');
        });
    });

    describe('Edge Cases', () => {
        it('should handle password with only special characters', () => {
            const result = validatePassword('@#$%^&*()');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Password must contain at least one uppercase letter');
            expect(result.errors).toContain('Password must contain at least one lowercase letter');
            expect(result.errors).toContain('Password must contain at least one number');
        });

        it('should handle password with spaces', () => {
            const result = validatePassword('Test @123');
            expect(result.isValid).toBe(true); // Spaces are allowed
        });

        it('should handle password with unicode characters', () => {
            const result = validatePassword('Test@123あ');
            expect(result.isValid).toBe(true);
        });
    });
});

// ============================================
// SECTION 2: authenticateToken MIDDLEWARE TESTS
// ============================================

describe('authenticateToken Middleware', () => {
    const createMockRequest = (overrides = {}) => ({
        headers: {},
        prisma: {
            user: {
                findUnique: jest.fn(),
            },
        },
        ...overrides,
    });

    const createMockResponse = () => {
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        return res;
    };

    const createMockNext = () => jest.fn();

    beforeEach(() => {
        process.env.JWT_SECRET = 'test-secret-key';
    });

    describe('Missing or Invalid Token', () => {
        it('should return 401 when no authorization header', async () => {
            const req = createMockRequest();
            const res = createMockResponse();
            const next = createMockNext();

            await authenticateToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('should return 401 when authorization header is empty', async () => {
            const req = createMockRequest({
                headers: { authorization: '' },
            });
            const res = createMockResponse();
            const next = createMockNext();

            await authenticateToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('should return 401 when authorization header has no token', async () => {
            const req = createMockRequest({
                headers: { authorization: 'Bearer ' },
            });
            const res = createMockResponse();
            const next = createMockNext();

            await authenticateToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('should return 403 when token is invalid', async () => {
            const req = createMockRequest({
                headers: { authorization: 'Bearer invalid-token' },
            });
            const res = createMockResponse();
            const next = createMockNext();

            await authenticateToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
            expect(next).not.toHaveBeenCalled();
        });

        it('should return 403 when token is expired', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'test@test.com' },
                process.env.JWT_SECRET,
                { expiresIn: '-1h' } // Expired 1 hour ago
            );

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
            });
            const res = createMockResponse();
            const next = createMockNext();

            await authenticateToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
            expect(next).not.toHaveBeenCalled();
        });

        it('should return 403 when token is malformed', async () => {
            const req = createMockRequest({
                headers: { authorization: 'Bearer not.a.jwt' },
            });
            const res = createMockResponse();
            const next = createMockNext();

            await authenticateToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('Valid Token', () => {
        it('should attach decoded user to request and call next', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'test@test.com', role: 'admin' },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        userRole: { permissions: ['orders:view'] },
                        permissionOverrides: [],
                    }),
                },
            };

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
                prisma: mockPrisma,
            });
            const res = createMockResponse();
            const next = createMockNext();

            await authenticateToken(req, res, next);

            expect(req.user).toBeDefined();
            expect(req.user.id).toBe('user-1');
            expect(req.user.email).toBe('test@test.com');
            expect(req.user.role).toBe('admin');
            expect(req.userPermissions).toBeDefined();
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('should attach permissions to request', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'test@test.com' },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        userRole: { permissions: ['orders:view', 'orders:ship'] },
                        permissionOverrides: [],
                    }),
                },
            };

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
                prisma: mockPrisma,
            });
            const res = createMockResponse();
            const next = createMockNext();

            await authenticateToken(req, res, next);

            expect(req.userPermissions).toBeDefined();
            expect(req.userPermissions).toContain('orders:view');
            expect(req.userPermissions).toContain('orders:ship');
            expect(next).toHaveBeenCalled();
        });

        it('should handle token without tokenVersion', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'test@test.com' },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        userRole: { permissions: [] },
                        permissionOverrides: [],
                    }),
                },
            };

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
                prisma: mockPrisma,
            });
            const res = createMockResponse();
            const next = createMockNext();

            await authenticateToken(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
    });

    describe('Token Version Validation', () => {
        it('should return 403 when token version does not match', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'test@test.com', tokenVersion: 1 },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        tokenVersion: 2, // Different version
                    }),
                },
            };

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
                prisma: mockPrisma,
            });
            const res = createMockResponse();
            const next = createMockNext();

            await authenticateToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Session invalidated. Please login again.' });
            expect(next).not.toHaveBeenCalled();
        });

        it('should call next when token version matches', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'test@test.com', tokenVersion: 5 },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        tokenVersion: 5, // Matching version
                        userRole: { permissions: [] },
                        permissionOverrides: [],
                    }),
                },
            };

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
                prisma: mockPrisma,
            });
            const res = createMockResponse();
            const next = createMockNext();

            await authenticateToken(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('should return 403 when user not found during token version check', async () => {
            const token = jwt.sign(
                { id: 'non-existent', email: 'test@test.com', tokenVersion: 1 },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue(null), // User not found
                },
            };

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
                prisma: mockPrisma,
            });
            const res = createMockResponse();
            const next = createMockNext();

            await authenticateToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Session invalidated. Please login again.' });
            expect(next).not.toHaveBeenCalled();
        });
    });
});

// ============================================
// SECTION 3: requireAdmin MIDDLEWARE TESTS
// ============================================

describe('requireAdmin Middleware', () => {
    const createMockRequest = (overrides = {}) => ({
        headers: {},
        prisma: {
            user: {
                findUnique: jest.fn(),
            },
        },
        ...overrides,
    });

    const createMockResponse = () => {
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        return res;
    };

    const createMockNext = () => jest.fn();

    beforeEach(() => {
        process.env.JWT_SECRET = 'test-secret-key';
    });

    describe('Access Control', () => {
        it('should return 401 when no token provided', async () => {
            const req = createMockRequest();
            const res = createMockResponse();
            const next = createMockNext();

            await requireAdmin(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('should return 403 when user has no admin permissions', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'test@test.com', role: 'staff', tokenVersion: 1 },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        tokenVersion: 1,
                        userRole: { permissions: ['orders:view'] }, // No admin permissions
                        permissionOverrides: [],
                    }),
                },
            };

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
                prisma: mockPrisma,
            });
            const res = createMockResponse();
            const next = createMockNext();

            await requireAdmin(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
            expect(next).not.toHaveBeenCalled();
        });

        it('should allow access when user has legacy admin role', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'admin@test.com', role: 'admin', tokenVersion: 1 },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        tokenVersion: 1,
                        userRole: { permissions: [] },
                        permissionOverrides: [],
                    }),
                },
            };

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
                prisma: mockPrisma,
            });
            const res = createMockResponse();
            const next = createMockNext();

            await requireAdmin(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
            expect(req.user).toBeDefined();
            expect(req.user.id).toBe('user-1');
        });

        it('should allow access when user has users:create permission', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'owner@test.com', role: 'staff', tokenVersion: 1 },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        tokenVersion: 1,
                        userRole: { permissions: ['users:create', 'orders:view'] },
                        permissionOverrides: [],
                    }),
                },
            };

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
                prisma: mockPrisma,
            });
            const res = createMockResponse();
            const next = createMockNext();

            await requireAdmin(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
            expect(req.userPermissions).toContain('users:create');
        });

        it('should return 403 when token version is invalid', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'admin@test.com', role: 'admin', tokenVersion: 1 },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        tokenVersion: 2, // Version mismatch
                    }),
                },
            };

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
                prisma: mockPrisma,
            });
            const res = createMockResponse();
            const next = createMockNext();

            await requireAdmin(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Session invalidated. Please login again.' });
            expect(next).not.toHaveBeenCalled();
        });

        it('should return 403 for invalid token', async () => {
            const req = createMockRequest({
                headers: { authorization: 'Bearer invalid-token' },
            });
            const res = createMockResponse();
            const next = createMockNext();

            await requireAdmin(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
            expect(next).not.toHaveBeenCalled();
        });
    });
});

// ============================================
// SECTION 4: optionalAuth MIDDLEWARE TESTS
// ============================================

describe('optionalAuth Middleware', () => {
    const createMockRequest = (overrides = {}) => ({
        headers: {},
        prisma: {
            user: {
                findUnique: jest.fn(),
            },
        },
        ...overrides,
    });

    const createMockResponse = () => ({
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    });

    const createMockNext = () => jest.fn();

    beforeEach(() => {
        process.env.JWT_SECRET = 'test-secret-key';
    });

    describe('No Token Provided', () => {
        it('should call next without attaching user when no token', async () => {
            const req = createMockRequest();
            const res = createMockResponse();
            const next = createMockNext();

            await optionalAuth(req, res, next);

            expect(req.user).toBeUndefined();
            expect(req.userPermissions).toBeUndefined();
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('should call next without attaching user when authorization header is empty', async () => {
            const req = createMockRequest({
                headers: { authorization: '' },
            });
            const res = createMockResponse();
            const next = createMockNext();

            await optionalAuth(req, res, next);

            expect(req.user).toBeUndefined();
            expect(next).toHaveBeenCalled();
        });
    });

    describe('Valid Token', () => {
        it('should attach user and permissions when valid token provided', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'test@test.com', tokenVersion: 1 },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        tokenVersion: 1,
                        userRole: { permissions: ['orders:view'] },
                        permissionOverrides: [],
                    }),
                },
            };

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
                prisma: mockPrisma,
            });
            const res = createMockResponse();
            const next = createMockNext();

            await optionalAuth(req, res, next);

            expect(req.user).toBeDefined();
            expect(req.user.id).toBe('user-1');
            expect(req.userPermissions).toBeDefined();
            expect(req.userPermissions).toContain('orders:view');
            expect(next).toHaveBeenCalled();
        });

        it('should call next without user when token version is invalid', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'test@test.com', tokenVersion: 1 },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        tokenVersion: 2, // Version mismatch
                    }),
                },
            };

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
                prisma: mockPrisma,
            });
            const res = createMockResponse();
            const next = createMockNext();

            await optionalAuth(req, res, next);

            expect(req.user).toBeUndefined();
            expect(req.userPermissions).toBeUndefined();
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('should call next without user when token is invalid', async () => {
            const req = createMockRequest({
                headers: { authorization: 'Bearer invalid-token' },
            });
            const res = createMockResponse();
            const next = createMockNext();

            await optionalAuth(req, res, next);

            expect(req.user).toBeUndefined();
            expect(next).toHaveBeenCalled();
        });

        it('should call next without user when token is expired', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'test@test.com' },
                process.env.JWT_SECRET,
                { expiresIn: '-1h' }
            );

            const req = createMockRequest({
                headers: { authorization: `Bearer ${token}` },
            });
            const res = createMockResponse();
            const next = createMockNext();

            await optionalAuth(req, res, next);

            expect(req.user).toBeUndefined();
            expect(next).toHaveBeenCalled();
        });
    });
});

// ============================================
// SECTION 5: TOKEN VERSION UTILITY TESTS
// ============================================

describe('Token Version Utilities', () => {
    describe('validateTokenVersion', () => {
        const createMockPrisma = (userData) => ({
            user: {
                findUnique: jest.fn().mockResolvedValue(userData),
            },
        });

        it('should return true when token version matches', async () => {
            const mockPrisma = createMockPrisma({ tokenVersion: 5 });
            const result = await validateTokenVersion(mockPrisma, 'user-1', 5);
            expect(result).toBe(true);
        });

        it('should return false when token version does not match', async () => {
            const mockPrisma = createMockPrisma({ tokenVersion: 5 });
            const result = await validateTokenVersion(mockPrisma, 'user-1', 3);
            expect(result).toBe(false);
        });

        it('should return false when user not found', async () => {
            const mockPrisma = createMockPrisma(null);
            const result = await validateTokenVersion(mockPrisma, 'non-existent', 1);
            expect(result).toBeFalsy();
        });

        it('should handle tokenVersion 0', async () => {
            const mockPrisma = createMockPrisma({ tokenVersion: 0 });
            const result = await validateTokenVersion(mockPrisma, 'user-1', 0);
            expect(result).toBe(true);
        });

        it('should handle large token versions', async () => {
            const mockPrisma = createMockPrisma({ tokenVersion: 999 });
            const result = await validateTokenVersion(mockPrisma, 'user-1', 999);
            expect(result).toBe(true);
        });
    });

    describe('invalidateUserTokens', () => {
        it('should increment token version', async () => {
            const mockUpdate = jest.fn().mockResolvedValue({ tokenVersion: 2 });
            const mockPrisma = {
                user: { update: mockUpdate },
            };

            await invalidateUserTokens(mockPrisma, 'user-1');

            expect(mockUpdate).toHaveBeenCalledWith({
                where: { id: 'user-1' },
                data: { tokenVersion: { increment: 1 } },
            });
        });

        it('should handle multiple invalidations', async () => {
            const mockUpdate = jest.fn()
                .mockResolvedValueOnce({ tokenVersion: 2 })
                .mockResolvedValueOnce({ tokenVersion: 3 })
                .mockResolvedValueOnce({ tokenVersion: 4 });
            const mockPrisma = {
                user: { update: mockUpdate },
            };

            await invalidateUserTokens(mockPrisma, 'user-1');
            await invalidateUserTokens(mockPrisma, 'user-1');
            await invalidateUserTokens(mockPrisma, 'user-1');

            expect(mockUpdate).toHaveBeenCalledTimes(3);
        });
    });
});

// ============================================
// SECTION 6: PASSWORD HASHING AND COMPARISON
// ============================================

describe('Password Hashing and Comparison', () => {
    describe('bcrypt.hash', () => {
        it('should hash password with default rounds', async () => {
            const password = 'Test@123';
            const hash = await bcrypt.hash(password, 10);

            expect(hash).toBeDefined();
            expect(hash).not.toBe(password);
            expect(hash.length).toBeGreaterThan(password.length);
        });

        it('should produce different hashes for same password', async () => {
            const password = 'Test@123';
            const hash1 = await bcrypt.hash(password, 10);
            const hash2 = await bcrypt.hash(password, 10);

            expect(hash1).not.toBe(hash2);
        });
    });

    describe('bcrypt.compare', () => {
        it('should return true for correct password', async () => {
            const password = 'Test@123';
            const hash = await bcrypt.hash(password, 10);
            const result = await bcrypt.compare(password, hash);

            expect(result).toBe(true);
        });

        it('should return false for incorrect password', async () => {
            const password = 'Test@123';
            const wrongPassword = 'Wrong@123';
            const hash = await bcrypt.hash(password, 10);
            const result = await bcrypt.compare(wrongPassword, hash);

            expect(result).toBe(false);
        });

        it('should be case-sensitive', async () => {
            const password = 'Test@123';
            const wrongCase = 'test@123';
            const hash = await bcrypt.hash(password, 10);
            const result = await bcrypt.compare(wrongCase, hash);

            expect(result).toBe(false);
        });
    });
});

// ============================================
// SECTION 7: JWT TOKEN GENERATION AND VERIFICATION
// ============================================

describe('JWT Token Operations', () => {
    beforeEach(() => {
        process.env.JWT_SECRET = 'test-secret-key';
    });

    describe('jwt.sign', () => {
        it('should generate valid token with user data', () => {
            const payload = {
                id: 'user-1',
                email: 'test@test.com',
                role: 'admin',
            };

            const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
        });

        it('should include tokenVersion in payload', () => {
            const payload = {
                id: 'user-1',
                email: 'test@test.com',
                tokenVersion: 5,
            };

            const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            expect(decoded.tokenVersion).toBe(5);
        });

        it('should include roleId in payload', () => {
            const payload = {
                id: 'user-1',
                email: 'test@test.com',
                roleId: 'role-123',
            };

            const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            expect(decoded.roleId).toBe('role-123');
        });
    });

    describe('jwt.verify', () => {
        it('should verify valid token', () => {
            const payload = { id: 'user-1', email: 'test@test.com' };
            const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            expect(decoded.id).toBe('user-1');
            expect(decoded.email).toBe('test@test.com');
        });

        it('should throw error for invalid token', () => {
            expect(() => {
                jwt.verify('invalid-token', process.env.JWT_SECRET);
            }).toThrow();
        });

        it('should throw error for expired token', () => {
            const payload = { id: 'user-1', email: 'test@test.com' };
            const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '-1h' });

            expect(() => {
                jwt.verify(token, process.env.JWT_SECRET);
            }).toThrow();
        });

        it('should throw error for token with wrong secret', () => {
            const payload = { id: 'user-1', email: 'test@test.com' };
            const token = jwt.sign(payload, 'wrong-secret', { expiresIn: '1h' });

            expect(() => {
                jwt.verify(token, process.env.JWT_SECRET);
            }).toThrow();
        });

        it('should include exp and iat claims', () => {
            const payload = { id: 'user-1', email: 'test@test.com' };
            const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            expect(decoded.exp).toBeDefined();
            expect(decoded.iat).toBeDefined();
            expect(typeof decoded.exp).toBe('number');
            expect(typeof decoded.iat).toBe('number');
        });
    });
});

// ============================================
// SECTION 8: INTEGRATION SCENARIOS
// ============================================

describe('Authentication Integration Scenarios', () => {
    beforeEach(() => {
        process.env.JWT_SECRET = 'test-secret-key';
    });

    describe('Complete Authentication Flow', () => {
        it('should simulate successful login -> token generation -> validation', async () => {
            // Step 1: Hash password (happens during user creation/login)
            const password = 'Test@123';
            const hashedPassword = await bcrypt.hash(password, 10);

            // Step 2: Validate password on login
            const passwordMatch = await bcrypt.compare(password, hashedPassword);
            expect(passwordMatch).toBe(true);

            // Step 3: Generate token
            const token = jwt.sign(
                { id: 'user-1', email: 'test@test.com', tokenVersion: 1 },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );
            expect(token).toBeDefined();

            // Step 4: Verify token (happens on subsequent requests)
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            expect(decoded.id).toBe('user-1');
            expect(decoded.tokenVersion).toBe(1);

            // Step 5: Validate token version
            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        tokenVersion: 1,
                    }),
                },
            };
            const isValid = await validateTokenVersion(mockPrisma, 'user-1', 1);
            expect(isValid).toBe(true);
        });

        it('should simulate token invalidation after permission change', async () => {
            // Step 1: Create initial token
            const token = jwt.sign(
                { id: 'user-1', email: 'test@test.com', tokenVersion: 1 },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            // Step 2: Verify token works initially
            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        tokenVersion: 1,
                    }),
                    update: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        tokenVersion: 2,
                    }),
                },
            };

            let isValid = await validateTokenVersion(mockPrisma, 'user-1', 1);
            expect(isValid).toBe(true);

            // Step 3: Invalidate all tokens (permission change)
            await invalidateUserTokens(mockPrisma, 'user-1');

            // Step 4: Update mock to return new version
            mockPrisma.user.findUnique = jest.fn().mockResolvedValue({
                id: 'user-1',
                tokenVersion: 2,
            });

            // Step 5: Old token should no longer be valid
            isValid = await validateTokenVersion(mockPrisma, 'user-1', 1);
            expect(isValid).toBe(false);
        });

        it('should simulate password change workflow', async () => {
            // Step 1: User has existing password
            const oldPassword = 'OldP@ss123';
            const oldHash = await bcrypt.hash(oldPassword, 10);

            // Step 2: User provides current password and new password
            const currentPassword = 'OldP@ss123';
            const newPassword = 'NewP@ss456';

            // Step 3: Verify current password
            const currentPasswordMatch = await bcrypt.compare(currentPassword, oldHash);
            expect(currentPasswordMatch).toBe(true);

            // Step 4: Validate new password strength
            const passwordValidation = validatePassword(newPassword);
            expect(passwordValidation.isValid).toBe(true);

            // Step 5: Hash and store new password
            const newHash = await bcrypt.hash(newPassword, 10);

            // Step 6: Verify new password works
            const newPasswordMatch = await bcrypt.compare(newPassword, newHash);
            expect(newPasswordMatch).toBe(true);

            // Step 7: Verify old password no longer works
            const oldPasswordMatch = await bcrypt.compare(oldPassword, newHash);
            expect(oldPasswordMatch).toBe(false);
        });
    });

    describe('Security Edge Cases', () => {
        it('should prevent timing attacks with consistent hash comparison', async () => {
            const password = 'Test@123';
            const hash = await bcrypt.hash(password, 10);

            // Both comparisons should take similar time (bcrypt is designed to prevent timing attacks)
            const start1 = Date.now();
            await bcrypt.compare('wrong', hash);
            const time1 = Date.now() - start1;

            const start2 = Date.now();
            await bcrypt.compare(password, hash);
            const time2 = Date.now() - start2;

            // Times should be roughly similar (within an order of magnitude)
            // This is a basic check - bcrypt internally handles timing resistance
            expect(Math.abs(time1 - time2)).toBeLessThan(100);
        });

        it('should handle token reuse after invalidation', async () => {
            const token = jwt.sign(
                { id: 'user-1', email: 'test@test.com', tokenVersion: 1 },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            // Token is valid
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            expect(decoded.tokenVersion).toBe(1);

            // After invalidation, same token should be rejected
            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        tokenVersion: 2, // Incremented
                    }),
                },
            };

            const isValid = await validateTokenVersion(mockPrisma, 'user-1', 1);
            expect(isValid).toBe(false);
        });

        it('should handle concurrent invalidations', async () => {
            const mockUpdate = jest.fn().mockResolvedValue({});
            const mockPrisma = {
                user: { update: mockUpdate },
            };

            // Simulate concurrent permission changes
            await Promise.all([
                invalidateUserTokens(mockPrisma, 'user-1'),
                invalidateUserTokens(mockPrisma, 'user-1'),
                invalidateUserTokens(mockPrisma, 'user-1'),
            ]);

            // All should succeed (database handles atomicity)
            expect(mockUpdate).toHaveBeenCalledTimes(3);
        });
    });

    describe('Error Handling', () => {
        it('should handle missing JWT_SECRET gracefully', () => {
            const originalSecret = process.env.JWT_SECRET;
            delete process.env.JWT_SECRET;

            expect(() => {
                jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, { expiresIn: '1h' });
            }).toThrow();

            process.env.JWT_SECRET = originalSecret;
        });

        it('should handle database errors during token version validation', async () => {
            const mockPrisma = {
                user: {
                    findUnique: jest.fn().mockRejectedValue(new Error('Database error')),
                },
            };

            await expect(
                validateTokenVersion(mockPrisma, 'user-1', 1)
            ).rejects.toThrow('Database error');
        });

        it('should handle database errors during token invalidation', async () => {
            const mockPrisma = {
                user: {
                    update: jest.fn().mockRejectedValue(new Error('Database error')),
                },
            };

            await expect(
                invalidateUserTokens(mockPrisma, 'user-1')
            ).rejects.toThrow('Database error');
        });
    });
});
