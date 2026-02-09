/**
 * Server-Side Access Control Utilities
 *
 * Provides access checking for Express routes and Server Functions.
 * Uses the same ACCESS_CONFIG as the client for consistency.
 *
 * Usage in Express routes:
 *   app.get('/admin/users', requireAccess('manage-users'), handler);
 *
 * Usage in handlers:
 *   if (!checkAccess(user, 'edit-costs')) {
 *     return res.status(403).json({ error: 'Access denied' });
 *   }
 */

import {
    hasAccess,
    type AccessFeature,
    type UserRole,
} from '@coh/shared/config/access';
import type { Request, Response, NextFunction } from 'express';

// ============================================
// TYPES
// ============================================

/**
 * User object with access information
 * Matches what's available in req.user after auth middleware
 */
export interface AccessUser {
    id: string;
    email: string;
    role: string;
    extraAccess?: string[];
}

// ============================================
// ACCESS CHECK UTILITIES
// ============================================

/**
 * Check if a user has access to a feature
 *
 * @param user - User object with role and extraAccess
 * @param feature - Feature to check
 * @returns true if user has access
 */
export function checkAccess(
    user: AccessUser | null | undefined,
    feature: AccessFeature
): boolean {
    if (!user) return false;
    return hasAccess(user.role, user.extraAccess ?? [], feature);
}

/**
 * Check if user has any of the specified features
 */
export function checkAnyAccess(
    user: AccessUser | null | undefined,
    ...features: AccessFeature[]
): boolean {
    if (!user) return false;
    return features.some((feature) => checkAccess(user, feature));
}

/**
 * Check if user has all of the specified features
 */
export function checkAllAccess(
    user: AccessUser | null | undefined,
    ...features: AccessFeature[]
): boolean {
    if (!user) return false;
    return features.every((feature) => checkAccess(user, feature));
}

// ============================================
// REQUIRE FUNCTIONS (throw on failure)
// ============================================

/**
 * Throw error if user lacks access to feature
 * Use in Server Functions and Express handlers
 */
export function requireAccess(
    user: AccessUser | null | undefined,
    feature: AccessFeature
): void {
    if (!checkAccess(user, feature)) {
        throw new Error(`Access denied: ${feature} permission required`);
    }
}

/**
 * Throw error if user lacks any of the specified features
 */
export function requireAnyAccess(
    user: AccessUser | null | undefined,
    ...features: AccessFeature[]
): void {
    if (!checkAnyAccess(user, ...features)) {
        throw new Error(`Access denied: one of [${features.join(', ')}] required`);
    }
}

/**
 * Throw error if user lacks all of the specified features
 */
export function requireAllAccess(
    user: AccessUser | null | undefined,
    ...features: AccessFeature[]
): void {
    if (!checkAllAccess(user, ...features)) {
        throw new Error(`Access denied: all of [${features.join(', ')}] required`);
    }
}

// ============================================
// EXPRESS MIDDLEWARE
// ============================================

/**
 * Express middleware that requires access to a feature
 *
 * Usage:
 *   router.get('/admin/users', accessMiddleware('manage-users'), handler);
 */
export function accessMiddleware(feature: AccessFeature) {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = req.user as AccessUser | undefined;

        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!checkAccess(user, feature)) {
            return res.status(403).json({
                error: 'Access denied',
                required: feature,
            });
        }

        next();
    };
}

/**
 * Express middleware that requires any of the specified features
 */
export function accessAnyMiddleware(...features: AccessFeature[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = req.user as AccessUser | undefined;

        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!checkAnyAccess(user, ...features)) {
            return res.status(403).json({
                error: 'Access denied',
                required: features,
            });
        }

        next();
    };
}

// ============================================
// LEGACY COMPATIBILITY
// ============================================

/**
 * Check if user has admin/owner role
 * For backward compatibility during migration
 */
export function isAdminUser(user: AccessUser | null | undefined): boolean {
    if (!user) return false;
    return user.role === 'admin' || user.role === 'owner';
}

/**
 * Throw if user is not admin/owner
 * For backward compatibility during migration
 */
export function requireAdminRole(user: AccessUser | null | undefined): void {
    if (!isAdminUser(user)) {
        throw new Error('Admin access required');
    }
}

// Re-export types
export type { AccessFeature, UserRole };
