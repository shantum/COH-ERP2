import { useQuery } from '@tanstack/react-query';
import { reportsApi, ordersApi, inventoryApi } from '../services/api';
import { ShoppingCart, AlertTriangle, RotateCcw, TrendingUp } from 'lucide-react';
import { OrdersAnalyticsBar } from '../components/orders/OrdersAnalyticsBar';

export default function Dashboard() {
    const { data: dashboard } = useQuery({ queryKey: ['dashboard'], queryFn: () => reportsApi.getDashboard().then(r => r.data) });
    const { data: openOrders } = useQuery({ queryKey: ['openOrders'], queryFn: () => ordersApi.getOpen().then(r => r.data.orders || r.data) });
    const { data: alerts } = useQuery({ queryKey: ['stockAlerts'], queryFn: () => inventoryApi.getAlerts().then(r => r.data) });
    const { data: velocity } = useQuery({ queryKey: ['velocity'], queryFn: () => reportsApi.getSalesVelocity(7).then(r => r.data) });

    const stats = [
        { label: 'Open Orders', value: dashboard?.openOrders || 0, icon: ShoppingCart, color: 'bg-blue-500' },
        { label: 'Pending Returns', value: dashboard?.pendingReturns || 0, icon: RotateCcw, color: 'bg-orange-500' },
        { label: 'Sales (30d)', value: dashboard?.totalSalesLast30Days || 0, icon: TrendingUp, color: 'bg-green-500' },
        { label: 'Low Stock Alerts', value: alerts?.length || 0, icon: AlertTriangle, color: 'bg-red-500' },
    ];

    return (
        <div className="space-y-4 md:space-y-6">
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Dashboard</h1>

            {/* Orders Analytics Bar */}
            <OrdersAnalyticsBar />

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
                {stats.map((stat) => (
                    <div key={stat.label} className="card flex items-center p-3 md:p-4">
                        <div className={`p-2 md:p-3 rounded-lg ${stat.color}`}>
                            <stat.icon className="w-5 h-5 md:w-6 md:h-6 text-white" />
                        </div>
                        <div className="ml-3 md:ml-4">
                            <p className="text-xs md:text-sm text-gray-500">{stat.label}</p>
                            <p className="text-xl md:text-2xl font-bold text-gray-900">{stat.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Open Orders */}
                <div className="card">
                    <h2 className="text-lg font-semibold mb-4">Open Orders</h2>
                    <div className="space-y-3 max-h-80 overflow-y-auto">
                        {openOrders?.slice(0, 5).map((order: any) => (
                            <div key={order.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div>
                                    <p className="font-medium">{order.orderNumber}</p>
                                    <p className="text-sm text-gray-500">{order.customerName}</p>
                                </div>
                                <div className="text-right">
                                    <span className={`badge ${order.fulfillmentStage === 'ready_to_ship' ? 'badge-success' : order.fulfillmentStage === 'in_progress' ? 'badge-warning' : 'badge-info'}`}>
                                        {order.fulfillmentStage?.replace('_', ' ')}
                                    </span>
                                    <p className="text-sm text-gray-500 mt-1">{order.totalLines} items</p>
                                </div>
                            </div>
                        )) || <p className="text-gray-500">No open orders</p>}
                    </div>
                </div>

                {/* Low Stock Alerts */}
                <div className="card">
                    <h2 className="text-lg font-semibold mb-4">Low Stock Alerts</h2>
                    <div className="space-y-3 max-h-80 overflow-y-auto">
                        {alerts?.slice(0, 5).map((alert: any) => (
                            <div key={alert.skuId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div>
                                    <p className="font-medium">{alert.skuCode}</p>
                                    <p className="text-sm text-gray-500">{alert.productName}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm"><span className="text-red-600 font-medium">{alert.currentBalance}</span> / {alert.targetStockQty}</p>
                                    <span className={`badge ${alert.status === 'can_produce' ? 'badge-success' : 'badge-danger'}`}>
                                        {alert.status === 'can_produce' ? 'Can produce' : 'Fabric needed'}
                                    </span>
                                </div>
                            </div>
                        )) || <p className="text-gray-500">No alerts</p>}
                    </div>
                </div>

                {/* Top Sellers */}
                <div className="card lg:col-span-2">
                    <h2 className="text-lg font-semibold mb-4">Top Sellers (7 days)</h2>
                    <div className="table-scroll-container">
                        <table className="w-full" style={{ minWidth: '500px' }}>
                            <thead>
                                <tr className="border-b">
                                    <th className="table-header">SKU</th>
                                    <th className="table-header">Product</th>
                                    <th className="table-header">Color</th>
                                    <th className="table-header">Size</th>
                                    <th className="table-header text-right">Units Sold</th>
                                    <th className="table-header text-right">Daily Avg</th>
                                </tr>
                            </thead>
                            <tbody>
                                {velocity?.slice(0, 10).map((item: any) => (
                                    <tr key={item.skuCode} className="border-b last:border-0">
                                        <td className="table-cell font-medium">{item.skuCode}</td>
                                        <td className="table-cell">{item.productName}</td>
                                        <td className="table-cell">{item.colorName}</td>
                                        <td className="table-cell">{item.size}</td>
                                        <td className="table-cell text-right font-medium">{item.totalSold}</td>
                                        <td className="table-cell text-right">{item.avgDailySales}</td>
                                    </tr>
                                )) || <tr><td colSpan={6} className="table-cell text-center text-gray-500">No sales data</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
