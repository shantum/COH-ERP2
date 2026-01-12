import { useQuery } from '@tanstack/react-query';
import { reportsApi, ordersApi, inventoryApi } from '../services/api';
import { ShoppingCart, AlertTriangle, RotateCcw, TrendingUp } from 'lucide-react';
import { OrdersAnalyticsBar } from '../components/orders/OrdersAnalyticsBar';
import { TopProductsCard } from '../components/dashboard/TopProductsCard';
import { TopFabricsCard } from '../components/dashboard/TopFabricsCard';
import { TopCustomersCard } from '../components/dashboard/TopCustomersCard';

export default function Dashboard() {
    const { data: dashboard } = useQuery({ queryKey: ['dashboard'], queryFn: () => reportsApi.getDashboard().then(r => r.data) });
    const { data: openOrders } = useQuery({ queryKey: ['openOrders'], queryFn: () => ordersApi.getOpen().then(r => r.data.orders || r.data) });
    const { data: alerts } = useQuery({ queryKey: ['stockAlerts'], queryFn: () => inventoryApi.getAlerts().then(r => r.data) });

    const stats = [
        { label: 'Open Orders', value: dashboard?.openOrders || 0, icon: ShoppingCart, color: 'bg-blue-500' },
        { label: 'Pending Returns', value: dashboard?.pendingReturns || 0, icon: RotateCcw, color: 'bg-orange-500' },
        { label: 'Sales (30d)', value: dashboard?.totalSalesLast30Days || 0, icon: TrendingUp, color: 'bg-green-500' },
        { label: 'Low Stock', value: alerts?.length || 0, icon: AlertTriangle, color: 'bg-red-500' },
    ];

    return (
        <div className="space-y-3 sm:space-y-4 md:space-y-6 px-2 sm:px-0">
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900">Dashboard</h1>

            {/* Orders Analytics Bar */}
            <OrdersAnalyticsBar />

            {/* Stats Grid - 2x2 on mobile, 4 across on desktop */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
                {stats.map((stat) => (
                    <div
                        key={stat.label}
                        className="bg-white rounded-lg border border-gray-200 flex items-center p-2.5 sm:p-3 md:p-4 shadow-sm"
                    >
                        <div className={`p-1.5 sm:p-2 md:p-3 rounded-lg ${stat.color} flex-shrink-0`}>
                            <stat.icon className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-white" />
                        </div>
                        <div className="ml-2 sm:ml-3 md:ml-4 min-w-0">
                            <p className="text-[10px] sm:text-xs md:text-sm text-gray-500 truncate">{stat.label}</p>
                            <p className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900">{stat.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Analytics Cards Grid - Responsive 1/2/3 column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 md:gap-6">
                {/* Top Products */}
                <TopProductsCard />

                {/* Top Fabrics */}
                <TopFabricsCard />

                {/* Top Customers */}
                <TopCustomersCard />
            </div>

            {/* Secondary Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
                {/* Open Orders */}
                <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm">
                    <h2 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Open Orders</h2>
                    <div className="space-y-2 sm:space-y-3 max-h-60 sm:max-h-80 overflow-y-auto">
                        {openOrders?.slice(0, 5).map((order: any) => (
                            <div
                                key={order.id}
                                className="flex items-center justify-between p-2 sm:p-3 bg-gray-50 rounded-lg gap-2"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="font-medium text-sm sm:text-base truncate">{order.orderNumber}</p>
                                    <p className="text-xs sm:text-sm text-gray-500 truncate">{order.customerName}</p>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <span className={`inline-block text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full font-medium ${
                                        order.fulfillmentStage === 'ready_to_ship'
                                            ? 'bg-green-100 text-green-700'
                                            : order.fulfillmentStage === 'in_progress'
                                                ? 'bg-yellow-100 text-yellow-700'
                                                : 'bg-blue-100 text-blue-700'
                                    }`}>
                                        {order.fulfillmentStage?.replace('_', ' ')}
                                    </span>
                                    <p className="text-[10px] sm:text-sm text-gray-500 mt-0.5 sm:mt-1">{order.totalLines} items</p>
                                </div>
                            </div>
                        )) || <p className="text-gray-500 text-sm">No open orders</p>}
                    </div>
                </div>

                {/* Low Stock Alerts */}
                <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm">
                    <h2 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Low Stock Alerts</h2>
                    <div className="space-y-2 sm:space-y-3 max-h-60 sm:max-h-80 overflow-y-auto">
                        {alerts?.slice(0, 5).map((alert: any) => (
                            <div
                                key={alert.skuId}
                                className="flex items-center justify-between p-2 sm:p-3 bg-gray-50 rounded-lg gap-2"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="font-medium text-sm sm:text-base truncate">{alert.skuCode}</p>
                                    <p className="text-xs sm:text-sm text-gray-500 truncate">{alert.productName}</p>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <p className="text-xs sm:text-sm">
                                        <span className="text-red-600 font-medium">{alert.currentBalance}</span>
                                        <span className="text-gray-400"> / {alert.targetStockQty}</span>
                                    </p>
                                    <span className={`inline-block text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full font-medium mt-0.5 ${
                                        alert.status === 'can_produce'
                                            ? 'bg-green-100 text-green-700'
                                            : 'bg-red-100 text-red-700'
                                    }`}>
                                        {alert.status === 'can_produce' ? 'Can produce' : 'Fabric needed'}
                                    </span>
                                </div>
                            </div>
                        )) || <p className="text-gray-500 text-sm">No alerts</p>}
                    </div>
                </div>
            </div>
        </div>
    );
}
