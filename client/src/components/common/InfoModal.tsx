/**
 * Reusable Info Modal Component
 * For displaying read-only information, help text, or details
 * 
 * Usage:
 * const [isOpen, setIsOpen] = useState(false);
 * 
 * <InfoModal
 *     isOpen={isOpen}
 *     onClose={() => setIsOpen(false)}
 *     title="Order Details"
 * >
 *     <div>
 *         <p>Order Number: {order.orderNumber}</p>
 *         <p>Customer: {order.customerName}</p>
 *     </div>
 * </InfoModal>
 */

import { ReactNode } from 'react';
import Modal from '../Modal';

interface InfoModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    closeText?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

export default function InfoModal({
    isOpen,
    onClose,
    title,
    children,
    closeText = 'Close',
    size = 'md',
}: InfoModalProps) {
    const sizeStyles = {
        sm: 'max-w-md',
        md: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <div className={`p-6 ${sizeStyles[size]}`}>
                <h2 className="text-xl font-semibold text-gray-900 mb-6">
                    {title}
                </h2>

                <div className="text-gray-700 mb-6">
                    {children}
                </div>

                <div className="flex justify-end border-t pt-4">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md"
                    >
                        {closeText}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
