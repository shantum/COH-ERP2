import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Search, Calendar, Trash2, Wrench, MapPin, User, Package, Hash, Warehouse } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { invalidateOrderView } from '../hooks/orders/orderMutationUtils';

// Server Functions
import { getInventoryTransactions, type InventoryTransactionItem } from '../server/functions/inventory';
import { getAllFabricColourTransactions } from '../server/functions/fabricColours';
import { deleteTransaction as deleteInventoryTransaction } from '../server/functions/inventoryMutations';
import { deleteFabricColourTransaction } from '../server/functions/fabricColourMutations';

type Tab = 'inventory' | 'materials';

export default function Ledgers() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [activeTab, setActiveTab] = useState<Tab>('inventory');
    const [inventoryFilter, setInventoryFilter] = useState({ search: '', txnType: '', reason: '', source: '', customOnly: false });
    const [materialsFilter, setMaterialsFilter] = useState({ search: '', txnType: '', materialId: '', fabricId: '' });

    // Fetch all inventory transactions using Server Function
    const { data: inventoryTxns, isLoading: invLoading } = useQuery({
        queryKey: ['allInventoryTransactions'],
        queryFn: async () => {
            const result = await getInventoryTransactions({ data: { limit: 500 } });
            return result;
        },
        enabled: activeTab === 'inventory'
    });

    // FabricColourTransaction interface for typing
    interface FabricColourTransaction {
        id: string;
        fabricColour?: {
            colourName: string;
            colourHex?: string | null;
            fabric?: {
                name: string;
                material?: { name: string } | null;
            } | null;
        } | null;
        txnType: string;
        reason: string;
        createdAt: string;
        qty: number;
        unit: string;
        notes?: string | null;
        costPerUnit?: number | null;
        supplier?: { name: string } | null;
        createdBy?: { name: string } | null;
    }

    // Fetch all fabric colour transactions using Server Function
    const { data: materialTxns, isLoading: materialsLoading } = useQuery<FabricColourTransaction[]>({
        queryKey: ['allFabricColourTransactions'],
        queryFn: async () => {
            const result = await getAllFabricColourTransactions({ data: { limit: 1000, days: 365 } });
            // Transform to expected format
            return result.transactions.map((t): FabricColourTransaction => ({
                id: t.id,
                txnType: t.txnType,
                reason: t.reason,
                createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(t.createdAt as Date).toISOString(),
                qty: Number(t.qty),
                unit: t.unit,
                notes: t.notes,
                costPerUnit: t.costPerUnit ? Number(t.costPerUnit) : null,
                fabricColour: t.fabricColour,
                supplier: t.supplier,
                createdBy: t.createdBy
            }));
        },
        enabled: activeTab === 'materials'
    });

    // Filter inventory transactions
    const filteredInventory = inventoryTxns?.filter((txn: InventoryTransactionItem) => {
        if (inventoryFilter.search) {
            const search = inventoryFilter.search.toLowerCase();
            const skuMatch = txn.sku?.skuCode?.toLowerCase().includes(search);
            const productMatch = txn.sku?.variation?.product?.name?.toLowerCase().includes(search);
            const orderMatch = txn.orderNumber?.toLowerCase().includes(search);
            const performedByMatch = txn.performedBy?.toLowerCase().includes(search);
            const sourceMatch = txn.source?.toLowerCase().includes(search);
            const destMatch = txn.destination?.toLowerCase().includes(search);
            if (!skuMatch && !productMatch && !orderMatch && !performedByMatch && !sourceMatch && !destMatch) return false;
        }
        if (inventoryFilter.txnType && txn.txnType !== inventoryFilter.txnType) return false;
        if (inventoryFilter.reason && txn.reason !== inventoryFilter.reason) return false;
        if (inventoryFilter.source) {
            const src = txn.txnType === 'inward' ? txn.source : txn.destination;
            if (src !== inventoryFilter.source) return false;
        }
        // Custom SKU filter - check isCustomSku flag or skuCode starting with 'C-'
        if (inventoryFilter.customOnly) {
            const isCustom = txn.sku?.isCustomSku || txn.sku?.skuCode?.startsWith('C-');
            if (!isCustom) return false;
        }
        return true;
    });

    // Count custom transactions for badge
    const customTxnCount = inventoryTxns?.filter((txn: InventoryTransactionItem) => {
        return txn.sku?.isCustomSku || txn.sku?.skuCode?.startsWith('C-');
    })?.length || 0;

    // Filter fabric colour transactions
    const filteredMaterials = materialTxns?.filter((txn: FabricColourTransaction) => {
        if (materialsFilter.search) {
            const search = materialsFilter.search.toLowerCase();
            const colourMatch = txn.fabricColour?.colourName?.toLowerCase().includes(search);
            const fabricMatch = txn.fabricColour?.fabric?.name?.toLowerCase().includes(search);
            const materialMatch = txn.fabricColour?.fabric?.material?.name?.toLowerCase().includes(search);
            if (!colourMatch && !fabricMatch && !materialMatch) return false;
        }
        if (materialsFilter.txnType && txn.txnType !== materialsFilter.txnType) return false;
        return true;
    });

    // Group transactions by date
    const groupByDate = <T extends { createdAt: string }>(txns: T[] | undefined) => {
        const groups: { [key: string]: T[] } = {};
        txns?.forEach(txn => {
            const date = new Date(txn.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            if (!groups[date]) groups[date] = [];
            groups[date].push(txn);
        });
        return groups;
    };

    const inventoryGroups = groupByDate(filteredInventory || []);
    const materialsGroups = groupByDate(filteredMaterials || []);

    const deleteMaterialsTxnMutation = useMutation({
        mutationFn: async (txnId: string) => {
            const result = await deleteFabricColourTransaction({ data: { txnId } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to delete transaction');
            }
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['allFabricColourTransactions'] });
            queryClient.invalidateQueries({ queryKey: ['fabricColourStock'] });
        },
        onError: (err: Error) => alert(err.message || 'Failed to delete transaction')
    });

    const deleteInventoryTxnMutation = useMutation({
        mutationFn: async (txnId: string) => {
            const result = await deleteInventoryTransaction({ data: { transactionId: txnId } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to delete transaction');
            }
            return result;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['allInventoryTransactions'] });
            queryClient.invalidateQueries({ queryKey: ['inventoryBalance'] });
            // If production batch was reverted, also invalidate production queries
            if (data?.data?.message?.includes('production')) {
                queryClient.invalidateQueries({ queryKey: ['productionBatches'] });
                queryClient.invalidateQueries({ queryKey: ['allFabricTransactions'] });
                queryClient.invalidateQueries({ queryKey: ['fabricStock'] });
            }
            // If allocation was reverted, invalidate open view (where allocations are managed)
            if (data?.data?.message?.includes('allocation') || data?.data?.message?.includes('queue')) {
                invalidateOrderView(queryClient, 'open');
            }
        },
        onError: (err: Error) => alert(err.message || 'Failed to delete transaction')
    });

    // Get unique reasons and sources for filter dropdowns
    const inventoryReasons = [...new Set(inventoryTxns?.map((t: InventoryTransactionItem) => t.reason as string) || [])] as string[];
    const inventorySources = [...new Set(
        inventoryTxns?.map((t: InventoryTransactionItem) => t.txnType === 'inward' ? t.source : t.destination)
            .filter((s): s is string => !!s) || []
    )].sort();

    return (
        <div className="space-y-4 md:space-y-6">
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Ledgers</h1>

            {/* Tabs */}
            <div className="border-b border-gray-200">
                <nav className="flex gap-4 md:gap-8 overflow-x-auto">
                    <button
                        onClick={() => setActiveTab('inventory')}
                        className={`pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'inventory'
                                ? 'border-primary-600 text-primary-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }`}
                    >
                        Inventory (SKU) Ledger
                    </button>
                    <button
                        onClick={() => setActiveTab('materials')}
                        className={`pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'materials'
                                ? 'border-primary-600 text-primary-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }`}
                    >
                        Materials Ledger
                    </button>
                </nav>
            </div>

            {/* Inventory Ledger */}
            {activeTab === 'inventory' && (
                <div className="space-y-4">
                    {/* Filters */}
                    <div className="card flex flex-wrap gap-2 md:gap-4 items-center">
                        <div className="relative w-full sm:flex-1 sm:min-w-[200px] sm:max-w-xs">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search SKU or product..."
                                className="input pl-9 w-full"
                                value={inventoryFilter.search}
                                onChange={(e) => setInventoryFilter(f => ({ ...f, search: e.target.value }))}
                            />
                        </div>
                        <select
                            className="input w-full sm:w-auto sm:max-w-[150px]"
                            value={inventoryFilter.txnType}
                            onChange={(e) => setInventoryFilter(f => ({ ...f, txnType: e.target.value }))}
                        >
                            <option value="">All Types</option>
                            <option value="inward">Inward</option>
                            <option value="outward">Outward</option>
                        </select>
                        <select
                            className="input w-full sm:w-auto sm:max-w-[180px]"
                            value={inventoryFilter.reason}
                            onChange={(e) => setInventoryFilter(f => ({ ...f, reason: e.target.value }))}
                        >
                            <option value="">All Reasons</option>
                            {inventoryReasons.map(r => (
                                <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                            ))}
                        </select>
                        <select
                            className="input w-full sm:w-auto sm:max-w-[180px]"
                            value={inventoryFilter.source}
                            onChange={(e) => setInventoryFilter(f => ({ ...f, source: e.target.value }))}
                        >
                            <option value="">All Sources</option>
                            {inventorySources.map(s => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                        {/* Custom SKU toggle */}
                        <button
                            onClick={() => setInventoryFilter(f => ({ ...f, customOnly: !f.customOnly }))}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                                inventoryFilter.customOnly
                                    ? 'bg-orange-100 text-orange-700 border-orange-300'
                                    : 'bg-white text-gray-600 border-gray-300 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200'
                            }`}
                            title="Show only custom SKU transactions"
                        >
                            <Wrench size={14} />
                            Custom
                            {customTxnCount > 0 && (
                                <span className={`ml-0.5 px-1.5 py-0.5 text-[10px] rounded-full ${
                                    inventoryFilter.customOnly
                                        ? 'bg-orange-200 text-orange-800'
                                        : 'bg-gray-200 text-gray-600'
                                }`}>
                                    {customTxnCount}
                                </span>
                            )}
                        </button>
                        <span className="text-sm text-gray-500">
                            {filteredInventory?.length || 0} transactions
                        </span>
                    </div>

                    {/* Transactions List */}
                    {invLoading ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                        </div>
                    ) : Object.keys(inventoryGroups).length === 0 ? (
                        <div className="card text-center py-12 text-gray-500">No transactions found</div>
                    ) : (
                        <div className="space-y-6">
                            {Object.entries(inventoryGroups).map(([date, txns]) => (
                                <div key={date}>
                                    <div className="flex items-center gap-2 mb-3">
                                        <Calendar size={16} className="text-gray-400" />
                                        <h3 className="font-medium text-gray-700">{date}</h3>
                                        <span className="text-xs text-gray-400">({txns.length} transactions)</span>
                                    </div>
                                    <div className="card divide-y">
                                        {txns.map((txn: InventoryTransactionItem) => {
                                            const hasSheetMeta = txn.source || txn.destination || txn.tailorNumber || txn.performedBy || txn.orderNumber || txn.warehouseLocation;
                                            return (
                                            <div key={txn.id} className="py-3 flex items-start justify-between gap-3">
                                                <div className="flex items-start gap-3 min-w-0 flex-1">
                                                    {txn.txnType === 'inward' ? (
                                                        <div className="p-2 rounded-full bg-green-100 shrink-0 mt-0.5">
                                                            <ArrowDownCircle size={18} className="text-green-600" />
                                                        </div>
                                                    ) : (
                                                        <div className="p-2 rounded-full bg-red-100 shrink-0 mt-0.5">
                                                            <ArrowUpCircle size={18} className="text-red-600" />
                                                        </div>
                                                    )}
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                                                            <span className={txn.sku?.isCustomSku || txn.sku?.skuCode?.startsWith('C-') ? 'text-orange-700' : ''}>
                                                                {txn.sku?.skuCode}
                                                            </span>
                                                            {(txn.sku?.isCustomSku || txn.sku?.skuCode?.startsWith('C-')) && (
                                                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700">
                                                                    <Wrench size={10} />
                                                                    Custom
                                                                </span>
                                                            )}
                                                            <span className="text-sm font-normal text-gray-500">
                                                                {txn.sku?.variation?.product?.name} • {txn.sku?.variation?.colorName} • {txn.sku?.size}
                                                            </span>
                                                        </p>
                                                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                                                            <span className="capitalize">{txn.reason?.replace(/_/g, ' ')}</span>
                                                            <span>•</span>
                                                            <span>{new Date(txn.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                                                            <span>•</span>
                                                            <span>{txn.createdBy?.name || 'System'}</span>
                                                        </div>
                                                        {/* Sheet-ingested metadata pills */}
                                                        {hasSheetMeta && (
                                                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                                                {txn.source && (
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                                                                        <MapPin size={10} />
                                                                        Source: {txn.source}
                                                                    </span>
                                                                )}
                                                                {txn.destination && (
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
                                                                        <MapPin size={10} />
                                                                        Dest: {txn.destination}
                                                                    </span>
                                                                )}
                                                                {txn.orderNumber && (
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                                                        <Hash size={10} />
                                                                        Order: #{txn.orderNumber}
                                                                    </span>
                                                                )}
                                                                {txn.performedBy && (
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-teal-50 text-teal-700 border border-teal-200">
                                                                        <User size={10} />
                                                                        By: {txn.performedBy}
                                                                    </span>
                                                                )}
                                                                {txn.tailorNumber && (
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                                                                        <Package size={10} />
                                                                        Tailor: {txn.tailorNumber}
                                                                    </span>
                                                                )}
                                                                {txn.warehouseLocation && (
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-700 border border-gray-300">
                                                                        <Warehouse size={10} />
                                                                        Loc: {txn.warehouseLocation}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                        {txn.referenceId && (
                                                            <p className="text-[10px] text-gray-400 mt-1 font-mono truncate" title={txn.referenceId}>
                                                                ref: {txn.referenceId}
                                                            </p>
                                                        )}
                                                        {txn.notes && <p className="text-xs text-gray-500 mt-1">{txn.notes}</p>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 shrink-0">
                                                    <div className={`text-lg font-semibold ${txn.txnType === 'inward' ? 'text-green-600' : 'text-red-600'}`}>
                                                        {txn.txnType === 'inward' ? '+' : '-'}{txn.qty}
                                                    </div>
                                                    {isAdmin && (
                                                        <button
                                                            onClick={() => {
                                                                if (confirm(`Delete this ${txn.txnType} transaction of ${txn.qty} units?`)) {
                                                                    deleteInventoryTxnMutation.mutate(txn.id);
                                                                }
                                                            }}
                                                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                            title="Delete transaction (admin only)"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Materials Ledger */}
            {activeTab === 'materials' && (
                <div className="space-y-4">
                    {/* Filters */}
                    <div className="card flex flex-wrap gap-2 md:gap-4 items-center">
                        <div className="relative w-full sm:flex-1 sm:min-w-[200px] sm:max-w-xs">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search material, fabric, or colour..."
                                className="input pl-9 w-full"
                                value={materialsFilter.search}
                                onChange={(e) => setMaterialsFilter(f => ({ ...f, search: e.target.value }))}
                            />
                        </div>
                        <select
                            className="input w-full sm:w-auto sm:max-w-[150px]"
                            value={materialsFilter.txnType}
                            onChange={(e) => setMaterialsFilter(f => ({ ...f, txnType: e.target.value }))}
                        >
                            <option value="">All Types</option>
                            <option value="inward">Inward</option>
                            <option value="outward">Outward (Usage)</option>
                        </select>
                        <span className="text-sm text-gray-500">
                            {filteredMaterials?.length || 0} transactions
                        </span>
                    </div>

                    {/* Transactions List */}
                    {materialsLoading ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                        </div>
                    ) : Object.keys(materialsGroups).length === 0 ? (
                        <div className="card text-center py-12 text-gray-500">No transactions found</div>
                    ) : (
                        <div className="space-y-6">
                            {Object.entries(materialsGroups).map(([date, txns]) => (
                                <div key={date}>
                                    <div className="flex items-center gap-2 mb-3">
                                        <Calendar size={16} className="text-gray-400" />
                                        <h3 className="font-medium text-gray-700">{date}</h3>
                                        <span className="text-xs text-gray-400">({txns.length} transactions)</span>
                                    </div>
                                    <div className="card divide-y">
                                        {txns.map((txn: FabricColourTransaction) => (
                                            <div key={txn.id} className="py-3 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    {txn.txnType === 'inward' ? (
                                                        <div className="p-2 rounded-full bg-green-100">
                                                            <ArrowDownCircle size={18} className="text-green-600" />
                                                        </div>
                                                    ) : (
                                                        <div className="p-2 rounded-full bg-red-100">
                                                            <ArrowUpCircle size={18} className="text-red-600" />
                                                        </div>
                                                    )}
                                                    <div className="flex items-center gap-2">
                                                        <div
                                                            className="w-5 h-5 rounded-full border border-gray-300"
                                                            style={{ backgroundColor: txn.fabricColour?.colourHex || '#ccc' }}
                                                        />
                                                        <div>
                                                            <p className="font-medium text-gray-900">
                                                                {txn.fabricColour?.colourName}
                                                            </p>
                                                            <p className="text-sm text-gray-500">
                                                                {txn.fabricColour?.fabric?.material?.name} → {txn.fabricColour?.fabric?.name}
                                                            </p>
                                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                                                <span className="capitalize">{txn.reason.replace(/_/g, ' ')}</span>
                                                                <span>•</span>
                                                                <span>{new Date(txn.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                                                                <span>•</span>
                                                                <span>{txn.createdBy?.name || 'System'}</span>
                                                                {txn.supplier && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span>From: {txn.supplier.name}</span>
                                                                    </>
                                                                )}
                                                                {txn.costPerUnit && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span>₹{txn.costPerUnit}/unit</span>
                                                                    </>
                                                                )}
                                                            </div>
                                                            {txn.notes && <p className="text-xs text-gray-500 mt-1">{txn.notes}</p>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <div className={`text-lg font-semibold ${txn.txnType === 'inward' ? 'text-green-600' : 'text-red-600'}`}>
                                                        {txn.txnType === 'inward' ? '+' : '-'}{txn.qty} {txn.unit}
                                                    </div>
                                                    {isAdmin && (
                                                        <button
                                                            onClick={() => {
                                                                if (confirm(`Delete this ${txn.txnType} transaction of ${txn.qty} ${txn.unit}?`)) {
                                                                    deleteMaterialsTxnMutation.mutate(txn.id);
                                                                }
                                                            }}
                                                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                            title="Delete transaction (admin only)"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
