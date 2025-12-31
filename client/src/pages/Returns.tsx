import { useQuery } from '@tanstack/react-query';
import { returnsApi } from '../services/api';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function Returns() {
    const [tab, setTab] = useState<'all' | 'pending' | 'analytics'>('all');
    const { data: returns, isLoading } = useQuery({ queryKey: ['returns'], queryFn: () => returnsApi.getAll().then(r => r.data) });
    const { data: analytics } = useQuery({ queryKey: ['returnAnalytics'], queryFn: () => returnsApi.getAnalyticsByProduct().then(r => r.data) });

    const getStatusBadge = (status: string) => {
        const colors: Record<string, string> = { requested: 'badge-info', reverse_initiated: 'badge-warning', in_transit: 'badge-warning', received: 'badge-info', inspected: 'badge-info', resolved: 'badge-success', cancelled: 'badge-danger' };
        return colors[status] || 'badge-info';
    };

    const pendingReturns = returns?.filter((r: any) => !['resolved', 'cancelled'].includes(r.status));

    if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Returns & Exchanges</h1>
                <button className="btn-primary">New Return</button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b">
                <button className={`px-4 py-2 font-medium ${tab === 'all' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('all')}>All ({returns?.length || 0})</button>
                <button className={`px-4 py-2 font-medium ${tab === 'pending' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('pending')}>Pending ({pendingReturns?.length || 0})</button>
                <button className={`px-4 py-2 font-medium ${tab === 'analytics' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('analytics')}>Analytics</button>
            </div>

            {/* Returns List */}
            {(tab === 'all' || tab === 'pending') && (
                <div className="card overflow-x-auto">
                    <table className="w-full">
                        <thead><tr className="border-b">
                            <th className="table-header">Request #</th><th className="table-header">Type</th><th className="table-header">Order</th><th className="table-header">Reason</th><th className="table-header text-right">Age</th><th className="table-header">Status</th>
                        </tr></thead>
                        <tbody>
                            {(tab === 'pending' ? pendingReturns : returns)?.map((r: any) => (
                                <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                                    <td className="table-cell font-medium">{r.requestNumber}</td>
                                    <td className="table-cell"><span className={`badge ${r.requestType === 'return' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>{r.requestType}</span></td>
                                    <td className="table-cell">{r.originalOrder?.orderNumber}</td>
                                    <td className="table-cell">{r.reasonCategory?.replace('_', ' ')}</td>
                                    <td className="table-cell text-right">{r.ageDays}d</td>
                                    <td className="table-cell"><span className={`badge ${getStatusBadge(r.status)}`}>{r.status.replace('_', ' ')}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {(tab === 'pending' ? pendingReturns : returns)?.length === 0 && <p className="text-center py-8 text-gray-500">No returns found</p>}
                </div>
            )}

            {/* Analytics */}
            {tab === 'analytics' && (
                <div className="card overflow-x-auto">
                    <h2 className="text-lg font-semibold mb-4">Return Rate by Product</h2>
                    <table className="w-full">
                        <thead><tr className="border-b"><th className="table-header">Product</th><th className="table-header text-right">Sold</th><th className="table-header text-right">Returned</th><th className="table-header text-right">Rate</th><th className="table-header">Alert</th></tr></thead>
                        <tbody>
                            {analytics?.filter((a: any) => a.timesSold > 0).map((a: any) => (
                                <tr key={a.productId} className="border-b last:border-0">
                                    <td className="table-cell font-medium">{a.productName}</td>
                                    <td className="table-cell text-right">{a.timesSold}</td>
                                    <td className="table-cell text-right">{a.timesReturned}</td>
                                    <td className="table-cell text-right font-medium">{a.returnRate}%</td>
                                    <td className="table-cell">{a.flagged && <AlertTriangle size={16} className="text-red-500" />}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
