/**
 * Create User Modal
 * Collects name, email, phone, and role. Password is auto-generated server-side
 * and emailed to the user + admin.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Copy } from 'lucide-react';
import Modal from '../Modal';
import { createUser } from '../../server/functions/admin';
import type { Role } from '../../types';

interface CreateUserModalProps {
    isOpen: boolean;
    onClose: () => void;
    roles: Role[];
}

export default function CreateUserModal({ isOpen, onClose, roles }: CreateUserModalProps) {
    const queryClient = useQueryClient();

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        roleId: '',
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const createUserMutation = useMutation({
        mutationFn: async (data: { email: string; name: string; phone: string; roleId?: string }) => {
            const response = await createUser({
                data: {
                    email: data.email,
                    name: data.name,
                    phone: data.phone,
                    roleId: data.roleId || null,
                },
            });
            if (!response.success) {
                throw new Error(response.error?.message || 'Failed to create user');
            }
            return response.data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            // Show generated password before closing
            if (data && 'generatedPassword' in data) {
                setGeneratedPassword((data as { generatedPassword: string }).generatedPassword);
            }
        },
        onError: (error: Error) => {
            setErrors({ submit: error.message || 'Failed to create user' });
        },
    });

    const handleClose = () => {
        setFormData({ name: '', email: '', phone: '', roleId: '' });
        setErrors({});
        setGeneratedPassword(null);
        setCopied(false);
        onClose();
    };

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!formData.name.trim()) {
            newErrors.name = 'Name is required';
        }

        if (!formData.email.trim()) {
            newErrors.email = 'Email is required';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            newErrors.email = 'Invalid email format';
        }

        const cleanPhone = formData.phone.replace(/\D/g, '');
        if (!cleanPhone) {
            newErrors.phone = 'Phone number is required';
        } else if (cleanPhone.length !== 10 && cleanPhone.length !== 12) {
            newErrors.phone = 'Enter a 10-digit phone number';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) return;

        createUserMutation.mutate({
            name: formData.name.trim(),
            email: formData.email.trim().toLowerCase(),
            phone: formData.phone.trim(),
            roleId: formData.roleId || undefined,
        });
    };

    const handleCopyPassword = async () => {
        if (!generatedPassword) return;
        await navigator.clipboard.writeText(generatedPassword);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Success state — show generated password
    if (generatedPassword) {
        return (
            <Modal
                isOpen={isOpen}
                onClose={handleClose}
                title="User Created"
                subtitle="Login credentials have been emailed"
                size="md"
                footer={
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800"
                        >
                            Done
                        </button>
                    </div>
                }
            >
                <div className="space-y-4">
                    <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                        <CheckCircle2 size={16} />
                        User created successfully. Credentials emailed to {formData.email} and admin.
                    </div>

                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                        <p className="text-xs text-gray-500 mb-2">Auto-generated password</p>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 text-lg font-mono bg-white px-3 py-2 rounded border border-gray-200">
                                {generatedPassword}
                            </code>
                            <button
                                type="button"
                                onClick={handleCopyPassword}
                                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                title="Copy password"
                            >
                                {copied ? <CheckCircle2 size={18} className="text-green-600" /> : <Copy size={18} />}
                            </button>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                            User can also log in via WhatsApp OTP using their phone number.
                        </p>
                    </div>
                </div>
            </Modal>
        );
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title="Create New User"
            subtitle="A password will be auto-generated and emailed"
            size="md"
            footer={
                <div className="flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={handleClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        form="create-user-form"
                        disabled={createUserMutation.isPending}
                        className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50"
                    >
                        {createUserMutation.isPending ? 'Creating...' : 'Create User'}
                    </button>
                </div>
            }
        >
            <form id="create-user-form" onSubmit={handleSubmit} className="space-y-4">
                {/* Error Banner */}
                {errors.submit && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                        <AlertCircle size={16} />
                        {errors.submit}
                    </div>
                )}

                {/* Name */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Full Name
                    </label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent ${
                            errors.name ? 'border-red-300' : 'border-gray-300'
                        }`}
                        placeholder="Pallavi Desai"
                    />
                    {errors.name && (
                        <p className="mt-1 text-xs text-red-600">{errors.name}</p>
                    )}
                </div>

                {/* Email */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email Address
                    </label>
                    <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent ${
                            errors.email ? 'border-red-300' : 'border-gray-300'
                        }`}
                        placeholder="name@creaturesofhabit.in"
                    />
                    {errors.email && (
                        <p className="mt-1 text-xs text-red-600">{errors.email}</p>
                    )}
                </div>

                {/* Phone */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Phone Number
                    </label>
                    <div className="flex">
                        <span className="inline-flex items-center px-3 text-sm text-gray-500 bg-gray-50 border border-r-0 border-gray-300 rounded-l-lg">
                            +91
                        </span>
                        <input
                            type="tel"
                            value={formData.phone}
                            onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                                setFormData({ ...formData, phone: val });
                            }}
                            className={`flex-1 px-3 py-2 border rounded-r-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent ${
                                errors.phone ? 'border-red-300' : 'border-gray-300'
                            }`}
                            placeholder="9876543210"
                            maxLength={10}
                        />
                    </div>
                    {errors.phone && (
                        <p className="mt-1 text-xs text-red-600">{errors.phone}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-500">
                        Used for WhatsApp OTP login
                    </p>
                </div>

                {/* Role Selection */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Role
                    </label>
                    <select
                        value={formData.roleId}
                        onChange={(e) => setFormData({ ...formData, roleId: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                        <option value="">Select a role...</option>
                        {roles.map((role) => (
                            <option key={role.id} value={role.id}>
                                {role.displayName} - {role.description}
                            </option>
                        ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                        Role determines default permissions. Can be customized later.
                    </p>
                </div>
            </form>
        </Modal>
    );
}
