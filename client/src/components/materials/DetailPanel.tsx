/**
 * Materials Detail Panel - Slide-out panel for viewing all properties of a material record
 */

import { X, Package, TrendingUp, TrendingDown, Clock, Info, DollarSign } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { materialsApi } from '../../services/api';

interface DetailPanelProps {
    item: any;
    type: 'colour' | 'fabric' | 'material' | 'trim' | 'service';
    isOpen: boolean;
    onClose: () => void;
    onEdit: () => void;
}

export function DetailPanel({ item, type, isOpen, onClose, onEdit }: DetailPanelProps) {
    // Fetch transaction history for colours
    const { data: transactions } = useQuery({
        queryKey: ['colourTransactions', item?.colourId],
        queryFn: () => materialsApi.getColourTransactions(item.colourId).then(r => r.data),
        enabled: isOpen && type === 'colour' && !!item?.colourId,
    });

    if (!isOpen || !item) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/30 transition-opacity"
                onClick={onClose}
            />

            {/* Panel */}
            <div className="relative w-full max-w-lg bg-white shadow-xl overflow-y-auto animate-slide-in-right">
                {/* Header */}
                <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
                    <div className="flex items-center gap-3">
                        {type === 'colour' && item.colourHex && (
                            <div
                                className="w-10 h-10 rounded-full border-2 border-gray-200 shadow-inner"
                                style={{ backgroundColor: item.colourHex }}
                            />
                        )}
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                                {type === 'colour' ? item.colourName : item.name}
                            </h2>
                            <p className="text-sm text-gray-500 capitalize">{type} Details</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onEdit}
                            className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                            Edit
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Colour-specific content */}
                    {type === 'colour' && (
                        <>
                            {/* Basic Info */}
                            <section>
                                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <Info size={14} />
                                    Basic Information
                                </h3>
                                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                                    <InfoRow label="Fabric" value={item.fabricName} />
                                    <InfoRow label="Material" value={item.materialName} />
                                    <InfoRow label="Standard Colour" value={item.standardColour || '-'} />
                                    <InfoRow label="Composition" value={item.composition || '-'} />
                                    {item.weight && (
                                        <InfoRow label="Weight" value={`${item.weight} ${item.weightUnit || 'gsm'}`} />
                                    )}
                                </div>
                            </section>

                            {/* Costing & Lead Time */}
                            <section>
                                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <DollarSign size={14} />
                                    Costing & Lead Time
                                </h3>
                                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                                    <InfoRow
                                        label="Cost/Unit"
                                        value={item.effectiveCostPerUnit != null ? `₹${item.effectiveCostPerUnit}` : '-'}
                                        inherited={item.costInherited}
                                    />
                                    <InfoRow
                                        label="Lead Time"
                                        value={item.effectiveLeadTimeDays != null ? `${item.effectiveLeadTimeDays} days` : '-'}
                                        inherited={item.leadTimeInherited}
                                    />
                                    <InfoRow
                                        label="Min Order Qty"
                                        value={item.effectiveMinOrderQty != null ? `${item.effectiveMinOrderQty}m` : '-'}
                                        inherited={item.minOrderInherited}
                                    />
                                    <InfoRow label="Supplier" value={item.supplierName || '-'} />
                                </div>
                            </section>

                            {/* Stock Summary */}
                            <section>
                                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <Package size={14} />
                                    Stock Summary
                                </h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-gray-50 rounded-xl p-4 text-center">
                                        <p className="text-2xl font-bold text-gray-900">{(item.currentBalance || 0).toFixed(1)}m</p>
                                        <p className="text-sm text-gray-500">Current Balance</p>
                                    </div>
                                    <div className={`rounded-xl p-4 text-center ${
                                        item.daysOfStock <= 7 ? 'bg-red-50' :
                                        item.daysOfStock <= 14 ? 'bg-yellow-50' : 'bg-green-50'
                                    }`}>
                                        <p className={`text-2xl font-bold ${
                                            item.daysOfStock <= 7 ? 'text-red-600' :
                                            item.daysOfStock <= 14 ? 'text-yellow-600' : 'text-green-600'
                                        }`}>
                                            {item.daysOfStock != null ? `${item.daysOfStock}d` : '-'}
                                        </p>
                                        <p className="text-sm text-gray-500">Days of Stock</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-3 mt-3">
                                    <div className="bg-green-50 rounded-lg p-3 text-center">
                                        <div className="flex items-center justify-center gap-1 text-green-600">
                                            <TrendingUp size={14} />
                                            <span className="font-semibold">+{(item.totalInward || 0).toFixed(1)}</span>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Total In</p>
                                    </div>
                                    <div className="bg-red-50 rounded-lg p-3 text-center">
                                        <div className="flex items-center justify-center gap-1 text-red-600">
                                            <TrendingDown size={14} />
                                            <span className="font-semibold">-{(item.totalOutward || 0).toFixed(1)}</span>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Total Out</p>
                                    </div>
                                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                                        <div className="font-semibold text-gray-700">
                                            {item.avgDailyConsumption ? item.avgDailyConsumption.toFixed(2) : '-'}
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Avg/Day</p>
                                    </div>
                                </div>
                            </section>

                            {/* Recent Transactions */}
                            {transactions?.items?.length > 0 && (
                                <section>
                                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                        <Clock size={14} />
                                        Recent Transactions
                                    </h3>
                                    <div className="space-y-2">
                                        {transactions.items.slice(0, 10).map((txn: any) => (
                                            <div
                                                key={txn.id}
                                                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                                        txn.txnType === 'inward' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                                                    }`}>
                                                        {txn.txnType === 'inward' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                                    </div>
                                                    <div>
                                                        <p className="font-medium capitalize">{txn.reason?.replace(/_/g, ' ') || txn.txnType}</p>
                                                        <p className="text-xs text-gray-500">
                                                            {new Date(txn.createdAt).toLocaleDateString()}
                                                        </p>
                                                    </div>
                                                </div>
                                                <span className={`font-medium ${
                                                    txn.txnType === 'inward' ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                    {txn.txnType === 'inward' ? '+' : '-'}{txn.qty}m
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}
                        </>
                    )}

                    {/* Fabric-specific content */}
                    {type === 'fabric' && (
                        <>
                            <section>
                                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
                                    Fabric Details
                                </h3>
                                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                                    <InfoRow label="Material" value={item.materialName} />
                                    <InfoRow label="Construction" value={item.constructionType} />
                                    <InfoRow label="Pattern" value={item.pattern || '-'} />
                                    <InfoRow label="Weight" value={item.weight ? `${item.weight} ${item.weightUnit || 'gsm'}` : '-'} />
                                    <InfoRow label="Composition" value={item.composition || '-'} />
                                    <InfoRow label="Shrinkage" value={item.avgShrinkagePct ? `${item.avgShrinkagePct}%` : '-'} />
                                </div>
                            </section>

                            <section>
                                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
                                    Default Values
                                </h3>
                                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                                    <InfoRow label="Cost/Unit" value={item.defaultCostPerUnit != null ? `₹${item.defaultCostPerUnit}` : '-'} />
                                    <InfoRow label="Lead Time" value={item.defaultLeadTimeDays != null ? `${item.defaultLeadTimeDays} days` : '-'} />
                                    <InfoRow label="Min Order" value={item.defaultMinOrderQty != null ? `${item.defaultMinOrderQty}m` : '-'} />
                                </div>
                            </section>

                            <section>
                                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
                                    Statistics
                                </h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-blue-50 rounded-xl p-4 text-center">
                                        <p className="text-2xl font-bold text-blue-600">{item.colourCount || 0}</p>
                                        <p className="text-sm text-gray-500">Colours</p>
                                    </div>
                                    <div className="bg-gray-50 rounded-xl p-4 text-center">
                                        <p className="text-2xl font-bold text-gray-900">{(item.totalStock || 0).toFixed(1)}m</p>
                                        <p className="text-sm text-gray-500">Total Stock</p>
                                    </div>
                                </div>
                            </section>
                        </>
                    )}

                    {/* Material-specific content */}
                    {type === 'material' && (
                        <>
                            <section>
                                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
                                    Material Details
                                </h3>
                                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                                    <InfoRow label="Name" value={item.name} />
                                    <InfoRow label="Description" value={item.description || '-'} />
                                    <InfoRow label="Status" value={item.isActive ? 'Active' : 'Inactive'} />
                                </div>
                            </section>

                            <section>
                                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
                                    Statistics
                                </h3>
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-blue-50 rounded-xl p-4 text-center">
                                        <p className="text-2xl font-bold text-blue-600">{item.fabricCount || 0}</p>
                                        <p className="text-sm text-gray-500">Fabrics</p>
                                    </div>
                                    <div className="bg-purple-50 rounded-xl p-4 text-center">
                                        <p className="text-2xl font-bold text-purple-600">{item.colourCount || 0}</p>
                                        <p className="text-sm text-gray-500">Colours</p>
                                    </div>
                                    <div className="bg-gray-50 rounded-xl p-4 text-center">
                                        <p className="text-2xl font-bold text-gray-900">{(item.totalStock || 0).toFixed(1)}m</p>
                                        <p className="text-sm text-gray-500">Total Stock</p>
                                    </div>
                                </div>
                            </section>
                        </>
                    )}

                    {/* Trim-specific content */}
                    {type === 'trim' && (
                        <>
                            <section>
                                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
                                    Trim Details
                                </h3>
                                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                                    <InfoRow label="Code" value={item.code} />
                                    <InfoRow label="Name" value={item.name} />
                                    <InfoRow label="Category" value={item.category} />
                                    <InfoRow label="Description" value={item.description || '-'} />
                                    <InfoRow label="Cost/Unit" value={`₹${item.costPerUnit}`} />
                                    <InfoRow label="Unit" value={item.unit} />
                                    <InfoRow label="Supplier" value={item.supplierName || '-'} />
                                    <InfoRow label="Lead Time" value={item.leadTimeDays ? `${item.leadTimeDays} days` : '-'} />
                                    <InfoRow label="Min Order" value={item.minOrderQty || '-'} />
                                    <InfoRow label="Used In" value={`${item.usageCount || 0} BOMs`} />
                                    <InfoRow label="Status" value={item.isActive ? 'Active' : 'Inactive'} />
                                </div>
                            </section>
                        </>
                    )}

                    {/* Service-specific content */}
                    {type === 'service' && (
                        <>
                            <section>
                                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
                                    Service Details
                                </h3>
                                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                                    <InfoRow label="Code" value={item.code} />
                                    <InfoRow label="Name" value={item.name} />
                                    <InfoRow label="Category" value={item.category} />
                                    <InfoRow label="Description" value={item.description || '-'} />
                                    <InfoRow label="Cost/Job" value={`₹${item.costPerJob}`} />
                                    <InfoRow label="Vendor" value={item.vendorName || '-'} />
                                    <InfoRow label="Lead Time" value={item.leadTimeDays ? `${item.leadTimeDays} days` : '-'} />
                                    <InfoRow label="Used In" value={`${item.usageCount || 0} BOMs`} />
                                    <InfoRow label="Status" value={item.isActive ? 'Active' : 'Inactive'} />
                                </div>
                            </section>
                        </>
                    )}
                </div>
            </div>

            <style>{`
                @keyframes slide-in-right {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                .animate-slide-in-right {
                    animation: slide-in-right 0.2s ease-out forwards;
                }
            `}</style>
        </div>
    );
}

// Helper component for info rows
function InfoRow({ label, value, inherited }: { label: string; value: string | number; inherited?: boolean }) {
    return (
        <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">{label}</span>
            <span className="text-sm font-medium text-gray-900 flex items-center gap-1">
                {value}
                {inherited && <span className="text-gray-400 text-[10px]" title="Inherited from fabric">↑</span>}
            </span>
        </div>
    );
}

export default DetailPanel;
