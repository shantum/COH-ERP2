/**
 * SkuDetail - Detail panel for SKU level
 */

import { useState } from 'react';
import { Box, FileText, Package, Edit, X } from 'lucide-react';
import type { ProductTreeNode } from '../types';

interface SkuDetailProps {
    sku: ProductTreeNode;
    onEdit?: (sku: ProductTreeNode) => void;
    onClose?: () => void;
}

type TabType = 'info' | 'inventory';

const TABS: { id: TabType; label: string; icon: typeof Box }[] = [
    { id: 'info', label: 'Info', icon: FileText },
    { id: 'inventory', label: 'Inventory', icon: Package },
];

export function SkuDetail({ sku, onEdit, onClose }: SkuDetailProps) {
    const [activeTab, setActiveTab] = useState<TabType>('info');

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                <div className="flex items-center gap-3">
                    <Box size={20} className="text-teal-600" />
                    <div>
                        <h3 className="font-medium text-gray-900">{sku.skuCode}</h3>
                        <p className="text-xs text-gray-500">
                            Size: {sku.size} • MRP: {sku.mrp ? `₹${sku.mrp.toLocaleString()}` : '-'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {onEdit && (
                        <button
                            onClick={() => onEdit(sku)}
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
                    <SkuInfoContent sku={sku} />
                )}
                {activeTab === 'inventory' && (
                    <SkuInventoryContent sku={sku} />
                )}
            </div>
        </div>
    );
}

function SkuInfoContent({ sku }: { sku: ProductTreeNode }) {
    return (
        <div className="space-y-6">
            <InfoSection title="Basic Information">
                <InfoRow label="SKU Code" value={sku.skuCode} />
                <InfoRow label="Barcode" value={sku.barcode || sku.skuCode} />
                <InfoRow label="Size" value={sku.size} />
                <InfoRow label="MRP" value={sku.mrp ? `₹${sku.mrp.toLocaleString()}` : null} />
            </InfoSection>

            <InfoSection title="Production">
                <InfoRow label="Fabric Consumption" value={sku.fabricConsumption ? `${sku.fabricConsumption} m` : null} />
            </InfoSection>

            <InfoSection title="Costs (Override)">
                <InfoRow label="Trims Cost" value={formatCost(sku.trimsCost)} />
                <InfoRow label="Lining Cost" value={formatCost(sku.liningCost)} />
                <InfoRow label="Packaging Cost" value={formatCost(sku.packagingCost)} />
                <InfoRow label="Labor Minutes" value={sku.laborMinutes ? `${sku.laborMinutes} min` : null} />
            </InfoSection>
        </div>
    );
}

function SkuInventoryContent({ sku }: { sku: ProductTreeNode }) {
    const stockPercentage = sku.targetStockQty
        ? Math.min(100, ((sku.currentBalance || 0) / sku.targetStockQty) * 100)
        : 0;

    let stockColor = 'bg-gray-200';
    let stockTextColor = 'text-gray-600';
    if ((sku.currentBalance || 0) <= 0) {
        stockColor = 'bg-red-500';
        stockTextColor = 'text-red-600';
    } else if (sku.targetStockQty && (sku.currentBalance || 0) < sku.targetStockQty * 0.5) {
        stockColor = 'bg-amber-500';
        stockTextColor = 'text-amber-600';
    } else if ((sku.currentBalance || 0) > 0) {
        stockColor = 'bg-green-500';
        stockTextColor = 'text-green-600';
    }

    return (
        <div className="space-y-6">
            {/* Stock Level */}
            <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">Current Stock</span>
                    <span className={`text-2xl font-bold ${stockTextColor}`}>
                        {(sku.currentBalance || 0).toLocaleString()}
                    </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                        className={`h-2 rounded-full transition-all ${stockColor}`}
                        style={{ width: `${stockPercentage}%` }}
                    />
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>0</span>
                    <span>Target: {sku.targetStockQty || '-'}</span>
                </div>
            </div>

            <InfoSection title="Stock Details">
                <InfoRow label="Current Balance" value={(sku.currentBalance || 0).toLocaleString()} />
                <InfoRow label="Available Balance" value={(sku.availableBalance || 0).toLocaleString()} />
                <InfoRow label="Target Stock" value={sku.targetStockQty?.toLocaleString()} />
            </InfoSection>

            {/* Placeholder for transaction history */}
            <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg">
                <p className="text-sm text-gray-500">Transaction history coming soon</p>
                <p className="text-xs text-gray-400 mt-1">
                    View recent inward/outward movements
                </p>
            </div>
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

function formatCost(value?: number | null): string | null {
    if (value === null || value === undefined) return null;
    return `₹${value.toLocaleString()}`;
}
