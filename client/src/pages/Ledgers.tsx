import { useQuery } from '@tanstack/react-query';
import { inventoryApi, fabricsApi } from '../services/api';
import { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Search, Calendar } from 'lucide-react';

type Tab = 'inventory' | 'fabric';

export default function Ledgers() {
    const [activeTab, setActiveTab] = useState<Tab>('inventory');
    const [inventoryFilter, setInventoryFilter] = useState({ search: '', txnType: '', reason: '' });
    const [fabricFilter, setFabricFilter] = useState({ search: '', txnType: '' });

    // Fetch all inventory transactions
    const { data: inventoryTxns, isLoading: invLoading } = useQuery({
        queryKey: ['allInventoryTransactions'],
        queryFn: () => inventoryApi.getTransactions({ limit: '500' }).then(r => r.data),
        enabled: activeTab === 'inventory'
    });

    // Fetch fabric types with fabrics to get transactions
    const { data: fabricTypes } = useQuery({
        queryKey: ['fabricTypes'],
        queryFn: () => fabricsApi.getTypes().then(r => r.data),
        enabled: activeTab === 'fabric'
    });

    // Fetch all fabric transactions by getting them for each fabric
    const { data: fabricTxns, isLoading: fabLoading } = useQuery({
        queryKey: ['allFabricTransactions'],
        queryFn: async () => {
            if (!fabricTypes) return [];
            const allTxns: any[] = [];
            for (const type of fabricTypes) {
                for (const fabric of type.fabrics || []) {
                    const txns = await fabricsApi.getTransactions(fabric.id).then(r => r.data);
                    allTxns.push(...txns.map((t: any) => ({ ...t, fabric, fabricType: type })));
                }
            }
            return allTxns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        },
        enabled: activeTab === 'fabric' && !!fabricTypes
    });

    // Filter inventory transactions (exclude 'reserved' - temporary allocations)
    const filteredInventory = inventoryTxns?.filter((txn: any) => {
        if (txn.txnType === 'reserved') return false;
        if (inventoryFilter.search) {
            const search = inventoryFilter.search.toLowerCase();
            const skuMatch = txn.sku?.skuCode?.toLowerCase().includes(search);
            const productMatch = txn.sku?.variation?.product?.name?.toLowerCase().includes(search);
            if (!skuMatch && !productMatch) return false;
        }
        if (inventoryFilter.txnType && txn.txnType !== inventoryFilter.txnType) return false;
        if (inventoryFilter.reason && txn.reason !== inventoryFilter.reason) return false;
        return true;
    });

    // Filter fabric transactions
    const filteredFabric = fabricTxns?.filter((txn: any) => {
        if (fabricFilter.search) {
            const search = fabricFilter.search.toLowerCase();
            const fabricMatch = txn.fabric?.colorName?.toLowerCase().includes(search);
            const typeMatch = txn.fabricType?.name?.toLowerCase().includes(search);
            if (!fabricMatch && !typeMatch) return false;
        }
        if (fabricFilter.txnType && txn.txnType !== fabricFilter.txnType) return false;
        return true;
    });

    // Group transactions by date
    const groupByDate = (txns: any[]) => {
        const groups: { [key: string]: any[] } = {};
        txns?.forEach(txn => {
            const date = new Date(txn.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            if (!groups[date]) groups[date] = [];
            groups[date].push(txn);
        });
        return groups;
    };

    const inventoryGroups = groupByDate(filteredInventory || []);
    const fabricGroups = groupByDate(filteredFabric || []);

    // Get unique reasons for filter dropdown
    const inventoryReasons = [...new Set(inventoryTxns?.map((t: any) => t.reason as string) || [])] as string[];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Ledgers</h1>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200">
                <nav className="flex gap-8">
                    <button
                        onClick={() => setActiveTab('inventory')}
                        className={`pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                            activeTab === 'inventory'
                                ? 'border-primary-600 text-primary-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        Inventory (SKU) Ledger
                    </button>
                    <button
                        onClick={() => setActiveTab('fabric')}
                        className={`pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                            activeTab === 'fabric'
                                ? 'border-primary-600 text-primary-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        Fabric Ledger
                    </button>
                </nav>
            </div>

            {/* Inventory Ledger */}
            {activeTab === 'inventory' && (
                <div className="space-y-4">
                    {/* Filters */}
                    <div className="card flex flex-wrap gap-4 items-center">
                        <div className="relative flex-1 min-w-[200px] max-w-xs">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search SKU or product..."
                                className="input pl-9"
                                value={inventoryFilter.search}
                                onChange={(e) => setInventoryFilter(f => ({ ...f, search: e.target.value }))}
                            />
                        </div>
                        <select
                            className="input max-w-[150px]"
                            value={inventoryFilter.txnType}
                            onChange={(e) => setInventoryFilter(f => ({ ...f, txnType: e.target.value }))}
                        >
                            <option value="">All Types</option>
                            <option value="inward">Inward</option>
                            <option value="outward">Outward</option>
                        </select>
                        <select
                            className="input max-w-[180px]"
                            value={inventoryFilter.reason}
                            onChange={(e) => setInventoryFilter(f => ({ ...f, reason: e.target.value }))}
                        >
                            <option value="">All Reasons</option>
                            {inventoryReasons.map(r => (
                                <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                            ))}
                        </select>
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
                                        {txns.map((txn: any) => (
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
                                                    <div>
                                                        <p className="font-medium text-gray-900">
                                                            {txn.sku?.skuCode}
                                                            <span className="ml-2 text-sm font-normal text-gray-500">
                                                                {txn.sku?.variation?.product?.name} • {txn.sku?.variation?.colorName} • {txn.sku?.size}
                                                            </span>
                                                        </p>
                                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                                            <span className="capitalize">{txn.reason.replace(/_/g, ' ')}</span>
                                                            <span>•</span>
                                                            <span>{new Date(txn.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                                                            <span>•</span>
                                                            <span>{txn.createdBy?.name || 'System'}</span>
                                                        </div>
                                                        {txn.notes && <p className="text-xs text-gray-500 mt-1">{txn.notes}</p>}
                                                    </div>
                                                </div>
                                                <div className={`text-lg font-semibold ${txn.txnType === 'inward' ? 'text-green-600' : 'text-red-600'}`}>
                                                    {txn.txnType === 'inward' ? '+' : '-'}{txn.qty}
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

            {/* Fabric Ledger */}
            {activeTab === 'fabric' && (
                <div className="space-y-4">
                    {/* Filters */}
                    <div className="card flex flex-wrap gap-4 items-center">
                        <div className="relative flex-1 min-w-[200px] max-w-xs">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search fabric or type..."
                                className="input pl-9"
                                value={fabricFilter.search}
                                onChange={(e) => setFabricFilter(f => ({ ...f, search: e.target.value }))}
                            />
                        </div>
                        <select
                            className="input max-w-[150px]"
                            value={fabricFilter.txnType}
                            onChange={(e) => setFabricFilter(f => ({ ...f, txnType: e.target.value }))}
                        >
                            <option value="">All Types</option>
                            <option value="inward">Inward</option>
                            <option value="outward">Outward (Usage)</option>
                        </select>
                        <span className="text-sm text-gray-500">
                            {filteredFabric?.length || 0} transactions
                        </span>
                    </div>

                    {/* Transactions List */}
                    {fabLoading ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                        </div>
                    ) : Object.keys(fabricGroups).length === 0 ? (
                        <div className="card text-center py-12 text-gray-500">No transactions found</div>
                    ) : (
                        <div className="space-y-6">
                            {Object.entries(fabricGroups).map(([date, txns]) => (
                                <div key={date}>
                                    <div className="flex items-center gap-2 mb-3">
                                        <Calendar size={16} className="text-gray-400" />
                                        <h3 className="font-medium text-gray-700">{date}</h3>
                                        <span className="text-xs text-gray-400">({txns.length} transactions)</span>
                                    </div>
                                    <div className="card divide-y">
                                        {txns.map((txn: any) => (
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
                                                            style={{ backgroundColor: txn.fabric?.colorHex || '#ccc' }}
                                                        />
                                                        <div>
                                                            <p className="font-medium text-gray-900">
                                                                {txn.fabric?.colorName}
                                                                <span className="ml-2 text-sm font-normal text-gray-500">
                                                                    {txn.fabricType?.name}
                                                                </span>
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
                                                <div className={`text-lg font-semibold ${txn.txnType === 'inward' ? 'text-green-600' : 'text-red-600'}`}>
                                                    {txn.txnType === 'inward' ? '+' : '-'}{txn.qty} {txn.unit}
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
