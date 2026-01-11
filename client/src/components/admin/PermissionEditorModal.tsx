/**
 * Permission Editor Modal
 * Modal for viewing and editing user permissions
 * Shows role selection and permission matrix grouped by domain
 */

import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, User, Mail, Check, AlertCircle, Key, Eye, Edit3 } from 'lucide-react';
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

export default function PermissionEditorModal({ isOpen, onClose, user, roles }: PermissionEditorModalProps) {
    const queryClient = useQueryClient();

    // Local state for role selection
    const [selectedRoleId, setSelectedRoleId] = useState(user.roleId || '');

    // Get the selected role's permissions
    const selectedRole = useMemo(() => {
        return roles.find(r => r.id === selectedRoleId);
    }, [roles, selectedRoleId]);

    const effectivePermissions = useMemo(() => {
        return new Set(selectedRole?.permissions || []);
    }, [selectedRole]);

    // Update role mutation
    const updateRoleMutation = useMutation({
        mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
            adminApi.assignUserRole(userId, roleId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            onClose();
        },
    });

    const handleSave = () => {
        if (selectedRoleId && selectedRoleId !== user.roleId) {
            updateRoleMutation.mutate({
                userId: user.id,
                roleId: selectedRoleId,
            });
        } else {
            onClose();
        }
    };

    // Calculate permission stats
    const permissionStats = useMemo(() => {
        let total = 0;
        let granted = 0;

        Object.values(PERMISSION_CATEGORIES).forEach(category => {
            category.permissions.forEach(perm => {
                total++;
                if (effectivePermissions.has(perm.key)) {
                    granted++;
                }
            });
        });

        return { total, granted };
    }, [effectivePermissions]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="User Permissions"
            subtitle="Manage role and view effective permissions"
            size="2xl"
            footer={
                <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-500">
                        {permissionStats.granted} of {permissionStats.total} permissions enabled
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
                            disabled={updateRoleMutation.isPending}
                            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50"
                        >
                            {updateRoleMutation.isPending ? 'Saving...' : 'Save Changes'}
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

                {/* Info Banner */}
                <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="font-medium">Role-based permissions</p>
                        <p className="text-blue-600 text-xs mt-0.5">
                            Permissions are determined by the assigned role. Individual permission overrides are not yet supported.
                        </p>
                    </div>
                </div>

                {/* Permission Matrix */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                        <Key size={16} />
                        Effective Permissions
                    </h3>

                    <div className="grid grid-cols-2 gap-4">
                        {Object.entries(PERMISSION_CATEGORIES).map(([key, category]) => (
                            <div key={key} className="border border-gray-200 rounded-lg overflow-hidden">
                                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
                                    <h4 className="text-sm font-medium text-gray-900">{category.label}</h4>
                                </div>
                                <div className="p-3 space-y-2">
                                    {category.permissions.map((perm) => {
                                        const isGranted = effectivePermissions.has(perm.key);
                                        return (
                                            <div
                                                key={perm.key}
                                                className={`flex items-center gap-2 text-sm ${
                                                    isGranted ? 'text-gray-900' : 'text-gray-400'
                                                }`}
                                            >
                                                <div className={`w-4 h-4 rounded flex items-center justify-center ${
                                                    isGranted
                                                        ? 'bg-green-100 text-green-600'
                                                        : 'bg-gray-100 text-gray-400'
                                                }`}>
                                                    {isGranted && <Check size={12} />}
                                                </div>
                                                <span className={`w-4 flex-shrink-0 ${
                                                    perm.type === 'view' ? 'text-blue-500' : 'text-amber-500'
                                                }`}>
                                                    {perm.type === 'view' ? <Eye size={12} /> : <Edit3 size={12} />}
                                                </span>
                                                <span className="truncate">{perm.label}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
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
                        <span>Granted</span>
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
