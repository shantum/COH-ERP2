/**
 * User Management Page
 * Allows admins to view, create, and manage users and their roles
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Search, UserPlus, Shield, Users, Check, X as XIcon } from 'lucide-react';
import { adminApi } from '../services/api';
import { compactTheme, formatDateWithYear, formatRelativeTime } from '../utils/agGridHelpers';
import { usePermissions } from '../hooks/usePermissions';
import { PermissionGate, AccessDenied } from '../components/PermissionGate';
import type { User, Role } from '../types';
import CreateUserModal from '../components/admin/CreateUserModal';
import PermissionEditorModal from '../components/admin/PermissionEditorModal';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// Status badge component
function StatusBadge({ isActive }: { isActive: boolean }) {
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
            isActive
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
        }`}>
            {isActive ? <Check size={12} /> : <XIcon size={12} />}
            {isActive ? 'Active' : 'Inactive'}
        </span>
    );
}

// Role badge component
function RoleBadge({ roleName }: { roleName: string | null }) {
    const roleColors: Record<string, string> = {
        'Owner': 'bg-purple-100 text-purple-700',
        'Manager': 'bg-blue-100 text-blue-700',
        'Operations': 'bg-emerald-100 text-emerald-700',
        'Warehouse': 'bg-amber-100 text-amber-700',
        'Production': 'bg-orange-100 text-orange-700',
        'Accounts': 'bg-cyan-100 text-cyan-700',
        'Viewer': 'bg-gray-100 text-gray-600',
    };

    const colorClass = roleColors[roleName || ''] || 'bg-gray-100 text-gray-600';

    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
            <Shield size={12} />
            {roleName || 'No Role'}
        </span>
    );
}

export default function UserManagement() {
    const queryClient = useQueryClient();
    const gridRef = useRef<AgGridReact>(null);
    const { hasPermission } = usePermissions();

    // State
    const [searchInput, setSearchInput] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);

    // Check permission to view this page
    if (!hasPermission('users:view')) {
        return (
            <div className="p-8">
                <AccessDenied message="You do not have permission to manage users." />
            </div>
        );
    }

    // Fetch users
    const { data: users, isLoading: usersLoading } = useQuery({
        queryKey: ['admin-users'],
        queryFn: () => adminApi.getUsers().then(r => r.data),
    });

    // Fetch roles for dropdown
    const { data: roles } = useQuery({
        queryKey: ['admin-roles'],
        queryFn: () => adminApi.getRoles().then(r => r.data),
    });

    // Update user role mutation
    const updateRoleMutation = useMutation({
        mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
            adminApi.assignUserRole(userId, roleId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
        },
    });

    // Update user status mutation
    const updateUserMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: { isActive?: boolean } }) =>
            adminApi.updateUser(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
        },
    });

    // Apply quick filter when search input changes
    useEffect(() => {
        const timer = setTimeout(() => {
            gridRef.current?.api?.setGridOption('quickFilterText', searchInput);
        }, 150);
        return () => clearTimeout(timer);
    }, [searchInput]);

    // Column definitions
    const columnDefs = useMemo<ColDef<User>[]>(() => [
        {
            field: 'name',
            headerName: 'Name',
            flex: 1,
            minWidth: 150,
            cellRenderer: (params: ICellRendererParams<User>) => {
                if (!params.data) return null;
                return (
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
                            {params.data.name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div>
                            <div className="font-medium text-gray-900">{params.data.name}</div>
                        </div>
                    </div>
                );
            },
        },
        {
            field: 'email',
            headerName: 'Email',
            flex: 1.5,
            minWidth: 200,
        },
        {
            field: 'roleName',
            headerName: 'Role',
            width: 150,
            cellRenderer: (params: ICellRendererParams<User>) => {
                if (!params.data) return null;
                const user = params.data;

                // Show dropdown only if user has edit permission
                if (hasPermission('users:edit') && roles?.length) {
                    return (
                        <select
                            value={user.roleId || ''}
                            onChange={(e) => {
                                if (e.target.value) {
                                    updateRoleMutation.mutate({
                                        userId: user.id,
                                        roleId: e.target.value,
                                    });
                                }
                            }}
                            className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <option value="">Select role...</option>
                            {roles.map((role: Role) => (
                                <option key={role.id} value={role.id}>
                                    {role.displayName}
                                </option>
                            ))}
                        </select>
                    );
                }

                return <RoleBadge roleName={user.roleName || null} />;
            },
        },
        {
            field: 'isActive',
            headerName: 'Status',
            width: 100,
            cellRenderer: (params: ICellRendererParams<User>) => {
                if (!params.data) return null;
                return <StatusBadge isActive={params.data.isActive} />;
            },
        },
        {
            field: 'createdAt',
            headerName: 'Created',
            width: 130,
            valueFormatter: (params) => formatDateWithYear(params.value),
        },
        {
            field: 'lastLoginAt',
            headerName: 'Last Login',
            width: 120,
            valueFormatter: (params) => params.value ? formatRelativeTime(params.value) : 'Never',
        },
        {
            colId: 'actions',
            headerName: '',
            width: 80,
            sortable: false,
            pinned: 'right' as const,
            cellRenderer: (params: ICellRendererParams<User>) => {
                if (!params.data) return null;
                const user = params.data;

                return (
                    <div className="flex items-center gap-1">
                        <PermissionGate permission="users:edit">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedUser(user);
                                }}
                                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                                title="Edit permissions"
                            >
                                <Shield size={16} />
                            </button>
                        </PermissionGate>
                        <PermissionGate permission="users:edit">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    updateUserMutation.mutate({
                                        id: user.id,
                                        data: { isActive: !user.isActive },
                                    });
                                }}
                                className={`p-1.5 rounded ${
                                    user.isActive
                                        ? 'text-red-500 hover:text-red-700 hover:bg-red-50'
                                        : 'text-green-500 hover:text-green-700 hover:bg-green-50'
                                }`}
                                title={user.isActive ? 'Deactivate' : 'Activate'}
                            >
                                {user.isActive ? <XIcon size={16} /> : <Check size={16} />}
                            </button>
                        </PermissionGate>
                    </div>
                );
            },
        },
    ], [roles, hasPermission, updateRoleMutation, updateUserMutation]);

    // Stats
    const stats = useMemo(() => {
        if (!users) return { total: 0, active: 0, inactive: 0 };
        return {
            total: users.length,
            active: users.filter((u: User) => u.isActive).length,
            inactive: users.filter((u: User) => !u.isActive).length,
        };
    }, [users]);

    return (
        <div className="space-y-4 md:space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-gray-900">User Management</h1>
                    <p className="text-sm text-gray-500 mt-1">Manage users and their roles</p>
                </div>
                <PermissionGate permission="users:create">
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                    >
                        <UserPlus size={18} />
                        <span>Add User</span>
                    </button>
                </PermissionGate>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                            <Users size={20} className="text-gray-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                            <p className="text-sm text-gray-500">Total Users</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                            <Check size={20} className="text-green-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{stats.active}</p>
                            <p className="text-sm text-gray-500">Active</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                            <XIcon size={20} className="text-gray-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{stats.inactive}</p>
                            <p className="text-sm text-gray-500">Inactive</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Search Bar */}
            <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search users..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-gray-50 border-0 rounded-lg text-sm focus:ring-2 focus:ring-gray-200 focus:bg-white transition-all"
                    />
                </div>
            </div>

            {/* Users Grid */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div style={{ height: 'calc(100vh - 380px)', minHeight: '400px' }}>
                    <AgGridReact
                        ref={gridRef}
                        theme={compactTheme}
                        rowData={users || []}
                        columnDefs={columnDefs}
                        loading={usersLoading}
                        defaultColDef={{
                            sortable: true,
                            resizable: true,
                        }}
                        rowSelection="single"
                        onRowClicked={(e) => {
                            if (hasPermission('users:edit') && e.data) {
                                setSelectedUser(e.data);
                            }
                        }}
                        suppressCellFocus
                        animateRows
                    />
                </div>
            </div>

            {/* Create User Modal */}
            {showCreateModal && (
                <CreateUserModal
                    isOpen={showCreateModal}
                    onClose={() => setShowCreateModal(false)}
                    roles={roles || []}
                />
            )}

            {/* Permission Editor Modal */}
            {selectedUser && (
                <PermissionEditorModal
                    isOpen={!!selectedUser}
                    onClose={() => setSelectedUser(null)}
                    user={selectedUser}
                    roles={roles || []}
                />
            )}
        </div>
    );
}
