import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, productsApi } from '../services/api';
import { useState, useMemo } from 'react';
import { Plus, AlertTriangle, Eye, X, ArrowDownCircle, ArrowUpCircle, ChevronUp, ChevronDown } from 'lucide-react';

export default function Inventory() {
    const queryClient = useQueryClient();
    const { data: balance, isLoading } = useQuery({ queryKey: ['inventoryBalance'], queryFn: () => inventoryApi.getBalance().then(r => r.data) });
    const { data: alerts } = useQuery({ queryKey: ['stockAlerts'], queryFn: () => inventoryApi.getAlerts().then(r => r.data) });
    const { data: skus } = useQuery({ queryKey: ['allSkus'], queryFn: () => productsApi.getAllSkus().then(r => r.data) });

    const [showInward, setShowInward] = useState(false);
    const [inwardForm, setInwardForm] = useState({ skuCode: '', qty: 1, reason: 'production', notes: '' });
    const [filter, setFilter] = useState({ belowTarget: false, search: '' });
    const [showDetail, setShowDetail] = useState<any>(null);
    const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' } | null>(null);

    // Fetch transactions when detail view is open
    const { data: transactions, isLoading: txnLoading } = useQuery({
        queryKey: ['skuTransactions', showDetail?.skuId],
        queryFn: () => inventoryApi.getSkuTransactions(showDetail.skuId).then(r => r.data),
        enabled: !!showDetail?.skuId
    });

    const quickInward = useMutation({
        mutationFn: (data: any) => inventoryApi.quickInward(data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['inventoryBalance'] }); setShowInward(false); setInwardForm({ skuCode: '', qty: 1, reason: 'production', notes: '' }); }
    });

    const toggleSort = (column: string) => {
        if (sort?.column === column) {
            if (sort.direction === 'asc') {
                setSort({ column, direction: 'desc' });
            } else {
                setSort(null); // Reset sort
            }
        } else {
            setSort({ column, direction: 'asc' });
        }
    };

    const filteredAndSortedBalance = useMemo(() => {
        let result = balance?.filter((b: any) => {
            if (filter.belowTarget && b.status !== 'below_target') return false;
            if (filter.search && !b.skuCode.toLowerCase().includes(filter.search.toLowerCase()) && !b.productName.toLowerCase().includes(filter.search.toLowerCase())) return false;
            return true;
        }) || [];

        if (sort) {
            result = [...result].sort((a: any, b: any) => {
                let aVal = 0, bVal = 0;
                if (sort.column === 'stock') {
                    aVal = a.currentBalance;
                    bVal = b.currentBalance;
                } else if (sort.column === 'available') {
                    aVal = a.availableBalance;
                    bVal = b.availableBalance;
                } else if (sort.column === 'target') {
                    aVal = a.targetStockQty;
                    bVal = b.targetStockQty;
                }
                return sort.direction === 'asc' ? aVal - bVal : bVal - aVal;
            });
        }

        return result;
    }, [balance, filter, sort]);

    if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
                <button onClick={() => setShowInward(true)} className="btn-primary flex items-center"><Plus size={20} className="mr-2" />Quick Inward</button>
            </div>

            {/* Alerts Banner */}
            {alerts?.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-3">
                    <AlertTriangle className="text-yellow-600" />
                    <span className="text-yellow-800 font-medium">{alerts.length} SKUs below target stock</span>
                </div>
            )}

            {/* Filters */}
            <div className="card flex flex-wrap gap-4">
                <input type="text" placeholder="Search SKU or product..." className="input max-w-xs" value={filter.search} onChange={(e) => setFilter(f => ({ ...f, search: e.target.value }))} />
                <label className="flex items-center gap-2">
                    <input type="checkbox" checked={filter.belowTarget} onChange={(e) => setFilter(f => ({ ...f, belowTarget: e.target.checked }))} className="rounded border-gray-300" />
                    <span className="text-sm">Show only below target</span>
                </label>
            </div>

            {/* Balance Table */}
            <div className="card overflow-x-auto">
                <table className="w-full">
                    <thead><tr className="border-b">
                        <th className="table-header">SKU</th><th className="table-header">Product</th><th className="table-header">Color</th><th className="table-header">Size</th>
                        <th className="table-header text-right cursor-pointer hover:bg-gray-50 select-none" onClick={() => toggleSort('stock')}>
                            <div className="flex items-center justify-end gap-1">
                                Stock
                                {sort?.column === 'stock' && (sort.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                            </div>
                        </th>
                        <th className="table-header text-right cursor-pointer hover:bg-gray-50 select-none" onClick={() => toggleSort('available')}>
                            <div className="flex items-center justify-end gap-1">
                                Available
                                {sort?.column === 'available' && (sort.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                            </div>
                        </th>
                        <th className="table-header text-right cursor-pointer hover:bg-gray-50 select-none" onClick={() => toggleSort('target')}>
                            <div className="flex items-center justify-end gap-1">
                                Target
                                {sort?.column === 'target' && (sort.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                            </div>
                        </th>
                        <th className="table-header">Status</th><th className="table-header"></th>
                    </tr></thead>
                    <tbody>
                        {filteredAndSortedBalance?.map((item: any) => (
                            <tr key={item.skuId} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="table-cell font-medium">{item.skuCode}</td>
                                <td className="table-cell">{item.productName}</td>
                                <td className="table-cell">{item.colorName}</td>
                                <td className="table-cell">{item.size}</td>
                                <td className="table-cell text-right font-medium">
                                    {item.currentBalance}
                                    {item.reservedBalance > 0 && (
                                        <span className="text-xs text-yellow-600 ml-1">({item.reservedBalance} held)</span>
                                    )}
                                </td>
                                <td className="table-cell text-right font-medium text-primary-600">{item.availableBalance}</td>
                                <td className="table-cell text-right text-gray-500">{item.targetStockQty}</td>
                                <td className="table-cell"><span className={`badge ${item.status === 'ok' ? 'badge-success' : 'badge-danger'}`}>{item.status === 'ok' ? 'OK' : 'Low'}</span></td>
                                <td className="table-cell">
                                    <button onClick={() => setShowDetail(item)} className="btn-secondary text-xs py-1 px-2 flex items-center gap-1">
                                        <Eye size={14} /> View
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Quick Inward Modal */}
            {showInward && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <h2 className="text-lg font-semibold mb-4">Quick Inward Entry</h2>
                        <form onSubmit={(e) => { e.preventDefault(); quickInward.mutate(inwardForm); }} className="space-y-4">
                            <div><label className="label">SKU Code</label><input className="input" value={inwardForm.skuCode} onChange={(e) => setInwardForm(f => ({ ...f, skuCode: e.target.value }))} required list="sku-list" />
                                <datalist id="sku-list">{skus?.map((s: any) => <option key={s.id} value={s.skuCode} />)}</datalist>
                            </div>
                            <div><label className="label">Quantity</label><input type="number" className="input" value={inwardForm.qty} onChange={(e) => setInwardForm(f => ({ ...f, qty: Number(e.target.value) }))} min={1} required /></div>
                            <div><label className="label">Reason</label><select className="input" value={inwardForm.reason} onChange={(e) => setInwardForm(f => ({ ...f, reason: e.target.value }))}>
                                <option value="production">Production</option><option value="return_receipt">Return</option><option value="adjustment">Adjustment</option>
                            </select></div>
                            <div><label className="label">Notes</label><input className="input" value={inwardForm.notes} onChange={(e) => setInwardForm(f => ({ ...f, notes: e.target.value }))} /></div>
                            <div className="flex gap-3">
                                <button type="button" onClick={() => setShowInward(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={quickInward.isPending}>{quickInward.isPending ? 'Saving...' : 'Add Inward'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* SKU Detail Modal with Transaction Ledger */}
            {showDetail && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-lg font-semibold">{showDetail.skuCode}</h2>
                                <p className="text-sm text-gray-500">{showDetail.productName} • {showDetail.colorName} • {showDetail.size}</p>
                            </div>
                            <button onClick={() => setShowDetail(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>

                        {/* Summary Stats */}
                        <div className="grid grid-cols-3 gap-3 mb-4">
                            <div className="bg-gray-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-gray-500">Physical Stock</p>
                                <p className="text-xl font-semibold">{showDetail.currentBalance}</p>
                            </div>
                            <div className="bg-yellow-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-yellow-600">Reserved/Held</p>
                                <p className="text-xl font-semibold text-yellow-700">{showDetail.reservedBalance || 0}</p>
                            </div>
                            <div className="bg-primary-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-primary-600">Available</p>
                                <p className="text-xl font-semibold text-primary-700">{showDetail.availableBalance}</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-4 gap-3 mb-4">
                            <div className="bg-green-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-green-600">Total Inward</p>
                                <p className="text-xl font-semibold text-green-700">{showDetail.totalInward}</p>
                            </div>
                            <div className="bg-red-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-red-600">Total Outward</p>
                                <p className="text-xl font-semibold text-red-700">{showDetail.totalOutward}</p>
                            </div>
                            <div className="bg-blue-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-blue-600">Target</p>
                                <p className="text-xl font-semibold text-blue-700">{showDetail.targetStockQty}</p>
                            </div>
                            <div className={`${showDetail.status === 'ok' ? 'bg-green-50' : 'bg-red-50'} rounded-lg p-3 text-center`}>
                                <p className="text-xs text-gray-600">Status</p>
                                <p className={`text-sm font-semibold ${showDetail.status === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                                    {showDetail.status === 'ok' ? 'OK' : 'Below Target'}
                                </p>
                            </div>
                        </div>

                        {/* Transaction Ledger */}
                        <div className="flex-1 overflow-y-auto">
                            <h3 className="font-medium text-gray-700 mb-3">Transaction Ledger</h3>
                            {txnLoading ? (
                                <div className="flex justify-center py-8">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                                </div>
                            ) : transactions?.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">No transactions yet</div>
                            ) : (
                                <div className="space-y-2">
                                    {transactions?.map((txn: any) => (
                                        <div key={txn.id} className={`p-3 rounded-lg border ${txn.txnType === 'inward' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    {txn.txnType === 'inward' ? (
                                                        <ArrowDownCircle size={20} className="text-green-600" />
                                                    ) : (
                                                        <ArrowUpCircle size={20} className="text-red-600" />
                                                    )}
                                                    <div>
                                                        <p className="font-medium">
                                                            {txn.txnType === 'inward' ? '+' : '-'}{txn.qty} units
                                                            <span className="ml-2 text-xs text-gray-500 font-normal capitalize">
                                                                {txn.reason.replace(/_/g, ' ')}
                                                            </span>
                                                        </p>
                                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                                            <span>{new Date(txn.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                                            <span>•</span>
                                                            <span>{txn.createdBy?.name || 'System'}</span>
                                                            {txn.referenceId && (
                                                                <>
                                                                    <span>•</span>
                                                                    <span className="font-mono text-xs">Ref: {txn.referenceId.slice(0, 8)}...</span>
                                                                </>
                                                            )}
                                                        </div>
                                                        {txn.notes && <p className="text-xs text-gray-600 mt-1">{txn.notes}</p>}
                                                    </div>
                                                </div>
                                                <div className={`text-lg font-semibold ${txn.txnType === 'inward' ? 'text-green-600' : 'text-red-600'}`}>
                                                    {txn.txnType === 'inward' ? '+' : '-'}{txn.qty}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex gap-3 pt-4 mt-4 border-t">
                            <button onClick={() => setShowDetail(null)} className="btn-secondary flex-1">Close</button>
                            <button
                                onClick={() => { setInwardForm(f => ({ ...f, skuCode: showDetail.skuCode })); setShowInward(true); setShowDetail(null); }}
                                className="btn-primary flex-1 flex items-center justify-center gap-2"
                            >
                                <Plus size={16} /> Add Inward
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
