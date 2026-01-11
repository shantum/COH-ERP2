/**
 * @deprecated This modal is deprecated. Use UnifiedOrderModal with mode='view' instead.
 * This component is kept for backward compatibility but will be removed in a future release.
 *
 * OrderViewModal - Shows complete order details including items, prices, taxes, discounts
 */

import { useQuery } from '@tanstack/react-query';
import { X, Package, Truck, CreditCard, Tag, MapPin, User, Phone, Mail, FileText, ExternalLink } from 'lucide-react';
import { ordersApi } from '../../services/api';

interface OrderViewModalProps {
    orderId: string;
    onClose: () => void;
}

// Format currency
const formatCurrency = (amount: string | number | undefined) => {
    if (amount === undefined || amount === null) return '₹0';
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Format date
const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

// Parse shipping address
const parseAddress = (addressJson: string | null | undefined) => {
    if (!addressJson) return null;
    try {
        return JSON.parse(addressJson);
    } catch {
        return null;
    }
};

export function OrderViewModal({ orderId, onClose }: OrderViewModalProps) {
    const { data: order, isLoading, error } = useQuery({
        queryKey: ['order', orderId],
        queryFn: async () => {
            const response = await ordersApi.getById(orderId);
            return response.data;
        },
    });

    if (isLoading) {
        return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg p-8">
                    <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
                    <p className="mt-4 text-gray-500">Loading order details...</p>
                </div>
            </div>
        );
    }

    if (error || !order) {
        return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg p-8">
                    <p className="text-red-500">Failed to load order details</p>
                    <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-100 rounded hover:bg-gray-200">
                        Close
                    </button>
                </div>
            </div>
        );
    }

    const shopify = order.shopifyDetails;
    const address = parseAddress(order.shippingAddress);
    const discountCodes = shopify?.discountCodes || [];
    const hasDiscount = discountCodes.length > 0 || parseFloat(shopify?.totalDiscounts || '0') > 0;

    // Status badges
    const statusColors: Record<string, string> = {
        open: 'bg-blue-100 text-blue-700',
        shipped: 'bg-green-100 text-green-700',
        delivered: 'bg-emerald-100 text-emerald-700',
        cancelled: 'bg-red-100 text-red-700',
        returned: 'bg-orange-100 text-orange-700',
    };

    const paymentColors: Record<string, string> = {
        paid: 'bg-green-100 text-green-700',
        pending: 'bg-yellow-100 text-yellow-700',
        refunded: 'bg-red-100 text-red-700',
        partially_refunded: 'bg-orange-100 text-orange-700',
    };

    const fulfillmentColors: Record<string, string> = {
        fulfilled: 'bg-green-100 text-green-700',
        partial: 'bg-yellow-100 text-yellow-700',
        unfulfilled: 'bg-gray-100 text-gray-600',
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                    <div className="flex items-center gap-3">
                        <Package className="w-5 h-5 text-gray-500" />
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-semibold">Order #{order.orderNumber}</h2>
                                {order.shopifyAdminUrl && (
                                    <a
                                        href={order.shopifyAdminUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:text-blue-800"
                                        title="View in Shopify"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                    </a>
                                )}
                            </div>
                            <p className="text-sm text-gray-500">{formatDate(order.orderDate)}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[order.status] || 'bg-gray-100'}`}>
                            {order.status?.toUpperCase()}
                        </span>
                        {shopify?.financialStatus && (
                            <span className={`px-2 py-1 rounded text-xs font-medium ${paymentColors[shopify.financialStatus] || 'bg-gray-100'}`}>
                                {shopify.financialStatus.replace('_', ' ').toUpperCase()}
                            </span>
                        )}
                        {shopify?.fulfillmentStatus && (
                            <span className={`px-2 py-1 rounded text-xs font-medium ${fulfillmentColors[shopify.fulfillmentStatus] || 'bg-gray-100'}`}>
                                {(shopify.fulfillmentStatus || 'unfulfilled').toUpperCase()}
                            </span>
                        )}
                        <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Customer & Shipping Info */}
                    <div className="grid grid-cols-2 gap-4">
                        {/* Customer Info */}
                        <div className="bg-gray-50 rounded-lg p-3">
                            <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                                <User className="w-4 h-4" /> Customer
                            </h3>
                            <div className="space-y-1 text-sm">
                                <p className="font-medium">{order.customerName}</p>
                                {order.customerEmail && (
                                    <p className="text-gray-500 flex items-center gap-1">
                                        <Mail className="w-3 h-3" /> {order.customerEmail}
                                    </p>
                                )}
                                {order.customerPhone && (
                                    <p className="text-gray-500 flex items-center gap-1">
                                        <Phone className="w-3 h-3" /> {order.customerPhone}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Shipping Address */}
                        <div className="bg-gray-50 rounded-lg p-3">
                            <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                                <MapPin className="w-4 h-4" /> Shipping Address
                            </h3>
                            {address ? (
                                <div className="text-sm text-gray-600">
                                    <p>{address.name || `${address.first_name || ''} ${address.last_name || ''}`.trim()}</p>
                                    <p>{address.address1}</p>
                                    {address.address2 && <p>{address.address2}</p>}
                                    <p>{address.city}, {address.province} {address.zip}</p>
                                    <p>{address.country}</p>
                                </div>
                            ) : (
                                <p className="text-sm text-gray-400">No address available</p>
                            )}
                        </div>
                    </div>

                    {/* Tags */}
                    {shopify?.tags && (
                        <div className="flex flex-wrap gap-1">
                            {shopify.tags.split(',').map((tag: string, idx: number) => (
                                <span key={idx} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                                    {tag.trim()}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Order Notes - use shopify cache only for customer notes */}
                    {(shopify?.customerNote || order.internalNotes) && (
                        <div className="bg-yellow-50 rounded-lg p-3">
                            <h3 className="text-sm font-medium text-yellow-700 mb-2 flex items-center gap-2">
                                <FileText className="w-4 h-4" /> Notes
                            </h3>
                            {shopify?.customerNote && (
                                <div className="text-sm mb-2">
                                    <span className="text-yellow-600 font-medium">Customer: </span>
                                    <span className="text-gray-700">{shopify.customerNote}</span>
                                </div>
                            )}
                            {order.internalNotes && (
                                <div className="text-sm">
                                    <span className="text-yellow-600 font-medium">Internal: </span>
                                    <span className="text-gray-700">{order.internalNotes}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Line Items */}
                    <div className="border rounded-lg overflow-hidden">
                        <div className="bg-gray-50 px-3 py-2 border-b">
                            <h3 className="text-sm font-medium text-gray-700">Items</h3>
                        </div>
                        <div className="divide-y">
                            {(shopify?.lineItems || order.orderLines || []).map((item: any, idx: number) => {
                                const isShopifyItem = !!item.title;
                                const title = isShopifyItem
                                    ? `${item.title}${item.variantTitle ? ` - ${item.variantTitle}` : ''}`
                                    : `${item.sku?.variation?.product?.name || 'Unknown'} - ${item.sku?.variation?.colorName || ''} - ${item.sku?.size || ''}`;
                                const sku = isShopifyItem ? item.sku : item.sku?.skuCode;
                                const qty = isShopifyItem ? item.quantity : item.qty;
                                const price = isShopifyItem ? item.price : item.unitPrice;
                                const discount = item.discountAllocations?.reduce((sum: number, d: any) => sum + parseFloat(d.amount || '0'), 0) || 0;
                                const lineTotal = (parseFloat(price) * qty) - discount;
                                // Get image URL: Shopify item image or variation/product image
                                const imageUrl = isShopifyItem
                                    ? item.imageUrl
                                    : (item.sku?.variation?.imageUrl || item.sku?.variation?.product?.imageUrl);

                                return (
                                    <div key={idx} className="px-3 py-2 flex items-center gap-3">
                                        {/* Thumbnail */}
                                        <div className="w-12 h-12 flex-shrink-0 bg-gray-100 rounded overflow-hidden">
                                            {imageUrl ? (
                                                <img
                                                    src={imageUrl}
                                                    alt={title}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-400">
                                                    <Package className="w-6 h-6" />
                                                </div>
                                            )}
                                        </div>
                                        {/* Item details */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{title}</p>
                                            <p className="text-xs text-gray-500">SKU: {sku || '-'}</p>
                                        </div>
                                        {/* Price */}
                                        <div className="text-right flex-shrink-0">
                                            <p className="text-sm">
                                                {qty} x {formatCurrency(price)}
                                            </p>
                                            {discount > 0 && (
                                                <p className="text-xs text-green-600">-{formatCurrency(discount)}</p>
                                            )}
                                            <p className="text-sm font-medium">{formatCurrency(lineTotal)}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Pricing Summary */}
                    <div className="border rounded-lg overflow-hidden">
                        <div className="bg-gray-50 px-3 py-2 border-b">
                            <h3 className="text-sm font-medium text-gray-700">Order Summary</h3>
                        </div>
                        <div className="p-3 space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-600">Subtotal</span>
                                <span>{formatCurrency(shopify?.subtotalPrice || order.totalAmount)}</span>
                            </div>

                            {/* Discounts */}
                            {hasDiscount && (
                                <div className="flex justify-between text-green-600">
                                    <span className="flex items-center gap-1">
                                        <Tag className="w-3 h-3" />
                                        Discount
                                        {discountCodes.length > 0 && (
                                            <span className="text-xs bg-green-100 px-1 rounded">
                                                {discountCodes.map((d: any) => d.code).join(', ')}
                                            </span>
                                        )}
                                    </span>
                                    <span>-{formatCurrency(shopify?.totalDiscounts || '0')}</span>
                                </div>
                            )}

                            {/* Shipping */}
                            {shopify?.shippingLines?.map((ship: any, idx: number) => (
                                <div key={idx} className="flex justify-between">
                                    <span className="text-gray-600 flex items-center gap-1">
                                        <Truck className="w-3 h-3" />
                                        {ship.title || 'Shipping'}
                                    </span>
                                    <span>{parseFloat(ship.price) === 0 ? 'Free' : formatCurrency(ship.price)}</span>
                                </div>
                            ))}

                            {/* Tax */}
                            {shopify?.taxLines?.map((tax: any, idx: number) => (
                                <div key={idx} className="flex justify-between text-gray-600">
                                    <span>{tax.title} ({(tax.rate * 100).toFixed(0)}%)</span>
                                    <span>{formatCurrency(tax.price)}</span>
                                </div>
                            ))}
                            {!shopify?.taxLines?.length && shopify?.totalTax && parseFloat(shopify.totalTax) > 0 && (
                                <div className="flex justify-between text-gray-600">
                                    <span>Tax</span>
                                    <span>{formatCurrency(shopify.totalTax)}</span>
                                </div>
                            )}

                            {/* Total */}
                            <div className="flex justify-between font-semibold text-base pt-2 border-t">
                                <span>Total</span>
                                <span>{formatCurrency(shopify?.totalPrice || order.totalAmount)}</span>
                            </div>

                            {/* Payment Method */}
                            {order.paymentMethod && (
                                <div className="flex justify-between pt-2 text-gray-500">
                                    <span className="flex items-center gap-1">
                                        <CreditCard className="w-3 h-3" />
                                        Payment
                                    </span>
                                    <span className={`px-2 py-0.5 rounded text-xs ${order.paymentMethod === 'COD' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                                        }`}>
                                        {order.paymentMethod}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tracking Info */}
                    {(order.awbNumber || order.courier) && (
                        <div className="bg-blue-50 rounded-lg p-3">
                            <h3 className="text-sm font-medium text-blue-700 mb-2 flex items-center gap-2">
                                <Truck className="w-4 h-4" /> Shipping Details
                            </h3>
                            <div className="text-sm space-y-1">
                                {order.courier && <p><span className="text-blue-600">Courier:</span> {order.courier}</p>}
                                {order.awbNumber && <p><span className="text-blue-600">AWB:</span> {order.awbNumber}</p>}
                                {order.shippedAt && <p><span className="text-blue-600">Shipped:</span> {formatDate(order.shippedAt)}</p>}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t bg-gray-50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded font-medium text-sm"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

export default OrderViewModal;
