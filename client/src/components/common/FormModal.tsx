/**
 * Reusable Form Modal Component
 * 
 * Usage:
 * const [isOpen, setIsOpen] = useState(false);
 * const [formData, setFormData] = useState({ name: '', email: '' });
 * 
 * <FormModal
 *     isOpen={isOpen}
 *     onClose={() => setIsOpen(false)}
 *     onSubmit={async (data) => {
 *         await createCustomer(data);
 *     }}
 *     title="Create Customer"
 *     submitText="Create"
 * >
 *     <input
 *         value={formData.name}
 *         onChange={(e) => setFormData({ ...formData, name: e.target.value })}
 *         placeholder="Name"
 *     />
 * </FormModal>
 */

import { useState, FormEvent, ReactNode } from 'react';
import Modal from '../Modal';

interface FormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (e: FormEvent) => void | Promise<void>;
    title: string;
    children: ReactNode;
    submitText?: string;
    cancelText?: string;
    submitVariant?: 'primary' | 'success' | 'warning';
    isLoading?: boolean;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

export default function FormModal({
    isOpen,
    onClose,
    onSubmit,
    title,
    children,
    submitText = 'Save',
    cancelText = 'Cancel',
    submitVariant = 'primary',
    isLoading: externalLoading = false,
    size = 'md',
}: FormModalProps) {
    const [internalLoading, setInternalLoading] = useState(false);
    const isLoading = externalLoading || internalLoading;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setInternalLoading(true);
        try {
            await onSubmit(e);
            onClose();
        } catch (error) {
            console.error('Form submission failed:', error);
            // Don't close modal on error
        } finally {
            setInternalLoading(false);
        }
    };

    const variantStyles = {
        primary: 'bg-blue-600 hover:bg-blue-700 text-white',
        success: 'bg-green-600 hover:bg-green-700 text-white',
        warning: 'bg-yellow-600 hover:bg-yellow-700 text-white',
    };

    const sizeStyles = {
        sm: 'max-w-md',
        md: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <form onSubmit={handleSubmit} className={`p-6 ${sizeStyles[size]}`}>
                <h2 className="text-xl font-semibold text-gray-900 mb-6">
                    {title}
                </h2>

                <div className="space-y-4 mb-6">
                    {children}
                </div>

                <div className="flex gap-3 justify-end border-t pt-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isLoading}
                        className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {cancelText}
                    </button>
                    <button
                        type="submit"
                        disabled={isLoading}
                        className={`px-4 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[submitVariant]}`}
                    >
                        {isLoading ? 'Saving...' : submitText}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
