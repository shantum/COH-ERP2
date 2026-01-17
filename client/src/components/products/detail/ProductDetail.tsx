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
import { ProductBomTab } from './ProductBomTab';
import { ProductCostsTab } from './ProductCostsTab';
import { ProductSkusTab } from './ProductSkusTab';

interface ProductDetailProps {
    product: ProductTreeNode;
    onClose?: () => void;
}

type TabType = 'info' | 'bom' | 'costs' | 'skus';

const TABS: { id: TabType; label: string; icon: typeof Package }[] = [
    { id: 'info', label: 'Info', icon: FileText },
    { id: 'bom', label: 'BOM', icon: Package },
    { id: 'costs', label: 'Costs', icon: DollarSign },
    { id: 'skus', label: 'SKUs', icon: Box },
];

export function ProductDetail({ product, onClose }: ProductDetailProps) {
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
                    <ProductBomTab product={product} />
                )}
                {activeTab === 'costs' && (
                    <ProductCostsTab product={product} />
                )}
                {activeTab === 'skus' && (
                    <ProductSkusTab product={product} />
                )}
            </div>
        </div>
    );
}

