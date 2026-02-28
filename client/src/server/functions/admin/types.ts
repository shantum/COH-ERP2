'use server';

import { hasAccess as checkFeatureAccess, type AccessFeature } from '@coh/shared/config/access';

export type { AccessFeature } from '@coh/shared/config/access';

// ============================================
// RESULT TYPES
// ============================================

export interface MutationResult<T> {
    success: boolean;
    data?: T;
    error?: {
        code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'UNAUTHORIZED';
        message: string;
    };
}

export interface User {
    id: string;
    email: string;
    name: string;
    role: string;
    roleId: string | null;
    roleName: string | null;
    isActive: boolean;
    createdAt: string;
    extraAccess?: string[]; // Additional feature access beyond role
}

export interface Channel {
    id: string;
    name: string;
}

export interface TierThresholds {
    platinum: number;
    gold: number;
    silver: number;
}

export interface UserPreferences {
    visibleColumns: string[];
    columnOrder: string[];
    columnWidths: Record<string, number>;
    adminVersion: string | null;
}

/** JSON-safe value type for serializable server function data */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface LogEntry {
    timestamp: string;
    level: string;
    message: string;
    meta?: Record<string, JsonValue>;
}

export interface LogsResult {
    logs: LogEntry[];
    total: number;
    level: string;
    limit: number;
    offset: number;
}

export interface BackgroundJob {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    intervalMinutes?: number;
    schedule?: string;
    isRunning?: boolean;
    lastRunAt?: string | null;
    lastResult?: Record<string, JsonValue>;
    config?: Record<string, JsonValue>;
    stats?: Record<string, JsonValue>;
    note?: string;
}

// ============================================
// HELPERS
// ============================================

/**
 * Check if user has admin-level access.
 * Accepts admin role, owner role, or users:create permission.
 * Matches Express-side hasAdminAccess() logic from shared/services/auth.
 */
export function requireAdminRole(userRole: string, permissions?: string[]): void {
    const isAdmin = userRole === 'admin' || userRole === 'owner';
    const hasPermission = permissions?.includes('users:create') ?? false;
    if (!isAdmin && !hasPermission) {
        throw new Error('Admin access required');
    }
}

/**
 * Check if user has access to a feature
 * Uses new simplified access system
 * @internal For future use when migrating from requireAdminRole
 */
function _requireAccess(
    userRole: string,
    extraAccess: string[] | undefined,
    feature: AccessFeature
): void {
    if (!checkFeatureAccess(userRole, extraAccess ?? [], feature)) {
        throw new Error(`Access denied: ${feature} permission required`);
    }
}
// Export for use in other modules
export { _requireAccess as requireAccess };

/**
 * Safely converts a Prisma JsonValue to string[].
 * Used for Role.permissions which is stored as Json in the database.
 */
export function parsePermissionsArray(jsonValue: unknown): string[] {
    if (!jsonValue) return [];
    if (!Array.isArray(jsonValue)) return [];
    return jsonValue.filter((item): item is string => typeof item === 'string');
}
