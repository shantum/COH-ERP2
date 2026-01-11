/**
 * Permissions System Tests
 *
 * Tests for Phase 6 of the permissions system:
 * - Permission utility functions (hasPermission, hasAnyPermission, hasAllPermissions)
 * - Confidential field filtering
 * - Permission override logic
 * - Role-based permission configurations
 * - Middleware functions
 */

import { jest, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';

import {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    filterConfidentialFields,
    getUserPermissions,
    requirePermission,
    requireAnyPermission,
    attachPermissions,
    validateTokenVersion,
    invalidateUserTokens,
    logAuditEvent,
} from '../middleware/permissions.js';

import {
    ALL_PERMISSIONS,
    VIEW_PERMISSIONS,
    EDIT_PERMISSIONS,
    PERMISSION_CATEGORIES,
    DEFAULT_ROLES,
} from '../utils/permissions.js';

// ============================================
// SECTION 1: hasPermission() TESTS
// ============================================

describe('hasPermission - Single Permission Checks', () => {
    it('should return true for direct permission match', () => {
        const userPermissions = ['orders:view', 'products:view'];
        expect(hasPermission(userPermissions, 'orders:view')).toBe(true);
    });

    it('should return false when permission not present', () => {
        const userPermissions = ['orders:view', 'products:view'];
        expect(hasPermission(userPermissions, 'orders:ship')).toBe(false);
    });

    it('should return false for empty permissions array', () => {
        expect(hasPermission([], 'orders:view')).toBe(false);
    });

    it('should return false for null permissions', () => {
        expect(hasPermission(null, 'orders:view')).toBe(false);
    });

    it('should return false for undefined permissions', () => {
        expect(hasPermission(undefined, 'orders:view')).toBe(false);
    });

    it('should return false for non-array permissions', () => {
        expect(hasPermission('orders:view', 'orders:view')).toBe(false);
        expect(hasPermission({}, 'orders:view')).toBe(false);
    });
});

describe('hasPermission - Domain Wildcard Support', () => {
    it('should match domain:* wildcard for domain:action permission', () => {
        const userPermissions = ['products:*'];
        expect(hasPermission(userPermissions, 'products:view')).toBe(true);
        expect(hasPermission(userPermissions, 'products:edit')).toBe(true);
        expect(hasPermission(userPermissions, 'products:delete')).toBe(true);
        expect(hasPermission(userPermissions, 'products:create')).toBe(true);
    });

    it('should not match wildcard across domains', () => {
        const userPermissions = ['products:*'];
        expect(hasPermission(userPermissions, 'orders:view')).toBe(false);
        expect(hasPermission(userPermissions, 'fabrics:edit')).toBe(false);
    });

    it('should handle multiple wildcards', () => {
        const userPermissions = ['products:*', 'orders:*'];
        expect(hasPermission(userPermissions, 'products:view')).toBe(true);
        expect(hasPermission(userPermissions, 'orders:ship')).toBe(true);
        expect(hasPermission(userPermissions, 'fabrics:view')).toBe(false);
    });

    it('should match nested permissions with wildcard', () => {
        const userPermissions = ['products:*'];
        expect(hasPermission(userPermissions, 'products:view:cost')).toBe(true);
        expect(hasPermission(userPermissions, 'products:edit:consumption')).toBe(true);
    });
});

describe('hasPermission - Global Admin Wildcard', () => {
    it('should grant all permissions with global * wildcard', () => {
        const userPermissions = ['*'];
        expect(hasPermission(userPermissions, 'orders:view')).toBe(true);
        expect(hasPermission(userPermissions, 'products:delete')).toBe(true);
        expect(hasPermission(userPermissions, 'users:create')).toBe(true);
        expect(hasPermission(userPermissions, 'settings:edit')).toBe(true);
    });

    it('should work alongside other permissions', () => {
        const userPermissions = ['*', 'orders:view'];
        expect(hasPermission(userPermissions, 'fabrics:edit')).toBe(true);
    });
});

describe('hasPermission - Edge Cases', () => {
    it('should handle permission with colons correctly', () => {
        const userPermissions = ['products:view:cost'];
        expect(hasPermission(userPermissions, 'products:view:cost')).toBe(true);
        expect(hasPermission(userPermissions, 'products:view')).toBe(false);
    });

    it('should be case-sensitive', () => {
        const userPermissions = ['orders:view'];
        expect(hasPermission(userPermissions, 'Orders:View')).toBe(false);
        expect(hasPermission(userPermissions, 'ORDERS:VIEW')).toBe(false);
    });

    it('should handle empty string permission', () => {
        const userPermissions = ['orders:view'];
        expect(hasPermission(userPermissions, '')).toBe(false);
    });
});

// ============================================
// SECTION 2: hasAnyPermission() TESTS
// ============================================

describe('hasAnyPermission - OR Logic', () => {
    it('should return true when user has first permission', () => {
        const userPermissions = ['orders:view'];
        expect(hasAnyPermission(userPermissions, 'orders:view', 'orders:ship')).toBe(true);
    });

    it('should return true when user has second permission', () => {
        const userPermissions = ['orders:ship'];
        expect(hasAnyPermission(userPermissions, 'orders:view', 'orders:ship')).toBe(true);
    });

    it('should return true when user has any of multiple permissions', () => {
        const userPermissions = ['products:edit'];
        expect(hasAnyPermission(userPermissions, 'orders:view', 'products:edit', 'fabrics:create')).toBe(true);
    });

    it('should return true when user has all permissions', () => {
        const userPermissions = ['orders:view', 'orders:ship', 'products:edit'];
        expect(hasAnyPermission(userPermissions, 'orders:view', 'orders:ship')).toBe(true);
    });

    it('should return false when user has none of the permissions', () => {
        const userPermissions = ['fabrics:view'];
        expect(hasAnyPermission(userPermissions, 'orders:view', 'orders:ship')).toBe(false);
    });

    it('should return false for empty user permissions', () => {
        expect(hasAnyPermission([], 'orders:view', 'orders:ship')).toBe(false);
    });

    it('should work with wildcards', () => {
        const userPermissions = ['orders:*'];
        expect(hasAnyPermission(userPermissions, 'orders:view', 'products:view')).toBe(true);
    });

    it('should handle single permission check', () => {
        const userPermissions = ['orders:view'];
        expect(hasAnyPermission(userPermissions, 'orders:view')).toBe(true);
        expect(hasAnyPermission(userPermissions, 'orders:ship')).toBe(false);
    });
});

// ============================================
// SECTION 3: hasAllPermissions() TESTS
// ============================================

describe('hasAllPermissions - AND Logic', () => {
    it('should return true when user has all required permissions', () => {
        const userPermissions = ['orders:view', 'orders:ship', 'products:view'];
        expect(hasAllPermissions(userPermissions, 'orders:view', 'orders:ship')).toBe(true);
    });

    it('should return false when user is missing one permission', () => {
        const userPermissions = ['orders:view', 'products:view'];
        expect(hasAllPermissions(userPermissions, 'orders:view', 'orders:ship')).toBe(false);
    });

    it('should return false when user is missing all permissions', () => {
        const userPermissions = ['fabrics:view'];
        expect(hasAllPermissions(userPermissions, 'orders:view', 'orders:ship')).toBe(false);
    });

    it('should return false for empty user permissions', () => {
        expect(hasAllPermissions([], 'orders:view', 'orders:ship')).toBe(false);
    });

    it('should work with wildcards', () => {
        const userPermissions = ['orders:*', 'products:*'];
        expect(hasAllPermissions(userPermissions, 'orders:view', 'orders:ship', 'products:edit')).toBe(true);
    });

    it('should fail if wildcard does not cover all domains', () => {
        const userPermissions = ['orders:*'];
        expect(hasAllPermissions(userPermissions, 'orders:view', 'products:view')).toBe(false);
    });

    it('should handle single permission check', () => {
        const userPermissions = ['orders:view'];
        expect(hasAllPermissions(userPermissions, 'orders:view')).toBe(true);
        expect(hasAllPermissions(userPermissions, 'orders:ship')).toBe(false);
    });

    it('should work with global wildcard', () => {
        const userPermissions = ['*'];
        expect(hasAllPermissions(userPermissions, 'orders:view', 'products:delete', 'users:create')).toBe(true);
    });
});

// ============================================
// SECTION 4: filterConfidentialFields() TESTS
// ============================================

describe('filterConfidentialFields - Cost Fields', () => {
    const sampleProduct = {
        id: 'prod-1',
        name: 'Test Product',
        fabricCost: 150.00,
        laborCost: 50.00,
        trimsCost: 25.00,
        liningCost: 30.00,
        packagingCost: 10.00,
        totalCost: 265.00,
        totalCogs: 265.00,
        costMultiple: 3.5,
    };

    it('should preserve cost fields when user has products:view:cost', () => {
        const userPermissions = ['products:view', 'products:view:cost'];
        const result = filterConfidentialFields(sampleProduct, userPermissions);

        expect(result.fabricCost).toBe(150.00);
        expect(result.laborCost).toBe(50.00);
        expect(result.trimsCost).toBe(25.00);
        expect(result.liningCost).toBe(30.00);
        expect(result.packagingCost).toBe(10.00);
        expect(result.totalCost).toBe(265.00);
        expect(result.totalCogs).toBe(265.00);
        expect(result.costMultiple).toBe(3.5);
        expect(result.name).toBe('Test Product');
    });

    it('should remove cost fields when user lacks products:view:cost', () => {
        const userPermissions = ['products:view'];
        const result = filterConfidentialFields(sampleProduct, userPermissions);

        expect(result.fabricCost).toBeUndefined();
        expect(result.laborCost).toBeUndefined();
        expect(result.trimsCost).toBeUndefined();
        expect(result.liningCost).toBeUndefined();
        expect(result.packagingCost).toBeUndefined();
        expect(result.totalCost).toBeUndefined();
        expect(result.totalCogs).toBeUndefined();
        expect(result.costMultiple).toBeUndefined();
        expect(result.name).toBe('Test Product');
    });

    it('should allow cost view with products:* wildcard', () => {
        const userPermissions = ['products:*'];
        const result = filterConfidentialFields(sampleProduct, userPermissions);

        expect(result.fabricCost).toBe(150.00);
        expect(result.totalCost).toBe(265.00);
    });

    it('should filter costPerUnit and laborRatePerMin', () => {
        const fabricData = {
            id: 'fabric-1',
            name: 'Cotton',
            costPerUnit: 120.00,
            laborRatePerMin: 0.50,
        };

        const userPermissions = ['fabrics:view'];
        const result = filterConfidentialFields(fabricData, userPermissions);

        expect(result.costPerUnit).toBeUndefined();
        expect(result.laborRatePerMin).toBeUndefined();
        expect(result.name).toBe('Cotton');
    });
});

describe('filterConfidentialFields - Consumption Fields', () => {
    const sampleSku = {
        id: 'sku-1',
        code: 'SKU-001',
        fabricConsumption: 2.5,
        size: 'M',
    };

    it('should preserve fabricConsumption when user has products:view:consumption', () => {
        const userPermissions = ['products:view', 'products:view:consumption'];
        const result = filterConfidentialFields(sampleSku, userPermissions);

        expect(result.fabricConsumption).toBe(2.5);
        expect(result.code).toBe('SKU-001');
    });

    it('should remove fabricConsumption when user lacks products:view:consumption', () => {
        const userPermissions = ['products:view'];
        const result = filterConfidentialFields(sampleSku, userPermissions);

        expect(result.fabricConsumption).toBeUndefined();
        expect(result.code).toBe('SKU-001');
    });

    it('should allow consumption view with products:* wildcard', () => {
        const userPermissions = ['products:*'];
        const result = filterConfidentialFields(sampleSku, userPermissions);

        expect(result.fabricConsumption).toBe(2.5);
    });
});

describe('filterConfidentialFields - Financial Order Data', () => {
    const sampleOrder = {
        id: 'order-1',
        orderNumber: 'ORD-001',
        customerName: 'John Doe',
        totalAmount: 5000.00,
        unitPrice: 2500.00,
        codRemittedAmount: 4500.00,
        status: 'shipped',
    };

    it('should preserve financial data when user has orders:view:financial', () => {
        const userPermissions = ['orders:view', 'orders:view:financial'];
        const result = filterConfidentialFields(sampleOrder, userPermissions);

        expect(result.totalAmount).toBe(5000.00);
        expect(result.unitPrice).toBe(2500.00);
        expect(result.codRemittedAmount).toBe(4500.00);
        expect(result.orderNumber).toBe('ORD-001');
    });

    it('should remove financial data when user lacks orders:view:financial', () => {
        const userPermissions = ['orders:view'];
        const result = filterConfidentialFields(sampleOrder, userPermissions);

        expect(result.totalAmount).toBeUndefined();
        expect(result.unitPrice).toBeUndefined();
        expect(result.codRemittedAmount).toBeUndefined();
        expect(result.orderNumber).toBe('ORD-001');
        expect(result.status).toBe('shipped');
    });

    it('should allow financial view with orders:* wildcard', () => {
        const userPermissions = ['orders:*'];
        const result = filterConfidentialFields(sampleOrder, userPermissions);

        expect(result.totalAmount).toBe(5000.00);
    });
});

describe('filterConfidentialFields - Customer Contact Info', () => {
    const sampleOrderWithContact = {
        id: 'order-1',
        orderNumber: 'ORD-001',
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
        customerPhone: '+91-9876543210',
        email: 'john@example.com',
        phone: '+91-9876543210',
        shippingAddress: '123 Main St, Mumbai, MH 400001',
    };

    it('should preserve contact info when user has customers:view:contact', () => {
        const userPermissions = ['orders:view', 'customers:view:contact'];
        const result = filterConfidentialFields(sampleOrderWithContact, userPermissions);

        expect(result.customerEmail).toBe('john@example.com');
        expect(result.customerPhone).toBe('+91-9876543210');
        expect(result.email).toBe('john@example.com');
        expect(result.phone).toBe('+91-9876543210');
        expect(result.shippingAddress).toBe('123 Main St, Mumbai, MH 400001');
    });

    it('should remove contact info when user lacks customers:view:contact', () => {
        const userPermissions = ['orders:view'];
        const result = filterConfidentialFields(sampleOrderWithContact, userPermissions);

        expect(result.customerEmail).toBeUndefined();
        expect(result.customerPhone).toBeUndefined();
        expect(result.email).toBeUndefined();
        expect(result.phone).toBeUndefined();
        expect(result.shippingAddress).toBe('[REDACTED]');
        expect(result.customerName).toBe('John Doe');
    });

    it('should allow contact view with customers:* wildcard', () => {
        const userPermissions = ['customers:*'];
        const result = filterConfidentialFields(sampleOrderWithContact, userPermissions);

        expect(result.customerEmail).toBe('john@example.com');
        expect(result.shippingAddress).toBe('123 Main St, Mumbai, MH 400001');
    });

    it('should handle undefined shippingAddress', () => {
        const orderWithoutAddress = {
            id: 'order-1',
            customerEmail: 'john@example.com',
        };

        const userPermissions = ['orders:view'];
        const result = filterConfidentialFields(orderWithoutAddress, userPermissions);

        expect(result.shippingAddress).toBeUndefined();
    });
});

describe('filterConfidentialFields - Arrays and Nested Objects', () => {
    it('should filter an array of objects', () => {
        const products = [
            { id: 'prod-1', name: 'Product 1', fabricCost: 100, totalCost: 200 },
            { id: 'prod-2', name: 'Product 2', fabricCost: 150, totalCost: 300 },
        ];

        const userPermissions = ['products:view'];
        const result = filterConfidentialFields(products, userPermissions);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(2);
        expect(result[0].name).toBe('Product 1');
        expect(result[0].fabricCost).toBeUndefined();
        expect(result[1].name).toBe('Product 2');
        expect(result[1].fabricCost).toBeUndefined();
    });

    it('should handle empty array', () => {
        const result = filterConfidentialFields([], ['orders:view']);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
    });

    it('should handle null input', () => {
        const result = filterConfidentialFields(null, ['orders:view']);
        expect(result).toBeNull();
    });

    it('should handle undefined input', () => {
        const result = filterConfidentialFields(undefined, ['orders:view']);
        expect(result).toBeUndefined();
    });
});

describe('filterConfidentialFields - Combined Permissions', () => {
    const complexData = {
        id: 'order-1',
        orderNumber: 'ORD-001',
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
        totalAmount: 5000.00,
        fabricCost: 150.00,
        fabricConsumption: 2.5,
    };

    it('should filter multiple field types when user has no special permissions', () => {
        const userPermissions = ['orders:view', 'products:view'];
        const result = filterConfidentialFields(complexData, userPermissions);

        expect(result.orderNumber).toBe('ORD-001');
        expect(result.customerName).toBe('John Doe');
        expect(result.customerEmail).toBeUndefined();
        expect(result.totalAmount).toBeUndefined();
        expect(result.fabricCost).toBeUndefined();
        expect(result.fabricConsumption).toBeUndefined();
    });

    it('should preserve all fields when user has all permissions', () => {
        const userPermissions = [
            'orders:view',
            'orders:view:financial',
            'products:view',
            'products:view:cost',
            'products:view:consumption',
            'customers:view:contact',
        ];
        const result = filterConfidentialFields(complexData, userPermissions);

        expect(result.customerEmail).toBe('john@example.com');
        expect(result.totalAmount).toBe(5000.00);
        expect(result.fabricCost).toBe(150.00);
        expect(result.fabricConsumption).toBe(2.5);
    });

    it('should handle partial permissions correctly', () => {
        const userPermissions = ['orders:view', 'orders:view:financial', 'products:view'];
        const result = filterConfidentialFields(complexData, userPermissions);

        expect(result.totalAmount).toBe(5000.00);
        expect(result.fabricCost).toBeUndefined();
        expect(result.customerEmail).toBeUndefined();
    });
});

// ============================================
// SECTION 5: getUserPermissions() TESTS
// ============================================

describe('getUserPermissions - Role and Override Merging', () => {
    // Mock Prisma client for testing
    const createMockPrisma = (userData) => ({
        user: {
            findUnique: jest.fn().mockResolvedValue(userData),
        },
    });

    it('should return role permissions for user without overrides', async () => {
        const mockPrisma = createMockPrisma({
            id: 'user-1',
            userRole: {
                permissions: ['orders:view', 'products:view', 'inventory:view'],
            },
            permissionOverrides: [],
        });

        const permissions = await getUserPermissions(mockPrisma, 'user-1');

        expect(permissions).toContain('orders:view');
        expect(permissions).toContain('products:view');
        expect(permissions).toContain('inventory:view');
        expect(permissions.length).toBe(3);
    });

    it('should add granted override permissions to role permissions', async () => {
        const mockPrisma = createMockPrisma({
            id: 'user-1',
            userRole: {
                permissions: ['orders:view', 'products:view'],
            },
            permissionOverrides: [
                { permission: 'orders:ship', granted: true },
            ],
        });

        const permissions = await getUserPermissions(mockPrisma, 'user-1');

        expect(permissions).toContain('orders:view');
        expect(permissions).toContain('products:view');
        expect(permissions).toContain('orders:ship');
    });

    it('should remove denied override permissions from role permissions', async () => {
        const mockPrisma = createMockPrisma({
            id: 'user-1',
            userRole: {
                permissions: ['orders:view', 'orders:ship', 'products:view'],
            },
            permissionOverrides: [
                { permission: 'orders:ship', granted: false },
            ],
        });

        const permissions = await getUserPermissions(mockPrisma, 'user-1');

        expect(permissions).toContain('orders:view');
        expect(permissions).toContain('products:view');
        expect(permissions).not.toContain('orders:ship');
    });

    it('should handle multiple overrides correctly', async () => {
        const mockPrisma = createMockPrisma({
            id: 'user-1',
            userRole: {
                permissions: ['orders:view', 'products:view'],
            },
            permissionOverrides: [
                { permission: 'orders:ship', granted: true },
                { permission: 'orders:cancel', granted: true },
                { permission: 'products:view', granted: false },
            ],
        });

        const permissions = await getUserPermissions(mockPrisma, 'user-1');

        expect(permissions).toContain('orders:view');
        expect(permissions).toContain('orders:ship');
        expect(permissions).toContain('orders:cancel');
        expect(permissions).not.toContain('products:view');
    });

    it('should return empty array for non-existent user', async () => {
        const mockPrisma = createMockPrisma(null);

        const permissions = await getUserPermissions(mockPrisma, 'non-existent');

        expect(permissions).toEqual([]);
    });

    it('should handle user without role', async () => {
        const mockPrisma = createMockPrisma({
            id: 'user-1',
            userRole: null,
            permissionOverrides: [
                { permission: 'orders:view', granted: true },
            ],
        });

        const permissions = await getUserPermissions(mockPrisma, 'user-1');

        expect(permissions).toContain('orders:view');
        expect(permissions.length).toBe(1);
    });

    it('should handle user with empty permissions array in role', async () => {
        const mockPrisma = createMockPrisma({
            id: 'user-1',
            userRole: {
                permissions: [],
            },
            permissionOverrides: [],
        });

        const permissions = await getUserPermissions(mockPrisma, 'user-1');

        expect(permissions).toEqual([]);
    });

    it('should handle null permissionOverrides', async () => {
        const mockPrisma = createMockPrisma({
            id: 'user-1',
            userRole: {
                permissions: ['orders:view'],
            },
            permissionOverrides: null,
        });

        const permissions = await getUserPermissions(mockPrisma, 'user-1');

        expect(permissions).toContain('orders:view');
    });
});

// ============================================
// SECTION 6: DEFAULT_ROLES CONFIGURATION TESTS
// ============================================

describe('DEFAULT_ROLES - Role Configurations', () => {
    it('should have owner role with all permissions', () => {
        const ownerRole = DEFAULT_ROLES.owner;

        expect(ownerRole.displayName).toBe('Owner');
        expect(ownerRole.isBuiltIn).toBe(true);
        expect(ownerRole.permissions.length).toBe(Object.keys(ALL_PERMISSIONS).length);

        // Spot check some permissions
        expect(ownerRole.permissions).toContain('orders:view');
        expect(ownerRole.permissions).toContain('users:delete');
        expect(ownerRole.permissions).toContain('settings:edit');
    });

    it('should have viewer role with only view permissions', () => {
        const viewerRole = DEFAULT_ROLES.viewer;

        expect(viewerRole.displayName).toBe('Viewer');
        expect(viewerRole.isBuiltIn).toBe(true);

        // Should have basic view permissions
        expect(viewerRole.permissions).toContain('orders:view');
        expect(viewerRole.permissions).toContain('products:view');

        // Should NOT have edit/create permissions
        expect(viewerRole.permissions).not.toContain('orders:ship');
        expect(viewerRole.permissions).not.toContain('products:edit');
        expect(viewerRole.permissions).not.toContain('users:create');
    });

    it('should have manager role with operational permissions', () => {
        const managerRole = DEFAULT_ROLES.manager;

        expect(managerRole.displayName).toBe('Manager');
        expect(managerRole.isBuiltIn).toBe(true);

        // Should have all view permissions
        expect(managerRole.permissions).toContain('orders:view');
        expect(managerRole.permissions).toContain('orders:view:financial');
        expect(managerRole.permissions).toContain('products:view:cost');

        // Should have operational permissions
        expect(managerRole.permissions).toContain('orders:ship');
        expect(managerRole.permissions).toContain('products:create');

        // Should NOT have destructive user permissions
        expect(managerRole.permissions).not.toContain('users:delete');
    });

    it('should have operations role without cost viewing', () => {
        const opsRole = DEFAULT_ROLES.operations;

        expect(opsRole.displayName).toBe('Operations');

        // Should have operational permissions
        expect(opsRole.permissions).toContain('orders:view');
        expect(opsRole.permissions).toContain('orders:ship');

        // Should NOT have cost/financial view
        expect(opsRole.permissions).not.toContain('orders:view:financial');
        expect(opsRole.permissions).not.toContain('products:view:cost');
    });

    it('should have warehouse role with limited permissions', () => {
        const warehouseRole = DEFAULT_ROLES.warehouse;

        expect(warehouseRole.displayName).toBe('Warehouse');

        // Should have inventory operations
        expect(warehouseRole.permissions).toContain('inventory:view');
        expect(warehouseRole.permissions).toContain('inventory:inward');
        expect(warehouseRole.permissions).toContain('inventory:outward');

        // Should NOT have order shipping
        expect(warehouseRole.permissions).not.toContain('orders:ship');
    });

    it('should have production role with production-specific permissions', () => {
        const productionRole = DEFAULT_ROLES.production;

        expect(productionRole.displayName).toBe('Production');

        // Should have production permissions
        expect(productionRole.permissions).toContain('production:view');
        expect(productionRole.permissions).toContain('production:create');
        expect(productionRole.permissions).toContain('production:complete');
        expect(productionRole.permissions).toContain('products:view:consumption');

        // Should NOT have order/inventory operations
        expect(productionRole.permissions).not.toContain('orders:ship');
        expect(productionRole.permissions).not.toContain('inventory:inward');
    });

    it('should have accounts role with financial visibility', () => {
        const accountsRole = DEFAULT_ROLES.accounts;

        expect(accountsRole.displayName).toBe('Accounts');

        // Should have financial view permissions
        expect(accountsRole.permissions).toContain('orders:view:financial');
        expect(accountsRole.permissions).toContain('products:view:cost');
        expect(accountsRole.permissions).toContain('fabrics:view:cost');
        expect(accountsRole.permissions).toContain('analytics:view:financial');

        // Should NOT have edit permissions for operations
        expect(accountsRole.permissions).not.toContain('orders:ship');
        expect(accountsRole.permissions).not.toContain('products:create');
    });
});

// ============================================
// SECTION 7: PERMISSION_CATEGORIES TESTS
// ============================================

describe('PERMISSION_CATEGORIES - Grouping', () => {
    it('should have all expected categories', () => {
        const expectedCategories = [
            'orders', 'products', 'fabrics', 'inventory',
            'production', 'returns', 'customers', 'settings',
            'users', 'analytics'
        ];

        expectedCategories.forEach(category => {
            expect(PERMISSION_CATEGORIES).toHaveProperty(category);
            expect(Array.isArray(PERMISSION_CATEGORIES[category])).toBe(true);
        });
    });

    it('should have orders category with correct permissions', () => {
        const orderPerms = PERMISSION_CATEGORIES.orders;

        expect(orderPerms).toContain('orders:view');
        expect(orderPerms).toContain('orders:view:financial');
        expect(orderPerms).toContain('orders:ship');
        expect(orderPerms).toContain('orders:cancel');
    });

    it('should have products category with correct permissions', () => {
        const productPerms = PERMISSION_CATEGORIES.products;

        expect(productPerms).toContain('products:view');
        expect(productPerms).toContain('products:view:cost');
        expect(productPerms).toContain('products:view:consumption');
        expect(productPerms).toContain('products:create');
        expect(productPerms).toContain('products:edit');
        expect(productPerms).toContain('products:delete');
    });

    it('should have users category with correct permissions', () => {
        const userPerms = PERMISSION_CATEGORIES.users;

        expect(userPerms).toContain('users:view');
        expect(userPerms).toContain('users:create');
        expect(userPerms).toContain('users:edit');
        expect(userPerms).toContain('users:delete');
        expect(userPerms).toContain('users:reset-password');
    });
});

// ============================================
// SECTION 8: ALL_PERMISSIONS TESTS
// ============================================

describe('ALL_PERMISSIONS - Complete Permission Set', () => {
    it('should contain all VIEW_PERMISSIONS', () => {
        Object.keys(VIEW_PERMISSIONS).forEach(permission => {
            expect(ALL_PERMISSIONS).toHaveProperty(permission);
        });
    });

    it('should contain all EDIT_PERMISSIONS', () => {
        Object.keys(EDIT_PERMISSIONS).forEach(permission => {
            expect(ALL_PERMISSIONS).toHaveProperty(permission);
        });
    });

    it('should have description for each permission', () => {
        Object.entries(ALL_PERMISSIONS).forEach(([key, description]) => {
            expect(typeof description).toBe('string');
            expect(description.length).toBeGreaterThan(0);
        });
    });
});

// ============================================
// SECTION 9: MIDDLEWARE TESTS
// ============================================

describe('requirePermission Middleware', () => {
    const createMockReq = (user, userPermissions) => ({
        user,
        userPermissions,
        prisma: {
            user: { findUnique: jest.fn() },
            permissionAuditLog: { create: jest.fn().mockResolvedValue({}) },
        },
        path: '/api/orders',
        method: 'POST',
        ip: '127.0.0.1',
    });

    const createMockRes = () => {
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        return res;
    };

    it('should return 401 when no user is authenticated', async () => {
        const req = createMockReq(null, null);
        const res = createMockRes();
        const next = jest.fn();

        const middleware = requirePermission('orders:ship');
        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
        expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 when user lacks required permission', async () => {
        const req = createMockReq({ id: 'user-1' }, ['orders:view']);
        const res = createMockRes();
        const next = jest.fn();

        const middleware = requirePermission('orders:ship');
        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Access denied',
            required: 'orders:ship',
        });
        expect(next).not.toHaveBeenCalled();
    });

    it('should call next when user has required permission', async () => {
        const req = createMockReq({ id: 'user-1' }, ['orders:view', 'orders:ship']);
        const res = createMockRes();
        const next = jest.fn();

        const middleware = requirePermission('orders:ship');
        await middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('should call next when user has wildcard permission', async () => {
        const req = createMockReq({ id: 'user-1' }, ['orders:*']);
        const res = createMockRes();
        const next = jest.fn();

        const middleware = requirePermission('orders:ship');
        await middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });
});

describe('requireAnyPermission Middleware', () => {
    const createMockReq = (user, userPermissions) => ({
        user,
        userPermissions,
        prisma: {
            user: { findUnique: jest.fn() },
            permissionAuditLog: { create: jest.fn().mockResolvedValue({}) },
        },
        path: '/api/orders',
        method: 'POST',
        ip: '127.0.0.1',
    });

    const createMockRes = () => ({
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    });

    it('should return 401 when no user is authenticated', async () => {
        const req = createMockReq(null, null);
        const res = createMockRes();
        const next = jest.fn();

        const middleware = requireAnyPermission('orders:ship', 'orders:cancel');
        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 when user lacks all required permissions', async () => {
        const req = createMockReq({ id: 'user-1' }, ['orders:view']);
        const res = createMockRes();
        const next = jest.fn();

        const middleware = requireAnyPermission('orders:ship', 'orders:cancel');
        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Access denied',
            requiredAny: ['orders:ship', 'orders:cancel'],
        });
        expect(next).not.toHaveBeenCalled();
    });

    it('should call next when user has one of the required permissions', async () => {
        const req = createMockReq({ id: 'user-1' }, ['orders:view', 'orders:ship']);
        const res = createMockRes();
        const next = jest.fn();

        const middleware = requireAnyPermission('orders:ship', 'orders:cancel');
        await middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });
});

describe('attachPermissions Middleware', () => {
    it('should attach permissions to request when user exists', async () => {
        const mockPrisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'user-1',
                    userRole: { permissions: ['orders:view'] },
                    permissionOverrides: [],
                }),
            },
        };

        const req = {
            user: { id: 'user-1' },
            prisma: mockPrisma,
        };
        const res = {};
        const next = jest.fn();

        await attachPermissions(req, res, next);

        expect(req.userPermissions).toContain('orders:view');
        expect(next).toHaveBeenCalled();
    });

    it('should not attach permissions when no user', async () => {
        const req = { user: null };
        const res = {};
        const next = jest.fn();

        await attachPermissions(req, res, next);

        expect(req.userPermissions).toBeUndefined();
        expect(next).toHaveBeenCalled();
    });

    it('should skip if permissions already attached', async () => {
        const mockPrisma = {
            user: { findUnique: jest.fn() },
        };

        const req = {
            user: { id: 'user-1' },
            userPermissions: ['orders:view'],
            prisma: mockPrisma,
        };
        const res = {};
        const next = jest.fn();

        await attachPermissions(req, res, next);

        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
    });
});

// ============================================
// SECTION 10: TOKEN VERSION VALIDATION TESTS
// ============================================

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

    it('should return falsy when user not found', async () => {
        const mockPrisma = createMockPrisma(null);

        const result = await validateTokenVersion(mockPrisma, 'non-existent', 1);

        // Returns null (falsy) when user not found
        expect(result).toBeFalsy();
    });
});

describe('invalidateUserTokens', () => {
    it('should increment token version', async () => {
        const mockUpdate = jest.fn().mockResolvedValue({});
        const mockPrisma = {
            user: { update: mockUpdate },
        };

        await invalidateUserTokens(mockPrisma, 'user-1');

        expect(mockUpdate).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            data: { tokenVersion: { increment: 1 } },
        });
    });
});

// ============================================
// SECTION 11: AUDIT LOGGING TESTS
// ============================================

describe('logAuditEvent', () => {
    it('should create audit log entry', async () => {
        const mockCreate = jest.fn().mockResolvedValue({});
        const mockPrisma = {
            permissionAuditLog: { create: mockCreate },
        };

        await logAuditEvent(mockPrisma, {
            userId: 'user-1',
            action: 'access_denied',
            resource: 'orders:ship',
            resourceId: 'order-123',
            details: { path: '/api/orders/ship', method: 'POST' },
            ipAddress: '192.168.1.1',
        });

        expect(mockCreate).toHaveBeenCalledWith({
            data: {
                userId: 'user-1',
                action: 'access_denied',
                resource: 'orders:ship',
                resourceId: 'order-123',
                details: { path: '/api/orders/ship', method: 'POST' },
                ipAddress: '192.168.1.1',
            },
        });
    });

    it('should handle null optional fields', async () => {
        const mockCreate = jest.fn().mockResolvedValue({});
        const mockPrisma = {
            permissionAuditLog: { create: mockCreate },
        };

        await logAuditEvent(mockPrisma, {
            userId: 'user-1',
            action: 'access_granted',
            resource: 'orders:view',
        });

        expect(mockCreate).toHaveBeenCalledWith({
            data: {
                userId: 'user-1',
                action: 'access_granted',
                resource: 'orders:view',
                resourceId: null,
                details: null,
                ipAddress: null,
            },
        });
    });

    it('should not throw on database error', async () => {
        const mockCreate = jest.fn().mockRejectedValue(new Error('DB Error'));
        const mockPrisma = {
            permissionAuditLog: { create: mockCreate },
        };

        // Should not throw
        await expect(logAuditEvent(mockPrisma, {
            userId: 'user-1',
            action: 'test',
            resource: 'test',
        })).resolves.not.toThrow();
    });
});

// ============================================
// SECTION 12: INTEGRATION SCENARIOS
// ============================================

describe('Integration - Role-based Access Scenarios', () => {
    it('Owner should have access to all features', () => {
        const ownerPermissions = DEFAULT_ROLES.owner.permissions;

        // Can view everything
        expect(hasPermission(ownerPermissions, 'orders:view')).toBe(true);
        expect(hasPermission(ownerPermissions, 'orders:view:financial')).toBe(true);
        expect(hasPermission(ownerPermissions, 'products:view:cost')).toBe(true);
        expect(hasPermission(ownerPermissions, 'customers:view:contact')).toBe(true);

        // Can edit everything
        expect(hasPermission(ownerPermissions, 'orders:ship')).toBe(true);
        expect(hasPermission(ownerPermissions, 'products:delete')).toBe(true);
        expect(hasPermission(ownerPermissions, 'users:create')).toBe(true);
        expect(hasPermission(ownerPermissions, 'settings:edit')).toBe(true);
    });

    it('Viewer should see basic data but not confidential fields', () => {
        const viewerPermissions = DEFAULT_ROLES.viewer.permissions;

        // Basic view access
        expect(hasPermission(viewerPermissions, 'orders:view')).toBe(true);
        expect(hasPermission(viewerPermissions, 'products:view')).toBe(true);

        // No confidential data
        expect(hasPermission(viewerPermissions, 'orders:view:financial')).toBe(false);
        expect(hasPermission(viewerPermissions, 'products:view:cost')).toBe(false);
        expect(hasPermission(viewerPermissions, 'customers:view:contact')).toBe(false);

        // No edit access
        expect(hasPermission(viewerPermissions, 'orders:ship')).toBe(false);
        expect(hasPermission(viewerPermissions, 'products:edit')).toBe(false);

        // Data filtering should work
        const order = {
            orderNumber: 'ORD-001',
            totalAmount: 5000,
            customerEmail: 'test@test.com',
        };

        const filtered = filterConfidentialFields(order, viewerPermissions);
        expect(filtered.orderNumber).toBe('ORD-001');
        expect(filtered.totalAmount).toBeUndefined();
        expect(filtered.customerEmail).toBeUndefined();
    });

    it('Operations staff should process orders without seeing financial data', () => {
        const opsPermissions = DEFAULT_ROLES.operations.permissions;

        // Can process orders
        expect(hasPermission(opsPermissions, 'orders:view')).toBe(true);
        expect(hasPermission(opsPermissions, 'orders:ship')).toBe(true);
        expect(hasPermission(opsPermissions, 'orders:allocate')).toBe(true);

        // Can see customer contact for shipping
        expect(hasPermission(opsPermissions, 'customers:view:contact')).toBe(true);

        // Cannot see financial data
        expect(hasPermission(opsPermissions, 'orders:view:financial')).toBe(false);
        expect(hasPermission(opsPermissions, 'products:view:cost')).toBe(false);
    });

    it('Accounts team should see financial data but not process orders', () => {
        const accountsPermissions = DEFAULT_ROLES.accounts.permissions;

        // Can see financial data
        expect(hasPermission(accountsPermissions, 'orders:view:financial')).toBe(true);
        expect(hasPermission(accountsPermissions, 'products:view:cost')).toBe(true);
        expect(hasPermission(accountsPermissions, 'fabrics:view:cost')).toBe(true);

        // Cannot process orders
        expect(hasPermission(accountsPermissions, 'orders:ship')).toBe(false);
        expect(hasPermission(accountsPermissions, 'orders:allocate')).toBe(false);

        // Data filtering should preserve financial data
        const order = {
            orderNumber: 'ORD-001',
            totalAmount: 5000,
            fabricCost: 150,
        };

        const filtered = filterConfidentialFields(order, accountsPermissions);
        expect(filtered.totalAmount).toBe(5000);
        expect(filtered.fabricCost).toBe(150);
    });
});

describe('Integration - Permission Override Scenarios', () => {
    it('should allow granting additional permissions to viewer', async () => {
        const mockPrisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'user-1',
                    userRole: {
                        permissions: DEFAULT_ROLES.viewer.permissions,
                    },
                    permissionOverrides: [
                        { permission: 'orders:ship', granted: true },
                    ],
                }),
            },
        };

        const permissions = await getUserPermissions(mockPrisma, 'user-1');

        // Has viewer permissions
        expect(hasPermission(permissions, 'orders:view')).toBe(true);

        // Has granted override
        expect(hasPermission(permissions, 'orders:ship')).toBe(true);
    });

    it('should allow restricting manager permissions', async () => {
        const mockPrisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'user-1',
                    userRole: {
                        permissions: DEFAULT_ROLES.manager.permissions,
                    },
                    permissionOverrides: [
                        { permission: 'products:view:cost', granted: false },
                        { permission: 'orders:view:financial', granted: false },
                    ],
                }),
            },
        };

        const permissions = await getUserPermissions(mockPrisma, 'user-1');

        // Still has basic manager permissions
        expect(hasPermission(permissions, 'orders:view')).toBe(true);
        expect(hasPermission(permissions, 'orders:ship')).toBe(true);

        // Denied overrides removed
        expect(hasPermission(permissions, 'products:view:cost')).toBe(false);
        expect(hasPermission(permissions, 'orders:view:financial')).toBe(false);
    });
});
