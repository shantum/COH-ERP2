/**
 * Simplified Access Control Configuration
 *
 * Replaces 47 granular permissions with simple role + feature-based access.
 *
 * Architecture:
 * - 3 roles: owner, manager, staff
 * - ~10 features with role arrays
 * - extraAccess on User for exceptions
 *
 * Usage:
 *   hasAccess(userRole, extraAccess, 'view-costs') // => boolean
 */

// ============================================
// TYPES
// ============================================

/**
 * User roles in order of decreasing access
 */
export type UserRole = 'owner' | 'manager' | 'staff';

/**
 * Feature keys for access control
 */
export type AccessFeature =
    | 'view-costs'          // See cost/COGS data in products, BOM
    | 'edit-costs'          // Modify costing, BOM costs
    | 'view-financials'     // Order amounts, revenue, analytics
    | 'costing-dashboard'   // P&L page, breakeven analysis
    | 'view-consumption'    // Fabric consumption rates
    | 'edit-consumption'    // Modify consumption values
    | 'manage-users'        // User CRUD, permission management
    | 'edit-settings'       // System settings
    | 'delete-data'         // Dangerous delete operations
    | 'view-analytics';     // Analytics page

/**
 * Access configuration type
 */
export type AccessConfig = Record<AccessFeature, UserRole[]>;

// ============================================
// ACCESS CONFIGURATION
// ============================================

/**
 * Feature access by role
 *
 * Rules:
 * - owner: Full access to everything
 * - manager: Operational access, can see costs and financials
 * - staff: Basic operational access only
 *
 * Users can be granted extraAccess for features beyond their role.
 */
export const ACCESS_CONFIG: AccessConfig = {
    // Cost visibility
    'view-costs': ['owner', 'manager'],
    'edit-costs': ['owner'],

    // Financial data
    'view-financials': ['owner', 'manager'],

    // Costing dashboard (P&L analysis)
    'costing-dashboard': ['owner'],

    // Consumption (fabric usage)
    'view-consumption': ['owner', 'manager'],
    'edit-consumption': ['owner', 'manager'],

    // User management
    'manage-users': ['owner'],

    // System settings
    'edit-settings': ['owner'],

    // Dangerous operations
    'delete-data': ['owner'],

    // Analytics
    'view-analytics': ['owner', 'manager'],
};

// ============================================
// ACCESS CHECK UTILITIES
// ============================================

/**
 * Check if a user has access to a feature
 *
 * @param role - User's base role
 * @param extraAccess - Additional features granted to user
 * @param feature - Feature to check access for
 * @returns true if user has access
 */
export function hasAccess(
    role: string | null | undefined,
    extraAccess: string[] | null | undefined,
    feature: AccessFeature
): boolean {
    // Owner always has access to everything
    if (role === 'owner' || role === 'admin') {
        return true;
    }

    // Check if role has access
    const allowedRoles = ACCESS_CONFIG[feature];
    if (allowedRoles && allowedRoles.includes(role as UserRole)) {
        return true;
    }

    // Check extraAccess for exceptions
    if (extraAccess && Array.isArray(extraAccess)) {
        return extraAccess.includes(feature);
    }

    return false;
}

/**
 * Get all features a user has access to
 *
 * @param role - User's base role
 * @param extraAccess - Additional features granted to user
 * @returns Array of feature keys user can access
 */
export function getUserFeatures(
    role: string | null | undefined,
    extraAccess: string[] | null | undefined
): AccessFeature[] {
    const features: AccessFeature[] = [];

    for (const feature of Object.keys(ACCESS_CONFIG) as AccessFeature[]) {
        if (hasAccess(role, extraAccess, feature)) {
            features.push(feature);
        }
    }

    return features;
}

/**
 * Get display info for features
 */
export const FEATURE_INFO: Record<AccessFeature, { label: string; description: string }> = {
    'view-costs': {
        label: 'View Costs',
        description: 'See cost and COGS data in products and BOM',
    },
    'edit-costs': {
        label: 'Edit Costs',
        description: 'Modify costing values and BOM costs',
    },
    'view-financials': {
        label: 'View Financials',
        description: 'See order amounts, revenue, and financial analytics',
    },
    'costing-dashboard': {
        label: 'Costing Dashboard',
        description: 'Access P&L analysis and breakeven calculations',
    },
    'view-consumption': {
        label: 'View Consumption',
        description: 'See fabric consumption rates',
    },
    'edit-consumption': {
        label: 'Edit Consumption',
        description: 'Modify fabric consumption values',
    },
    'manage-users': {
        label: 'Manage Users',
        description: 'Create, edit, and delete user accounts',
    },
    'edit-settings': {
        label: 'Edit Settings',
        description: 'Modify system-wide settings',
    },
    'delete-data': {
        label: 'Delete Data',
        description: 'Perform dangerous delete operations',
    },
    'view-analytics': {
        label: 'View Analytics',
        description: 'Access analytics and reporting pages',
    },
};

/**
 * Get features that are NOT included in a role by default
 * Used for showing which features can be granted as extras
 */
export function getExtraFeatures(role: string | null | undefined): AccessFeature[] {
    if (!role || role === 'owner' || role === 'admin') {
        return []; // Owner has everything, no extras needed
    }

    const features: AccessFeature[] = [];

    for (const [feature, allowedRoles] of Object.entries(ACCESS_CONFIG) as [AccessFeature, UserRole[]][]) {
        if (!allowedRoles.includes(role as UserRole)) {
            features.push(feature);
        }
    }

    return features;
}

/**
 * Get features that ARE included in a role by default
 */
export function getRoleFeatures(role: string | null | undefined): AccessFeature[] {
    if (!role) return [];

    if (role === 'owner' || role === 'admin') {
        return Object.keys(ACCESS_CONFIG) as AccessFeature[];
    }

    const features: AccessFeature[] = [];

    for (const [feature, allowedRoles] of Object.entries(ACCESS_CONFIG) as [AccessFeature, UserRole[]][]) {
        if (allowedRoles.includes(role as UserRole)) {
            features.push(feature);
        }
    }

    return features;
}
