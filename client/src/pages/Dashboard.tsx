import { useQuery } from '@tanstack/react-query';
import { reportsApi, ordersApi, inventoryApi } from '../services/api';
import { ShoppingCart, AlertTriangle, RotateCcw, TrendingUp } from 'lucide-react';
import { OrdersAnalyticsBar } from '../components/orders/OrdersAnalyticsBar';
import { TopProductsCard } from '../components/dashboard/TopProductsCard';

export default function Dashboard() {
    const { data: dashboard } = useQuery({ queryKey: ['dashboard'], queryFn: () => reportsApi.getDashboard().then(r => r.data) });
    const { data: openOrders } = useQuery({ queryKey: ['openOrders'], queryFn: () => ordersApi.getOpen().then(r => r.data.orders || r.data) });
    const { data: alerts } = useQuery({ queryKey: ['stockAlerts'], queryFn: () => inventoryApi.getAlerts().then(r => r.data) });

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

                {/* Top Products */}
                <div className="lg:col-span-2">
                    <TopProductsCard />
                </div>
            </div>
        </div>
    );
}
