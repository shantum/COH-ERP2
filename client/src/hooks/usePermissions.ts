/**
 * Permission utilities and hook for frontend permission checking
 * 
 * Provides:
 * - usePermissions() hook for checking permissions
 * - hasPermission() utility for single permission check
 * - hasAnyPermission() for any of multiple permissions
 * - hasAllPermissions() for all permissions required
 * - PermissionGate component for conditional rendering
 */

import { useAuth } from './useAuth';

/**
 * Check if user has a specific permission
 * Supports wildcards: 'products:*' matches 'products:view', 'products:edit', etc.
 */
function checkPermission(permissions: string[], permission: string): boolean {
    if (!permissions || !Array.isArray(permissions)) return false;

    // Direct match
    if (permissions.includes(permission)) return true;

    // Wildcard support: products:* matches products:view, products:edit, etc.
    const [domain] = permission.split(':');
    if (permissions.includes(`${domain}:*`)) return true;

    // Global admin wildcard
    if (permissions.includes('*')) return true;

    return false;
}

/**
 * Check if user has any of the specified permissions
 */
function checkAnyPermission(permissions: string[], ...requiredPermissions: string[]): boolean {
    return requiredPermissions.some(p => checkPermission(permissions, p));
}

/**
 * Check if user has all of the specified permissions
 */
function checkAllPermissions(permissions: string[], ...requiredPermissions: string[]): boolean {
    return requiredPermissions.every(p => checkPermission(permissions, p));
}

/**
 * Permission context return type
 */
interface PermissionContext {
    permissions: string[];
    roleName: string | null;
    hasPermission: (permission: string) => boolean;
    hasAnyPermission: (...permissions: string[]) => boolean;
    hasAllPermissions: (...permissions: string[]) => boolean;
    isOwner: boolean;
    isManager: boolean;
}

/**
 * Hook to access permission checking functions
 * Must be used within AuthProvider
 */
export function usePermissions(): PermissionContext {
    const { user } = useAuth();

    const permissions = user?.permissions ?? [];
    const roleName = user?.roleName ?? null;

    return {
        permissions,
        roleName,
        hasPermission: (permission: string) => checkPermission(permissions, permission),
        hasAnyPermission: (...perms: string[]) => checkAnyPermission(permissions, ...perms),
        hasAllPermissions: (...perms: string[]) => checkAllPermissions(permissions, ...perms),
        isOwner: roleName === 'Owner',
        isManager: roleName === 'Owner' || roleName === 'Manager',
    };
}

/**
 * Static permission check utilities (for use outside React components)
 * These read permissions from localStorage user data
 */
export const PermissionUtils = {
    hasPermission: checkPermission,
    hasAnyPermission: checkAnyPermission,
    hasAllPermissions: checkAllPermissions,
};
