import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, productsApi } from '../services/api';
import { useState } from 'react';
import { Plus, AlertTriangle } from 'lucide-react';

export default function Inventory() {
    const queryClient = useQueryClient();
    const { data: balance, isLoading } = useQuery({ queryKey: ['inventoryBalance'], queryFn: () => inventoryApi.getBalance().then(r => r.data) });
    const { data: alerts } = useQuery({ queryKey: ['stockAlerts'], queryFn: () => inventoryApi.getAlerts().then(r => r.data) });
    const { data: skus } = useQuery({ queryKey: ['allSkus'], queryFn: () => productsApi.getAllSkus().then(r => r.data) });

    const [showInward, setShowInward] = useState(false);
    const [inwardForm, setInwardForm] = useState({ skuCode: '', qty: 1, reason: 'production', notes: '' });
    const [filter, setFilter] = useState({ belowTarget: false, search: '' });

    const quickInward = useMutation({
        mutationFn: (data: any) => inventoryApi.quickInward(data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['inventoryBalance'] }); setShowInward(false); setInwardForm({ skuCode: '', qty: 1, reason: 'production', notes: '' }); }
    });

    const filteredBalance = balance?.filter((b: any) => {
        if (filter.belowTarget && b.status !== 'below_target') return false;
        if (filter.search && !b.skuCode.toLowerCase().includes(filter.search.toLowerCase()) && !b.productName.toLowerCase().includes(filter.search.toLowerCase())) return false;
        return true;
    });

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
                        <th className="table-header text-right">Stock</th><th className="table-header text-right">Target</th><th className="table-header">Status</th>
                    </tr></thead>
                    <tbody>
                        {filteredBalance?.map((item: any) => (
                            <tr key={item.skuId} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="table-cell font-medium">{item.skuCode}</td>
                                <td className="table-cell">{item.productName}</td>
                                <td className="table-cell">{item.colorName}</td>
                                <td className="table-cell">{item.size}</td>
                                <td className="table-cell text-right font-medium">{item.currentBalance}</td>
                                <td className="table-cell text-right text-gray-500">{item.targetStockQty}</td>
                                <td className="table-cell"><span className={`badge ${item.status === 'ok' ? 'badge-success' : 'badge-danger'}`}>{item.status === 'ok' ? 'OK' : 'Low'}</span></td>
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
        </div>
    );
}
