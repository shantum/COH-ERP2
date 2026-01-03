/**
 * GeneralTab component
 * Handles password change, user management, and order channels
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, authApi } from '../../../services/api';
import { useAuth } from '../../../hooks/useAuth';
import {
    Lock, Users, UserPlus, Edit2, Shield, Trash2, RefreshCw, Plus, X,
    ShoppingCart, CheckCircle
} from 'lucide-react';

export function GeneralTab() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const [newChannel, setNewChannel] = useState({ id: '', name: '' });

    // Password change state
    const [passwordData, setPasswordData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const [passwordError, setPasswordError] = useState('');
    const [passwordSuccess, setPasswordSuccess] = useState('');

    // User management state
    const [showAddUser, setShowAddUser] = useState(false);
    const [editingUser, setEditingUser] = useState<any>(null);
    const [newUser, setNewUser] = useState({ email: '', password: '', name: '', role: 'staff' });

    const { data: channels, isLoading } = useQuery({
        queryKey: ['orderChannels'],
        queryFn: () => adminApi.getChannels().then(r => r.data),
    });

    const { data: users, isLoading: usersLoading } = useQuery({
        queryKey: ['users'],
        queryFn: () => adminApi.getUsers().then(r => r.data),
        enabled: user?.role === 'admin',
    });

    const updateChannelsMutation = useMutation({
        mutationFn: (channels: { id: string; name: string }[]) => adminApi.updateChannels(channels),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orderChannels'] });
        },
    });

    const changePasswordMutation = useMutation({
        mutationFn: (data: { currentPassword: string; newPassword: string }) => authApi.changePassword(data),
        onSuccess: () => {
            setPasswordSuccess('Password changed successfully!');
            setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
            setPasswordError('');
        },
        onError: (error: any) => {
            setPasswordError(error.response?.data?.error || 'Failed to change password');
            setPasswordSuccess('');
        },
    });

    const createUserMutation = useMutation({
        mutationFn: (data: { email: string; password: string; name: string; role: string }) =>
            adminApi.createUser(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setShowAddUser(false);
            setNewUser({ email: '', password: '', name: '', role: 'staff' });
        },
        onError: (error: any) => {
            alert(error.response?.data?.error || 'Failed to create user');
        },
    });

    const updateUserMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => adminApi.updateUser(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setEditingUser(null);
        },
        onError: (error: any) => {
            alert(error.response?.data?.error || 'Failed to update user');
        },
    });

    const deleteUserMutation = useMutation({
        mutationFn: (id: string) => adminApi.deleteUser(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
        },
        onError: (error: any) => {
            alert(error.response?.data?.error || 'Failed to delete user');
        },
    });

    const validatePasswordStrength = (password: string) => {
        const errors = [];
        if (password.length < 8) errors.push('At least 8 characters');
        if (!/[A-Z]/.test(password)) errors.push('One uppercase letter');
        if (!/[a-z]/.test(password)) errors.push('One lowercase letter');
        if (!/[0-9]/.test(password)) errors.push('One number');
        if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push('One special character');
        return errors;
    };

    const handleChangePassword = () => {
        setPasswordError('');
        setPasswordSuccess('');

        if (!passwordData.currentPassword || !passwordData.newPassword) {
            setPasswordError('All fields are required');
            return;
        }
        if (passwordData.newPassword !== passwordData.confirmPassword) {
            setPasswordError('New passwords do not match');
            return;
        }

        const passwordErrors = validatePasswordStrength(passwordData.newPassword);
        if (passwordErrors.length > 0) {
            setPasswordError('Password requirements: ' + passwordErrors.join(', '));
            return;
        }

        changePasswordMutation.mutate({
            currentPassword: passwordData.currentPassword,
            newPassword: passwordData.newPassword,
        });
    };

    const addChannel = () => {
        if (!newChannel.id || !newChannel.name) {
            alert('Both ID and Name are required');
            return;
        }
        const channelId = newChannel.id.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        if (channels?.some((c: any) => c.id === channelId)) {
            alert('Channel ID already exists');
            return;
        }
        const updatedChannels = [...(channels || []), { id: channelId, name: newChannel.name }];
        updateChannelsMutation.mutate(updatedChannels);
        setNewChannel({ id: '', name: '' });
    };

    const removeChannel = (id: string) => {
        if (!confirm('Remove this channel?')) return;
        const updatedChannels = channels?.filter((c: any) => c.id !== id) || [];
        updateChannelsMutation.mutate(updatedChannels);
    };

    return (
        <div className="space-y-6">
            {/* Change Password */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Lock size={20} /> Change Password
                </h2>

                <div className="max-w-md space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
                        <input
                            type="password"
                            className="input"
                            value={passwordData.currentPassword}
                            onChange={(e) => setPasswordData(d => ({ ...d, currentPassword: e.target.value }))}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                        <input
                            type="password"
                            className="input"
                            value={passwordData.newPassword}
                            onChange={(e) => setPasswordData(d => ({ ...d, newPassword: e.target.value }))}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Min 8 chars with uppercase, lowercase, number & special character
                        </p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                        <input
                            type="password"
                            className="input"
                            value={passwordData.confirmPassword}
                            onChange={(e) => setPasswordData(d => ({ ...d, confirmPassword: e.target.value }))}
                        />
                    </div>

                    {passwordError && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                            {passwordError}
                        </div>
                    )}
                    {passwordSuccess && (
                        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex items-center gap-2">
                            <CheckCircle size={16} /> {passwordSuccess}
                        </div>
                    )}

                    <button
                        onClick={handleChangePassword}
                        className="btn btn-primary"
                        disabled={changePasswordMutation.isPending}
                    >
                        {changePasswordMutation.isPending ? 'Changing...' : 'Change Password'}
                    </button>
                </div>
            </div>

            {/* User Management (Admin only) */}
            {user?.role === 'admin' && (
                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <Users size={20} /> User Management
                        </h2>
                        <button
                            onClick={() => setShowAddUser(true)}
                            className="btn btn-primary flex items-center gap-2"
                        >
                            <UserPlus size={16} /> Add User
                        </button>
                    </div>

                    {usersLoading ? (
                        <div className="flex justify-center p-4">
                            <RefreshCw size={24} className="animate-spin text-gray-400" />
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-4 py-2 text-left">Name</th>
                                        <th className="px-4 py-2 text-left">Email</th>
                                        <th className="px-4 py-2 text-left">Role</th>
                                        <th className="px-4 py-2 text-left">Status</th>
                                        <th className="px-4 py-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users?.map((u: any) => (
                                        <tr key={u.id} className="border-t">
                                            <td className="px-4 py-3 font-medium">{u.name}</td>
                                            <td className="px-4 py-3">{u.email}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                    u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                                                }`}>
                                                    {u.role === 'admin' && <Shield size={12} className="inline mr-1" />}
                                                    {u.role}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 rounded-full text-xs ${
                                                    u.isActive !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                                }`}>
                                                    {u.isActive !== false ? 'Active' : 'Disabled'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    onClick={() => setEditingUser(u)}
                                                    className="text-blue-600 hover:text-blue-800 mr-3"
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                                {u.id !== user?.id && (
                                                    <button
                                                        onClick={() => {
                                                            if (confirm(`Delete user ${u.name}?`)) {
                                                                deleteUserMutation.mutate(u.id);
                                                            }
                                                        }}
                                                        className="text-red-600 hover:text-red-800"
                                                        disabled={deleteUserMutation.isPending}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Add User Modal */}
                    {showAddUser && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                            <div className="bg-white rounded-lg p-6 w-full max-w-md">
                                <h3 className="text-lg font-semibold mb-4">Add New User</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                                        <input
                                            type="text"
                                            className="input"
                                            value={newUser.name}
                                            onChange={(e) => setNewUser(u => ({ ...u, name: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                        <input
                                            type="email"
                                            className="input"
                                            value={newUser.email}
                                            onChange={(e) => setNewUser(u => ({ ...u, email: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                                        <input
                                            type="password"
                                            className="input"
                                            value={newUser.password}
                                            onChange={(e) => setNewUser(u => ({ ...u, password: e.target.value }))}
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Min 8 chars with uppercase, lowercase, number & special character
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                                        <select
                                            className="input"
                                            value={newUser.role}
                                            onChange={(e) => setNewUser(u => ({ ...u, role: e.target.value }))}
                                        >
                                            <option value="staff">Staff</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="flex justify-end gap-2 mt-6">
                                    <button
                                        onClick={() => setShowAddUser(false)}
                                        className="btn btn-secondary"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => createUserMutation.mutate(newUser)}
                                        className="btn btn-primary"
                                        disabled={createUserMutation.isPending || !newUser.email || !newUser.password || !newUser.name}
                                    >
                                        {createUserMutation.isPending ? 'Creating...' : 'Create User'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Edit User Modal */}
                    {editingUser && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                            <div className="bg-white rounded-lg p-6 w-full max-w-md">
                                <h3 className="text-lg font-semibold mb-4">Edit User</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                                        <input
                                            type="text"
                                            className="input"
                                            value={editingUser.name}
                                            onChange={(e) => setEditingUser((u: any) => ({ ...u, name: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                        <input
                                            type="email"
                                            className="input"
                                            value={editingUser.email}
                                            onChange={(e) => setEditingUser((u: any) => ({ ...u, email: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">New Password (leave blank to keep current)</label>
                                        <input
                                            type="password"
                                            className="input"
                                            value={editingUser.newPassword || ''}
                                            onChange={(e) => setEditingUser((u: any) => ({ ...u, newPassword: e.target.value }))}
                                            placeholder="Enter new password"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Min 8 chars with uppercase, lowercase, number & special character
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                                        <select
                                            className="input"
                                            value={editingUser.role}
                                            onChange={(e) => setEditingUser((u: any) => ({ ...u, role: e.target.value }))}
                                        >
                                            <option value="staff">Staff</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            id="userActive"
                                            checked={editingUser.isActive !== false}
                                            onChange={(e) => setEditingUser((u: any) => ({ ...u, isActive: e.target.checked }))}
                                            className="rounded border-gray-300"
                                        />
                                        <label htmlFor="userActive" className="text-sm text-gray-700">Active</label>
                                    </div>
                                </div>
                                <div className="flex justify-end gap-2 mt-6">
                                    <button
                                        onClick={() => setEditingUser(null)}
                                        className="btn btn-secondary"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => {
                                            const updateData: any = {
                                                name: editingUser.name,
                                                email: editingUser.email,
                                                role: editingUser.role,
                                                isActive: editingUser.isActive,
                                            };
                                            if (editingUser.newPassword) {
                                                updateData.password = editingUser.newPassword;
                                            }
                                            updateUserMutation.mutate({ id: editingUser.id, data: updateData });
                                        }}
                                        className="btn btn-primary"
                                        disabled={updateUserMutation.isPending}
                                    >
                                        {updateUserMutation.isPending ? 'Saving...' : 'Save Changes'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Order Channels */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <ShoppingCart size={20} /> Order Channels
                </h2>
                <p className="text-sm text-gray-600 mb-4">
                    Configure the sales channels available when creating new orders.
                </p>

                {isLoading ? (
                    <div className="flex justify-center p-4">
                        <RefreshCw size={24} className="animate-spin text-gray-400" />
                    </div>
                ) : (
                    <>
                        {/* Current Channels */}
                        <div className="space-y-2 mb-4">
                            {channels?.map((channel: any) => (
                                <div key={channel.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                    <div>
                                        <span className="font-medium text-gray-900">{channel.name}</span>
                                        <span className="ml-2 text-xs text-gray-500 font-mono">({channel.id})</span>
                                    </div>
                                    <button
                                        onClick={() => removeChannel(channel.id)}
                                        className="text-gray-400 hover:text-red-500"
                                        disabled={updateChannelsMutation.isPending}
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                            ))}
                            {(!channels || channels.length === 0) && (
                                <p className="text-gray-500 text-sm py-4 text-center">No channels configured</p>
                            )}
                        </div>

                        {/* Add New Channel */}
                        <div className="border-t pt-4">
                            <p className="text-sm font-medium text-gray-700 mb-2">Add New Channel</p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    className="input flex-1"
                                    placeholder="Channel name (e.g., Instagram)"
                                    value={newChannel.name}
                                    onChange={(e) => setNewChannel(c => ({
                                        ...c,
                                        name: e.target.value,
                                        id: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
                                    }))}
                                />
                                <input
                                    type="text"
                                    className="input w-32 font-mono text-sm"
                                    placeholder="ID"
                                    value={newChannel.id}
                                    onChange={(e) => setNewChannel(c => ({ ...c, id: e.target.value }))}
                                />
                                <button
                                    onClick={addChannel}
                                    className="btn btn-primary flex items-center gap-1"
                                    disabled={updateChannelsMutation.isPending || !newChannel.name}
                                >
                                    <Plus size={16} /> Add
                                </button>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                ID is auto-generated from name, but can be customized
                            </p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default GeneralTab;
