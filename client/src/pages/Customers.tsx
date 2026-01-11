import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../services/api';
import { useState, useMemo } from 'react';
import { Crown, Medal, AlertTriangle, TrendingDown, ShoppingBag, Clock, TrendingUp, Repeat } from 'lucide-react';
import CustomerDetailModal from '../components/orders/CustomerDetailModal';

// Debounce hook for search
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);
    useMemo(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

const PAGE_SIZE = 50;

// Format relative time (e.g., "2 days ago", "3 months ago")
function formatRelativeTime(date: string | Date | null): string {
    if (!date) return '-';
    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
    }
    if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        return months === 1 ? '1 month ago' : `${months} months ago`;
    }
    const years = Math.floor(diffDays / 365);
    return years === 1 ? '1 year ago' : `${years} years ago`;
}

// Format short date (e.g., "15 Jan")
function formatShortDate(date: string | Date | null): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const TOP_N_OPTIONS = [10, 20, 50, 100, 500, 1000, 5000];
const TIME_PERIOD_OPTIONS = [
    { value: 'all', label: 'All Time' },
    { value: 3, label: 'Last 3 Months' },
    { value: 6, label: 'Last 6 Months' },
    { value: 12, label: 'Last 12 Months' },
    { value: 24, label: 'Last 24 Months' },
    { value: 36, label: 'Last 36 Months' },
    { value: 48, label: 'Last 48 Months' },
];

export default function Customers() {
    const [tab, setTab] = useState<'all' | 'highValue' | 'atRisk' | 'returners'>('all');
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const [topN, setTopN] = useState(100);
    const [timePeriod, setTimePeriod] = useState<number | 'all'>('all');
    const debouncedSearch = useDebounce(search, 300);

    // Reset page when search changes
    useMemo(() => { setPage(0); }, [debouncedSearch]);

    // Server-side search and pagination
    const { data: customers, isLoading, isFetching } = useQuery({
        queryKey: ['customers', debouncedSearch, page],
        queryFn: () => customersApi.getAll({
            ...(debouncedSearch && { search: debouncedSearch }),
            limit: String(PAGE_SIZE),
            offset: String(page * PAGE_SIZE)
        }).then(r => r.data),
    });
    const { data: overviewStats } = useQuery({
        queryKey: ['customerOverviewStats', timePeriod],
        queryFn: () => customersApi.getOverviewStats(timePeriod).then(r => r.data),
    });
    const { data: highValueData } = useQuery({
        queryKey: ['highValueCustomers', topN],
        queryFn: () => customersApi.getHighValue(topN).then(r => r.data),
    });
    const { data: atRisk } = useQuery({ queryKey: ['atRiskCustomers'], queryFn: () => customersApi.getAtRisk().then(r => r.data) });
    const { data: returners } = useQuery({ queryKey: ['frequentReturners'], queryFn: () => customersApi.getFrequentReturners().then(r => r.data) });

    // Extract customers and stats from high value response
    const highValue = highValueData?.customers || [];
    const highValueStats = highValueData?.stats;

    const hasMore = customers?.length === PAGE_SIZE;

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

    // Display data - server handles filtering for 'all' tab
    const displayData = tab === 'all' ? customers
        : tab === 'highValue' ? highValue : tab === 'atRisk' ? atRisk : returners;

    if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

    return (
        <div className="space-y-4 md:space-y-6">
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Customers</h1>

            {/* Tabs */}
            <div className="flex flex-wrap gap-1 md:gap-2 border-b overflow-x-auto">
                <button className={`px-4 py-2 font-medium flex items-center gap-2 ${tab === 'all' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => { setTab('all'); setPage(0); }}>All</button>
                <button className={`px-4 py-2 font-medium flex items-center gap-2 ${tab === 'highValue' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('highValue')}><Crown size={16} />High Value</button>
                <button className={`px-4 py-2 font-medium flex items-center gap-2 ${tab === 'atRisk' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('atRisk')}><TrendingDown size={16} />At Risk</button>
                <button className={`px-4 py-2 font-medium flex items-center gap-2 ${tab === 'returners' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('returners')}><AlertTriangle size={16} />Frequent Returners</button>
            </div>

            {/* All Customers Analytics Dashboard */}
            {tab === 'all' && (
                <div className="space-y-6">
                    {/* Controls Row */}
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <select
                                value={timePeriod}
                                onChange={(e) => setTimePeriod(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                                className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-full border-0 cursor-pointer hover:bg-gray-800 transition-colors"
                            >
                                {TIME_PERIOD_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="relative flex-1 max-w-md">
                            <input
                                type="text"
                                placeholder="Search customers..."
                                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border-0 rounded-full text-sm focus:ring-2 focus:ring-gray-200 focus:bg-white transition-all"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>

                    {/* Analytics Dashboard */}
                    {overviewStats && (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                            {/* Hero Metrics - Revenue & Retention */}
                            <div className="lg:col-span-5 grid grid-cols-2 gap-4">
                                {/* Total Revenue - Hero Card */}
                                <div className="col-span-2 relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                                    <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
                                    <div className="relative">
                                        <p className="text-emerald-100 text-sm font-medium tracking-wide uppercase">Total Revenue</p>
                                        <p className="text-4xl font-bold mt-2 tracking-tight">₹{(overviewStats.totalRevenue / 100000).toFixed(1)}L</p>
                                        <p className="text-emerald-200 text-sm mt-1">{overviewStats.totalOrders.toLocaleString()} orders</p>
                                    </div>
                                </div>

                                {/* Repeat Rate - Highlight */}
                                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 p-5 text-white">
                                    <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/10 rounded-full" />
                                    <p className="text-violet-200 text-xs font-medium tracking-wide uppercase">Repeat Rate</p>
                                    <p className="text-3xl font-bold mt-1">{overviewStats.repeatRate}%</p>
                                    <p className="text-violet-200 text-xs mt-1">{overviewStats.repeatCustomers.toLocaleString()} returning</p>
                                </div>

                                {/* AOV */}
                                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 p-5 text-white">
                                    <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/10 rounded-full" />
                                    <p className="text-blue-200 text-xs font-medium tracking-wide uppercase">Avg Order Value</p>
                                    <p className="text-3xl font-bold mt-1">₹{overviewStats.avgOrderValue.toLocaleString()}</p>
                                    <p className="text-blue-200 text-xs mt-1">per order</p>
                                </div>
                            </div>

                            {/* Customer Breakdown */}
                            <div className="lg:col-span-4 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Customer Base</h3>
                                    <span className="text-2xl font-bold text-gray-900">{overviewStats.totalCustomers.toLocaleString()}</span>
                                </div>

                                {/* Visual breakdown bar */}
                                <div className="h-3 rounded-full bg-gray-100 overflow-hidden flex mb-4">
                                    <div
                                        className="bg-emerald-500 transition-all"
                                        style={{ width: `${(overviewStats.newCustomers / overviewStats.totalCustomers) * 100}%` }}
                                    />
                                    <div
                                        className="bg-violet-500 transition-all"
                                        style={{ width: `${(overviewStats.repeatCustomers / overviewStats.totalCustomers) * 100}%` }}
                                    />
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                            <span className="text-sm text-gray-600">New Customers</span>
                                        </div>
                                        <span className="text-sm font-semibold text-gray-900">{overviewStats.newCustomers.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                                            <span className="text-sm text-gray-600">Repeat Customers</span>
                                        </div>
                                        <span className="text-sm font-semibold text-gray-900">{overviewStats.repeatCustomers.toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Engagement Metrics */}
                            <div className="lg:col-span-3 space-y-4">
                                <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Avg Lifetime Value</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">₹{overviewStats.avgLTV.toLocaleString()}</p>
                                    <div className="flex items-center gap-1 mt-1">
                                        <TrendingUp size={12} className="text-emerald-500" />
                                        <span className="text-xs text-emerald-600 font-medium">per customer</span>
                                    </div>
                                </div>

                                <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Avg Orders</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">{overviewStats.avgOrdersPerCustomer}</p>
                                    <p className="text-xs text-gray-500 mt-1">orders per customer</p>
                                </div>

                                <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Order Frequency</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">{overviewStats.avgOrderFrequency}<span className="text-base font-normal text-gray-500">/mo</span></p>
                                    <p className="text-xs text-gray-500 mt-1">avg purchase rate</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* High Value Analytics Dashboard */}
            {tab === 'highValue' && (
                <div className="space-y-6">
                    {/* Controls Row */}
                    <div className="flex items-center gap-3">
                        <select
                            value={topN}
                            onChange={(e) => setTopN(Number(e.target.value))}
                            className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-full border-0 cursor-pointer hover:bg-gray-800 transition-colors"
                        >
                            {TOP_N_OPTIONS.map(n => (
                                <option key={n} value={n}>Top {n.toLocaleString()} by LTV</option>
                            ))}
                        </select>
                    </div>

                    {/* Analytics Dashboard */}
                    {highValueStats && (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                            {/* Hero Metrics - Revenue & LTV */}
                            <div className="lg:col-span-5 grid grid-cols-2 gap-4">
                                {/* Total Revenue - Hero Card */}
                                <div className="col-span-2 relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 p-6 text-white">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                                    <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
                                    <div className="relative">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Crown size={16} className="text-amber-200" />
                                            <p className="text-amber-100 text-sm font-medium tracking-wide uppercase">High Value Revenue</p>
                                        </div>
                                        <p className="text-4xl font-bold mt-2 tracking-tight">₹{(highValueStats.totalRevenue / 100000).toFixed(1)}L</p>
                                        <p className="text-amber-200 text-sm mt-1">from {highValueStats.totalCustomers.toLocaleString()} top customers</p>
                                    </div>
                                </div>

                                {/* Avg LTV - Highlight */}
                                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 p-5 text-white">
                                    <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/10 rounded-full" />
                                    <p className="text-purple-200 text-xs font-medium tracking-wide uppercase">Avg LTV</p>
                                    <p className="text-3xl font-bold mt-1">₹{(highValueStats.avgLTV / 1000).toFixed(1)}K</p>
                                    <p className="text-purple-200 text-xs mt-1">per customer</p>
                                </div>

                                {/* Avg AOV */}
                                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 p-5 text-white">
                                    <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/10 rounded-full" />
                                    <p className="text-cyan-200 text-xs font-medium tracking-wide uppercase">Avg Order Value</p>
                                    <p className="text-3xl font-bold mt-1">₹{highValueStats.avgAOV.toLocaleString()}</p>
                                    <p className="text-cyan-200 text-xs mt-1">per order</p>
                                </div>
                            </div>

                            {/* Customer Snapshot */}
                            <div className="lg:col-span-4 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Top Customers</h3>
                                    <Crown size={20} className="text-amber-500" />
                                </div>

                                <div className="text-center py-4">
                                    <p className="text-5xl font-bold text-gray-900">{highValueStats.totalCustomers.toLocaleString()}</p>
                                    <p className="text-sm text-gray-500 mt-1">High Value Customers</p>
                                </div>

                                {/* Visual representation */}
                                <div className="flex items-end justify-center gap-1 h-16 mt-4">
                                    {[0.4, 0.6, 0.8, 1, 0.9, 0.7, 0.5, 0.3].map((h, i) => (
                                        <div
                                            key={i}
                                            className="w-4 rounded-t bg-gradient-to-t from-amber-400 to-orange-500 transition-all"
                                            style={{ height: `${h * 100}%` }}
                                        />
                                    ))}
                                </div>

                                <div className="mt-4 pt-4 border-t border-gray-100">
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-gray-500">Total Orders</span>
                                        <span className="font-semibold text-gray-900">{highValueStats.totalOrders.toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Engagement Metrics */}
                            <div className="lg:col-span-3 space-y-4">
                                <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Avg Orders</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">{highValueStats.avgOrdersPerCustomer}</p>
                                    <div className="flex items-center gap-1 mt-1">
                                        <ShoppingBag size={12} className="text-amber-500" />
                                        <span className="text-xs text-amber-600 font-medium">per customer</span>
                                    </div>
                                </div>

                                <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Order Frequency</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">{highValueStats.avgOrderFrequency}<span className="text-base font-normal text-gray-500">/mo</span></p>
                                    <div className="flex items-center gap-1 mt-1">
                                        <Repeat size={12} className="text-purple-500" />
                                        <span className="text-xs text-purple-600 font-medium">purchase rate</span>
                                    </div>
                                </div>

                                <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-5 text-white">
                                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Revenue Share</p>
                                    <p className="text-2xl font-bold mt-1">Elite</p>
                                    <p className="text-xs text-gray-400 mt-1">Top {topN} customers</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Customer Table */}
            <div className="card table-scroll-container">
                <table className="w-full" style={{ minWidth: '600px' }}>
                    <thead><tr className="border-b">
                        <th className="table-header">Customer</th><th className="table-header">Email</th><th className="table-header text-right">Orders</th><th className="table-header text-right">LTV</th>
                        {tab === 'all' && <th className="table-header">Tier</th>}
                        {tab === 'highValue' && <th className="table-header text-right">AOV</th>}
                        {tab === 'highValue' && <th className="table-header">Last Order</th>}
                        {tab === 'atRisk' && <th className="table-header text-right">Days Inactive</th>}
                        {tab === 'returners' && <th className="table-header text-right">Return Rate</th>}
                    </tr></thead>
                    <tbody>
                        {displayData?.map((c: any) => (
                            <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedCustomerId(c.id)}>
                                <td className="table-cell"><div className="flex items-center gap-2">{getTierIcon(c.customerTier)}<span className="font-medium">{c.firstName} {c.lastName}</span></div></td>
                                <td className="table-cell text-gray-500">{c.email}</td>
                                <td className="table-cell text-right">{c.totalOrders}</td>
                                <td className="table-cell text-right font-medium">₹{Number(c.lifetimeValue).toLocaleString()}</td>
                                {tab === 'all' && <td className="table-cell"><span className={`badge ${getTierBadge(c.customerTier)}`}>{c.customerTier}</span></td>}
                                {tab === 'highValue' && <td className="table-cell text-right text-gray-600">₹{Number(c.avgOrderValue || 0).toLocaleString()}</td>}
                                {tab === 'highValue' && (
                                    <td className="table-cell">
                                        <div className="flex items-center gap-1.5 text-gray-600">
                                            <Clock size={12} className="text-gray-400" />
                                            <span className="text-sm">{formatShortDate(c.lastOrderDate)}</span>
                                            <span className="text-xs text-gray-400">({formatRelativeTime(c.lastOrderDate)})</span>
                                        </div>
                                    </td>
                                )}
                                {tab === 'atRisk' && <td className="table-cell text-right text-red-600 font-medium">{c.daysSinceLastOrder}</td>}
                                {tab === 'returners' && <td className="table-cell text-right text-red-600 font-medium">{c.returnRate}%</td>}
                            </tr>
                        ))}
                    </tbody>
                </table>
                {displayData?.length === 0 && <p className="text-center py-8 text-gray-500">No customers found</p>}

                {/* Pagination controls - only for 'all' tab */}
                {tab === 'all' && (customers?.length ?? 0) > 0 && (
                    <div className="flex items-center justify-between p-4 border-t">
                        <div className="text-sm text-gray-500">
                            Showing {page * PAGE_SIZE + 1} - {page * PAGE_SIZE + (customers?.length || 0)}
                            {isFetching && <span className="ml-2 text-gray-400">(loading...)</span>}
                        </div>
                        <div className="flex gap-2">
                            <button
                                className="btn btn-secondary text-sm"
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                            >
                                Previous
                            </button>
                            <button
                                className="btn btn-secondary text-sm"
                                onClick={() => setPage(p => p + 1)}
                                disabled={!hasMore}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Customer Detail Modal */}
            <CustomerDetailModal
                customerId={selectedCustomerId}
                onClose={() => setSelectedCustomerId(null)}
            />
        </div>
    );
}
