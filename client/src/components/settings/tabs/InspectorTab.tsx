/**
 * InspectorTab component
 * Database inspector with table views
 */

import { useState } from 'react';
import { adminApi } from '../../../services/api';
import { Database, Eye } from 'lucide-react';

export function InspectorTab() {
    const [inspectorTable, setInspectorTable] = useState<'orders' | 'customers' | 'products' | 'skus' | 'shopifyOrderCache' | 'shopifyProductCache'>('orders');
    const [inspectorLimit, setInspectorLimit] = useState(50);
    const [inspectorData, setInspectorData] = useState<any>(null);
    const [inspectorLoading, setInspectorLoading] = useState(false);

    const fetchData = async () => {
        setInspectorLoading(true);
        try {
            const apiCall = {
                orders: () => adminApi.inspectOrders(inspectorLimit),
                customers: () => adminApi.inspectCustomers(inspectorLimit),
                products: () => adminApi.inspectProducts(inspectorLimit),
                skus: () => adminApi.inspectSkus(inspectorLimit),
                shopifyOrderCache: () => adminApi.inspectShopifyOrderCache(inspectorLimit),
                shopifyProductCache: () => adminApi.inspectShopifyProductCache(inspectorLimit),
            }[inspectorTable];
            const res = await apiCall();
            setInspectorData(res.data);
        } catch (err) {
            console.error(err);
            alert('Failed to fetch data');
        } finally {
            setInspectorLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Database size={20} /> Database Inspector
                </h2>

                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <select
                        value={inspectorTable}
                        onChange={(e) => {
                            setInspectorTable(e.target.value as any);
                            setInspectorData(null);
                        }}
                        className="input w-52"
                    >
                        <option value="orders">Orders</option>
                        <option value="customers">Customers</option>
                        <option value="products">Products</option>
                        <option value="skus">SKUs</option>
                        <option value="shopifyOrderCache">Shopify Order Cache</option>
                        <option value="shopifyProductCache">Shopify Product Cache</option>
                    </select>

                    <select
                        value={inspectorLimit}
                        onChange={(e) => setInspectorLimit(Number(e.target.value))}
                        className="input w-36"
                    >
                        <option value={50}>50 rows</option>
                        <option value={100}>100 rows</option>
                        <option value={250}>250 rows</option>
                        <option value={500}>500 rows</option>
                        <option value={1000}>1,000 rows</option>
                        <option value={2000}>2,000 rows</option>
                        <option value={5000}>5,000 rows</option>
                    </select>

                    <button
                        className="btn btn-primary flex items-center gap-2"
                        onClick={fetchData}
                        disabled={inspectorLoading}
                    >
                        <Eye size={16} />
                        {inspectorLoading ? 'Loading...' : 'Fetch Data'}
                    </button>
                </div>

                {inspectorData && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm text-gray-600">
                            <span>
                                Showing {inspectorData.data?.length || 0} of {inspectorData.total || 0} records
                            </span>
                            <button
                                className="text-blue-600 hover:underline"
                                onClick={() => setInspectorData(null)}
                            >
                                Clear
                            </button>
                        </div>

                        <div className="border rounded-lg overflow-hidden">
                            <div className="bg-gray-50 px-3 py-2 text-sm font-medium border-b">
                                {{
                                    orders: 'Orders',
                                    customers: 'Customers',
                                    products: 'Products',
                                    skus: 'SKUs',
                                    shopifyOrderCache: 'Shopify Order Cache',
                                    shopifyProductCache: 'Shopify Product Cache',
                                }[inspectorTable]} Table
                            </div>
                            <div className="max-h-[700px] overflow-auto">
                                <InspectorTable data={inspectorData.data} />
                            </div>
                        </div>
                    </div>
                )}

                {!inspectorData && (
                    <p className="text-gray-500 text-sm">
                        Select a table and click "Fetch Data" to inspect database records.
                    </p>
                )}
            </div>
        </div>
    );
}

// Format cell value for display
function formatCellValue(value: any, key: string): React.ReactNode {
    if (value === null || value === undefined) return <span className="text-gray-400">-</span>;

    // Handle booleans
    if (typeof value === 'boolean') {
        return value ? <span className="text-green-600">✓</span> : <span className="text-red-600">✗</span>;
    }

    // Handle dates
    if (key.toLowerCase().includes('at') || key.toLowerCase().includes('date')) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
            return <span className="whitespace-nowrap">{date.toLocaleString()}</span>;
        }
    }

    // Handle IDs (show truncated)
    if (key === 'id' && typeof value === 'string' && value.length > 20) {
        return <span className="font-mono text-xs" title={value}>{value.slice(0, 8)}...</span>;
    }

    // Handle objects (nested data)
    if (typeof value === 'object') {
        if (Array.isArray(value)) {
            return <span className="text-blue-600">[{value.length} items]</span>;
        }
        // Show a preview of the object
        const preview = JSON.stringify(value).slice(0, 50);
        return <span className="text-purple-600 font-mono text-xs" title={JSON.stringify(value, null, 2)}>{preview}{preview.length >= 50 ? '...' : ''}</span>;
    }

    // Handle numbers (format currency-like fields)
    if (typeof value === 'number') {
        if (key.toLowerCase().includes('amount') || key.toLowerCase().includes('price') || key.toLowerCase().includes('cost') || key.toLowerCase().includes('mrp') || key.toLowerCase().includes('spent')) {
            return <span className="font-mono">₹{value.toLocaleString()}</span>;
        }
        return <span className="font-mono">{value.toLocaleString()}</span>;
    }

    // Handle status fields
    if (key === 'status' || key === 'lineStatus') {
        const statusColors: Record<string, string> = {
            open: 'bg-yellow-100 text-yellow-700',
            pending: 'bg-yellow-100 text-yellow-700',
            shipped: 'bg-blue-100 text-blue-700',
            delivered: 'bg-green-100 text-green-700',
            cancelled: 'bg-red-100 text-red-700',
            completed: 'bg-green-100 text-green-700',
            running: 'bg-blue-100 text-blue-700',
            failed: 'bg-red-100 text-red-700',
        };
        const color = statusColors[value] || 'bg-gray-100 text-gray-700';
        return <span className={`px-2 py-0.5 rounded-full text-xs ${color}`}>{value}</span>;
    }

    // Default: show as string (truncated if too long)
    const str = String(value);
    if (str.length > 100) {
        return <span title={str}>{str.slice(0, 100)}...</span>;
    }
    return str;
}

// Get all unique keys from data array
function getAllKeys(data: any[]): string[] {
    const keySet = new Set<string>();
    for (const row of data) {
        for (const key of Object.keys(row)) {
            keySet.add(key);
        }
    }
    // Sort keys to put important ones first
    const priorityKeys = ['id', 'orderNumber', 'name', 'skuCode', 'email', 'status'];
    const sorted = Array.from(keySet).sort((a, b) => {
        const aIndex = priorityKeys.indexOf(a);
        const bIndex = priorityKeys.indexOf(b);
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        // Put timestamps at the end
        if (a.includes('At') || a.includes('Date')) return 1;
        if (b.includes('At') || b.includes('Date')) return -1;
        return a.localeCompare(b);
    });
    return sorted;
}

// Inspector Table component for table view - shows ALL columns dynamically
function InspectorTable({ data }: { data: any[] }) {
    if (!data || data.length === 0) {
        return <p className="p-4 text-gray-500">No data found</p>;
    }

    // Get all unique keys from the data
    const columns = getAllKeys(data);

    return (
        <table className="w-full text-sm">
            <thead className="bg-gray-100 sticky top-0">
                <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-700 text-xs">#</th>
                    {columns.map((col) => (
                        <th key={col} className="px-3 py-2 text-left font-medium text-gray-700 text-xs whitespace-nowrap">
                            {col}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {data.map((row, rowIndex) => (
                    <tr key={row.id || rowIndex} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-400 text-xs">{rowIndex + 1}</td>
                        {columns.map((col) => (
                            <td key={col} className="px-3 py-2 text-gray-700 text-xs max-w-[250px] truncate">
                                {formatCellValue(row[col], col)}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default InspectorTab;
