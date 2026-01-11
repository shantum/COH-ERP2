/**
 * PermissionGate Component
 * 
 * Conditionally renders children based on user permissions.
 * Supports single permission, any of multiple permissions, or all permissions required.
 * 
 * Usage:
 *   <PermissionGate permission="products:view:cost">
 *     <CostColumn />
 *   </PermissionGate>
 * 
 *   <PermissionGate anyOf={['orders:ship', 'orders:allocate']}>
 *     <FulfillmentActions />
 *   </PermissionGate>
 * 
 *   <PermissionGate allOf={['inventory:inward', 'inventory:outward']} fallback={<AccessDenied />}>
 *     <InventoryManager />
 *   </PermissionGate>
 */

import { type ReactNode, type ReactElement } from 'react';
import { usePermissions } from '../hooks/usePermissions';

interface PermissionGateProps {
    /** Single permission required */
    permission?: string;
    /** Any of these permissions required (OR logic) */
    anyOf?: string[];
    /** All of these permissions required (AND logic) */
    allOf?: string[];
    /** Show this when permission denied (optional) */
    fallback?: ReactNode;
    /** Children to render when permission granted */
    children: ReactNode;
}

/**
 * Permission gate for conditional rendering based on user permissions
 */
export function PermissionGate({
    permission,
    anyOf,
    allOf,
    fallback = null,
    children,
}: PermissionGateProps): ReactElement | null {
    const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions();

    let hasAccess = true;

    // Check single permission
    if (permission) {
        hasAccess = hasPermission(permission);
    }

    // Check any of permissions (OR logic)
    if (anyOf && anyOf.length > 0) {
        hasAccess = hasAccess && hasAnyPermission(...anyOf);
    }

    // Check all of permissions (AND logic)
    if (allOf && allOf.length > 0) {
        hasAccess = hasAccess && hasAllPermissions(...allOf);
    }

    if (!hasAccess) {
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
