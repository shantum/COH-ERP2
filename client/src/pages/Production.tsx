import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionApi, productsApi } from '../services/api';
import { useState } from 'react';
import { Plus, Play, CheckCircle, X, ChevronDown, ChevronRight } from 'lucide-react';

export default function Production() {
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<'schedule' | 'capacity' | 'tailors'>('schedule');
    const { data: batches, isLoading } = useQuery({ queryKey: ['productionBatches'], queryFn: () => productionApi.getBatches().then(r => r.data) });
    const { data: capacity } = useQuery({ queryKey: ['productionCapacity'], queryFn: () => productionApi.getCapacity().then(r => r.data) });
    const { data: tailors } = useQuery({ queryKey: ['tailors'], queryFn: () => productionApi.getTailors().then(r => r.data) });
    const { data: allSkus } = useQuery({ queryKey: ['allSkus'], queryFn: () => productsApi.getAllSkus().then(r => r.data) });

    const [showComplete, setShowComplete] = useState<any>(null);
    const [qtyCompleted, setQtyCompleted] = useState(0);
    const [showAddItem, setShowAddItem] = useState<string | null>(null); // date string
    const [newItem, setNewItem] = useState({ skuId: '', qty: 1 });
    const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: ['productionBatches'] });
        queryClient.invalidateQueries({ queryKey: ['productionCapacity'] });
    };

    const startBatch = useMutation({ mutationFn: (id: string) => productionApi.startBatch(id), onSuccess: invalidateAll });
    const completeBatch = useMutation({ mutationFn: ({ id, data }: any) => productionApi.completeBatch(id, data), onSuccess: () => { invalidateAll(); setShowComplete(null); } });
    const updateBatch = useMutation({ mutationFn: ({ id, data }: { id: string; data: any }) => productionApi.updateBatch(id, data), onSuccess: invalidateAll });
    const deleteBatch = useMutation({ mutationFn: (id: string) => productionApi.deleteBatch(id), onSuccess: invalidateAll });
    const createBatch = useMutation({
        mutationFn: (data: any) => productionApi.createBatch(data),
        onSuccess: () => { invalidateAll(); setShowAddItem(null); setNewItem({ skuId: '', qty: 1 }); }
    });

    // Group batches by date
    const groupBatchesByDate = (batches: any[]) => {
        if (!batches) return [];
        const groups: Record<string, any[]> = {};

        batches.forEach(batch => {
            const dateKey = new Date(batch.batchDate).toISOString().split('T')[0];
            if (!groups[dateKey]) groups[dateKey] = [];
            groups[dateKey].push(batch);
        });

        // Sort dates descending (most recent first), but put future dates at top
        const today = new Date().toISOString().split('T')[0];
        return Object.entries(groups)
            .sort(([a], [b]) => {
                if (a >= today && b < today) return -1;
                if (a < today && b >= today) return 1;
                return b.localeCompare(a);
            })
            .map(([date, items]) => ({
                date,
                displayDate: formatDate(date),
                isToday: date === today,
                isFuture: date > today,
                isPast: date < today,
                batches: items.sort((a, b) => a.sku?.skuCode?.localeCompare(b.sku?.skuCode || '') || 0),
                totalPlanned: items.reduce((sum, b) => sum + b.qtyPlanned, 0),
                totalCompleted: items.reduce((sum, b) => sum + b.qtyCompleted, 0),
                allCompleted: items.every(b => b.status === 'completed'),
                hasInProgress: items.some(b => b.status === 'in_progress')
            }));
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        if (date.getTime() === today.getTime()) return 'Today';
        if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';

        return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    };

    const toggleDate = (date: string) => {
        const newSet = new Set(expandedDates);
        if (newSet.has(date)) newSet.delete(date);
        else newSet.add(date);
        setExpandedDates(newSet);
    };

    const handleAddItem = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showAddItem || !newItem.skuId) return;
        createBatch.mutate({
            skuId: newItem.skuId,
            qtyPlanned: newItem.qty,
            priority: 'stock_replenishment',
            batchDate: showAddItem
        });
    };

    const dateGroups = groupBatchesByDate(batches);

    // Expand today and tomorrow by default
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    if (expandedDates.size === 0 && dateGroups.length > 0) {
        const initial = new Set<string>();
        dateGroups.forEach(g => {
            if (g.date === today || g.date === tomorrow || g.isFuture) {
                initial.add(g.date);
            }
        });
        if (initial.size > 0) setExpandedDates(initial);
    }

    if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div></div>;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Production</h1>
                <button
                    onClick={() => setShowAddItem(today)}
                    className="btn-primary flex items-center text-sm"
                >
                    <Plus size={18} className="mr-1" />Add to Plan
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-4 border-b text-sm">
                <button className={`pb-2 font-medium ${tab === 'schedule' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => setTab('schedule')}>Schedule</button>
                <button className={`pb-2 font-medium ${tab === 'capacity' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => setTab('capacity')}>Capacity</button>
                <button className={`pb-2 font-medium ${tab === 'tailors' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => setTab('tailors')}>Tailors</button>
            </div>

            {/* Date-wise Schedule */}
            {tab === 'schedule' && (
                <div className="space-y-2">
                    {dateGroups.length === 0 && (
                        <div className="text-center text-gray-400 py-12">No production scheduled</div>
                    )}
                    {dateGroups.map(group => (
                        <div key={group.date} className={`border rounded-lg overflow-hidden ${group.isToday ? 'border-orange-300' : 'border-gray-200'}`}>
                            {/* Date Header */}
                            <div
                                className={`flex items-center justify-between px-4 py-2 cursor-pointer ${
                                    group.isToday ? 'bg-orange-50' :
                                    group.isFuture ? 'bg-blue-50' :
                                    'bg-gray-50'
                                }`}
                                onClick={() => toggleDate(group.date)}
                            >
                                <div className="flex items-center gap-3">
                                    {expandedDates.has(group.date) ?
                                        <ChevronDown size={16} className="text-gray-400" /> :
                                        <ChevronRight size={16} className="text-gray-400" />
                                    }
                                    <span className={`font-medium ${group.isToday ? 'text-orange-700' : group.isFuture ? 'text-blue-700' : 'text-gray-700'}`}>
                                        {group.displayDate}
                                    </span>
                                    <span className="text-xs text-gray-400">{group.date}</span>
                                </div>
                                <div className="flex items-center gap-4 text-sm">
                                    <span className="text-gray-500">{group.batches.length} items</span>
                                    <span className={group.allCompleted ? 'text-green-600' : group.hasInProgress ? 'text-yellow-600' : 'text-gray-500'}>
                                        {group.totalCompleted}/{group.totalPlanned} done
                                    </span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setShowAddItem(group.date); }}
                                        className="text-xs text-gray-400 hover:text-gray-600"
                                    >
                                        <Plus size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Batch Items */}
                            {expandedDates.has(group.date) && (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-t text-left text-gray-500 text-xs uppercase tracking-wide bg-white">
                                            <th className="py-2 px-4 font-medium">SKU</th>
                                            <th className="py-2 px-4 font-medium">Product</th>
                                            <th className="py-2 px-4 font-medium text-center">Planned</th>
                                            <th className="py-2 px-4 font-medium text-center">Done</th>
                                            <th className="py-2 px-4 font-medium">Status</th>
                                            <th className="py-2 px-4 font-medium">Order</th>
                                            <th className="py-2 px-4 font-medium w-32">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {group.batches.map((batch: any) => (
                                            <tr key={batch.id} className="border-t hover:bg-gray-50">
                                                <td className="py-2 px-4 font-mono text-xs">{batch.sku?.skuCode}</td>
                                                <td className="py-2 px-4 text-gray-600">
                                                    {batch.sku?.variation?.product?.name} - {batch.sku?.variation?.colorName} - {batch.sku?.size}
                                                </td>
                                                <td className="py-2 px-4 text-center">{batch.qtyPlanned}</td>
                                                <td className="py-2 px-4 text-center">
                                                    <span className={batch.qtyCompleted > 0 ? 'text-green-600' : 'text-gray-400'}>
                                                        {batch.qtyCompleted}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-4">
                                                    <span className={`text-xs ${
                                                        batch.status === 'completed' ? 'text-green-600' :
                                                        batch.status === 'in_progress' ? 'text-yellow-600' :
                                                        'text-gray-400'
                                                    }`}>
                                                        {batch.status}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-4 text-xs text-gray-400">
                                                    {batch.sourceOrderLineId ? 'order' : '-'}
                                                </td>
                                                <td className="py-2 px-4">
                                                    <div className="flex items-center gap-2">
                                                        {batch.status === 'planned' && (
                                                            <>
                                                                <button
                                                                    onClick={() => startBatch.mutate(batch.id)}
                                                                    className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                                                                >
                                                                    <Play size={12} />Start
                                                                </button>
                                                                <input
                                                                    type="date"
                                                                    className="text-xs border rounded px-1 py-0.5 w-28"
                                                                    value={batch.batchDate?.split('T')[0]}
                                                                    onChange={(e) => updateBatch.mutate({ id: batch.id, data: { batchDate: e.target.value } })}
                                                                />
                                                                <button
                                                                    onClick={() => deleteBatch.mutate(batch.id)}
                                                                    className="text-gray-400 hover:text-red-500"
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                            </>
                                                        )}
                                                        {batch.status === 'in_progress' && (
                                                            <button
                                                                onClick={() => { setShowComplete(batch); setQtyCompleted(batch.qtyPlanned); }}
                                                                className="text-xs text-green-600 hover:underline flex items-center gap-0.5"
                                                            >
                                                                <CheckCircle size={12} />Complete
                                                            </button>
                                                        )}
                                                        {batch.status === 'completed' && (
                                                            <span className="text-xs text-green-500">✓</span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Capacity */}
            {tab === 'capacity' && (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {capacity?.map((t: any) => (
                        <div key={t.tailorId} className="card">
                            <h3 className="font-semibold">{t.tailorName}</h3>
                            <div className="mt-3">
                                <div className="flex justify-between text-sm mb-1"><span>Utilization</span><span>{t.utilizationPct}%</span></div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div className={`h-2 rounded-full ${Number(t.utilizationPct) > 90 ? 'bg-red-500' : Number(t.utilizationPct) > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, t.utilizationPct)}%` }} />
                                </div>
                            </div>
                            <p className="text-sm text-gray-500 mt-2">{t.allocatedMins} / {t.dailyCapacityMins} mins</p>
                            <p className="text-sm text-gray-500">{t.batches?.length || 0} batches today</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Tailors */}
            {tab === 'tailors' && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b text-left text-gray-500 text-xs uppercase tracking-wide">
                                <th className="pb-2 pr-4 font-medium">Name</th>
                                <th className="pb-2 pr-4 font-medium">Specializations</th>
                                <th className="pb-2 pr-4 font-medium text-right">Daily Capacity</th>
                                <th className="pb-2 font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tailors?.map((t: any) => (
                                <tr key={t.id} className="border-b border-gray-100">
                                    <td className="py-2 pr-4 font-medium">{t.name}</td>
                                    <td className="py-2 pr-4 text-gray-600">{t.specializations?.join(', ') || '-'}</td>
                                    <td className="py-2 pr-4 text-right">{t.dailyCapacityMins} mins</td>
                                    <td className="py-2">
                                        <span className={`text-xs ${t.isActive ? 'text-green-600' : 'text-red-500'}`}>
                                            {t.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Complete Modal */}
            {showComplete && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-sm">
                        <h2 className="text-lg font-semibold mb-2">Complete Batch</h2>
                        <p className="text-sm text-gray-500 mb-4">{showComplete.sku?.skuCode} - Planned: {showComplete.qtyPlanned}</p>
                        <div className="mb-4">
                            <label className="text-xs text-gray-500 mb-1 block">Quantity Completed</label>
                            <input type="number" className="input text-sm" value={qtyCompleted} onChange={(e) => setQtyCompleted(Number(e.target.value))} min={1} max={showComplete.qtyPlanned} />
                        </div>
                        <div className="flex gap-3">
                            <button type="button" onClick={() => setShowComplete(null)} className="btn-secondary flex-1 text-sm">Cancel</button>
                            <button onClick={() => completeBatch.mutate({ id: showComplete.id, data: { qtyCompleted } })} className="btn-primary flex-1 text-sm" disabled={completeBatch.isPending}>
                                {completeBatch.isPending ? 'Completing...' : 'Complete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Item Modal */}
            {showAddItem && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add to Production</h2>
                            <button onClick={() => setShowAddItem(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleAddItem} className="space-y-4">
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Production Date</label>
                                <input
                                    type="date"
                                    className="input text-sm"
                                    value={showAddItem}
                                    min={new Date().toISOString().split('T')[0]}
                                    onChange={(e) => setShowAddItem(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">SKU</label>
                                <select
                                    className="input text-sm"
                                    value={newItem.skuId}
                                    onChange={(e) => setNewItem(n => ({ ...n, skuId: e.target.value }))}
                                    required
                                >
                                    <option value="">Select SKU...</option>
                                    {allSkus?.map((sku: any) => (
                                        <option key={sku.id} value={sku.id}>
                                            {sku.skuCode} - {sku.variation?.product?.name} {sku.size}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Quantity</label>
                                <input
                                    type="number"
                                    className="input text-sm"
                                    value={newItem.qty}
                                    onChange={(e) => setNewItem(n => ({ ...n, qty: Number(e.target.value) }))}
                                    min={1}
                                    required
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddItem(null)} className="btn-secondary flex-1 text-sm">Cancel</button>
                                <button type="submit" className="btn-primary flex-1 text-sm" disabled={createBatch.isPending}>
                                    {createBatch.isPending ? 'Adding...' : 'Add to Plan'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
