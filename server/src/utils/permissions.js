/**
 * Permission Definitions
 * Central source of truth for all permissions in the system
 */

// View permissions
export const VIEW_PERMISSIONS = {
    // Orders
    'orders:view': 'View basic order information',
    'orders:view:financial': 'View order prices and totals',

    // Products
    'products:view': 'View product names and sizes',
    'products:view:cost': 'View product costing data',
    'products:view:consumption': 'View fabric consumption rates',

    // Fabrics
    'fabrics:view': 'View fabric information',
    'fabrics:view:cost': 'View fabric costs',

    // Inventory
    'inventory:view': 'View inventory levels',

    // Production
    'production:view': 'View production schedules',

    // Returns
    'returns:view': 'View return requests',
    'returns:view:financial': 'View return financial data',

    // Customers
    'customers:view': 'View customer names',
    'customers:view:contact': 'View customer contact details',

    // Settings
    'settings:view': 'View system settings',

    // Users
    'users:view': 'View user list',

    // Analytics
    'analytics:view': 'View analytics',
    'analytics:view:financial': 'View financial analytics',
};

// Edit permissions
export const EDIT_PERMISSIONS = {
    // Orders
    'orders:ship': 'Ship orders',
    'orders:hold': 'Place orders on hold',
    'orders:cancel': 'Cancel orders',
    'orders:allocate': 'Allocate inventory to orders',

    // Products
    'products:create': 'Create new products',
    'products:edit': 'Edit product information',
    'products:edit:inventory': 'Edit stock targets',
    'products:edit:cost': 'Edit product costing',
    'products:edit:consumption': 'Edit fabric consumption',
    'products:delete': 'Delete products',

    // Fabrics
    'fabrics:create': 'Create new fabrics',
    'fabrics:edit': 'Edit fabric information',
    'fabrics:edit:cost': 'Edit fabric costs',
    'fabrics:order': 'Create fabric orders',
    'fabrics:delete': 'Delete fabrics',

    // Inventory
    'inventory:inward': 'Record inventory inward',
    'inventory:outward': 'Record inventory outward',
    'inventory:adjust': 'Adjust inventory',
    'inventory:delete:inward': 'Delete inward transactions',
    'inventory:delete:outward': 'Delete outward transactions',

    // Production
    'production:create': 'Create production batches',
    'production:complete': 'Complete production batches',
    'production:delete': 'Delete production batches',

    // Returns
    'returns:process': 'Process returns',
    'returns:refund': 'Issue refunds',
    'returns:delete': 'Delete returns',

    // Customers
    'customers:edit': 'Edit customer information',
    'customers:delete': 'Delete customers',

    // Settings
    'settings:edit': 'Edit system settings',

    // Users
    'users:create': 'Create new users',
    'users:edit': 'Edit users',
    'users:delete': 'Delete users',
    'users:reset-password': 'Reset user passwords',
};

// All permissions combined
export const ALL_PERMISSIONS = { ...VIEW_PERMISSIONS, ...EDIT_PERMISSIONS };

// Permission categories for UI grouping
export const PERMISSION_CATEGORIES = {
    orders: ['orders:view', 'orders:view:financial', 'orders:ship', 'orders:hold', 'orders:cancel', 'orders:allocate'],
    products: ['products:view', 'products:view:cost', 'products:view:consumption', 'products:create', 'products:edit', 'products:edit:inventory', 'products:edit:cost', 'products:edit:consumption', 'products:delete'],
    fabrics: ['fabrics:view', 'fabrics:view:cost', 'fabrics:create', 'fabrics:edit', 'fabrics:edit:cost', 'fabrics:order', 'fabrics:delete'],
    inventory: ['inventory:view', 'inventory:inward', 'inventory:outward', 'inventory:adjust', 'inventory:delete:inward', 'inventory:delete:outward'],
    production: ['production:view', 'production:create', 'production:complete', 'production:delete'],
    returns: ['returns:view', 'returns:view:financial', 'returns:process', 'returns:refund', 'returns:delete'],
    customers: ['customers:view', 'customers:view:contact', 'customers:edit', 'customers:delete'],
    settings: ['settings:view', 'settings:edit'],
    users: ['users:view', 'users:create', 'users:edit', 'users:delete', 'users:reset-password'],
    analytics: ['analytics:view', 'analytics:view:financial'],
};

// Default role configurations
export const DEFAULT_ROLES = {
    owner: {
        displayName: 'Owner',
        description: 'Full access to everything',
        permissions: Object.keys(ALL_PERMISSIONS),
        isBuiltIn: true,
    },
    manager: {
        displayName: 'Manager',
        description: 'Operations and financial visibility, limited user management',
        permissions: [
            // All view permissions
            ...Object.keys(VIEW_PERMISSIONS),
            // Order operations
            'orders:ship', 'orders:hold', 'orders:cancel', 'orders:allocate',
            // Product management (not delete)
            'products:create', 'products:edit', 'products:edit:inventory', 'products:edit:cost', 'products:edit:consumption',
            // Fabric management
            'fabrics:create', 'fabrics:edit', 'fabrics:edit:cost', 'fabrics:order',
            // Inventory operations
            'inventory:inward', 'inventory:outward', 'inventory:adjust',
            // Production
            'production:create', 'production:complete',
            // Returns
            'returns:process', 'returns:refund',
            // Customers
            'customers:edit',
            // Settings (view only via VIEW_PERMISSIONS)
        ],
        isBuiltIn: true,
    },
    operations: {
        displayName: 'Operations',
        description: 'Day-to-day order management, no cost viewing',
        permissions: [
            'orders:view',
            'products:view',
            'fabrics:view',
            'inventory:view',
            'production:view',
            'returns:view',
            'customers:view',
            'customers:view:contact',
            // Order operations
            'orders:ship', 'orders:hold', 'orders:cancel', 'orders:allocate',
            // Inventory operations
            'inventory:inward', 'inventory:outward',
            // Production
            'production:create', 'production:complete',
            // Returns processing
            'returns:process',
        ],
        isBuiltIn: true,
    },
    warehouse: {
        displayName: 'Warehouse',
        description: 'Inward/outward processing only',
        permissions: [
            'orders:view',
            'products:view',
            'inventory:view',
            'production:view',
            'inventory:inward',
            'inventory:outward',
        ],
        isBuiltIn: true,
    },
    production: {
        displayName: 'Production',
        description: 'Production oversight only',
        permissions: [
            'products:view',
            'products:view:consumption',
            'fabrics:view',
            'production:view',
            'production:create',
            'production:complete',
        ],
        isBuiltIn: true,
    },
    accounts: {
        displayName: 'Accounts',
        description: 'Financial data access',
        permissions: [
            'orders:view',
            'orders:view:financial',
            'products:view',
            'products:view:cost',
            'fabrics:view',
            'fabrics:view:cost',
            'returns:view',
            'returns:view:financial',
            'returns:refund',
            'analytics:view',
            'analytics:view:financial',
        ],
        isBuiltIn: true,
    },
    viewer: {
        displayName: 'Viewer',
        description: 'Read-only access to non-confidential data',
        permissions: [
            'orders:view',
            'products:view',
            'fabrics:view',
            'inventory:view',
            'production:view',
            'returns:view',
            'customers:view',
            'analytics:view',
        ],
        isBuiltIn: true,
    },
};
