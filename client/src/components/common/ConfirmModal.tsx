/**
 * Reusable Confirm Modal Component
 * 
 * Usage:
 * const [isOpen, setIsOpen] = useState(false);
 * 
 * <ConfirmModal
 *     isOpen={isOpen}
 *     onClose={() => setIsOpen(false)}
 *     onConfirm={async () => {
 *         await deleteOrder(orderId);
 *     }}
 *     title="Delete Order"
 *     message="Are you sure you want to delete this order? This action cannot be undone."
 *     confirmText="Delete"
 *     confirmVariant="danger"
 * />
 */

import { useState } from 'react';
import Modal from '../Modal';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: 'danger' | 'primary' | 'warning';
    isLoading?: boolean;
}

export default function ConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    confirmVariant = 'primary',
    isLoading: externalLoading = false,
}: ConfirmModalProps) {
    const [internalLoading, setInternalLoading] = useState(false);
    const isLoading = externalLoading || internalLoading;

    const handleConfirm = async () => {
        setInternalLoading(true);
        try {
            await onConfirm();
            onClose();
        } catch (error) {
            console.error('Confirm action failed:', error);
            // Don't close modal on error
        } finally {
            setInternalLoading(false);
        }
    };

    const variantStyles = {
        danger: 'bg-red-600 hover:bg-red-700 text-white',
        primary: 'bg-blue-600 hover:bg-blue-700 text-white',
        warning: 'bg-yellow-600 hover:bg-yellow-700 text-white',
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <div className="py-2">
                <p className="text-gray-600 mb-6 whitespace-pre-line">
                    {message}
                </p>

                <div className="flex gap-3 justify-end">
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={isLoading}
                        className={`px-4 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[confirmVariant]}`}
                    >
                        {isLoading ? 'Processing...' : confirmText}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
