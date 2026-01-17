/**
 * ProductDetail - Detail panel for Product level
 *
 * Shows tabs:
 * - Info: Basic product information with edit capability
 * - BOM: Bill of materials template (trims, services)
 * - Costs: Cost breakdown and cascade
 * - SKUs: All SKUs with inventory
 */

import { useState } from 'react';
import { Package, FileText, DollarSign, Box, Edit, Save, X } from 'lucide-react';
import type { ProductTreeNode } from '../types';
import { ProductInfoTab } from './ProductInfoTab';
import { ProductSkusTab } from './ProductSkusTab';

interface ProductDetailProps {
    product: ProductTreeNode;
    onEdit?: (product: ProductTreeNode) => void;
    onClose?: () => void;
}

type TabType = 'info' | 'bom' | 'costs' | 'skus';

const TABS: { id: TabType; label: string; icon: typeof Package }[] = [
    { id: 'info', label: 'Info', icon: FileText },
    { id: 'bom', label: 'BOM', icon: Package },
    { id: 'costs', label: 'Costs', icon: DollarSign },
    { id: 'skus', label: 'SKUs', icon: Box },
];

export function ProductDetail({ product, onEdit, onClose }: ProductDetailProps) {
    const [activeTab, setActiveTab] = useState<TabType>('info');
    const [isEditing, setIsEditing] = useState(false);

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                <div className="flex items-center gap-3">
                    <Package size={20} className="text-blue-600" />
                    <div>
                        <h3 className="font-medium text-gray-900">{product.name}</h3>
                        <p className="text-xs text-gray-500">
                            {product.styleCode || 'No style code'} • {product.category}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isEditing ? (
                        <>
                            <button
                                onClick={() => setIsEditing(false)}
                                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
                                title="Cancel"
                            >
                                <X size={16} />
                            </button>
                            <button
                                onClick={() => setIsEditing(false)}
                                className="p-1.5 text-green-600 hover:text-green-700 hover:bg-green-50 rounded transition-colors"
                                title="Save"
                            >
                                <Save size={16} />
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
                            title="Edit"
                        >
                            <Edit size={16} />
                        </button>
                    )}
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
                            title="Close"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b px-4">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === tab.id
                                ? 'border-primary-500 text-primary-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        <tab.icon size={14} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-auto p-4">
                {activeTab === 'info' && (
                    <ProductInfoTab product={product} isEditing={isEditing} />
                )}
                {activeTab === 'bom' && (
                    <BomPlaceholder />
                )}
                {activeTab === 'costs' && (
                    <CostsPlaceholder product={product} />
                )}
                {activeTab === 'skus' && (
                    <ProductSkusTab product={product} />
                )}
            </div>
        </div>
    );
}

// Placeholder for BOM tab (Phase 3)
function BomPlaceholder() {
    return (
        <div className="text-center py-12">
            <Package size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm text-gray-500">BOM editing coming in Phase 3</p>
            <p className="text-xs text-gray-400 mt-1">
                Configure trims, services, and fabric assignments
            </p>
        </div>
    );
}

// Placeholder for Costs tab (Phase 4)
function CostsPlaceholder({ product }: { product: ProductTreeNode }) {
    return (
        <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                    Product Level Costs
                </h4>
                <div className="space-y-2">
                    <CostRow label="Trims Cost" value={product.trimsCost} />
                    <CostRow label="Lining Cost" value={product.liningCost} />
                    <CostRow label="Packaging Cost" value={product.packagingCost} />
                    <CostRow label="Labor Minutes" value={product.laborMinutes} unit="min" />
                </div>
            </div>
            <div className="text-center py-6 border border-dashed border-gray-300 rounded-lg">
                <p className="text-sm text-gray-500">Full cost breakdown coming in Phase 4</p>
            </div>
        </div>
    );
}

function CostRow({ label, value, unit = '₹' }: { label: string; value?: number | null; unit?: string }) {
    return (
        <div className="flex justify-between text-sm">
            <span className="text-gray-500">{label}</span>
            <span className="text-gray-900 font-medium">
                {value !== null && value !== undefined
                    ? `${unit === '₹' ? '₹' : ''}${value}${unit !== '₹' ? ` ${unit}` : ''}`
                    : <span className="text-gray-400">-</span>
                }
            </span>
        </div>
    );
}
