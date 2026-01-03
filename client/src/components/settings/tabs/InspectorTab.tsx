/**
 * InspectorTab component
 * Database inspector with table views
 */

import { useState } from 'react';
import { adminApi } from '../../../services/api';
import { Database, Eye } from 'lucide-react';

export function InspectorTab() {
    const [inspectorTable, setInspectorTable] = useState<'orders' | 'customers' | 'products' | 'skus'>('orders');
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
                        className="input w-40"
                    >
                        <option value="orders">Orders</option>
                        <option value="customers">Customers</option>
                        <option value="products">Products</option>
                        <option value="skus">SKUs</option>
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
                                {inspectorTable.charAt(0).toUpperCase() + inspectorTable.slice(1)} Table
                            </div>
                            <div className="max-h-[700px] overflow-auto">
                                <InspectorTable table={inspectorTable} data={inspectorData.data} />
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

// Inspector Table component for table view
function InspectorTable({ table, data }: { table: string; data: any[] }) {
    if (!data || data.length === 0) {
        return <p className="p-4 text-gray-500">No data found</p>;
    }

    // Define columns for each table type
    const columnConfigs: Record<string, { key: string; label: string; render?: (val: any, row: any) => React.ReactNode }[]> = {
        orders: [
            { key: 'id', label: 'ID', render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
            { key: 'orderNumber', label: 'Order #' },
            { key: 'shopifyOrderId', label: 'Shopify ID' },
            { key: 'customerName', label: 'Customer' },
            { key: 'customer', label: 'Email', render: (v) => v?.email || '-' },
            { key: 'channel', label: 'Channel' },
            { key: 'status', label: 'Status', render: (v) => (
                <span className={`px-2 py-0.5 rounded-full text-xs ${
                    v === 'delivered' ? 'bg-green-100 text-green-700' :
                    v === 'shipped' ? 'bg-blue-100 text-blue-700' :
                    v === 'cancelled' ? 'bg-red-100 text-red-700' :
                    'bg-gray-100 text-gray-700'
                }`}>{v}</span>
            )},
            { key: 'totalAmount', label: 'Total', render: (v) => v ? `₹${Number(v).toLocaleString()}` : '-' },
            { key: 'orderLines', label: 'Lines', render: (v) => v?.length || 0 },
            { key: 'createdAt', label: 'Created', render: (v) => v ? new Date(v).toLocaleDateString() : '-' },
        ],
        customers: [
            { key: 'id', label: 'ID', render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
            { key: 'shopifyCustomerId', label: 'Shopify ID' },
            { key: 'firstName', label: 'First Name' },
            { key: 'lastName', label: 'Last Name' },
            { key: 'email', label: 'Email' },
            { key: 'phone', label: 'Phone' },
            { key: 'city', label: 'City' },
            { key: 'state', label: 'State' },
            { key: 'totalOrders', label: 'Orders' },
            { key: 'totalSpent', label: 'Total Spent', render: (v) => v ? `₹${Number(v).toLocaleString()}` : '-' },
            { key: 'createdAt', label: 'Created', render: (v) => v ? new Date(v).toLocaleDateString() : '-' },
        ],
        products: [
            { key: 'id', label: 'ID', render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
            { key: 'shopifyProductId', label: 'Shopify ID' },
            { key: 'name', label: 'Name' },
            { key: 'styleCode', label: 'Style Code' },
            { key: 'category', label: 'Category' },
            { key: 'productType', label: 'Type' },
            { key: 'gender', label: 'Gender' },
            { key: 'variations', label: 'Variations', render: (v) => v?.length || 0 },
            { key: 'variations', label: 'SKUs', render: (v) => v?.reduce((sum: number, var_: any) => sum + (var_.skus?.length || 0), 0) || 0 },
            { key: 'createdAt', label: 'Created', render: (v) => v ? new Date(v).toLocaleDateString() : '-' },
        ],
        skus: [
            { key: 'id', label: 'ID', render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
            { key: 'shopifyVariantId', label: 'Shopify Variant' },
            { key: 'skuCode', label: 'SKU Code' },
            { key: 'variation', label: 'Product', render: (v) => v?.product?.name || '-' },
            { key: 'variation', label: 'Style', render: (v) => v?.product?.styleCode || '-' },
            { key: 'variation', label: 'Color', render: (v) => v?.colorName || '-' },
            { key: 'size', label: 'Size' },
            { key: 'mrp', label: 'MRP', render: (v) => v ? `₹${Number(v).toLocaleString()}` : '-' },
            { key: 'barcode', label: 'Barcode' },
            { key: 'isActive', label: 'Active', render: (v) => v !== false ? '✓' : '✗' },
            { key: 'createdAt', label: 'Created', render: (v) => v ? new Date(v).toLocaleDateString() : '-' },
        ],
    };

    const columns = columnConfigs[table] || [];

    return (
        <table className="w-full text-sm">
            <thead className="bg-gray-100 sticky top-0">
                <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-700 text-xs">#</th>
                    {columns.map((col, i) => (
                        <th key={i} className="px-3 py-2 text-left font-medium text-gray-700 text-xs whitespace-nowrap">
                            {col.label}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {data.map((row, rowIndex) => (
                    <tr key={row.id || rowIndex} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-400 text-xs">{rowIndex + 1}</td>
                        {columns.map((col, colIndex) => (
                            <td key={colIndex} className="px-3 py-2 text-gray-700 text-xs max-w-[200px] truncate">
                                {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '-')}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default InspectorTab;
