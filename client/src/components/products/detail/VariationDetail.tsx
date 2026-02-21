/**
 * VariationDetail - Detail panel for Variation level
 */

import { useState } from 'react';
import { Palette, FileText, Package, Box, Edit, X } from 'lucide-react';
import type { ProductTreeNode } from '../types';
import { sortBySizeOrder } from '../types';
import { VariationBomTab } from './VariationBomTab';

interface VariationDetailProps {
    variation: ProductTreeNode;
    onEdit?: (variation: ProductTreeNode) => void;
    onClose?: () => void;
}

type TabType = 'info' | 'bom' | 'skus';

const TABS: { id: TabType; label: string; icon: typeof Palette }[] = [
    { id: 'info', label: 'Info', icon: FileText },
    { id: 'bom', label: 'BOM', icon: Package },
    { id: 'skus', label: 'SKUs', icon: Box },
];

export function VariationDetail({ variation, onEdit, onClose }: VariationDetailProps) {
    const [activeTab, setActiveTab] = useState<TabType>('info');

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                <div className="flex items-center gap-3">
                    {variation.colorHex && (
                        <span
                            className="w-5 h-5 rounded-full border-2 border-white shadow"
                            style={{ backgroundColor: variation.colorHex }}
                        />
                    )}
                    <div>
                        <h3 className="font-medium text-gray-900">{variation.colorName || variation.name}</h3>
                        <p className="text-xs text-gray-500">
                            {variation.productName} • {variation.fabricName || 'No fabric'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {onEdit && (
                        <button
                            onClick={() => onEdit(variation)}
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
                    <VariationInfoContent variation={variation} />
                )}
                {activeTab === 'bom' && (
                    <VariationBomTab variation={variation} />
                )}
                {activeTab === 'skus' && (
                    <VariationSkusContent variation={variation} />
                )}
            </div>
        </div>
    );
}

function VariationInfoContent({ variation }: { variation: ProductTreeNode }) {
    return (
        <div className="space-y-6">
            <InfoSection title="Basic Information">
                <InfoRow label="Color Name" value={variation.colorName} />
                <InfoRow label="Product" value={variation.productName} />
                <InfoRow label="Fabric" value={variation.fabricName} />
                <InfoRow
                    label="Has Lining"
                    value={variation.hasLining ? 'Yes' : 'No'}
                />
            </InfoSection>

            <InfoSection title="Summary">
                <div className="grid grid-cols-2 gap-4">
                    <SummaryCard label="SKUs" value={variation.children?.length || 0} />
                    <SummaryCard label="Total Stock" value={variation.totalStock || 0} />
                </div>
            </InfoSection>

            <InfoSection title="Costs">
                <InfoRow label="BOM Cost" value={formatCost(variation.bomCost)} />
            </InfoSection>
        </div>
    );
}

function VariationSkusContent({ variation }: { variation: ProductTreeNode }) {
    const skus = [...(variation.children || [])].sort((a, b) =>
        sortBySizeOrder(a.size || '', b.size || '')
    );

    if (skus.length === 0) {
        return (
            <div className="text-center py-12">
                <p className="text-sm text-gray-500">No SKUs for this variation</p>
            </div>
        );
    }

    return (
        <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                    <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU Code</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">MRP</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Stock</th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {skus.map((sku) => (
                        <tr key={sku.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium text-gray-900">{sku.size}</td>
                            <td className="px-3 py-2 text-gray-500 font-mono text-xs">{sku.skuCode}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                                {sku.mrp ? `₹${sku.mrp.toLocaleString()}` : '-'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                                {(sku.currentBalance || 0).toLocaleString()}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">{title}</h4>
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                {children}
            </div>
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
    return (
        <div className="flex justify-between text-sm">
            <span className="text-gray-500">{label}</span>
            <span className="text-gray-900 font-medium">
                {value !== undefined && value !== null ? value : '-'}
            </span>
        </div>
    );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
    return (
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
            <div className="text-2xl font-semibold text-gray-900">{value.toLocaleString()}</div>
            <div className="text-xs text-gray-500 mt-1">{label}</div>
        </div>
    );
}

function formatCost(value?: number | null): string | null {
    if (value === null || value === undefined) return null;
    return `₹${value.toLocaleString()}`;
}
