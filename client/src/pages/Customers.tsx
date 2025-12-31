import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../services/api';
import { useState } from 'react';
import { Crown, Medal, AlertTriangle, TrendingDown } from 'lucide-react';

export default function Customers() {
    const [tab, setTab] = useState<'all' | 'highValue' | 'atRisk' | 'returners'>('all');
    const { data: customers, isLoading } = useQuery({ queryKey: ['customers'], queryFn: () => customersApi.getAll().then(r => r.data) });
    const { data: highValue } = useQuery({ queryKey: ['highValueCustomers'], queryFn: () => customersApi.getHighValue().then(r => r.data) });
    const { data: atRisk } = useQuery({ queryKey: ['atRiskCustomers'], queryFn: () => customersApi.getAtRisk().then(r => r.data) });
    const { data: returners } = useQuery({ queryKey: ['frequentReturners'], queryFn: () => customersApi.getFrequentReturners().then(r => r.data) });
    const [search, setSearch] = useState('');

    const getTierIcon = (tier: string) => {
        if (tier === 'platinum') return <Crown size={16} className="text-purple-600" />;
        if (tier === 'gold') return <Medal size={16} className="text-yellow-600" />;
        if (tier === 'silver') return <Medal size={16} className="text-gray-400" />;
        return null;
    };

    const getTierBadge = (tier: string) => {
        const colors: Record<string, string> = { platinum: 'bg-purple-100 text-purple-800', gold: 'bg-yellow-100 text-yellow-800', silver: 'bg-gray-100 text-gray-800', bronze: 'bg-orange-100 text-orange-800' };
        return colors[tier] || colors.bronze;
    };

    const displayData = tab === 'all' ? customers?.filter((c: any) => !search || c.email.toLowerCase().includes(search.toLowerCase()) || `${c.firstName} ${c.lastName}`.toLowerCase().includes(search.toLowerCase()))
        : tab === 'highValue' ? highValue : tab === 'atRisk' ? atRisk : returners;

    if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-gray-900">Customers</h1>

            {/* Tabs */}
            <div className="flex flex-wrap gap-2 border-b">
                <button className={`px-4 py-2 font-medium flex items-center gap-2 ${tab === 'all' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('all')}>All ({customers?.length || 0})</button>
                <button className={`px-4 py-2 font-medium flex items-center gap-2 ${tab === 'highValue' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('highValue')}><Crown size={16} />High Value</button>
                <button className={`px-4 py-2 font-medium flex items-center gap-2 ${tab === 'atRisk' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('atRisk')}><TrendingDown size={16} />At Risk</button>
                <button className={`px-4 py-2 font-medium flex items-center gap-2 ${tab === 'returners' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('returners')}><AlertTriangle size={16} />Frequent Returners</button>
            </div>

            {tab === 'all' && <input type="text" placeholder="Search by name or email..." className="input max-w-md" value={search} onChange={(e) => setSearch(e.target.value)} />}

            {/* Customer Table */}
            <div className="card overflow-x-auto">
                <table className="w-full">
                    <thead><tr className="border-b">
                        <th className="table-header">Customer</th><th className="table-header">Email</th><th className="table-header text-right">Orders</th><th className="table-header text-right">LTV</th>
                        {tab === 'all' && <th className="table-header">Tier</th>}
                        {tab === 'atRisk' && <th className="table-header text-right">Days Inactive</th>}
                        {tab === 'returners' && <th className="table-header text-right">Return Rate</th>}
                    </tr></thead>
                    <tbody>
                        {displayData?.map((c: any) => (
                            <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="table-cell"><div className="flex items-center gap-2">{getTierIcon(c.customerTier)}<span className="font-medium">{c.firstName} {c.lastName}</span></div></td>
                                <td className="table-cell text-gray-500">{c.email}</td>
                                <td className="table-cell text-right">{c.totalOrders}</td>
                                <td className="table-cell text-right font-medium">₹{Number(c.lifetimeValue).toLocaleString()}</td>
                                {tab === 'all' && <td className="table-cell"><span className={`badge ${getTierBadge(c.customerTier)}`}>{c.customerTier}</span></td>}
                                {tab === 'atRisk' && <td className="table-cell text-right text-red-600 font-medium">{c.daysSinceLastOrder}</td>}
                                {tab === 'returners' && <td className="table-cell text-right text-red-600 font-medium">{c.returnRate}%</td>}
                            </tr>
                        ))}
                    </tbody>
                </table>
                {displayData?.length === 0 && <p className="text-center py-8 text-gray-500">No customers found</p>}
            </div>
        </div>
    );
}
