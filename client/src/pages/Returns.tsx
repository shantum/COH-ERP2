import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { returnsApi, customersApi, ordersApi } from '../services/api';
import { useState, useRef, useEffect } from 'react';
import { AlertTriangle, Plus, X, Search, Package, Truck, Check, Trash2, Crown, Medal, Eye, Calendar } from 'lucide-react';

// Format date as "27 Dec 2025"
const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

// Calculate days elapsed since a date
const daysElapsed = (dateString: string | null | undefined) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
};
import { CustomerDetailModal } from '../components/orders/CustomerDetailModal';

interface OrderItem {
    orderLineId: string;
    skuId: string;
    skuCode: string;
    barcode: string | null;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    imageUrl: string | null;
}

interface OrderDetails {
    id: string;
    orderNumber: string;
    shopifyOrderNumber: string | null;
    orderDate: string;
    shippedAt: string | null;
    deliveredAt: string | null;
    customer: {
        id: string;
        name: string;
        email: string;
        phone: string | null;
    } | null;
    items: OrderItem[];
}

const REASON_CATEGORIES = [
    { value: 'size_issue', label: 'Size Issue' },
    { value: 'color_mismatch', label: 'Color Mismatch' },
    { value: 'quality_defect', label: 'Quality Defect' },
    { value: 'wrong_item', label: 'Wrong Item Received' },
    { value: 'changed_mind', label: 'Changed Mind' },
    { value: 'damaged_in_transit', label: 'Damaged in Transit' },
    { value: 'other', label: 'Other' },
];

interface ReturnRequest {
    id: string;
    requestNumber: string;
    requestType: 'return' | 'exchange';
    status: string;
    reasonCategory: string;
    reasonDetails: string | null;
    createdAt: string;
    originalOrderId: string;
    originalOrder: {
        id: string;
        orderNumber: string;
        orderDate?: string;
        shippedAt?: string;
        deliveredAt?: string;
        customerName?: string;
    } | null;
    customerId: string | null;
    customer: { id: string; name: string; firstName: string; lastName: string; email: string } | null;
    lines: Array<{
        id: string;
        qty: number;
        itemCondition: string | null;
        sku: {
            skuCode: string;
            size: string;
            variation: {
                colorName: string;
                imageUrl: string | null;
                product: {
                    name: string;
                    imageUrl: string | null;
                };
            };
        };
    }>;
    shipping: Array<{ awbNumber: string; courier: string; direction?: string }>;
    ageDays: number;
    customerLtv: number;
    customerOrderCount: number;
    customerTier: 'platinum' | 'gold' | 'silver' | 'bronze';
}

export default function Returns() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<'all' | 'pending' | 'analytics'>('all');
    const [showModal, setShowModal] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<ReturnRequest | null>(null);
    const [deleteRequest, setDeleteRequest] = useState<ReturnRequest | null>(null);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

    const { data: returns, isLoading } = useQuery({
        queryKey: ['returns'],
        queryFn: () => returnsApi.getAll().then((r) => r.data),
    });

    // Customer detail query for modal
    const { data: customerDetail, isLoading: loadingCustomer } = useQuery({
        queryKey: ['customer', selectedCustomerId],
        queryFn: () => customersApi.getById(selectedCustomerId!).then((r) => r.data),
        enabled: !!selectedCustomerId,
    });

    // Order detail query for modal
    const { data: orderDetail, isLoading: loadingOrder } = useQuery({
        queryKey: ['order', selectedOrderId],
        queryFn: () => ordersApi.getById(selectedOrderId!).then((r) => r.data),
        enabled: !!selectedOrderId,
    });

    const { data: analytics } = useQuery({
        queryKey: ['returnAnalytics'],
        queryFn: () => returnsApi.getAnalyticsByProduct().then((r) => r.data),
    });

    const getStatusBadge = (status: string) => {
        const colors: Record<string, string> = {
            requested: 'bg-yellow-100 text-yellow-800',
            reverse_initiated: 'bg-blue-100 text-blue-800',
            in_transit: 'bg-purple-100 text-purple-800',
            received: 'bg-green-100 text-green-800',
            inspected: 'bg-teal-100 text-teal-800',
            resolved: 'bg-gray-100 text-gray-800',
            cancelled: 'bg-red-100 text-red-800',
        };
        return colors[status] || 'bg-gray-100 text-gray-800';
    };

    const getTierIcon = (tier: string) => {
        if (tier === 'platinum') return <Crown size={12} className="text-purple-600" />;
        if (tier === 'gold') return <Medal size={12} className="text-yellow-600" />;
        if (tier === 'silver') return <Medal size={12} className="text-gray-400" />;
        return null;
    };

    const getTierBadge = (tier: string) => {
        const colors: Record<string, string> = {
            platinum: 'bg-purple-100 text-purple-800',
            gold: 'bg-yellow-100 text-yellow-800',
            silver: 'bg-gray-100 text-gray-700',
            bronze: 'bg-orange-50 text-orange-700',
        };
        return colors[tier] || colors.bronze;
    };

    const deleteMutation = useMutation({
        mutationFn: (id: string) => returnsApi.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            setDeleteRequest(null);
        },
    });

    const canDelete = (r: ReturnRequest) => {
        const hasReceivedItems = r.lines?.some((l) => l.itemCondition !== null);
        return !hasReceivedItems && r.status !== 'resolved';
    };

    const pendingReturns = returns?.filter((r: any) => !['resolved', 'cancelled'].includes(r.status));

    if (isLoading) {
        return (
            <div className="flex justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Returns & Exchanges</h1>
                <div className="flex gap-2">
                    <button
                        className="btn-secondary"
                        onClick={() => navigate('/return-inward')}
                    >
                        <Package size={16} className="mr-2" />
                        Receive Items
                    </button>
                    <button className="btn-primary" onClick={() => setShowModal(true)}>
                        <Plus size={16} className="mr-2" />
                        New Return Request
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b">
                <button
                    className={`px-4 py-2 font-medium ${tab === 'all' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setTab('all')}
                >
                    All ({returns?.length || 0})
                </button>
                <button
                    className={`px-4 py-2 font-medium ${tab === 'pending' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setTab('pending')}
                >
                    Pending ({pendingReturns?.length || 0})
                </button>
                <button
                    className={`px-4 py-2 font-medium ${tab === 'analytics' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setTab('analytics')}
                >
                    Analytics
                </button>
            </div>

            {/* Returns List */}
            {(tab === 'all' || tab === 'pending') && (
                <div className="card overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b">
                                <th className="table-header">Request #</th>
                                <th className="table-header">Type</th>
                                <th className="table-header">Order</th>
                                <th className="table-header">Customer</th>
                                <th className="table-header">Item</th>
                                <th className="table-header">Reason</th>
                                <th className="table-header">AWB</th>
                                <th className="table-header text-right">Age</th>
                                <th className="table-header">Status</th>
                                <th className="table-header">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(tab === 'pending' ? pendingReturns : returns)?.map((r: any) => (
                                <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                                    <td className="table-cell">
                                        <button
                                            onClick={() => setSelectedRequest(r)}
                                            className="font-medium text-primary-600 hover:text-primary-800 hover:underline"
                                        >
                                            {r.requestNumber}
                                        </button>
                                    </td>
                                    <td className="table-cell">
                                        <span className={`badge ${r.requestType === 'return' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>
                                            {r.requestType}
                                        </span>
                                    </td>
                                    <td className="table-cell">
                                        <button
                                            onClick={() => setSelectedOrderId(r.originalOrder?.id)}
                                            className="text-primary-600 hover:text-primary-800 hover:underline font-medium"
                                        >
                                            {r.originalOrder?.orderNumber}
                                        </button>
                                    </td>
                                    <td className="table-cell">
                                        {r.customer ? (
                                            <button
                                                onClick={() => setSelectedCustomerId(r.customer.id)}
                                                className="flex items-center gap-1.5 text-primary-600 hover:text-primary-800 hover:underline"
                                            >
                                                {getTierIcon(r.customerTier)}
                                                <span className="text-sm">{r.customer.firstName || r.customer.name?.split(' ')[0]}</span>
                                                {r.customerLtv > 0 && (
                                                    <span className={`badge text-xs ${getTierBadge(r.customerTier)}`}>
                                                        ₹{(r.customerLtv / 1000).toFixed(0)}k
                                                    </span>
                                                )}
                                            </button>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="table-cell">
                                        {r.lines?.slice(0, 1).map((l: any, i: number) => {
                                            const imageUrl = l.sku?.variation?.imageUrl || l.sku?.variation?.product?.imageUrl;
                                            return (
                                                <div key={i} className="flex items-center gap-2">
                                                    {imageUrl && (
                                                        <img
                                                            src={imageUrl}
                                                            alt=""
                                                            className="w-10 h-10 object-cover rounded"
                                                        />
                                                    )}
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-medium truncate max-w-[150px]">
                                                            {l.sku?.variation?.product?.name}
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                            {l.sku?.variation?.colorName} / {l.sku?.size}
                                                            {l.itemCondition && <Check size={10} className="inline ml-1 text-green-500" />}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {r.lines?.length > 1 && (
                                            <div className="text-xs text-gray-400 mt-1">+{r.lines.length - 1} more item{r.lines.length > 2 ? 's' : ''}</div>
                                        )}
                                    </td>
                                    <td className="table-cell text-sm">{r.reasonCategory?.replace(/_/g, ' ')}</td>
                                    <td className="table-cell text-xs">
                                        {r.shipping?.[0]?.awbNumber || '-'}
                                    </td>
                                    <td className="table-cell text-right">{r.ageDays}d</td>
                                    <td className="table-cell">
                                        <span className={`badge ${getStatusBadge(r.status)}`}>
                                            {r.status.replace(/_/g, ' ')}
                                        </span>
                                    </td>
                                    <td className="table-cell">
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => setSelectedRequest(r)}
                                                className="p-1 text-gray-400 hover:text-primary-600"
                                                title="View / Edit"
                                            >
                                                <Eye size={14} />
                                            </button>
                                            {canDelete(r) && (
                                                <button
                                                    onClick={() => setDeleteRequest(r)}
                                                    className="p-1 text-gray-400 hover:text-red-600"
                                                    title="Delete"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {(tab === 'pending' ? pendingReturns : returns)?.length === 0 && (
                        <p className="text-center py-8 text-gray-500">No returns found</p>
                    )}
                </div>
            )}

            {/* Analytics */}
            {tab === 'analytics' && (
                <div className="card overflow-x-auto">
                    <h2 className="text-lg font-semibold mb-4">Return Rate by Product</h2>
                    <table className="w-full">
                        <thead>
                            <tr className="border-b">
                                <th className="table-header">Product</th>
                                <th className="table-header text-right">Sold</th>
                                <th className="table-header text-right">Returned</th>
                                <th className="table-header text-right">Rate</th>
                                <th className="table-header">Alert</th>
                            </tr>
                        </thead>
                        <tbody>
                            {analytics
                                ?.filter((a: any) => a.sold > 0)
                                .map((a: any) => (
                                    <tr key={a.productId} className="border-b last:border-0">
                                        <td className="table-cell font-medium">{a.name}</td>
                                        <td className="table-cell text-right">{a.sold}</td>
                                        <td className="table-cell text-right">{a.returned}</td>
                                        <td className="table-cell text-right font-medium">{a.returnRate}%</td>
                                        <td className="table-cell">
                                            {parseFloat(a.returnRate) > 10 && (
                                                <AlertTriangle size={16} className="text-red-500" />
                                            )}
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* New Return Request Modal */}
            {showModal && (
                <NewReturnModal
                    onClose={() => setShowModal(false)}
                    onSuccess={() => {
                        setShowModal(false);
                        queryClient.invalidateQueries({ queryKey: ['returns'] });
                    }}
                />
            )}

            {/* Return Detail Modal (View/Edit) */}
            {selectedRequest && (
                <ReturnDetailModal
                    request={selectedRequest}
                    onClose={() => setSelectedRequest(null)}
                    onSuccess={() => {
                        setSelectedRequest(null);
                        queryClient.invalidateQueries({ queryKey: ['returns'] });
                    }}
                    onDelete={() => {
                        setSelectedRequest(null);
                        queryClient.invalidateQueries({ queryKey: ['returns'] });
                    }}
                />
            )}

            {/* Delete Confirmation Modal */}
            {deleteRequest && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Delete Return Request</h2>
                        <p className="text-gray-600 mb-6">
                            Are you sure you want to delete <span className="font-medium">{deleteRequest.requestNumber}</span>?
                            This action cannot be undone.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                className="btn-secondary"
                                onClick={() => setDeleteRequest(null)}
                                disabled={deleteMutation.isPending}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn-primary bg-red-600 hover:bg-red-700"
                                onClick={() => deleteMutation.mutate(deleteRequest.id)}
                                disabled={deleteMutation.isPending}
                            >
                                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                        {deleteMutation.isError && (
                            <p className="mt-4 text-sm text-red-600">
                                {(deleteMutation.error as any)?.response?.data?.error || 'Failed to delete'}
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Customer Detail Modal */}
            {selectedCustomerId && (
                <CustomerDetailModal
                    customer={customerDetail}
                    isLoading={loadingCustomer}
                    onClose={() => setSelectedCustomerId(null)}
                />
            )}

            {/* Order Detail Modal */}
            {selectedOrderId && orderDetail && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
                        <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                            <h2 className="text-lg font-bold text-gray-900">Order #{orderDetail.orderNumber}</h2>
                            <button onClick={() => setSelectedOrderId(null)} className="p-2 hover:bg-gray-200 rounded-lg">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto max-h-[70vh]">
                            {loadingOrder ? (
                                <div className="flex justify-center py-8">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <span className="text-gray-500">Customer:</span>
                                            <span className="ml-2 font-medium">{orderDetail.customerName}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Date:</span>
                                            <span className="ml-2">{new Date(orderDetail.orderDate).toLocaleDateString()}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Status:</span>
                                            <span className="ml-2 capitalize">{orderDetail.status}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Total:</span>
                                            <span className="ml-2 font-medium">₹{orderDetail.totalAmount?.toLocaleString()}</span>
                                        </div>
                                    </div>
                                    <div className="border-t pt-4">
                                        <h3 className="font-medium mb-3">Items</h3>
                                        <div className="space-y-2">
                                            {orderDetail.orderLines?.map((line: any) => (
                                                <div key={line.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                                                    {(line.sku?.variation?.imageUrl || line.sku?.variation?.product?.imageUrl) && (
                                                        <img
                                                            src={line.sku.variation.imageUrl || line.sku.variation.product.imageUrl}
                                                            alt=""
                                                            className="w-12 h-12 object-cover rounded"
                                                        />
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-medium text-sm">{line.sku?.variation?.product?.name}</div>
                                                        <div className="text-xs text-gray-500">
                                                            {line.sku?.variation?.colorName} / {line.sku?.size} • {line.sku?.skuCode}
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-sm font-medium">₹{line.unitPrice}</div>
                                                        <div className="text-xs text-gray-500">Qty: {line.qty}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

function NewReturnModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [orderNumber, setOrderNumber] = useState('');
    const [order, setOrder] = useState<OrderDetails | null>(null);
    const [selectedItems, setSelectedItems] = useState<string[]>([]);
    const [requestType, setRequestType] = useState<'return' | 'exchange'>('return');
    const [reasonCategory, setReasonCategory] = useState('');
    const [reasonDetails, setReasonDetails] = useState('');
    const [courier, setCourier] = useState('');
    const [awbNumber, setAwbNumber] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (step === 1) {
            inputRef.current?.focus();
        }
    }, [step]);

    const searchOrder = async () => {
        if (!orderNumber.trim()) return;
        setLoading(true);
        setError('');
        try {
            const res = await returnsApi.getOrder(orderNumber.trim());
            setOrder(res.data);
            setStep(2);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Order not found');
        } finally {
            setLoading(false);
        }
    };

    const toggleItem = (skuId: string) => {
        setSelectedItems((prev) =>
            prev.includes(skuId) ? prev.filter((id) => id !== skuId) : [...prev, skuId]
        );
    };

    const createMutation = useMutation({
        mutationFn: (data: Parameters<typeof returnsApi.create>[0]) => returnsApi.create(data),
        onSuccess: () => {
            onSuccess();
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || 'Failed to create return request');
        },
    });

    const handleSubmit = () => {
        if (!order || selectedItems.length === 0 || !reasonCategory) {
            setError('Please select items and provide a reason');
            return;
        }

        createMutation.mutate({
            requestType,
            originalOrderId: order.id,
            reasonCategory,
            reasonDetails: reasonDetails || undefined,
            lines: selectedItems.map((skuId) => ({ skuId, qty: 1 })),
            courier: courier || undefined,
            awbNumber: awbNumber || undefined,
        });
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-lg font-semibold">New Return/Exchange Request</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                {/* Steps indicator */}
                <div className="flex items-center justify-center gap-4 p-4 bg-gray-50 border-b">
                    <div className={`flex items-center gap-2 ${step >= 1 ? 'text-primary-600' : 'text-gray-400'}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step >= 1 ? 'bg-primary-600 text-white' : 'bg-gray-200'}`}>
                            1
                        </div>
                        <span className="text-sm font-medium">Find Order</span>
                    </div>
                    <div className="w-8 h-px bg-gray-300"></div>
                    <div className={`flex items-center gap-2 ${step >= 2 ? 'text-primary-600' : 'text-gray-400'}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step >= 2 ? 'bg-primary-600 text-white' : 'bg-gray-200'}`}>
                            2
                        </div>
                        <span className="text-sm font-medium">Select Items</span>
                    </div>
                    <div className="w-8 h-px bg-gray-300"></div>
                    <div className={`flex items-center gap-2 ${step >= 3 ? 'text-primary-600' : 'text-gray-400'}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step >= 3 ? 'bg-primary-600 text-white' : 'bg-gray-200'}`}>
                            3
                        </div>
                        <span className="text-sm font-medium">Details</span>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                            {error}
                        </div>
                    )}

                    {/* Step 1: Find Order */}
                    {step === 1 && (
                        <div className="space-y-4">
                            <p className="text-gray-600">Enter the order number to start a return or exchange request.</p>
                            <div className="flex gap-2">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    className="input flex-1"
                                    placeholder="Order number (e.g., 63814)"
                                    value={orderNumber}
                                    onChange={(e) => setOrderNumber(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && searchOrder()}
                                />
                                <button
                                    className="btn-primary"
                                    onClick={searchOrder}
                                    disabled={loading || !orderNumber.trim()}
                                >
                                    {loading ? (
                                        <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                                    ) : (
                                        <>
                                            <Search size={16} className="mr-2" />
                                            Search
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Select Items */}
                    {step === 2 && order && (
                        <div className="space-y-4">
                            {/* Order Info Header */}
                            <div className="bg-gray-50 p-4 rounded-lg">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <span className="font-semibold text-lg">Order #{order.orderNumber}</span>
                                        {order.shopifyOrderNumber && order.shopifyOrderNumber !== order.orderNumber && (
                                            <span className="text-gray-500 ml-2 text-sm">({order.shopifyOrderNumber})</span>
                                        )}
                                    </div>
                                </div>
                                {order.customer && (
                                    <div className="text-sm text-gray-600 mb-3">
                                        {order.customer.name} • {order.customer.email}
                                    </div>
                                )}

                                {/* Order Timeline */}
                                <div className="border-t pt-3">
                                    <div className="grid grid-cols-3 gap-4 text-center">
                                        <div className="bg-white rounded-lg p-2 border">
                                            <div className="text-xs text-gray-500 mb-1">Ordered</div>
                                            <div className="text-sm font-medium">{formatDate(order.orderDate)}</div>
                                            <div className="text-xs text-amber-600">{daysElapsed(order.orderDate)}d ago</div>
                                        </div>
                                        <div className={`rounded-lg p-2 border ${order.shippedAt ? 'bg-white' : 'bg-gray-100'}`}>
                                            <div className="text-xs text-gray-500 mb-1">Shipped</div>
                                            {order.shippedAt ? (
                                                <>
                                                    <div className="text-sm font-medium">{formatDate(order.shippedAt)}</div>
                                                    <div className="text-xs text-amber-600">{daysElapsed(order.shippedAt)}d ago</div>
                                                </>
                                            ) : (
                                                <div className="text-sm text-gray-400">Not shipped</div>
                                            )}
                                        </div>
                                        <div className={`rounded-lg p-2 border ${order.deliveredAt ? 'bg-white' : 'bg-gray-100'}`}>
                                            <div className="text-xs text-gray-500 mb-1">Delivered</div>
                                            {order.deliveredAt ? (
                                                <>
                                                    <div className="text-sm font-medium">{formatDate(order.deliveredAt)}</div>
                                                    <div className="text-xs text-amber-600">{daysElapsed(order.deliveredAt)}d ago</div>
                                                </>
                                            ) : (
                                                <div className="text-sm text-gray-400">Not delivered</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <p className="text-gray-600">Select the items being returned:</p>

                            <div className="space-y-2">
                                {order.items.map((item) => (
                                    <label
                                        key={item.skuId}
                                        className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                                            selectedItems.includes(item.skuId)
                                                ? 'border-primary-500 bg-primary-50'
                                                : 'border-gray-200 hover:bg-gray-50'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedItems.includes(item.skuId)}
                                            onChange={() => toggleItem(item.skuId)}
                                            className="h-4 w-4 text-primary-600 rounded"
                                        />
                                        {item.imageUrl && (
                                            <img
                                                src={item.imageUrl}
                                                alt=""
                                                className="w-12 h-12 object-cover rounded"
                                            />
                                        )}
                                        <div className="flex-1">
                                            <div className="font-medium">{item.productName}</div>
                                            <div className="text-sm text-gray-500">
                                                {item.colorName} / {item.size} • {item.skuCode}
                                            </div>
                                        </div>
                                        <span className="text-sm text-gray-500">Qty: {item.qty}</span>
                                    </label>
                                ))}
                            </div>

                            <div className="flex gap-2 pt-4">
                                <button className="btn-secondary" onClick={() => setStep(1)}>
                                    Back
                                </button>
                                <button
                                    className="btn-primary flex-1"
                                    onClick={() => setStep(3)}
                                    disabled={selectedItems.length === 0}
                                >
                                    Continue ({selectedItems.length} selected)
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Details */}
                    {step === 3 && order && (
                        <div className="space-y-4">
                            {/* Request Type */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Request Type</label>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="requestType"
                                            checked={requestType === 'return'}
                                            onChange={() => setRequestType('return')}
                                            className="text-primary-600"
                                        />
                                        <span>Return (Refund)</span>
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="requestType"
                                            checked={requestType === 'exchange'}
                                            onChange={() => setRequestType('exchange')}
                                            className="text-primary-600"
                                        />
                                        <span>Exchange</span>
                                    </label>
                                </div>
                            </div>

                            {/* Reason */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Reason *</label>
                                <select
                                    className="input w-full"
                                    value={reasonCategory}
                                    onChange={(e) => setReasonCategory(e.target.value)}
                                >
                                    <option value="">Select reason...</option>
                                    {REASON_CATEGORIES.map((r) => (
                                        <option key={r.value} value={r.value}>
                                            {r.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Additional Details</label>
                                <textarea
                                    className="input w-full"
                                    rows={2}
                                    placeholder="Optional notes..."
                                    value={reasonDetails}
                                    onChange={(e) => setReasonDetails(e.target.value)}
                                />
                            </div>

                            {/* Reverse Pickup */}
                            <div className="border-t pt-4 mt-4">
                                <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                                    <Truck size={16} />
                                    Reverse Pickup (Optional)
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Courier</label>
                                        <input
                                            type="text"
                                            className="input w-full"
                                            placeholder="e.g., Delhivery, BlueDart"
                                            value={courier}
                                            onChange={(e) => setCourier(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">AWB Number</label>
                                        <input
                                            type="text"
                                            className="input w-full"
                                            placeholder="Tracking number"
                                            value={awbNumber}
                                            onChange={(e) => setAwbNumber(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-2 pt-4">
                                <button className="btn-secondary" onClick={() => setStep(2)}>
                                    Back
                                </button>
                                <button
                                    className="btn-primary flex-1"
                                    onClick={handleSubmit}
                                    disabled={!reasonCategory || createMutation.isPending}
                                >
                                    {createMutation.isPending ? (
                                        <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                                    ) : (
                                        'Create Return Request'
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function ReturnDetailModal({
    request,
    onClose,
    onSuccess,
    onDelete,
}: {
    request: ReturnRequest;
    onClose: () => void;
    onSuccess: () => void;
    onDelete: () => void;
}) {
    const queryClient = useQueryClient();
    const [reasonCategory, setReasonCategory] = useState(request.reasonCategory);
    const [reasonDetails, setReasonDetails] = useState(request.reasonDetails || '');
    const [courier, setCourier] = useState(request.shipping?.[0]?.courier || '');
    const [awbNumber, setAwbNumber] = useState(request.shipping?.[0]?.awbNumber || '');
    const [error, setError] = useState('');
    const [showAddItem, setShowAddItem] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [localLines, setLocalLines] = useState(request.lines || []);

    // Fetch order details for adding items
    const { data: orderDetails } = useQuery({
        queryKey: ['order-for-return', request.originalOrder?.id],
        queryFn: () => returnsApi.getOrder(request.originalOrder?.id || '').then((r) => r.data),
        enabled: showAddItem && !!request.originalOrder?.id,
    });

    // Get items from order that are not already in the return
    const availableItems = orderDetails?.items?.filter(
        (item: OrderItem) => !localLines.some((line) => line.sku?.skuCode === item.skuCode)
    ) || [];

    const updateMutation = useMutation({
        mutationFn: (data: Parameters<typeof returnsApi.update>[1]) =>
            returnsApi.update(request.id, data),
        onSuccess: () => {
            onSuccess();
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || 'Failed to update return request');
        },
    });

    const addItemMutation = useMutation({
        mutationFn: ({ skuId }: { skuId: string }) =>
            returnsApi.addItem(request.id, skuId),
        onSuccess: (data) => {
            // Add the new line to local state
            setLocalLines([...localLines, data.data]);
            setShowAddItem(false);
            queryClient.invalidateQueries({ queryKey: ['returns'] });
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || 'Failed to add item');
        },
    });

    const removeItemMutation = useMutation({
        mutationFn: (lineId: string) =>
            returnsApi.removeItem(request.id, lineId),
        onSuccess: (_, lineId) => {
            // Remove from local state
            setLocalLines(localLines.filter((l) => l.id !== lineId));
            queryClient.invalidateQueries({ queryKey: ['returns'] });
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || 'Failed to remove item');
        },
    });

    const deleteMutation = useMutation({
        mutationFn: () => returnsApi.delete(request.id),
        onSuccess: () => {
            onDelete();
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || 'Failed to delete return request');
        },
    });

    const handleSubmit = () => {
        updateMutation.mutate({
            reasonCategory,
            reasonDetails: reasonDetails || undefined,
            courier: courier || undefined,
            awbNumber: awbNumber || undefined,
        });
    };

    const canModify = !['resolved', 'cancelled'].includes(request.status);
    const canDelete = canModify && !localLines.some((l) => l.itemCondition);

    const orderDate = request.originalOrder?.orderDate;
    const shippedAt = request.originalOrder?.shippedAt;
    const deliveredAt = request.originalOrder?.deliveredAt;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                    <div className="flex items-center gap-3">
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">{request.requestNumber}</h2>
                            <div className="flex items-center gap-2 mt-1">
                                <span className={`badge text-xs ${request.requestType === 'return' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                                    {request.requestType}
                                </span>
                                <span className={`badge text-xs ${
                                    request.status === 'requested' ? 'bg-yellow-100 text-yellow-800' :
                                    request.status === 'received' ? 'bg-green-100 text-green-800' :
                                    request.status === 'resolved' ? 'bg-gray-100 text-gray-800' :
                                    'bg-blue-100 text-blue-800'
                                }`}>
                                    {request.status.replace(/_/g, ' ')}
                                </span>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg">
                        <X size={20} />
                    </button>
                </div>

                {/* Content - Scrollable */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                            {error}
                        </div>
                    )}

                    {/* Customer & Order Info */}
                    <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                                    <span className="text-blue-700 font-semibold text-sm">
                                        {(request.customer?.name || request.originalOrder?.customerName || 'U')[0].toUpperCase()}
                                    </span>
                                </div>
                                <div>
                                    <div className="font-medium text-gray-900">
                                        {request.customer?.name || request.originalOrder?.customerName || 'Unknown Customer'}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        Order #{request.originalOrder?.orderNumber} • {request.customerOrderCount || 0} orders
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {request.customerTier && (
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                                        request.customerTier === 'platinum' ? 'bg-purple-100 text-purple-700' :
                                        request.customerTier === 'gold' ? 'bg-yellow-100 text-yellow-700' :
                                        request.customerTier === 'silver' ? 'bg-gray-200 text-gray-700' :
                                        'bg-orange-100 text-orange-700'
                                    }`}>
                                        {request.customerTier === 'platinum' || request.customerTier === 'gold' ? (
                                            <Crown size={10} />
                                        ) : (
                                            <Medal size={10} />
                                        )}
                                        {request.customerTier}
                                    </span>
                                )}
                                <span className="text-sm font-medium text-gray-700">
                                    ₹{((request.customerLtv || 0) / 1000).toFixed(0)}k LTV
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Order Timeline */}
                    <div className="bg-blue-50 rounded-lg p-4">
                        <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                            <Calendar size={16} />
                            Timeline
                        </h3>
                        <div className="grid grid-cols-4 gap-2 text-center text-xs">
                            <div>
                                <div className="text-gray-500">Ordered</div>
                                <div className="font-medium">{formatDate(orderDate) || '-'}</div>
                                {orderDate && <div className="text-amber-600">{daysElapsed(orderDate)}d ago</div>}
                            </div>
                            <div>
                                <div className="text-gray-500">Shipped</div>
                                <div className="font-medium">{formatDate(shippedAt) || '-'}</div>
                                {shippedAt && <div className="text-amber-600">{daysElapsed(shippedAt)}d ago</div>}
                            </div>
                            <div>
                                <div className="text-gray-500">Delivered</div>
                                <div className="font-medium">{formatDate(deliveredAt) || '-'}</div>
                                {deliveredAt && <div className="text-amber-600">{daysElapsed(deliveredAt)}d ago</div>}
                            </div>
                            <div>
                                <div className="text-gray-500">Return</div>
                                <div className="font-medium">{formatDate(request.createdAt) || '-'}</div>
                                {request.createdAt && <div className="text-amber-600">{daysElapsed(request.createdAt)}d ago</div>}
                            </div>
                        </div>
                    </div>

                    {/* Items */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-gray-700">Items ({localLines.length})</label>
                            {canModify && (
                                <button
                                    onClick={() => setShowAddItem(!showAddItem)}
                                    className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
                                >
                                    <Plus size={14} />
                                    Add Item
                                </button>
                            )}
                        </div>

                        {/* Add Item Panel */}
                        {showAddItem && (
                            <div className="mb-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                                <div className="text-sm font-medium text-blue-800 mb-2">Add item from order</div>
                                {availableItems.length > 0 ? (
                                    <div className="space-y-2 max-h-40 overflow-y-auto">
                                        {availableItems.map((item: OrderItem) => (
                                            <div
                                                key={item.skuId}
                                                className="flex items-center gap-2 p-2 bg-white rounded-lg hover:bg-blue-100 cursor-pointer"
                                                onClick={() => addItemMutation.mutate({ skuId: item.skuId })}
                                            >
                                                {item.imageUrl ? (
                                                    <img src={item.imageUrl} alt="" className="w-10 h-10 object-cover rounded" />
                                                ) : (
                                                    <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center">
                                                        <Package size={16} className="text-gray-400" />
                                                    </div>
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium truncate">{item.productName}</div>
                                                    <div className="text-xs text-gray-500">{item.colorName} • {item.size}</div>
                                                </div>
                                                <Plus size={16} className="text-blue-600" />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-sm text-gray-500 text-center py-2">
                                        All items from this order are already added
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Item List */}
                        <div className="space-y-2">
                            {localLines.map((line) => {
                                const imageUrl = line.sku?.variation?.imageUrl || line.sku?.variation?.product?.imageUrl;
                                const isReceived = !!line.itemCondition;
                                const canRemove = canModify && !isReceived && localLines.length > 1;

                                return (
                                    <div
                                        key={line.id}
                                        className={`flex items-center gap-3 p-3 rounded-lg ${
                                            isReceived ? 'bg-green-50 border border-green-200' : 'bg-gray-50'
                                        }`}
                                    >
                                        {imageUrl ? (
                                            <img src={imageUrl} alt="" className="w-12 h-12 object-cover rounded" />
                                        ) : (
                                            <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center">
                                                <Package size={20} className="text-gray-400" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className={`font-medium text-sm ${isReceived ? 'text-green-800' : 'text-gray-900'}`}>
                                                {line.sku?.variation?.product?.name || 'Unknown Product'}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {line.sku?.variation?.colorName} • {line.sku?.size} • {line.sku?.skuCode}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {isReceived ? (
                                                <span className="flex items-center gap-1 text-green-600 text-xs">
                                                    <Check size={12} />
                                                    {line.itemCondition}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-amber-600">Pending</span>
                                            )}
                                            {canRemove && (
                                                <button
                                                    onClick={() => removeItemMutation.mutate(line.id)}
                                                    disabled={removeItemMutation.isPending}
                                                    className="p-1 hover:bg-red-100 rounded text-red-500 hover:text-red-700"
                                                    title="Remove item"
                                                >
                                                    <X size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Reason */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                        <select
                            className="input w-full"
                            value={reasonCategory}
                            onChange={(e) => setReasonCategory(e.target.value)}
                            disabled={!canModify}
                        >
                            <option value="">Select reason...</option>
                            {REASON_CATEGORIES.map((r) => (
                                <option key={r.value} value={r.value}>
                                    {r.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Additional Details</label>
                        <textarea
                            className="input w-full"
                            rows={2}
                            placeholder="Optional notes..."
                            value={reasonDetails}
                            onChange={(e) => setReasonDetails(e.target.value)}
                            disabled={!canModify}
                        />
                    </div>

                    {/* Shipping */}
                    <div className="border-t pt-4">
                        <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                            <Truck size={16} />
                            Reverse Pickup
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Courier</label>
                                <input
                                    type="text"
                                    className="input w-full"
                                    placeholder="e.g., Delhivery"
                                    value={courier}
                                    onChange={(e) => setCourier(e.target.value)}
                                    disabled={!canModify}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">AWB Number</label>
                                <input
                                    type="text"
                                    className="input w-full"
                                    placeholder="Tracking number"
                                    value={awbNumber}
                                    onChange={(e) => setAwbNumber(e.target.value)}
                                    disabled={!canModify}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-4 border-t bg-gray-50">
                    {/* Delete button */}
                    <div>
                        {canDelete && !confirmDelete && (
                            <button
                                onClick={() => setConfirmDelete(true)}
                                className="text-red-600 hover:text-red-800 text-sm flex items-center gap-1"
                            >
                                <Trash2 size={14} />
                                Delete Ticket
                            </button>
                        )}
                        {confirmDelete && (
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-red-600">Delete?</span>
                                <button
                                    onClick={() => deleteMutation.mutate()}
                                    disabled={deleteMutation.isPending}
                                    className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                                >
                                    Yes
                                </button>
                                <button
                                    onClick={() => setConfirmDelete(false)}
                                    className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
                                >
                                    No
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Save/Close buttons */}
                    <div className="flex gap-3">
                        <button className="btn-secondary" onClick={onClose}>
                            Close
                        </button>
                        {canModify && (
                            <button
                                className="btn-primary"
                                onClick={handleSubmit}
                                disabled={updateMutation.isPending}
                            >
                                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
