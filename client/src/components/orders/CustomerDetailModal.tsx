/**
 * CustomerDetailModal component
 * Displays customer profile with stats, order history, and product affinities
 */

import { X, Crown, Medal, Mail, Phone, Package, Palette, Layers, ShoppingBag, Calendar } from 'lucide-react';

interface CustomerDetailModalProps {
    customer: any;
    isLoading: boolean;
    onClose: () => void;
}

export function CustomerDetailModal({
    customer,
    isLoading,
    onClose,
}: CustomerDetailModalProps) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                    <h2 className="text-lg font-bold text-gray-900">Customer Details</h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg">
                        <X size={20} />
                    </button>
                </div>

                {isLoading ? (
                    <div className="flex justify-center p-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600"></div>
                    </div>
                ) : customer ? (
                    <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
                        {/* Customer Info Header */}
                        <div className="p-4 border-b">
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="flex items-center gap-3 mb-2">
                                        <h3 className="text-lg font-semibold">
                                            {customer.firstName} {customer.lastName}
                                        </h3>
                                        {customer.customerTier && (
                                            <span
                                                className={`px-2 py-0.5 rounded text-xs font-medium ${
                                                    customer.customerTier === 'platinum'
                                                        ? 'bg-purple-100 text-purple-800'
                                                        : customer.customerTier === 'gold'
                                                        ? 'bg-yellow-100 text-yellow-800'
                                                        : customer.customerTier === 'silver'
                                                        ? 'bg-gray-100 text-gray-800'
                                                        : 'bg-orange-100 text-orange-800'
                                                }`}
                                            >
                                                {customer.customerTier === 'platinum' && (
                                                    <Crown size={12} className="inline mr-1" />
                                                )}
                                                {customer.customerTier === 'gold' && (
                                                    <Medal size={12} className="inline mr-1" />
                                                )}
                                                {customer.customerTier}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                                        <a
                                            href={`mailto:${customer.email}`}
                                            className="flex items-center gap-1 hover:text-blue-600"
                                        >
                                            <Mail size={14} />
                                            {customer.email}
                                        </a>
                                        {customer.phone && (
                                            <a
                                                href={`tel:${customer.phone}`}
                                                className="flex items-center gap-1 hover:text-blue-600"
                                            >
                                                <Phone size={14} />
                                                {customer.phone}
                                            </a>
                                        )}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-2xl font-bold text-blue-600">
                                        ₹{Number(customer.lifetimeValue || 0).toLocaleString()}
                                    </p>
                                    <p className="text-sm text-gray-500">Lifetime Value</p>
                                </div>
                            </div>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-3 gap-4 p-4 border-b bg-gray-50">
                            <div className="text-center">
                                <p className="text-2xl font-bold text-gray-900">
                                    {customer.totalOrders || 0}
                                </p>
                                <p className="text-sm text-gray-500">Total Orders</p>
                            </div>
                            <div className="text-center">
                                <p className="text-2xl font-bold text-gray-900">
                                    {customer.returnRequests?.length || 0}
                                </p>
                                <p className="text-sm text-gray-500">Returns</p>
                            </div>
                            <div className="text-center">
                                <p className="text-2xl font-bold text-gray-900">
                                    {customer.productAffinity?.length || 0}
                                </p>
                                <p className="text-sm text-gray-500">Products Ordered</p>
                            </div>
                        </div>

                        {/* Product Affinity */}
                        {customer.productAffinity?.length > 0 && (
                            <div className="p-4 border-b">
                                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <Package size={16} /> Top Products
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                    {customer.productAffinity.map((p: any, i: number) => (
                                        <span
                                            key={i}
                                            className="px-3 py-1 bg-gray-100 rounded-full text-sm"
                                        >
                                            {p.productName}{' '}
                                            <span className="text-gray-500">({p.qty})</span>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Color Affinity */}
                        {customer.colorAffinity?.length > 0 && (
                            <div className="p-4 border-b">
                                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <Palette size={16} /> Top Colors
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                    {customer.colorAffinity.map((c: any, i: number) => (
                                        <span
                                            key={i}
                                            className="px-3 py-1 bg-purple-50 text-purple-800 rounded-full text-sm"
                                        >
                                            {c.color}{' '}
                                            <span className="text-purple-500">({c.qty})</span>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Fabric Affinity */}
                        {customer.fabricAffinity?.length > 0 && (
                            <div className="p-4 border-b">
                                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <Layers size={16} /> Top Fabrics
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                    {customer.fabricAffinity.map((f: any, i: number) => (
                                        <span
                                            key={i}
                                            className="px-3 py-1 bg-amber-50 text-amber-800 rounded-full text-sm"
                                        >
                                            {f.fabricType}{' '}
                                            <span className="text-amber-500">({f.qty})</span>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Recent Orders */}
                        {customer.orders?.length > 0 && (
                            <div className="p-4">
                                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <ShoppingBag size={16} /> Recent Orders
                                </h4>
                                <div className="space-y-3">
                                    {customer.orders.slice(0, 5).map((order: any) => (
                                        <div key={order.id} className="border rounded-lg p-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-3">
                                                    <span className="font-medium">
                                                        #{order.orderNumber}
                                                    </span>
                                                    <span
                                                        className={`px-2 py-0.5 rounded text-xs ${
                                                            order.status === 'open'
                                                                ? 'bg-blue-100 text-blue-800'
                                                                : order.status === 'shipped'
                                                                ? 'bg-yellow-100 text-yellow-800'
                                                                : order.status === 'delivered'
                                                                ? 'bg-green-100 text-green-800'
                                                                : 'bg-gray-100 text-gray-800'
                                                        }`}
                                                    >
                                                        {order.status}
                                                    </span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="font-semibold">
                                                        ₹{Number(order.totalAmount).toLocaleString()}
                                                    </span>
                                                    <p className="text-xs text-gray-500 flex items-center gap-1 justify-end">
                                                        <Calendar size={12} />
                                                        {new Date(order.orderDate).toLocaleDateString(
                                                            'en-IN',
                                                            {
                                                                day: 'numeric',
                                                                month: 'short',
                                                                year: 'numeric',
                                                            }
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="text-sm text-gray-600 space-y-1">
                                                {order.orderLines?.slice(0, 3).map((line: any) => (
                                                    <div
                                                        key={line.id}
                                                        className="flex justify-between"
                                                    >
                                                        <span>
                                                            {line.sku?.variation?.product?.name} -{' '}
                                                            {line.sku?.variation?.colorName} (
                                                            {line.sku?.size})
                                                        </span>
                                                        <span className="text-gray-500">
                                                            x{line.qty}
                                                        </span>
                                                    </div>
                                                ))}
                                                {order.orderLines?.length > 3 && (
                                                    <p className="text-gray-400 text-xs">
                                                        +{order.orderLines.length - 3} more items
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {customer.orders.length > 5 && (
                                        <p className="text-center text-gray-500 text-sm">
                                            +{customer.orders.length - 5} more orders
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-center py-8 text-gray-500">Customer not found</p>
                )}
            </div>
        </div>
    );
}

export default CustomerDetailModal;
