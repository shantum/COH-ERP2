import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionApi } from '../services/api';
import { useState } from 'react';
import { Plus, Play, CheckCircle } from 'lucide-react';

export default function Production() {
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<'batches' | 'capacity' | 'tailors'>('batches');
    const { data: batches, isLoading } = useQuery({ queryKey: ['productionBatches'], queryFn: () => productionApi.getBatches().then(r => r.data) });
    const { data: capacity } = useQuery({ queryKey: ['productionCapacity'], queryFn: () => productionApi.getCapacity().then(r => r.data) });
    const { data: tailors } = useQuery({ queryKey: ['tailors'], queryFn: () => productionApi.getTailors().then(r => r.data) });

    const [showComplete, setShowComplete] = useState<any>(null);
    const [qtyCompleted, setQtyCompleted] = useState(0);

    const startBatch = useMutation({ mutationFn: (id: string) => productionApi.startBatch(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['productionBatches'] }) });
    const completeBatch = useMutation({ mutationFn: ({ id, data }: any) => productionApi.completeBatch(id, data), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['productionBatches'] }); setShowComplete(null); } });

    const getStatusBadge = (status: string) => {
        const colors: Record<string, string> = { planned: 'badge-info', in_progress: 'badge-warning', completed: 'badge-success', cancelled: 'badge-danger' };
        return colors[status] || 'badge-info';
    };

    if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Production</h1>
                <button className="btn-primary flex items-center"><Plus size={20} className="mr-2" />New Batch</button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b">
                <button className={`px-4 py-2 font-medium ${tab === 'batches' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('batches')}>Batches</button>
                <button className={`px-4 py-2 font-medium ${tab === 'capacity' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('capacity')}>Capacity</button>
                <button className={`px-4 py-2 font-medium ${tab === 'tailors' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('tailors')}>Tailors</button>
            </div>

            {/* Batches */}
            {tab === 'batches' && (
                <div className="card overflow-x-auto">
                    <table className="w-full">
                        <thead><tr className="border-b">
                            <th className="table-header">Date</th><th className="table-header">SKU</th><th className="table-header">Product</th><th className="table-header">Tailor</th>
                            <th className="table-header text-center">Planned</th><th className="table-header text-center">Done</th><th className="table-header">Status</th><th className="table-header">Actions</th>
                        </tr></thead>
                        <tbody>
                            {batches?.map((b: any) => (
                                <tr key={b.id} className="border-b last:border-0">
                                    <td className="table-cell">{new Date(b.batchDate).toLocaleDateString()}</td>
                                    <td className="table-cell font-medium">{b.sku?.skuCode}</td>
                                    <td className="table-cell">{b.sku?.variation?.product?.name} - {b.sku?.variation?.colorName} - {b.sku?.size}</td>
                                    <td className="table-cell">{b.tailor?.name || '-'}</td>
                                    <td className="table-cell text-center">{b.qtyPlanned}</td>
                                    <td className="table-cell text-center">{b.qtyCompleted}</td>
                                    <td className="table-cell"><span className={`badge ${getStatusBadge(b.status)}`}>{b.status}</span></td>
                                    <td className="table-cell">
                                        {b.status === 'planned' && <button onClick={() => startBatch.mutate(b.id)} className="text-primary-600 hover:underline flex items-center gap-1"><Play size={14} />Start</button>}
                                        {b.status === 'in_progress' && <button onClick={() => { setShowComplete(b); setQtyCompleted(b.qtyPlanned); }} className="text-green-600 hover:underline flex items-center gap-1"><CheckCircle size={14} />Complete</button>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
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
                                <div className="w-full bg-gray-200 rounded-full h-2"><div className={`h-2 rounded-full ${Number(t.utilizationPct) > 90 ? 'bg-red-500' : Number(t.utilizationPct) > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, t.utilizationPct)}%` }} /></div>
                            </div>
                            <p className="text-sm text-gray-500 mt-2">{t.allocatedMins} / {t.dailyCapacityMins} mins</p>
                            <p className="text-sm text-gray-500">{t.batches?.length || 0} batches today</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Tailors */}
            {tab === 'tailors' && (
                <div className="card overflow-x-auto">
                    <table className="w-full">
                        <thead><tr className="border-b"><th className="table-header">Name</th><th className="table-header">Specializations</th><th className="table-header text-right">Daily Capacity</th><th className="table-header">Status</th></tr></thead>
                        <tbody>
                            {tailors?.map((t: any) => (
                                <tr key={t.id} className="border-b last:border-0">
                                    <td className="table-cell font-medium">{t.name}</td>
                                    <td className="table-cell">{t.specializations?.join(', ') || '-'}</td>
                                    <td className="table-cell text-right">{t.dailyCapacityMins} mins</td>
                                    <td className="table-cell"><span className={`badge ${t.isActive ? 'badge-success' : 'badge-danger'}`}>{t.isActive ? 'Active' : 'Inactive'}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Complete Modal */}
            {showComplete && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <h2 className="text-lg font-semibold mb-4">Complete Batch</h2>
                        <p className="text-gray-600 mb-4">{showComplete.sku?.skuCode} - Planned: {showComplete.qtyPlanned}</p>
                        <div className="mb-4"><label className="label">Quantity Completed</label><input type="number" className="input" value={qtyCompleted} onChange={(e) => setQtyCompleted(Number(e.target.value))} min={1} max={showComplete.qtyPlanned} /></div>
                        <div className="flex gap-3">
                            <button type="button" onClick={() => setShowComplete(null)} className="btn-secondary flex-1">Cancel</button>
                            <button onClick={() => completeBatch.mutate({ id: showComplete.id, data: { qtyCompleted } })} className="btn-primary flex-1" disabled={completeBatch.isPending}>{completeBatch.isPending ? 'Completing...' : 'Complete'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
