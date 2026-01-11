/**
 * Permission Editor Modal
 * Modal for viewing and editing user permissions
 * Shows role selection and permission matrix grouped by domain
 * Supports individual permission overrides from role defaults
 */

import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, User, Mail, Check, Key, Eye, Edit3, RotateCcw } from 'lucide-react';
import Modal from '../Modal';
import { adminApi } from '../../services/api';
import type { User as UserType, Role } from '../../types';

// Permission categories matching server/src/utils/permissions.js
const PERMISSION_CATEGORIES: Record<string, { label: string; permissions: Array<{ key: string; label: string; type: 'view' | 'edit' }> }> = {
    orders: {
        label: 'Orders',
        permissions: [
            { key: 'orders:view', label: 'View orders', type: 'view' },
            { key: 'orders:view:financial', label: 'View financial data', type: 'view' },
            { key: 'orders:ship', label: 'Ship orders', type: 'edit' },
            { key: 'orders:hold', label: 'Hold orders', type: 'edit' },
            { key: 'orders:cancel', label: 'Cancel orders', type: 'edit' },
            { key: 'orders:allocate', label: 'Allocate inventory', type: 'edit' },
        ],
    },
    products: {
        label: 'Products',
        permissions: [
            { key: 'products:view', label: 'View products', type: 'view' },
            { key: 'products:view:cost', label: 'View costing', type: 'view' },
            { key: 'products:view:consumption', label: 'View consumption', type: 'view' },
            { key: 'products:create', label: 'Create products', type: 'edit' },
            { key: 'products:edit', label: 'Edit products', type: 'edit' },
            { key: 'products:edit:inventory', label: 'Edit stock targets', type: 'edit' },
            { key: 'products:edit:cost', label: 'Edit costing', type: 'edit' },
            { key: 'products:edit:consumption', label: 'Edit consumption', type: 'edit' },
            { key: 'products:delete', label: 'Delete products', type: 'edit' },
        ],
    },
    fabrics: {
        label: 'Fabrics',
        permissions: [
            { key: 'fabrics:view', label: 'View fabrics', type: 'view' },
            { key: 'fabrics:view:cost', label: 'View costs', type: 'view' },
            { key: 'fabrics:create', label: 'Create fabrics', type: 'edit' },
            { key: 'fabrics:edit', label: 'Edit fabrics', type: 'edit' },
            { key: 'fabrics:edit:cost', label: 'Edit costs', type: 'edit' },
            { key: 'fabrics:order', label: 'Create orders', type: 'edit' },
            { key: 'fabrics:delete', label: 'Delete fabrics', type: 'edit' },
        ],
    },
    inventory: {
        label: 'Inventory',
        permissions: [
            { key: 'inventory:view', label: 'View inventory', type: 'view' },
            { key: 'inventory:inward', label: 'Record inward', type: 'edit' },
            { key: 'inventory:outward', label: 'Record outward', type: 'edit' },
            { key: 'inventory:adjust', label: 'Adjust inventory', type: 'edit' },
            { key: 'inventory:delete:inward', label: 'Delete inward', type: 'edit' },
            { key: 'inventory:delete:outward', label: 'Delete outward', type: 'edit' },
        ],
    },
    production: {
        label: 'Production',
        permissions: [
            { key: 'production:view', label: 'View batches', type: 'view' },
            { key: 'production:create', label: 'Create batches', type: 'edit' },
            { key: 'production:complete', label: 'Complete batches', type: 'edit' },
            { key: 'production:delete', label: 'Delete batches', type: 'edit' },
        ],
    },
    returns: {
        label: 'Returns',
        permissions: [
            { key: 'returns:view', label: 'View returns', type: 'view' },
            { key: 'returns:view:financial', label: 'View financial', type: 'view' },
            { key: 'returns:process', label: 'Process returns', type: 'edit' },
            { key: 'returns:refund', label: 'Issue refunds', type: 'edit' },
            { key: 'returns:delete', label: 'Delete returns', type: 'edit' },
        ],
    },
    customers: {
        label: 'Customers',
        permissions: [
            { key: 'customers:view', label: 'View customers', type: 'view' },
            { key: 'customers:view:contact', label: 'View contact info', type: 'view' },
            { key: 'customers:edit', label: 'Edit customers', type: 'edit' },
            { key: 'customers:delete', label: 'Delete customers', type: 'edit' },
        ],
    },
    settings: {
        label: 'Settings',
        permissions: [
            { key: 'settings:view', label: 'View settings', type: 'view' },
            { key: 'settings:edit', label: 'Edit settings', type: 'edit' },
        ],
    },
    users: {
        label: 'Users',
        permissions: [
            { key: 'users:view', label: 'View users', type: 'view' },
            { key: 'users:create', label: 'Create users', type: 'edit' },
            { key: 'users:edit', label: 'Edit users', type: 'edit' },
            { key: 'users:delete', label: 'Delete users', type: 'edit' },
            { key: 'users:reset-password', label: 'Reset passwords', type: 'edit' },
        ],
    },
    analytics: {
        label: 'Analytics',
        permissions: [
            { key: 'analytics:view', label: 'View analytics', type: 'view' },
            { key: 'analytics:view:financial', label: 'View financial', type: 'view' },
        ],
    },
};

interface PermissionEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    user: UserType;
    roles: Role[];
}

interface PermissionState {
    granted: boolean;
    isOverridden: boolean;
    roleHasPermission: boolean;
}

export default function PermissionEditorModal({ isOpen, onClose, user, roles }: PermissionEditorModalProps) {
    const queryClient = useQueryClient();

    // Local state for role selection
    const [selectedRoleId, setSelectedRoleId] = useState(user.roleId || '');

    // Local state for permission changes (tracks what user has modified)
    const [localPermissions, setLocalPermissions] = useState<Map<string, boolean>>(new Map());

    // Track if there are unsaved changes
    const [hasChanges, setHasChanges] = useState(false);

    // Track if we're in the middle of a save operation to prevent state resets
    const [isSaving, setIsSaving] = useState(false);

    // Fetch user's current permissions and overrides
    const { data: permissionData, isLoading: isLoadingPermissions } = useQuery({
        queryKey: ['user-permissions', user.id],
        queryFn: async () => {
            const response = await adminApi.getUserPermissions(user.id);
            return response.data as {
                userId: string;
                roleId: string | null;
                roleName: string | null;
                rolePermissions: string[];
                overrides: Array<{ permission: string; granted: boolean }>;
            };
        },
        enabled: isOpen,
    });

    // Get the selected role's permissions
    const selectedRole = useMemo(() => {
        return roles.find(r => r.id === selectedRoleId);
    }, [roles, selectedRoleId]);

    const rolePermissions = useMemo(() => {
        return new Set(selectedRole?.permissions || []);
    }, [selectedRole]);

    // Initialize local permissions from server data when modal opens
    // CRITICAL: Only run when modal first opens or user changes, NOT during save operations
    useEffect(() => {
        if (permissionData && isOpen && !isSaving) {
            const initialMap = new Map<string, boolean>();

            // Start with role permissions as base
            for (const perm of permissionData.rolePermissions) {
                initialMap.set(perm, true);
            }

            // Apply overrides
            for (const override of permissionData.overrides) {
                initialMap.set(override.permission, override.granted);
            }

            setLocalPermissions(initialMap);
            setHasChanges(false);
        }
    }, [permissionData, isOpen, isSaving]);

    // Reset local state when role changes
    useEffect(() => {
        if (selectedRoleId !== user.roleId && !isSaving) {
            // When role changes, reset to role's default permissions
            const newMap = new Map<string, boolean>();
            if (selectedRole?.permissions) {
                for (const perm of selectedRole.permissions) {
                    newMap.set(perm, true);
                }
            }
            setLocalPermissions(newMap);
            setHasChanges(true);
        }
    }, [selectedRoleId, selectedRole, user.roleId, isSaving]);

    // Reset saving flag when modal closes
    useEffect(() => {
        if (!isOpen) {
            setIsSaving(false);
        }
    }, [isOpen]);

    // Get permission state for a specific permission key
    const getPermissionState = (permKey: string): PermissionState => {
        const roleHasPermission = rolePermissions.has(permKey);
        const localValue = localPermissions.get(permKey);
        const granted = localValue ?? roleHasPermission;
        const isOverridden = localValue !== undefined && localValue !== roleHasPermission;

        return { granted, isOverridden, roleHasPermission };
    };

    // Toggle a permission
    const togglePermission = (permKey: string) => {
        const currentState = getPermissionState(permKey);
        const newValue = !currentState.granted;

        setLocalPermissions(prev => {
            const next = new Map(prev);
            next.set(permKey, newValue);
            return next;
        });
        setHasChanges(true);
    };

    // Reset a single permission to role default
    const resetPermission = (permKey: string) => {
        const roleHasPermission = rolePermissions.has(permKey);

        setLocalPermissions(prev => {
            const next = new Map(prev);
            if (roleHasPermission) {
                next.set(permKey, true);
            } else {
                next.delete(permKey);
            }
            return next;
        });
        setHasChanges(true);
    };

    // Update role mutation
    const updateRoleMutation = useMutation({
        mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
            adminApi.assignUserRole(userId, roleId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            queryClient.invalidateQueries({ queryKey: ['user-permissions', user.id] });
        },
    });

    // Update permissions mutation
    const updatePermissionsMutation = useMutation({
        mutationFn: ({ userId, overrides }: { userId: string; overrides: Array<{ permission: string; granted: boolean }> }) =>
            adminApi.updateUserPermissions(userId, overrides),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            queryClient.invalidateQueries({ queryKey: ['user-permissions', user.id] });
        },
    });

    const handleSave = async () => {
        try {
            // Set saving flag to prevent useEffect from resetting state during mutations
            setIsSaving(true);

            // Update role if changed
            if (selectedRoleId && selectedRoleId !== user.roleId) {
                await updateRoleMutation.mutateAsync({
                    userId: user.id,
                    roleId: selectedRoleId,
                });
            }

            // Build overrides array - send ALL permissions currently in localPermissions
            // The backend will filter out those that match role defaults
            const overrides: Array<{ permission: string; granted: boolean }> = [];

            // Send all permissions in the localPermissions map
            for (const [permission, granted] of localPermissions.entries()) {
                overrides.push({ permission, granted });
            }

            // Always call the update endpoint (even if empty to clear overrides)
            await updatePermissionsMutation.mutateAsync({
                userId: user.id,
                overrides,
            });

            onClose();
        } finally {
            // Reset saving flag
            setIsSaving(false);
        }
    };

    // Calculate permission stats
    const permissionStats = useMemo(() => {
        let total = 0;
        let granted = 0;
        let overridden = 0;

        Object.values(PERMISSION_CATEGORIES).forEach(category => {
            category.permissions.forEach(perm => {
                total++;
                const state = getPermissionState(perm.key);
                if (state.granted) {
                    granted++;
                }
                if (state.isOverridden) {
                    overridden++;
                }
            });
        });

        return { total, granted, overridden };
    }, [localPermissions, rolePermissions]);

    const isPending = updateRoleMutation.isPending || updatePermissionsMutation.isPending;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="User Permissions"
            subtitle="Manage role and customize individual permissions"
            size="2xl"
            footer={
                <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-500">
                        {permissionStats.granted} of {permissionStats.total} permissions enabled
                        {permissionStats.overridden > 0 && (
                            <span className="ml-2 text-amber-600">
                                ({permissionStats.overridden} customized)
                            </span>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isPending || (!hasChanges && selectedRoleId === user.roleId)}
                            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isPending ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </div>
            }
        >
            <div className="space-y-6">
                {/* User Info Header */}
                <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                    <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-lg font-semibold text-gray-600">
                        {user.name?.charAt(0).toUpperCase() || '?'}
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <User size={14} className="text-gray-400" />
                            <span className="font-medium text-gray-900">{user.name}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                            <Mail size={14} className="text-gray-400" />
                            <span className="text-sm text-gray-500">{user.email}</span>
                        </div>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                        user.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                        {user.isActive ? 'Active' : 'Inactive'}
                    </div>
                </div>

                {/* Role Selection */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        <div className="flex items-center gap-2">
                            <Shield size={16} />
                            Assigned Role
                        </div>
                    </label>
                    <select
                        value={selectedRoleId}
                        onChange={(e) => setSelectedRoleId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                        <option value="">No role assigned</option>
                        {roles.map((role) => (
                            <option key={role.id} value={role.id}>
                                {role.displayName} - {role.description}
                            </option>
                        ))}
                    </select>
                    {selectedRole && (
                        <p className="mt-2 text-xs text-gray-500">
                            {selectedRole.description}
                        </p>
                    )}
                </div>

                {/* Permission Matrix */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                        <Key size={16} />
                        Permissions
                        <span className="text-xs font-normal text-gray-400 ml-2">
                            Click to toggle, customized permissions are highlighted
                        </span>
                    </h3>

                    {isLoadingPermissions ? (
                        <div className="flex items-center justify-center py-8 text-gray-500">
                            Loading permissions...
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4">
                            {Object.entries(PERMISSION_CATEGORIES).map(([key, category]) => (
                                <div key={key} className="border border-gray-200 rounded-lg overflow-hidden">
                                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
                                        <h4 className="text-sm font-medium text-gray-900">{category.label}</h4>
                                    </div>
                                    <div className="p-3 space-y-2">
                                        {category.permissions.map((perm) => {
                                            const state = getPermissionState(perm.key);
                                            return (
                                                <div
                                                    key={perm.key}
                                                    className={`flex items-center gap-2 text-sm group ${
                                                        state.granted ? 'text-gray-900' : 'text-gray-400'
                                                    }`}
                                                >
                                                    {/* Clickable checkbox */}
                                                    <button
                                                        type="button"
                                                        onClick={() => togglePermission(perm.key)}
                                                        className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${
                                                            state.granted
                                                                ? state.isOverridden
                                                                    ? 'bg-amber-100 text-amber-600 ring-2 ring-amber-300'
                                                                    : 'bg-green-100 text-green-600'
                                                                : state.isOverridden
                                                                    ? 'bg-red-50 ring-2 ring-red-200'
                                                                    : 'bg-gray-100 text-gray-400'
                                                        } hover:ring-2 hover:ring-gray-300`}
                                                        title={state.isOverridden
                                                            ? `Customized (role default: ${state.roleHasPermission ? 'granted' : 'denied'})`
                                                            : 'From role'}
                                                    >
                                                        {state.granted && <Check size={12} />}
                                                    </button>

                                                    {/* Permission type icon */}
                                                    <span className={`w-4 flex-shrink-0 ${
                                                        perm.type === 'view' ? 'text-blue-500' : 'text-amber-500'
                                                    }`}>
                                                        {perm.type === 'view' ? <Eye size={12} /> : <Edit3 size={12} />}
                                                    </span>

                                                    {/* Permission label */}
                                                    <span
                                                        className="truncate flex-1 cursor-pointer"
                                                        onClick={() => togglePermission(perm.key)}
                                                    >
                                                        {perm.label}
                                                    </span>

                                                    {/* Reset button (only show on hover if overridden) */}
                                                    {state.isOverridden && (
                                                        <button
                                                            type="button"
                                                            onClick={() => resetPermission(perm.key)}
                                                            className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-gray-600 transition-opacity"
                                                            title="Reset to role default"
                                                        >
                                                            <RotateCcw size={12} />
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Permission Legend */}
                <div className="flex items-center gap-6 text-xs text-gray-500 border-t border-gray-100 pt-4">
                    <div className="flex items-center gap-1.5">
                        <Eye size={12} className="text-blue-500" />
                        <span>View permission</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Edit3 size={12} className="text-amber-500" />
                        <span>Edit permission</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded bg-green-100 flex items-center justify-center">
                            <Check size={8} className="text-green-600" />
                        </div>
                        <span>From role</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded bg-amber-100 ring-2 ring-amber-300 flex items-center justify-center">
                            <Check size={8} className="text-amber-600" />
                        </div>
                        <span>Customized</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded bg-gray-100"></div>
                        <span>Denied</span>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
