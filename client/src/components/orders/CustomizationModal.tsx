/**
 * CustomizationModal component
 * Modal for adding customization to an order line (e.g., length adjustment, size modification)
 * Generates a custom SKU and marks the line as non-returnable
 */

import { useState, useEffect, useRef } from 'react';
import { X, AlertTriangle, Scissors, Package, Ban } from 'lucide-react';

// Customization type options
export type CustomizationType = 'length' | 'size' | 'measurements' | 'other';

// Customization types available
const CUSTOMIZATION_TYPES: { value: CustomizationType; label: string }[] = [
    { value: 'length', label: 'Length Adjustment' },
    { value: 'size', label: 'Size Modification' },
    { value: 'measurements', label: 'Custom Measurements' },
    { value: 'other', label: 'Other' },
];

// Initial data for edit mode
interface CustomizationInitialData {
    type: CustomizationType;
    value: string;
    notes?: string;
}

interface CustomizationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (data: { type: CustomizationType; value: string; notes?: string }) => void;
    lineData: {
        lineId: string;
        skuCode: string;
        productName: string;
        colorName: string;
        size: string;
        qty: number;
    } | null;
    isSubmitting: boolean;
    /** Edit mode: pre-populate form with existing customization data */
    initialData?: CustomizationInitialData | null;
    /** Edit mode indicator */
    isEditMode?: boolean;
}

export function CustomizationModal({
    isOpen,
    onClose,
    onConfirm,
    lineData,
    isSubmitting,
    initialData,
    isEditMode = false,
}: CustomizationModalProps) {
    const [type, setType] = useState<CustomizationType>('length');
    const [value, setValue] = useState('');
    const [notes, setNotes] = useState('');
    const [confirmed, setConfirmed] = useState(false);

    const valueInputRef = useRef<HTMLInputElement>(null);

    // Reset form when modal opens, or populate with initial data in edit mode
    useEffect(() => {
        if (isOpen) {
            if (isEditMode && initialData) {
                // Edit mode: populate form with existing data
                setType(initialData.type || 'length');
                setValue(initialData.value || '');
                setNotes(initialData.notes || '');
                // In edit mode, pre-check the confirmation since user already agreed before
                setConfirmed(true);
            } else {
                // Create mode: reset form
                setType('length');
                setValue('');
                setNotes('');
                setConfirmed(false);
            }
            // Focus value input after modal opens
            setTimeout(() => valueInputRef.current?.focus(), 100);
        }
    }, [isOpen, isEditMode, initialData]);

    // Handle escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen || !lineData) return null;

    // Generate preview of custom SKU code
    const generateCustomSkuPreview = () => {
        // The actual number will be determined by the backend
        return `${lineData.skuCode}-C??`;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!value.trim() || !confirmed || isSubmitting) return;
        onConfirm({
            type,
            value: value.trim(),
            notes: notes.trim() || undefined,
        });
    };

    const isValid = value.trim().length > 0 && confirmed;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Overlay */}
            <div
                className="absolute inset-0 bg-black/50"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <div className="flex items-center gap-2">
                        <Scissors className="text-orange-500" size={20} />
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                                {isEditMode ? 'Edit Customization' : 'Customize Order Line'}
                            </h2>
                            <p className="text-sm text-gray-500">
                                {lineData.productName} - {lineData.colorName} - {lineData.size}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
                    {/* SKU Info */}
                    <div className="bg-gray-50 rounded-lg p-3">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">Current SKU:</span>
                            <span className="font-mono font-medium">{lineData.skuCode}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm mt-1">
                            <span className="text-gray-500">Quantity:</span>
                            <span className="font-medium">{lineData.qty} units</span>
                        </div>
                    </div>

                    {/* Customization Type */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Customization Type
                        </label>
                        <select
                            value={type}
                            onChange={(e) => setType(e.target.value as CustomizationType)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        >
                            {CUSTOMIZATION_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>
                                    {t.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Customization Value */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Customization Value <span className="text-red-500">*</span>
                        </label>
                        <input
                            ref={valueInputRef}
                            type="text"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder={
                                type === 'length'
                                    ? 'e.g., -2 inches'
                                    : type === 'size'
                                    ? 'e.g., increase waist by 1 inch'
                                    : type === 'measurements'
                                    ? 'e.g., bust: 36, waist: 28'
                                    : 'Describe the customization'
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                            required
                        />
                    </div>

                    {/* Notes */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Production Notes (optional)
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Additional instructions for production team"
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none"
                        />
                    </div>

                    {/* Warning Section */}
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="text-orange-500 flex-shrink-0 mt-0.5" size={18} />
                            <div className="text-sm">
                                <p className="font-medium text-orange-800 mb-2">This will:</p>
                                <ul className="space-y-1.5 text-orange-700">
                                    <li className="flex items-center gap-2">
                                        <Package size={14} />
                                        <span>Generate custom SKU: <span className="font-mono font-medium">{generateCustomSkuPreview()}</span></span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <Scissors size={14} />
                                        <span>Require special production for all {lineData.qty} units</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <Ban size={14} />
                                        <span className="font-semibold">Make ALL units NON-RETURNABLE</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* Confirmation Checkbox */}
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(e) => setConfirmed(e.target.checked)}
                            className="mt-0.5 w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                        />
                        <span className="text-sm text-gray-700">
                            I confirm these items become <span className="font-semibold text-red-600">NON-RETURNABLE</span>
                        </span>
                    </label>
                </form>

                {/* Footer */}
                <div className="px-6 py-4 border-t bg-gray-50 rounded-b-xl flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        onClick={handleSubmit}
                        disabled={!isValid || isSubmitting}
                        className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isSubmitting ? (
                            <>
                                <span className="animate-spin">...</span>
                                {isEditMode ? 'Updating...' : 'Creating...'}
                            </>
                        ) : (
                            <>
                                <Scissors size={16} />
                                {isEditMode ? 'Update Customization' : 'Generate Custom SKU'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default CustomizationModal;
