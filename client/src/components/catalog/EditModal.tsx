/**
 * EditModal Component
 *
 * Modal for editing SKU, Variation, or Product data.
 * Displays appropriate fields based on edit level.
 *
 * NOTE: Fabric assignment is now managed via BOM Editor, not this modal.
 * FabricType and Fabric fields have been removed as part of fabric system consolidation.
 */

import { useState, useEffect } from 'react';
import { FormModal } from '../Modal';

type EditLevel = 'sku' | 'variation' | 'product';

export interface EditModalProps {
    isOpen: boolean;
    level: EditLevel;
    data: any;
    onClose: () => void;
    onSubmit: (formData: any) => void;
    // Legacy props - kept for backward compatibility but no longer used
    fabricTypes?: Array<{ id: string; name: string }>;
    fabrics?: Array<{ id: string; name: string; colorName: string; fabricTypeId: string | null; displayName: string }>;
    isLoading: boolean;
}

export function EditModal({
    isOpen,
    level,
    data,
    onClose,
    onSubmit,
    isLoading
}: EditModalProps) {
    const [formData, setFormData] = useState<any>({});

    // Reset form when data changes
    // NOTE: fabricId and fabricTypeId removed - fabric is now managed via BOM Editor
    useEffect(() => {
        if (data) {
            if (level === 'sku') {
                setFormData({
                    fabricConsumption: data.fabricConsumption || '',
                    mrp: data.mrp || '',
                    targetStockQty: data.targetStockQty || '',
                });
            } else if (level === 'variation') {
                setFormData({
                    colorName: data.colorName || '',
                    hasLining: data.hasLining || false,
                });
            } else if (level === 'product') {
                setFormData({
                    name: data.productName || '',
                    styleCode: data.styleCode || '',
                    category: data.category || '',
                    gender: data.gender || '',
                    productType: data.productType || '',
                });
            }
        }
    }, [data, level]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
    };

    const handleChange = (field: string, value: any) => {
        setFormData((prev: any) => ({ ...prev, [field]: value }));
    };

    const getTitle = () => {
        if (level === 'sku') return `Edit SKU: ${data?.skuCode}`;
        if (level === 'variation') return `Edit Color: ${data?.colorName}`;
        return `Edit Product: ${data?.productName}`;
    };

    const getSubtitle = () => {
        if (level === 'sku') return `${data?.productName} - ${data?.colorName} - ${data?.size}`;
        if (level === 'variation') return data?.productName;
        return data?.styleCode || '';
    };

    return (
        <FormModal
            isOpen={isOpen}
            onClose={onClose}
            onSubmit={handleSubmit}
            title={getTitle()}
            subtitle={getSubtitle()}
            size="md"
            isLoading={isLoading}
        >
            <div className="space-y-4">
                {level === 'sku' && (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Fabric Consumption (m)
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.fabricConsumption}
                                onChange={(e) => handleChange('fabricConsumption', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">MRP (₹)</label>
                            <input
                                type="number"
                                step="1"
                                value={formData.mrp}
                                onChange={(e) => handleChange('mrp', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Target Stock Qty</label>
                            <input
                                type="number"
                                step="1"
                                value={formData.targetStockQty}
                                onChange={(e) => handleChange('targetStockQty', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                    </>
                )}

                {level === 'variation' && (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Color Name</label>
                            <input
                                type="text"
                                value={formData.colorName}
                                onChange={(e) => handleChange('colorName', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Has Lining</label>
                            <div className="flex items-center gap-4 mt-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="hasLining"
                                        checked={formData.hasLining === true}
                                        onChange={() => handleChange('hasLining', true)}
                                        className="text-blue-600"
                                    />
                                    <span className="text-sm">Yes</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="hasLining"
                                        checked={formData.hasLining === false}
                                        onChange={() => handleChange('hasLining', false)}
                                        className="text-blue-600"
                                    />
                                    <span className="text-sm">No</span>
                                </label>
                            </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                            Fabric is assigned via BOM Editor
                        </p>
                    </>
                )}

                {level === 'product' && (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => handleChange('name', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Style Code</label>
                            <input
                                type="text"
                                value={formData.styleCode}
                                onChange={(e) => handleChange('styleCode', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                                <select
                                    value={formData.category}
                                    onChange={(e) => handleChange('category', e.target.value)}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                                >
                                    <option value="dress">Dress</option>
                                    <option value="top">Top</option>
                                    <option value="bottom">Bottom</option>
                                    <option value="outerwear">Outerwear</option>
                                    <option value="accessory">Accessory</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                                <select
                                    value={formData.gender}
                                    onChange={(e) => handleChange('gender', e.target.value)}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                                >
                                    <option value="womens">Womens</option>
                                    <option value="mens">Mens</option>
                                    <option value="unisex">Unisex</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Product Type</label>
                            <select
                                value={formData.productType}
                                onChange={(e) => handleChange('productType', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            >
                                <option value="basic">Basic</option>
                                <option value="seasonal">Seasonal</option>
                                <option value="limited">Limited</option>
                            </select>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                            Fabric is assigned at variation level via BOM Editor
                        </p>
                    </>
                )}
            </div>
        </FormModal>
    );
}
