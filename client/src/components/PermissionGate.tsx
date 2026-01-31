/**
 * PermissionGate Component
 *
 * Conditionally renders children based on user permissions or access features.
 *
 * Supports:
 * - New simplified access system (access prop)
 * - Legacy permissions (permission, anyOf, allOf props)
 *
 * Usage (new - preferred):
 *   <PermissionGate access="view-costs">
 *     <CostColumn />
 *   </PermissionGate>
 *
 *   <PermissionGate access="costing-dashboard">
 *     <CostingLink />
 *   </PermissionGate>
 *
 * Usage (legacy - still supported):
 *   <PermissionGate permission="products:view:cost">
 *     <CostColumn />
 *   </PermissionGate>
 *
 *   <PermissionGate anyOf={['orders:ship', 'orders:allocate']}>
 *     <FulfillmentActions />
 *   </PermissionGate>
 */

import { type ReactNode, type ReactElement } from 'react';
import { usePermissions } from '../hooks/usePermissions';
import { useAccess, type AccessFeature } from '../hooks/useAccess';

interface PermissionGateProps {
    /** New simplified access feature check */
    access?: AccessFeature;
    /** Single permission required (legacy) */
    permission?: string;
    /** Any of these permissions required (OR logic, legacy) */
    anyOf?: string[];
    /** All of these permissions required (AND logic, legacy) */
    allOf?: string[];
    /** Show this when permission denied (optional) */
    fallback?: ReactNode;
    /** Children to render when permission granted */
    children: ReactNode;
}

/**
 * Permission gate for conditional rendering based on user permissions or access
 */
export function PermissionGate({
    access,
    permission,
    anyOf,
    allOf,
    fallback = null,
    children,
}: PermissionGateProps): ReactElement | null {
    const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions();
    const { hasAccess: checkAccess } = useAccess();

    let allowed = true;

    // New access system (takes priority)
    if (access) {
        allowed = checkAccess(access);
    }

    // Legacy: Check single permission
    if (permission) {
        allowed = allowed && hasPermission(permission);
    }

    // Legacy: Check any of permissions (OR logic)
    if (anyOf && anyOf.length > 0) {
        allowed = allowed && hasAnyPermission(...anyOf);
    }

    // Legacy: Check all of permissions (AND logic)
    if (allOf && allOf.length > 0) {
        allowed = allowed && hasAllPermissions(...allOf);
    }

    if (!allowed) {
        return fallback as ReactElement | null;
    }

    return <>{children}</>;
}

/**
 * Simple access denied message component
 */
export function AccessDenied({ message }: { message?: string }): ReactElement {
    return (
        <div className="text-gray-500 text-sm italic p-2">
            {message || 'You do not have permission to view this content.'}
        </div>
    );
}

export default PermissionGate;
