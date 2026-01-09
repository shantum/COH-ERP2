import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../services/api';
import { useState, useMemo } from 'react';
import { Crown, Medal, AlertTriangle, TrendingDown, X, Package, ShoppingBag, Calendar, Phone, Mail, Palette, Layers, Clock, Users, DollarSign, TrendingUp, Repeat } from 'lucide-react';

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

export default function Customers() {
    const [tab, setTab] = useState<'all' | 'highValue' | 'atRisk' | 'returners'>('all');
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const [topN, setTopN] = useState(100);
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
    const { data: highValueData } = useQuery({
        queryKey: ['highValueCustomers', topN],
        queryFn: () => customersApi.getHighValue(topN).then(r => r.data),
    });
    const { data: atRisk } = useQuery({ queryKey: ['atRiskCustomers'], queryFn: () => customersApi.getAtRisk().then(r => r.data) });
    const { data: returners } = useQuery({ queryKey: ['frequentReturners'], queryFn: () => customersApi.getFrequentReturners().then(r => r.data) });
    const { data: customerDetail, isLoading: detailLoading } = useQuery({
        queryKey: ['customer', selectedCustomerId],
        queryFn: () => customersApi.getById(selectedCustomerId!).then(r => r.data),
        enabled: !!selectedCustomerId
    });

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

    const getStatusBadge = (status: string) => {
        const colors: Record<string, string> = {
            open: 'bg-blue-100 text-blue-800',
            shipped: 'bg-yellow-100 text-yellow-800',
            delivered: 'bg-green-100 text-green-800',
            cancelled: 'bg-red-100 text-red-800',
            returned: 'bg-gray-100 text-gray-800'
        };
        return colors[status] || 'bg-gray-100 text-gray-800';
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

            {tab === 'all' && <input type="text" placeholder="Search by name or email..." className="input w-full sm:max-w-md" value={search} onChange={(e) => setSearch(e.target.value)} />}

            {/* High Value Analytics Bar */}
            {tab === 'highValue' && (
                <div className="space-y-4">
                    {/* Top N Selector */}
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-600">Show top</span>
                        <select
                            value={topN}
                            onChange={(e) => setTopN(Number(e.target.value))}
                            className="input py-1.5 px-3 w-auto"
                        >
                            {TOP_N_OPTIONS.map(n => (
                                <option key={n} value={n}>{n.toLocaleString()}</option>
                            ))}
                        </select>
                        <span className="text-sm text-gray-600">customers by LTV</span>
                    </div>

                    {/* Stats Cards */}
                    {highValueStats && (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                            <div className="bg-white border rounded-lg p-3">
                                <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                                    <Users size={14} />
                                    <span>Customers</span>
                                </div>
                                <p className="text-xl font-bold text-gray-900">{highValueStats.totalCustomers.toLocaleString()}</p>
                            </div>
                            <div className="bg-white border rounded-lg p-3">
                                <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                                    <DollarSign size={14} />
                                    <span>Total Revenue</span>
                                </div>
                                <p className="text-xl font-bold text-emerald-600">₹{highValueStats.totalRevenue.toLocaleString()}</p>
                            </div>
                            <div className="bg-white border rounded-lg p-3">
                                <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                                    <ShoppingBag size={14} />
                                    <span>Total Orders</span>
                                </div>
                                <p className="text-xl font-bold text-gray-900">{highValueStats.totalOrders.toLocaleString()}</p>
                            </div>
                            <div className="bg-white border rounded-lg p-3">
                                <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                                    <TrendingUp size={14} />
                                    <span>Avg LTV</span>
                                </div>
                                <p className="text-xl font-bold text-purple-600">₹{highValueStats.avgLTV.toLocaleString()}</p>
                            </div>
                            <div className="bg-white border rounded-lg p-3">
                                <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                                    <DollarSign size={14} />
                                    <span>Avg AOV</span>
                                </div>
                                <p className="text-xl font-bold text-blue-600">₹{highValueStats.avgAOV.toLocaleString()}</p>
                            </div>
                            <div className="bg-white border rounded-lg p-3">
                                <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                                    <Package size={14} />
                                    <span>Avg Orders</span>
                                </div>
                                <p className="text-xl font-bold text-gray-900">{highValueStats.avgOrdersPerCustomer}</p>
                            </div>
                            <div className="bg-white border rounded-lg p-3">
                                <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                                    <Repeat size={14} />
                                    <span>Order Freq</span>
                                </div>
                                <p className="text-xl font-bold text-amber-600">{highValueStats.avgOrderFrequency}/mo</p>
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
            {selectedCustomerId && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                            <h2 className="text-xl font-bold text-gray-900">Customer Details</h2>
                            <button onClick={() => setSelectedCustomerId(null)} className="p-2 hover:bg-gray-200 rounded-lg">
                                <X size={20} />
                            </button>
                        </div>

                        {detailLoading ? (
                            <div className="flex justify-center p-12">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                            </div>
                        ) : customerDetail ? (
                            <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
                                {/* Customer Info */}
                                <div className="p-4 border-b">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <div className="flex items-center gap-3 mb-2">
                                                <h3 className="text-lg font-semibold">{customerDetail.firstName} {customerDetail.lastName}</h3>
                                                <span className={`badge ${getTierBadge(customerDetail.customerTier)}`}>
                                                    {customerDetail.customerTier}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                                                <span className="flex items-center gap-1"><Mail size={14} />{customerDetail.email}</span>
                                                {customerDetail.phone && <span className="flex items-center gap-1"><Phone size={14} />{customerDetail.phone}</span>}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-2xl font-bold text-primary-600">₹{Number(customerDetail.lifetimeValue).toLocaleString()}</p>
                                            <p className="text-sm text-gray-500">Lifetime Value</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Stats Grid */}
                                <div className="grid grid-cols-3 gap-2 md:gap-4 p-3 md:p-4 border-b bg-gray-50">
                                    <div className="text-center">
                                        <p className="text-xl md:text-2xl font-bold text-gray-900">{customerDetail.totalOrders}</p>
                                        <p className="text-xs md:text-sm text-gray-500">Total Orders</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xl md:text-2xl font-bold text-gray-900">{customerDetail.returnRequests?.length || 0}</p>
                                        <p className="text-xs md:text-sm text-gray-500">Returns</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xl md:text-2xl font-bold text-gray-900">{customerDetail.productAffinity?.length || 0}</p>
                                        <p className="text-xs md:text-sm text-gray-500">Products Ordered</p>
                                    </div>
                                </div>

                                {/* Product Affinity */}
                                {customerDetail.productAffinity?.length > 0 && (
                                    <div className="p-4 border-b">
                                        <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                            <Package size={16} /> Top Products
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {customerDetail.productAffinity.map((p: any, i: number) => (
                                                <span key={i} className="px-3 py-1 bg-gray-100 rounded-full text-sm">
                                                    {p.productName} <span className="text-gray-500">({p.qty})</span>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Color Affinity */}
                                {customerDetail.colorAffinity?.length > 0 && (
                                    <div className="p-4 border-b">
                                        <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                            <Palette size={16} /> Top Colors
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {customerDetail.colorAffinity.map((c: any, i: number) => (
                                                <span key={i} className="px-3 py-1 bg-purple-50 text-purple-800 rounded-full text-sm">
                                                    {c.color} <span className="text-purple-500">({c.qty})</span>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Fabric Affinity */}
                                {customerDetail.fabricAffinity?.length > 0 && (
                                    <div className="p-4 border-b">
                                        <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                            <Layers size={16} /> Top Fabrics
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {customerDetail.fabricAffinity.map((f: any, i: number) => (
                                                <span key={i} className="px-3 py-1 bg-amber-50 text-amber-800 rounded-full text-sm">
                                                    {f.fabricType} <span className="text-amber-500">({f.qty})</span>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Orders List */}
                                <div className="p-4">
                                    <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                        <ShoppingBag size={16} /> Order History
                                    </h4>
                                    {customerDetail.orders?.length > 0 ? (
                                        <div className="space-y-3">
                                            {customerDetail.orders.map((order: any) => (
                                                <div key={order.id} className="border rounded-lg p-3">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="flex items-center gap-3">
                                                            <span className="font-medium">#{order.orderNumber}</span>
                                                            <span className={`badge text-xs ${getStatusBadge(order.status)}`}>{order.status}</span>
                                                        </div>
                                                        <div className="text-right">
                                                            <span className="font-semibold">₹{Number(order.totalAmount).toLocaleString()}</span>
                                                            <p className="text-xs text-gray-500 flex items-center gap-1 justify-end">
                                                                <Calendar size={12} />
                                                                {new Date(order.orderDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    {/* Order Lines */}
                                                    <div className="text-sm text-gray-600 space-y-1">
                                                        {order.orderLines?.map((line: any) => (
                                                            <div key={line.id} className="flex justify-between">
                                                                <span>
                                                                    {line.sku?.variation?.product?.name} - {line.sku?.variation?.colorName} ({line.sku?.size})
                                                                </span>
                                                                <span className="text-gray-500">x{line.qty}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-gray-500 text-center py-4">No orders yet</p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <p className="text-center py-8 text-gray-500">Customer not found</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
