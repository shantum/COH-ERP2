/**
 * Permission Editor Modal (Simplified)
 *
 * Simple role dropdown + feature checkboxes for exceptions.
 * Replaces the old 47-permission matrix with ~10 features.
 *
 * UI:
 * - Role dropdown (owner/manager/staff)
 * - Feature checkboxes for extraAccess (features beyond role)
 * - Shows which features are included in role vs extras
 */

import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, User as UserIcon, Mail, Check, Info } from 'lucide-react';
import Modal from '../Modal';
import { updateUser } from '../../server/functions/admin';
import {
    FEATURE_INFO,
    getRoleFeatures,
    getExtraFeatures,
    type AccessFeature,
    type UserRole,
} from '@coh/shared/config/access';

// ============================================
// TYPES
// ============================================

// Accept a minimal user type that works with both types/index.User and admin.User
interface UserForModal {
    id: string;
    email: string;
    name: string;
    role: string;
    isActive: boolean;
    extraAccess?: string[];
}

interface PermissionEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    user: UserForModal;
    roles?: unknown[]; // Accept but ignore - for backward compatibility
}

// Role display info
const ROLE_INFO: Record<UserRole, { label: string; description: string }> = {
    owner: {
        label: 'Owner',
        description: 'Full access to all features including user management and settings',
    },
    manager: {
        label: 'Manager',
        description: 'Operational access with cost visibility, no user management',
    },
    staff: {
        label: 'Staff',
        description: 'Basic operational access for day-to-day tasks',
    },
};

// ============================================
// COMPONENT
// ============================================

export default function PermissionEditorModal({
    isOpen,
    onClose,
    user,
    roles: _roles, // Accept but ignore for backward compatibility
}: PermissionEditorModalProps) {
    const queryClient = useQueryClient();

    // Local state
    const [selectedRole, setSelectedRole] = useState<UserRole>(
        (user.role as UserRole) || 'staff'
    );
    const [selectedExtras, setSelectedExtras] = useState<Set<AccessFeature>>(
        new Set((user as any).extraAccess ?? [])
    );
    const [hasChanges, setHasChanges] = useState(false);

    // Reset state when modal opens with different user
    useEffect(() => {
        if (isOpen) {
            setSelectedRole((user.role as UserRole) || 'staff');
            setSelectedExtras(new Set((user as any).extraAccess ?? []));
            setHasChanges(false);
        }
    }, [isOpen, user.id]);

    // Get features for current role
    const roleFeatures = useMemo(() => getRoleFeatures(selectedRole), [selectedRole]);
    const availableExtras = useMemo(() => getExtraFeatures(selectedRole), [selectedRole]);

    // Handle role change
    const handleRoleChange = (role: UserRole) => {
        setSelectedRole(role);
        // Clear extras that are now included in the new role
        const newRoleFeatures = new Set(getRoleFeatures(role));
        setSelectedExtras((prev) => {
            const filtered = new Set<AccessFeature>();
            for (const feature of prev) {
                if (!newRoleFeatures.has(feature)) {
                    filtered.add(feature);
                }
            }
            return filtered;
        });
        setHasChanges(true);
    };

    // Toggle extra feature
    const toggleExtra = (feature: AccessFeature) => {
        setSelectedExtras((prev) => {
            const next = new Set(prev);
            if (next.has(feature)) {
                next.delete(feature);
            } else {
                next.add(feature);
            }
            return next;
        });
        setHasChanges(true);
    };

    // Update mutation
    const updateMutation = useMutation({
        mutationFn: async () => {
            const response = await updateUser({
                data: {
                    userId: user.id,
                    role: selectedRole === 'owner' ? 'admin' : selectedRole, // Map owner to admin for legacy field
                    // extraAccess will be handled separately via a new endpoint
                },
            });
            if (!response.success) {
                throw new Error(response.error?.message || 'Failed to update user');
            }
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            onClose();
        },
    });

    // Save handler
    const handleSave = () => {
        updateMutation.mutate();
    };

    const isPending = updateMutation.isPending;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Edit User Access"
            subtitle="Configure role and additional permissions"
            size="lg"
            footer={
                <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-500">
                        {roleFeatures.length} features from role
                        {selectedExtras.size > 0 && (
                            <span className="ml-1 text-amber-600">
                                + {selectedExtras.size} extra
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
                            disabled={isPending || !hasChanges}
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
                            <UserIcon size={14} className="text-gray-400" />
                            <span className="font-medium text-gray-900">{user.name}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                            <Mail size={14} className="text-gray-400" />
                            <span className="text-sm text-gray-500">{user.email}</span>
                        </div>
                    </div>
                    <div
                        className={`px-3 py-1 rounded-full text-sm font-medium ${
                            user.isActive
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-500'
                        }`}
                    >
                        {user.isActive ? 'Active' : 'Inactive'}
                    </div>
                </div>

                {/* Role Selection */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                        <div className="flex items-center gap-2">
                            <Shield size={16} />
                            Role
                        </div>
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                        {(Object.entries(ROLE_INFO) as [UserRole, typeof ROLE_INFO.owner][]).map(
                            ([role, info]) => (
                                <button
                                    key={role}
                                    type="button"
                                    onClick={() => handleRoleChange(role)}
                                    className={`p-3 text-left rounded-lg border-2 transition-all ${
                                        selectedRole === role
                                            ? 'border-primary-500 bg-primary-50'
                                            : 'border-gray-200 hover:border-gray-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span
                                            className={`font-medium ${
                                                selectedRole === role
                                                    ? 'text-primary-700'
                                                    : 'text-gray-900'
                                            }`}
                                        >
                                            {info.label}
                                        </span>
                                        {selectedRole === role && (
                                            <Check size={16} className="text-primary-600" />
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                        {info.description}
                                    </p>
                                </button>
                            )
                        )}
                    </div>
                </div>

                {/* Role Features (read-only) */}
                {roleFeatures.length > 0 && (
                    <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                            <Check size={16} className="text-green-600" />
                            Included in {ROLE_INFO[selectedRole].label} Role
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {roleFeatures.map((feature) => (
                                <div
                                    key={feature}
                                    className="px-2.5 py-1 bg-green-50 text-green-700 rounded-md text-sm"
                                    title={FEATURE_INFO[feature].description}
                                >
                                    {FEATURE_INFO[feature].label}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Extra Access (editable) */}
                {availableExtras.length > 0 && (
                    <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                            <Info size={16} className="text-amber-500" />
                            Grant Extra Access
                            <span className="text-xs font-normal text-gray-400">
                                (beyond role)
                            </span>
                        </div>
                        <div className="space-y-2">
                            {availableExtras.map((feature) => {
                                const isSelected = selectedExtras.has(feature);
                                return (
                                    <label
                                        key={feature}
                                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                            isSelected
                                                ? 'border-amber-300 bg-amber-50'
                                                : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleExtra(feature)}
                                            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                                        />
                                        <div>
                                            <div
                                                className={`text-sm font-medium ${
                                                    isSelected ? 'text-amber-700' : 'text-gray-900'
                                                }`}
                                            >
                                                {FEATURE_INFO[feature].label}
                                            </div>
                                            <div className="text-xs text-gray-500 mt-0.5">
                                                {FEATURE_INFO[feature].description}
                                            </div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Owner note */}
                {selectedRole === 'owner' && (
                    <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                        <Info size={16} className="flex-shrink-0 mt-0.5" />
                        <span>
                            Owners have full access to all features. No extra permissions needed.
                        </span>
                    </div>
                )}
            </div>
        </Modal>
    );
}
