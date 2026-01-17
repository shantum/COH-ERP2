/**
 * ProductInfoTab - Basic product information display/edit
 */

import type { ProductTreeNode } from '../types';

interface ProductInfoTabProps {
    product: ProductTreeNode;
    isEditing?: boolean;
    onSave?: (data: Partial<ProductTreeNode>) => void;
}

export function ProductInfoTab({ product, isEditing = false }: ProductInfoTabProps) {
    return (
        <div className="space-y-6">
            {/* Basic Information */}
            <InfoSection title="Basic Information">
                <InfoField label="Name" value={product.name} editable={isEditing} />
                <InfoField label="Style Code" value={product.styleCode} editable={isEditing} />
                <InfoField label="Category" value={product.category} editable={isEditing} />
                <InfoField label="Gender" value={product.gender} editable={isEditing} />
                <InfoField label="Fabric Type" value={product.fabricTypeName} />
                <InfoField
                    label="Has Lining"
                    value={product.hasLining ? 'Yes' : 'No'}
                    badge={product.hasLining ? 'green' : 'gray'}
                />
            </InfoSection>

            {/* Summary Counts */}
            <InfoSection title="Summary">
                <div className="grid grid-cols-3 gap-4">
                    <SummaryCard label="Variations" value={product.variationCount || 0} />
                    <SummaryCard label="SKUs" value={product.skuCount || 0} />
                    <SummaryCard label="Total Stock" value={product.totalStock || 0} />
                </div>
            </InfoSection>

            {/* Status */}
            <InfoSection title="Status">
                <InfoField
                    label="Active"
                    value={product.isActive ? 'Active' : 'Inactive'}
                    badge={product.isActive ? 'green' : 'red'}
                />
            </InfoSection>
        </div>
    );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                {title}
            </h4>
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                {children}
            </div>
        </div>
    );
}

interface InfoFieldProps {
    label: string;
    value?: string | number | null;
    editable?: boolean;
    badge?: 'green' | 'red' | 'gray' | 'blue';
}

function InfoField({ label, value, editable = false, badge }: InfoFieldProps) {
    const displayValue = value !== undefined && value !== null ? String(value) : '-';

    if (editable) {
        return (
            <div className="flex items-center justify-between">
                <label className="text-sm text-gray-500">{label}</label>
                <input
                    type="text"
                    defaultValue={displayValue !== '-' ? displayValue : ''}
                    placeholder={displayValue === '-' ? 'Not set' : undefined}
                    className="text-sm px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 w-48"
                />
            </div>
        );
    }

    return (
        <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">{label}</span>
            {badge ? (
                <Badge color={badge}>{displayValue}</Badge>
            ) : (
                <span className="text-sm text-gray-900 font-medium">{displayValue}</span>
            )}
        </div>
    );
}

function Badge({ color, children }: { color: 'green' | 'red' | 'gray' | 'blue'; children: React.ReactNode }) {
    const colors = {
        green: 'bg-green-100 text-green-800',
        red: 'bg-red-100 text-red-800',
        gray: 'bg-gray-100 text-gray-800',
        blue: 'bg-blue-100 text-blue-800',
    };

    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[color]}`}>
            {children}
        </span>
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
