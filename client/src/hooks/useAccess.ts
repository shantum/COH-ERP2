/**
 * Simple Access Control Hook
 *
 * Provides feature-based access control using role + extraAccess.
 * Replaces complex permission checking with simple feature checks.
 *
 * Usage:
 *   const { hasAccess, isOwner, isManager, role } = useAccess();
 *
 *   if (hasAccess('view-costs')) { ... }
 *   if (hasAccess('costing-dashboard')) { ... }
 */

import { useAuth } from './useAuth';
import {
    hasAccess as checkAccess,
    getUserFeatures,
    getRoleFeatures,
    getExtraFeatures,
    type AccessFeature,
    type UserRole,
} from '@coh/shared/config/access';

// ============================================
// TYPES
// ============================================

export interface AccessContext {
    /** Check if user has access to a feature */
    hasAccess: (feature: AccessFeature) => boolean;
    /** User's base role */
    role: string | null;
    /** User's extra access features */
    extraAccess: string[];
    /** All features user can access */
    features: AccessFeature[];
    /** Features included in role */
    roleFeatures: AccessFeature[];
    /** Features available as extras (not in role) */
    availableExtras: AccessFeature[];
    /** Is user an owner (full access) */
    isOwner: boolean;
    /** Is user a manager or higher */
    isManager: boolean;
    /** Is user at least staff level */
    isStaff: boolean;
}

// ============================================
// HOOK
// ============================================

/**
 * Hook to access feature-based access control
 * Must be used within AuthProvider
 */
export function useAccess(): AccessContext {
    const { user } = useAuth();

    // Extract role and extraAccess from user
    const role = user?.role ?? null;
    const extraAccess: string[] = user?.extraAccess ?? [];

    // Role checks
    const isOwner = role === 'owner' || role === 'admin';
    const isManager = isOwner || role === 'manager';
    const isStaff = isManager || role === 'staff';

    // Get features
    const features = getUserFeatures(role, extraAccess);
    const roleFeatures = getRoleFeatures(role);
    const availableExtras = getExtraFeatures(role);

    // Access check function
    const hasAccess = (feature: AccessFeature): boolean => {
        return checkAccess(role, extraAccess, feature);
    };

    return {
        hasAccess,
        role,
        extraAccess,
        features,
        roleFeatures,
        availableExtras,
        isOwner,
        isManager,
        isStaff,
    };
}

// Re-export types for convenience
export type { AccessFeature, UserRole };
