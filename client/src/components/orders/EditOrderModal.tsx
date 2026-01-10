/**
 * EditOrderModal component
 * Comprehensive modal for editing order details, customer info, and line items
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    X, Undo2, Plus, User, Phone, Mail, MapPin, Calendar, Package,
    ShoppingBag, RefreshCw, Hash, FileText, CreditCard, Search,
    AlertCircle, Check, Trash2, ChevronDown, ChevronUp, History, Clock,
    Truck, Loader2, XCircle, Printer, CheckCircle2
} from 'lucide-react';
import { customersApi, trackingApi } from '../../services/api';
import { getSkuBalance } from '../../utils/orderHelpers';

interface AddressData {
    first_name?: string;
    last_name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
    phone?: string;
}

interface EditOrderModalProps {
    order: any;
    allSkus: any[];
    inventoryBalance?: any[];
    onUpdateOrder: (data: any) => void;
    onUpdateLine: (lineId: string, data: any) => void;
    onAddLine: (orderId: string, data: any) => void;
    onCancelLine: (lineId: string) => void;
    onUncancelLine: (lineId: string) => void;
    onClose: () => void;
    isUpdating: boolean;
    isAddingLine: boolean;
}

// Product Search Component (reused from CreateOrderModal pattern)
function ProductSearch({
    allSkus,
    inventoryBalance,
    onSelect,
    onCancel
}: {
    allSkus: any[];
    inventoryBalance?: any[];
    onSelect: (sku: any, stock: number) => void;
    onCancel: () => void;
}) {
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const filteredSkus = useMemo(() => {
        if (!query.trim()) return allSkus?.slice(0, 30) || [];
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return (allSkus || []).filter((sku: any) => {
            const productName = sku.variation?.product?.name?.toLowerCase() || '';
            const colorName = sku.variation?.colorName?.toLowerCase() || '';
            const size = sku.size?.toLowerCase() || '';
            const skuCode = sku.skuCode?.toLowerCase() || '';
            const searchText = `${productName} ${colorName} ${size} ${skuCode}`;
            return words.every(word => searchText.includes(word));
        }).slice(0, 50);
    }, [allSkus, query]);

    const sortedSkus = useMemo(() => {
        const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];
        return [...filteredSkus].sort((a: any, b: any) => {
            const nameA = a.variation?.product?.name || '';
            const nameB = b.variation?.product?.name || '';
            const nameCompare = nameA.localeCompare(nameB);
            if (nameCompare !== 0) return nameCompare;
            const colorA = a.variation?.colorName || '';
            const colorB = b.variation?.colorName || '';
            const colorCompare = colorA.localeCompare(colorB);
            if (colorCompare !== 0) return colorCompare;
            const sizeA = a.size || '';
            const sizeB = b.size || '';
            const sizeIndexA = sizeOrder.indexOf(sizeA);
            const sizeIndexB = sizeOrder.indexOf(sizeB);
            if (sizeIndexA !== -1 && sizeIndexB !== -1) return sizeIndexA - sizeIndexB;
            if (sizeIndexA === -1 && sizeIndexB !== -1) return 1;
            if (sizeIndexA !== -1 && sizeIndexB === -1) return -1;
            return sizeA.localeCompare(sizeB);
        });
    }, [filteredSkus]);

    return (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden shadow-lg">
            <div className="p-3 border-b border-gray-100">
                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search by name, color, size, or SKU..."
                        className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                        autoComplete="off"
                    />
                </div>
            </div>
            <div className="max-h-64 overflow-y-auto">
                {sortedSkus.length === 0 ? (
                    <div className="p-6 text-center">
                        <Package size={24} className="mx-auto text-gray-300 mb-2" />
                        <p className="text-sm text-gray-500">No products found</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {sortedSkus.map((sku: any) => {
                            const stockNum = inventoryBalance ? getSkuBalance(inventoryBalance, sku.id) : 0;
                            const isOutOfStock = stockNum <= 0;
                            const isLowStock = stockNum > 0 && stockNum <= 3;
                            return (
                                <button
                                    key={sku.id}
                                    type="button"
                                    onClick={() => onSelect(sku, stockNum)}
                                    className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-blue-50 transition-colors text-left"
                                >
                                    <div className="flex-1 min-w-0">
                                        <span className={`text-sm font-medium ${isOutOfStock ? 'text-gray-400' : 'text-gray-900'}`}>
                                            {sku.variation?.product?.name}
                                        </span>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <span className={`text-xs ${isOutOfStock ? 'text-gray-400' : 'text-gray-600'}`}>
                                                {sku.variation?.colorName}
                                            </span>
                                            <span className="text-gray-300">·</span>
                                            <span className={`text-xs font-medium ${isOutOfStock ? 'text-gray-400' : 'text-gray-700'}`}>
                                                {sku.size}
                                            </span>
                                            <span className="text-gray-300">·</span>
                                            <span className="text-xs text-gray-400 font-mono">{sku.skuCode}</span>
                                            <span className="text-gray-300">·</span>
                                            <span className="text-xs text-gray-500">₹{sku.mrp}</span>
                                        </div>
                                    </div>
                                    <div className={`shrink-0 ml-3 px-2 py-1 rounded text-xs font-medium ${
                                        isOutOfStock ? 'bg-gray-100 text-gray-500' :
                                        isLowStock ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                                    }`}>
                                        {stockNum}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                <span className="text-xs text-gray-400">{sortedSkus.length} results</span>
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded transition-colors"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

// Customer Search Component
function CustomerSearch({
    onSelect,
    onCancel,
    initialQuery = ''
}: {
    onSelect: (customer: any) => void;
    onCancel: () => void;
    initialQuery?: string;
}) {
    const [query, setQuery] = useState(initialQuery);
    const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(timer);
    }, [query]);

    const { data: customersData, isLoading } = useQuery({
        queryKey: ['customers-search', debouncedQuery],
        queryFn: () => {
            const params: Record<string, string> = { limit: '50' };
            if (debouncedQuery.trim()) params.search = debouncedQuery.trim();
            return customersApi.getAll(params);
        },
        staleTime: 30 * 1000,
    });

    const customers = customersData?.data || [];

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const getDisplayName = (customer: any) => {
        const firstName = customer.firstName || '';
        const lastName = customer.lastName || '';
        if (firstName || lastName) return `${firstName} ${lastName}`.trim();
        return customer.email?.split('@')[0] || 'Unknown';
    };

    return (
        <div className="absolute z-50 w-full mt-1 border border-gray-200 rounded-xl bg-white overflow-hidden shadow-lg">
            <div className="p-2 border-b border-gray-100">
                <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search by name, email, or phone..."
                        className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none transition-all"
                        autoComplete="off"
                    />
                </div>
            </div>
            <div className="max-h-48 overflow-y-auto">
                {isLoading ? (
                    <div className="p-4 text-center">
                        <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                        <p className="text-xs text-gray-500">Searching...</p>
                    </div>
                ) : customers.length === 0 ? (
                    <div className="p-4 text-center">
                        <User size={20} className="mx-auto text-gray-300 mb-1" />
                        <p className="text-xs text-gray-500">{query.trim() ? 'No customers found' : 'Type to search'}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {customers.map((customer: any) => (
                            <button
                                key={customer.id}
                                type="button"
                                onClick={() => onSelect(customer)}
                                className="w-full px-3 py-2 flex items-start hover:bg-blue-50 transition-colors text-left"
                            >
                                <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium text-gray-900">{getDisplayName(customer)}</span>
                                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                                        {customer.email && (
                                            <span className="flex items-center gap-1">
                                                <Mail size={10} className="text-gray-400" />
                                                {customer.email}
                                            </span>
                                        )}
                                        {customer.phone && (
                                            <>
                                                <span className="text-gray-300">·</span>
                                                <span className="flex items-center gap-1">
                                                    <Phone size={10} className="text-gray-400" />
                                                    {customer.phone}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50">
                <button type="button" onClick={onCancel} className="text-xs text-gray-600 hover:text-gray-800">
                    Cancel
                </button>
            </div>
        </div>
    );
}

// Line Status Badge
function StatusBadge({ status }: { status: string }) {
    const config: Record<string, { bg: string; text: string; label: string }> = {
        pending: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Pending' },
        allocated: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Allocated' },
        picked: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Picked' },
        packed: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Packed' },
        shipped: { bg: 'bg-green-100', text: 'text-green-700', label: 'Shipped' },
        cancelled: { bg: 'bg-red-100', text: 'text-red-600', label: 'Cancelled' },
    };
    const c = config[status] || { bg: 'bg-gray-100', text: 'text-gray-600', label: status };
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
            {c.label}
        </span>
    );
}

// Helper to parse address JSON
function parseAddress(addressStr: string | null): AddressData {
    if (!addressStr) return {};
    try {
        return JSON.parse(addressStr);
    } catch {
        return {};
    }
}

// Helper to stringify address
function stringifyAddress(addr: AddressData): string {
    return JSON.stringify(addr);
}

// Courier Rate Interface
interface CourierRate {
    logistics: string;
    serviceType: string; // 'Surface', 'Air', etc.
    logisticId?: string;
    rate: number;
    freightCharges?: number;
    codCharges?: number;
    gstCharges?: number;
    rtoCharges?: number;
    zone: string;
    deliveryTat: string;
    weightSlab?: string; // '0.50', '1.00', '2.00', '5.00' kg
    supportsCod: boolean;
    supportsPrepaid: boolean;
    supportsPickup: boolean;
    supportsReversePickup?: boolean;
}

// Book Shipment Section Component
function BookShipmentSection({
    order,
    addressForm,
    onShipmentBooked,
}: {
    order: any;
    addressForm: AddressData;
    onShipmentBooked: () => void;
}) {
    const queryClient = useQueryClient();
    const [step, setStep] = useState<'idle' | 'rates' | 'confirm' | 'booked'>('idle');
    const [rates, setRates] = useState<CourierRate[]>([]);
    const [selectedCourier, setSelectedCourier] = useState<CourierRate | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [shipmentWeight, setShipmentWeight] = useState<string>(''); // Weight in kg - user must enter

    // Check if order already has AWB
    const hasAwb = !!order.awbNumber;
    const canCancel = hasAwb && !['delivered', 'rto_delivered'].includes(order.trackingStatus);

    // Validate address has pincode
    const customerPincode = addressForm.zip || '';
    const hasValidPincode = customerPincode.length === 6;

    // Determine payment method for COD check
    const isCod = order.paymentStatus === 'cod_pending' || order.shopifyCache?.financialStatus === 'pending';

    // Helper: Find appropriate weight slab for entered weight
    const getWeightSlab = (weight: number): string => {
        if (weight <= 0.5) return '0.50';
        if (weight <= 1.0) return '1.00';
        if (weight <= 2.0) return '2.00';
        return '5.00'; // Max slab
    };

    // Fetch rates mutation
    const fetchRatesMutation = useMutation({
        mutationFn: async () => {
            // Origin pincode (warehouse) - hardcoded for now
            // TODO: Get from trackingApi.getConfig() when warehouse pincode is stored there
            const originPincode = '400092'; // Mumbai warehouse
            const weightNum = parseFloat(shipmentWeight) || 0.5;

            const result = await trackingApi.getRates({
                fromPincode: originPincode,
                toPincode: customerPincode,
                weight: weightNum,
                paymentMethod: isCod ? 'cod' : 'prepaid',
                productMrp: order.totalAmount || 0,
            });
            return { data: result.data, weight: weightNum };
        },
        onSuccess: ({ data, weight }) => {
            const targetSlab = getWeightSlab(weight);

            // Filter rates: only matching weight slab + payment method support
            const filteredRates = (data.rates || []).filter((r: CourierRate) => {
                const paymentOk = isCod ? r.supportsCod : r.supportsPrepaid;
                const slabOk = r.weightSlab === targetSlab;
                return paymentOk && slabOk;
            });

            // If no exact slab match, show lowest available rates per courier
            if (filteredRates.length === 0) {
                const lowestPerCourier = new Map<string, CourierRate>();
                for (const r of data.rates || []) {
                    const paymentOk = isCod ? r.supportsCod : r.supportsPrepaid;
                    if (!paymentOk) continue;
                    const key = r.logistics;
                    if (!lowestPerCourier.has(key) || r.rate < lowestPerCourier.get(key)!.rate) {
                        lowestPerCourier.set(key, r);
                    }
                }
                setRates(Array.from(lowestPerCourier.values()));
            } else {
                setRates(filteredRates);
            }

            setStep('rates');
            setError(null);
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || err.message || 'Failed to fetch rates');
        },
    });

    // Book shipment mutation
    const bookShipmentMutation = useMutation({
        mutationFn: async () => {
            if (!selectedCourier) throw new Error('No courier selected');
            const result = await trackingApi.createShipment({
                orderId: order.id,
                logistics: selectedCourier.logistics.toLowerCase(),
            });
            return result.data;
        },
        onSuccess: () => {
            setStep('booked');
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            onShipmentBooked();
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || err.message || 'Failed to book shipment');
        },
    });

    // Cancel shipment mutation
    const cancelShipmentMutation = useMutation({
        mutationFn: async () => {
            const result = await trackingApi.cancelShipment({ orderId: order.id });
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            onShipmentBooked();
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || err.message || 'Failed to cancel shipment');
        },
    });

    // Get label mutation
    const getLabelMutation = useMutation({
        mutationFn: async () => {
            const result = await trackingApi.getLabel({ orderId: order.id, pageSize: 'A4' });
            return result.data;
        },
        onSuccess: (data) => {
            if (data.labelUrl) {
                window.open(data.labelUrl, '_blank');
            }
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || err.message || 'Failed to get label');
        },
    });

    // Reset state when order changes
    useEffect(() => {
        setStep('idle');
        setRates([]);
        setSelectedCourier(null);
        setError(null);
    }, [order.id]);

    // If order already has AWB - show AWB info with cancel option
    if (hasAwb) {
        return (
            <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
                    <Truck size={12} />
                    Shipment Details
                </div>

                <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-200">
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <CheckCircle2 size={18} className="text-green-600" />
                                <span className="font-semibold text-green-800">Shipment Booked</span>
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm text-gray-700">
                                    <span className="text-gray-500">AWB:</span>{' '}
                                    <span className="font-mono font-medium">{order.awbNumber}</span>
                                </p>
                                {order.courier && (
                                    <p className="text-sm text-gray-700">
                                        <span className="text-gray-500">Courier:</span>{' '}
                                        <span className="font-medium capitalize">{order.courier}</span>
                                    </p>
                                )}
                                {order.trackingStatus && (
                                    <p className="text-sm text-gray-700">
                                        <span className="text-gray-500">Status:</span>{' '}
                                        <span className="font-medium capitalize">{order.trackingStatus.replace(/_/g, ' ')}</span>
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => getLabelMutation.mutate()}
                                disabled={getLabelMutation.isPending}
                                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors"
                            >
                                {getLabelMutation.isPending ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <Printer size={14} />
                                )}
                                Label
                            </button>

                            {canCancel && (
                                <button
                                    onClick={() => {
                                        if (confirm('Are you sure you want to cancel this shipment?')) {
                                            cancelShipmentMutation.mutate();
                                        }
                                    }}
                                    disabled={cancelShipmentMutation.isPending}
                                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-lg transition-colors"
                                >
                                    {cancelShipmentMutation.isPending ? (
                                        <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                        <XCircle size={14} />
                                    )}
                                    Cancel
                                </button>
                            )}
                        </div>
                    </div>

                    {error && (
                        <div className="mt-3 p-2 bg-red-100 text-red-700 text-xs rounded-lg">
                            {error}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Check if can book shipment
    if (!hasValidPincode) {
        return (
            <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
                    <Truck size={12} />
                    Book Shipment
                </div>
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                    <div className="flex items-center gap-2 text-amber-700">
                        <AlertCircle size={16} />
                        <span className="text-sm">Add a valid 6-digit pincode in shipping address to book shipment</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
                <Truck size={12} />
                Book Shipment
            </div>

            {/* Idle state - Show book button */}
            {step === 'idle' && (
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-700">Ready to ship</p>
                                <p className="text-xs text-gray-500 mt-0.5">
                                    Destination: {addressForm.city || 'City'}, {customerPincode}
                                    {isCod && <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px]">COD</span>}
                                </p>
                            </div>
                        </div>

                        {/* Weight input */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">Package Weight (kg) <span className="text-red-500">*</span></label>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1">
                                    <input
                                        type="number"
                                        value={shipmentWeight}
                                        onChange={(e) => setShipmentWeight(e.target.value)}
                                        min="0.1"
                                        max="50"
                                        step="0.1"
                                        placeholder="Enter weight"
                                        className={`w-24 px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                                            !shipmentWeight || parseFloat(shipmentWeight) <= 0
                                                ? 'border-red-300 bg-red-50'
                                                : 'border-gray-300'
                                        }`}
                                    />
                                    <span className="text-sm text-gray-500">kg</span>
                                </div>
                                <div className="flex gap-1">
                                    {['0.5', '1', '2', '5'].map((w) => (
                                        <button
                                            key={w}
                                            onClick={() => setShipmentWeight(w)}
                                            className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                                shipmentWeight === w
                                                    ? 'bg-blue-500 text-white'
                                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            }`}
                                        >
                                            {w}kg
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {(!shipmentWeight || parseFloat(shipmentWeight) <= 0) && (
                                <p className="text-xs text-red-500">Please enter package weight to get rates</p>
                            )}
                        </div>

                        <button
                            onClick={() => fetchRatesMutation.mutate()}
                            disabled={fetchRatesMutation.isPending || !shipmentWeight || parseFloat(shipmentWeight) <= 0}
                            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${
                                !shipmentWeight || parseFloat(shipmentWeight) <= 0
                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                    : 'text-white bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 shadow-lg shadow-blue-500/25'
                            }`}
                        >
                            {fetchRatesMutation.isPending ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Fetching Rates...
                                </>
                            ) : (
                                <>
                                    <Truck size={16} />
                                    Get Shipping Rates
                                </>
                            )}
                        </button>
                    </div>

                    {error && (
                        <div className="mt-3 p-2 bg-red-100 text-red-700 text-xs rounded-lg">
                            {error}
                        </div>
                    )}
                </div>
            )}

            {/* Rates step - Show courier options */}
            {step === 'rates' && (
                <div className="p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <p className="text-sm font-semibold text-gray-900">Select Courier</p>
                            <p className="text-xs text-gray-500">
                                {rates.length} options for {shipmentWeight}kg package
                            </p>
                        </div>
                        <button
                            onClick={() => { setStep('idle'); setError(null); }}
                            className="text-xs text-gray-500 hover:text-gray-700"
                        >
                            ← Back
                        </button>
                    </div>

                    {rates.length === 0 ? (
                        <div className="p-4 text-center">
                            <AlertCircle size={24} className="mx-auto text-amber-500 mb-2" />
                            <p className="text-sm text-gray-600">No couriers available for this pincode</p>
                            {isCod && <p className="text-xs text-gray-500 mt-1">COD may not be available at this location</p>}
                        </div>
                    ) : (
                        <div className="space-y-2 max-h-72 overflow-y-auto">
                            {rates.map((rate, idx) => {
                                const isSelected = selectedCourier?.logistics === rate.logistics &&
                                    selectedCourier?.weightSlab === rate.weightSlab &&
                                    selectedCourier?.rate === rate.rate;

                                // Service type badge
                                const serviceTypeText = rate.serviceType || '';
                                const serviceModeLower = serviceTypeText.toLowerCase();
                                const isAir = serviceModeLower.includes('air') || serviceModeLower.includes('express') || serviceModeLower.includes('priority');
                                const isSurface = serviceModeLower.includes('surface') || serviceModeLower.includes('ground') || serviceModeLower.includes('standard');

                                return (
                                    <button
                                        key={`${rate.logistics}-${rate.weightSlab}-${rate.rate}-${idx}`}
                                        onClick={() => setSelectedCourier(rate)}
                                        className={`w-full p-3 rounded-lg border text-left transition-all ${
                                            isSelected
                                                ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-200'
                                                : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                <div className={`p-2 rounded-lg shrink-0 ${isSelected ? 'bg-blue-100' : 'bg-gray-100'}`}>
                                                    <Truck size={16} className={isSelected ? 'text-blue-600' : 'text-gray-500'} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <p className="text-sm font-medium text-gray-900">{rate.logistics}</p>
                                                        {/* Service type badge */}
                                                        {serviceTypeText && (
                                                            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                                                isAir
                                                                    ? 'bg-sky-100 text-sky-700'
                                                                    : isSurface
                                                                        ? 'bg-amber-100 text-amber-700'
                                                                        : 'bg-gray-100 text-gray-600'
                                                            }`}>
                                                                {isAir ? '✈ Air' : isSurface ? '🚛 Surface' : serviceTypeText}
                                                            </span>
                                                        )}
                                                        {/* Weight slab badge */}
                                                        {rate.weightSlab && (
                                                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 text-purple-700">
                                                                ≤{rate.weightSlab}kg
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                                                        <span className="font-medium">Zone {rate.zone}</span>
                                                        <span>•</span>
                                                        <span>{rate.deliveryTat ? `${rate.deliveryTat} day${rate.deliveryTat !== '1' ? 's' : ''} delivery` : 'Est. 2-3 days'}</span>
                                                        {rate.supportsReversePickup && (
                                                            <>
                                                                <span>•</span>
                                                                <span className="text-green-600">Easy returns</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-base font-semibold text-gray-900">₹{rate.rate.toFixed(2)}</p>
                                                <div className="flex items-center justify-end gap-1 mt-1">
                                                    {rate.supportsCod && (
                                                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-medium rounded">COD</span>
                                                    )}
                                                    {rate.supportsPrepaid && (
                                                        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] font-medium rounded">Prepaid</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {selectedCourier && (
                        <div className="mt-4 pt-4 border-t border-gray-100">
                            <button
                                onClick={() => setStep('confirm')}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 rounded-xl transition-all"
                            >
                                Continue with {selectedCourier.logistics}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Confirm step - Show confirmation */}
            {step === 'confirm' && selectedCourier && (
                <div className="p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-sm font-semibold text-gray-900">Confirm Booking</p>
                        <button
                            onClick={() => setStep('rates')}
                            className="text-xs text-gray-500 hover:text-gray-700"
                        >
                            ← Change
                        </button>
                    </div>

                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 rounded-lg">
                                <Truck size={20} className="text-blue-600" />
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-blue-900">{selectedCourier.logistics}</p>
                                    {/* Only show service type if it's meaningful text, not just numbers */}
                                    {selectedCourier.serviceType && !/^\d+$/.test(selectedCourier.serviceType) && (
                                        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                            selectedCourier.serviceType.toLowerCase().includes('air') || selectedCourier.serviceType.toLowerCase().includes('express')
                                                ? 'bg-sky-200 text-sky-800'
                                                : 'bg-amber-200 text-amber-800'
                                        }`}>
                                            {selectedCourier.serviceType.toLowerCase().includes('air') || selectedCourier.serviceType.toLowerCase().includes('express')
                                                ? `✈ ${selectedCourier.serviceType}`
                                                : selectedCourier.serviceType.toLowerCase().includes('surface')
                                                    ? `🚛 ${selectedCourier.serviceType}`
                                                    : selectedCourier.serviceType
                                            }
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-blue-700">
                                    Zone {selectedCourier.zone} • {selectedCourier.deliveryTat ? `${selectedCourier.deliveryTat} day${selectedCourier.deliveryTat !== '1' ? 's' : ''} delivery` : 'Est. 2-3 days delivery'}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-lg font-bold text-blue-900">₹{selectedCourier.rate.toFixed(2)}</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2 text-sm text-gray-600 mb-4">
                        <div className="flex justify-between">
                            <span>Destination</span>
                            <span className="font-medium text-gray-900">{addressForm.city}, {customerPincode}</span>
                        </div>
                        {/* Only show shipping mode if serviceType is meaningful text */}
                        {selectedCourier.serviceType && !/^\d+$/.test(selectedCourier.serviceType) && (
                            <div className="flex justify-between">
                                <span>Shipping Mode</span>
                                <span className="font-medium text-gray-900">
                                    {selectedCourier.serviceType.toLowerCase().includes('air') || selectedCourier.serviceType.toLowerCase().includes('express')
                                        ? 'Air Express'
                                        : selectedCourier.serviceType.toLowerCase().includes('surface')
                                            ? 'Surface/Ground'
                                            : selectedCourier.serviceType
                                    }
                                </span>
                            </div>
                        )}
                        <div className="flex justify-between">
                            <span>Payment</span>
                            <span className="font-medium text-gray-900">{isCod ? 'Cash on Delivery' : 'Prepaid'}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Order Value</span>
                            <span className="font-medium text-gray-900">₹{(order.totalAmount || 0).toLocaleString('en-IN')}</span>
                        </div>
                    </div>

                    {error && (
                        <div className="mb-4 p-2 bg-red-100 text-red-700 text-xs rounded-lg">
                            {error}
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            onClick={() => setStep('rates')}
                            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                        >
                            Back
                        </button>
                        <button
                            onClick={() => bookShipmentMutation.mutate()}
                            disabled={bookShipmentMutation.isPending}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 rounded-xl shadow-lg shadow-green-500/25 transition-all"
                        >
                            {bookShipmentMutation.isPending ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Booking...
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 size={16} />
                                    Confirm Booking
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* Booked step - Success message */}
            {step === 'booked' && (
                <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-200">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 bg-green-100 rounded-full">
                            <CheckCircle2 size={20} className="text-green-600" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-green-800">Shipment Booked Successfully!</p>
                            <p className="text-xs text-green-600">AWB number has been assigned</p>
                        </div>
                    </div>
                    <p className="text-xs text-gray-500">Refresh the order to see the AWB details.</p>
                </div>
            )}
        </div>
    );
}

export function EditOrderModal({
    order,
    allSkus,
    inventoryBalance,
    onUpdateOrder,
    onUpdateLine,
    onAddLine,
    onCancelLine,
    onUncancelLine,
    onClose,
    isUpdating,
    isAddingLine: _isAddingLine,
}: EditOrderModalProps) {
    const [editForm, setEditForm] = useState({
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        internalNotes: '',
        shipByDate: '',
        isExchange: false,
    });
    const [addressForm, setAddressForm] = useState<AddressData>({});
    const [isAddressExpanded, setIsAddressExpanded] = useState(false);
    const [isSearchingCustomer, setIsSearchingCustomer] = useState(false);
    const [isAddingProduct, setIsAddingProduct] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        if (order) {
            setEditForm({
                customerName: order.customerName || '',
                customerEmail: order.customerEmail || '',
                customerPhone: order.customerPhone || '',
                internalNotes: order.internalNotes || '',
                shipByDate: order.shipByDate ? order.shipByDate.split('T')[0] : '',
                isExchange: order.isExchange || false,
            });
            setAddressForm(parseAddress(order.shippingAddress));
        }
    }, [order]);

    // Fetch past addresses only when address section is expanded and customer exists
    const { data: pastAddressesData, isLoading: isLoadingAddresses } = useQuery({
        queryKey: ['customer-addresses', order?.customerId],
        queryFn: () => customersApi.getAddresses(order.customerId),
        enabled: isAddressExpanded && !!order?.customerId,
        staleTime: 60 * 1000, // Cache for 1 minute
    });

    const pastAddresses: AddressData[] = pastAddressesData?.data || [];

    const handleSelectPastAddress = (addr: AddressData) => {
        setAddressForm(addr);
        setHasChanges(true);
    };

    const handleFieldChange = (field: string, value: string | boolean) => {
        setEditForm(f => ({ ...f, [field]: value }));
        setHasChanges(true);
    };

    const handleAddressChange = (field: keyof AddressData, value: string) => {
        setAddressForm(f => ({ ...f, [field]: value }));
        setHasChanges(true);
    };

    const handleSelectCustomer = (customer: any) => {
        const firstName = customer.firstName || '';
        const lastName = customer.lastName || '';
        const displayName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : customer.email?.split('@')[0] || '';
        setEditForm(f => ({
            ...f,
            customerName: displayName,
            customerEmail: customer.email || f.customerEmail,
            customerPhone: customer.phone || f.customerPhone,
        }));
        setIsSearchingCustomer(false);
        setHasChanges(true);
    };

    const handleAddProduct = (sku: any) => {
        onAddLine(order.id, {
            skuId: sku.id,
            qty: 1,
            unitPrice: sku.mrp || 0,
        });
        setIsAddingProduct(false);
    };

    const handleUpdateLinePrice = (lineId: string, newPrice: number) => {
        if (newPrice >= 0) {
            onUpdateLine(lineId, { unitPrice: newPrice });
        }
    };

    const handleSave = () => {
        onUpdateOrder({
            customerName: editForm.customerName,
            customerEmail: editForm.customerEmail,
            customerPhone: editForm.customerPhone,
            shippingAddress: stringifyAddress(addressForm),
            internalNotes: editForm.internalNotes,
            shipByDate: editForm.shipByDate ? new Date(editForm.shipByDate).toISOString() : null,
            isExchange: editForm.isExchange,
        });
    };

    // Calculate totals
    const activeLines = order.orderLines?.filter((l: any) => l.lineStatus !== 'cancelled') || [];
    const orderTotal = activeLines.reduce((sum: number, l: any) => sum + (l.qty * l.unitPrice), 0);
    const totalItems = activeLines.reduce((sum: number, l: any) => sum + l.qty, 0);

    // Check if address has any data
    const hasAddressData = Object.values(addressForm).some(v => v && v.trim());

    // Format address for display
    const addressDisplay = [
        addressForm.address1,
        addressForm.address2,
        addressForm.city,
        addressForm.province,
        addressForm.zip,
        addressForm.country
    ].filter(Boolean).join(', ');

    // Format order date
    const orderDate = order.orderDate ? new Date(order.orderDate).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : '-';

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
                style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white shrink-0">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                            <button
                                type="button"
                                onClick={() => handleFieldChange('isExchange', !editForm.isExchange)}
                                className={`p-2.5 rounded-xl transition-all ${
                                    editForm.isExchange
                                        ? 'bg-amber-100 hover:bg-amber-200 ring-2 ring-amber-300'
                                        : 'bg-blue-100 hover:bg-blue-200'
                                }`}
                                title={editForm.isExchange ? 'Click to mark as regular order' : 'Click to mark as exchange order'}
                            >
                                {editForm.isExchange ? (
                                    <RefreshCw size={20} className="text-amber-600" />
                                ) : (
                                    <ShoppingBag size={20} className="text-blue-600" />
                                )}
                            </button>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-lg font-semibold text-gray-900">{order.orderNumber}</h2>
                                    {editForm.isExchange && (
                                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
                                            Exchange
                                        </span>
                                    )}
                                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                        order.status === 'open' ? 'bg-green-100 text-green-700' :
                                        order.status === 'shipped' ? 'bg-blue-100 text-blue-700' :
                                        'bg-gray-100 text-gray-600'
                                    }`}>
                                        {order.status}
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                                    <span className="flex items-center gap-1">
                                        <Calendar size={12} />
                                        {orderDate}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Hash size={12} />
                                        {order.channel || 'offline'}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <CreditCard size={12} />
                                        {order.paymentMethod || 'Prepaid'}
                                    </span>
                                    {editForm.isExchange !== order.isExchange && (
                                        <span className="px-2 py-0.5 bg-amber-50 text-amber-600 text-[10px] font-medium rounded">
                                            Type changed
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Customer Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
                            <User size={12} />
                            Customer Details
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            {/* Customer Name with Search */}
                            <div className="relative">
                                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                    Customer Name
                                </label>
                                <div className="relative">
                                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        className="w-full pl-9 pr-8 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                                        placeholder="Search or enter name..."
                                        value={editForm.customerName}
                                        onChange={(e) => handleFieldChange('customerName', e.target.value)}
                                        onFocus={() => setIsSearchingCustomer(true)}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setIsSearchingCustomer(!isSearchingCustomer)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                                    >
                                        <Search size={14} />
                                    </button>
                                    {isSearchingCustomer && (
                                        <CustomerSearch
                                            onSelect={handleSelectCustomer}
                                            onCancel={() => setIsSearchingCustomer(false)}
                                            initialQuery={editForm.customerName}
                                        />
                                    )}
                                </div>
                            </div>

                            {/* Email */}
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
                                <div className="relative">
                                    <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="email"
                                        className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                                        placeholder="email@example.com"
                                        value={editForm.customerEmail}
                                        onChange={(e) => handleFieldChange('customerEmail', e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Phone */}
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1.5">Phone</label>
                                <div className="relative">
                                    <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                                        placeholder="+91 98765 43210"
                                        value={editForm.customerPhone}
                                        onChange={(e) => handleFieldChange('customerPhone', e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Ship By Date */}
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                    Ship By Date
                                </label>
                                <div className="relative">
                                    <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="date"
                                        className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                                        value={editForm.shipByDate}
                                        onChange={(e) => handleFieldChange('shipByDate', e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Shipping Address - Expandable */}
                        <div className="col-span-2">
                            <button
                                type="button"
                                onClick={() => setIsAddressExpanded(!isAddressExpanded)}
                                className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left ${
                                    hasAddressData
                                        ? 'bg-green-50 border-green-200 hover:border-green-300'
                                        : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                                }`}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <MapPin size={14} className={hasAddressData ? 'text-green-500' : 'text-gray-400'} />
                                    {hasAddressData ? (
                                        <span className="text-sm text-gray-700 truncate">{addressDisplay}</span>
                                    ) : (
                                        <span className="text-sm text-gray-400 italic">Add shipping address...</span>
                                    )}
                                </div>
                                {isAddressExpanded ? (
                                    <ChevronUp size={16} className="text-gray-400 shrink-0" />
                                ) : (
                                    <ChevronDown size={16} className="text-gray-400 shrink-0" />
                                )}
                            </button>

                            {/* Expanded Address Section */}
                            {isAddressExpanded && (
                                <div className="mt-3 space-y-4">
                                    {/* Past Addresses from Customer History */}
                                    {order?.customerId && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                                                <History size={12} />
                                                <span>Previous Addresses</span>
                                                {isLoadingAddresses && (
                                                    <div className="animate-spin w-3 h-3 border border-gray-400 border-t-transparent rounded-full" />
                                                )}
                                            </div>

                                            {pastAddresses.length > 0 ? (
                                                <div className="grid grid-cols-1 gap-2">
                                                    {pastAddresses.slice(0, 3).map((addr, idx) => {
                                                        const addrLine = [addr.address1, addr.city, addr.province, addr.zip].filter(Boolean).join(', ');
                                                        const isSelected = addr.address1 === addressForm.address1 && addr.zip === addressForm.zip;
                                                        return (
                                                            <button
                                                                key={idx}
                                                                type="button"
                                                                onClick={() => handleSelectPastAddress(addr)}
                                                                className={`group relative w-full p-3 rounded-lg border text-left transition-all ${
                                                                    isSelected
                                                                        ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200'
                                                                        : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'
                                                                }`}
                                                            >
                                                                <div className="flex items-start gap-2">
                                                                    <div className={`mt-0.5 p-1 rounded ${isSelected ? 'bg-blue-100' : 'bg-gray-100 group-hover:bg-blue-100'}`}>
                                                                        <MapPin size={12} className={isSelected ? 'text-blue-600' : 'text-gray-400 group-hover:text-blue-500'} />
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="text-sm font-medium text-gray-900 truncate">
                                                                            {addr.first_name} {addr.last_name}
                                                                        </p>
                                                                        <p className="text-xs text-gray-500 truncate">{addrLine}</p>
                                                                        <div className="flex items-center gap-2 mt-1">
                                                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                                                (addr as any).source === 'shopify'
                                                                                    ? 'bg-green-100 text-green-700'
                                                                                    : 'bg-gray-100 text-gray-600'
                                                                            }`}>
                                                                                {(addr as any).source === 'shopify' ? 'Shopify' : 'Order'}
                                                                            </span>
                                                                            {(addr as any).lastUsed && (
                                                                                <span className="flex items-center gap-1 text-[10px] text-gray-400">
                                                                                    <Clock size={10} />
                                                                                    {new Date((addr as any).lastUsed).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    {isSelected && (
                                                                        <Check size={16} className="text-blue-600 shrink-0" />
                                                                    )}
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            ) : !isLoadingAddresses ? (
                                                <p className="text-xs text-gray-400 italic py-2">No previous addresses found</p>
                                            ) : null}
                                        </div>
                                    )}

                                    {/* Manual Address Form */}
                                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-medium text-gray-500 mb-2">
                                            <FileText size={12} />
                                            <span>Enter Address Manually</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">First Name</label>
                                                <input
                                                    type="text"
                                                    value={addressForm.first_name || ''}
                                                    onChange={(e) => handleAddressChange('first_name', e.target.value)}
                                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
                                                    placeholder="First name"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">Last Name</label>
                                                <input
                                                    type="text"
                                                    value={addressForm.last_name || ''}
                                                    onChange={(e) => handleAddressChange('last_name', e.target.value)}
                                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
                                                    placeholder="Last name"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">Address Line 1</label>
                                            <input
                                                type="text"
                                                value={addressForm.address1 || ''}
                                                onChange={(e) => handleAddressChange('address1', e.target.value)}
                                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
                                                placeholder="Street address"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">Address Line 2</label>
                                            <input
                                                type="text"
                                                value={addressForm.address2 || ''}
                                                onChange={(e) => handleAddressChange('address2', e.target.value)}
                                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
                                                placeholder="Apartment, suite, etc."
                                            />
                                        </div>
                                        <div className="grid grid-cols-3 gap-3">
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">City</label>
                                                <input
                                                    type="text"
                                                    value={addressForm.city || ''}
                                                    onChange={(e) => handleAddressChange('city', e.target.value)}
                                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
                                                    placeholder="City"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">State/Province</label>
                                                <input
                                                    type="text"
                                                    value={addressForm.province || ''}
                                                    onChange={(e) => handleAddressChange('province', e.target.value)}
                                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
                                                    placeholder="State"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">ZIP/Postal</label>
                                                <input
                                                    type="text"
                                                    value={addressForm.zip || ''}
                                                    onChange={(e) => handleAddressChange('zip', e.target.value)}
                                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
                                                    placeholder="ZIP"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">Country</label>
                                                <input
                                                    type="text"
                                                    value={addressForm.country || ''}
                                                    onChange={(e) => handleAddressChange('country', e.target.value)}
                                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
                                                    placeholder="Country"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">Phone</label>
                                                <input
                                                    type="text"
                                                    value={addressForm.phone || ''}
                                                    onChange={(e) => handleAddressChange('phone', e.target.value)}
                                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
                                                    placeholder="Phone for delivery"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Order Items Section */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
                                <Package size={12} />
                                Order Items
                                <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded-full text-[10px]">
                                    {totalItems} item{totalItems !== 1 ? 's' : ''}
                                </span>
                            </div>
                            {!isAddingProduct && (
                                <button
                                    type="button"
                                    onClick={() => setIsAddingProduct(true)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                                >
                                    <Plus size={14} />
                                    Add Item
                                </button>
                            )}
                        </div>

                        {/* Add Product Search */}
                        {isAddingProduct && (
                            <ProductSearch
                                allSkus={allSkus}
                                inventoryBalance={inventoryBalance}
                                onSelect={handleAddProduct}
                                onCancel={() => setIsAddingProduct(false)}
                            />
                        )}

                        {/* Order Lines */}
                        <div className="space-y-2">
                            {order.orderLines?.map((line: any) => {
                                const isCancelled = line.lineStatus === 'cancelled';
                                const isPending = line.lineStatus === 'pending';
                                const lineTotal = line.qty * line.unitPrice;

                                return (
                                    <div
                                        key={line.id}
                                        className={`group relative rounded-xl border transition-all overflow-hidden ${
                                            isCancelled
                                                ? 'bg-gray-50 border-gray-200 opacity-60'
                                                : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
                                        }`}
                                    >
                                        {/* Color accent */}
                                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                                            isCancelled ? 'bg-gray-300' :
                                            line.lineStatus === 'shipped' ? 'bg-green-500' :
                                            line.lineStatus === 'packed' ? 'bg-purple-500' :
                                            line.lineStatus === 'picked' ? 'bg-indigo-500' :
                                            line.lineStatus === 'allocated' ? 'bg-blue-500' :
                                            'bg-gray-300'
                                        }`} />

                                        <div className="pl-4 pr-3 py-3">
                                            <div className="flex items-center gap-4">
                                                {/* Product Info */}
                                                <div className="flex-1 min-w-0">
                                                    <div className={`flex items-center gap-2 ${isCancelled ? 'line-through' : ''}`}>
                                                        <span className="text-sm font-medium text-gray-900 truncate">
                                                            {line.sku?.variation?.product?.name}
                                                        </span>
                                                        <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 rounded">
                                                            {line.sku?.skuCode}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                                                        <span>{line.sku?.variation?.colorName}</span>
                                                        <span>·</span>
                                                        <span>Size {line.sku?.size}</span>
                                                    </div>
                                                </div>

                                                {/* Quantity */}
                                                <div className="w-20 text-center">
                                                    {isPending ? (
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            defaultValue={line.qty}
                                                            className="w-14 text-center text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
                                                            onBlur={(e) => {
                                                                const newQty = parseInt(e.target.value);
                                                                if (newQty !== line.qty && newQty > 0) {
                                                                    onUpdateLine(line.id, { qty: newQty });
                                                                }
                                                            }}
                                                        />
                                                    ) : (
                                                        <span className="text-sm text-gray-700">×{line.qty}</span>
                                                    )}
                                                </div>

                                                {/* Price */}
                                                <div className="w-28 text-right">
                                                    <p className="text-sm font-medium text-gray-900">
                                                        ₹{lineTotal.toLocaleString('en-IN')}
                                                    </p>
                                                    {isPending ? (
                                                        <div className="flex items-center justify-end gap-1 mt-0.5">
                                                            <span className="text-xs text-gray-400">₹</span>
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                step="1"
                                                                defaultValue={line.unitPrice}
                                                                className="w-16 text-right text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
                                                                onBlur={(e) => {
                                                                    const newPrice = parseFloat(e.target.value);
                                                                    if (!isNaN(newPrice) && newPrice !== line.unitPrice) {
                                                                        handleUpdateLinePrice(line.id, newPrice);
                                                                    }
                                                                }}
                                                            />
                                                            <span className="text-xs text-gray-400">ea</span>
                                                        </div>
                                                    ) : (
                                                        <p className="text-xs text-gray-400">
                                                            ₹{Number(line.unitPrice).toLocaleString('en-IN')} each
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Status */}
                                                <div className="w-24">
                                                    <StatusBadge status={line.lineStatus} />
                                                </div>

                                                {/* Actions */}
                                                <div className="w-10 flex justify-center">
                                                    {isCancelled ? (
                                                        <button
                                                            onClick={() => onUncancelLine(line.id)}
                                                            className="p-1.5 text-green-500 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors"
                                                            title="Restore item"
                                                        >
                                                            <Undo2 size={16} />
                                                        </button>
                                                    ) : isPending ? (
                                                        <button
                                                            onClick={() => onCancelLine(line.id)}
                                                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                                            title="Cancel item"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    ) : (
                                                        <div className="p-1.5">
                                                            <Check size={16} className="text-green-500" />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Notes Section */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
                            <FileText size={12} />
                            Internal Notes
                        </div>
                        <textarea
                            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all resize-none"
                            rows={2}
                            placeholder="Add internal notes about this order..."
                            value={editForm.internalNotes}
                            onChange={(e) => handleFieldChange('internalNotes', e.target.value)}
                        />
                    </div>

                    {/* Book Shipment Section - Show for offline orders or orders without shopify tracking */}
                    {(order.channel === 'offline' || !order.shopifyOrderId) && (
                        <BookShipmentSection
                            order={order}
                            addressForm={addressForm}
                            onShipmentBooked={() => {
                                // Trigger a refresh of the order data
                                // The queryClient invalidation in the component handles this
                            }}
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 shrink-0">
                    <div className="flex items-center justify-between">
                        {/* Order Total */}
                        <div className="flex items-center gap-6">
                            <div>
                                <p className="text-xs text-gray-500">Order Total</p>
                                <p className="text-xl font-semibold text-gray-900">
                                    ₹{orderTotal.toLocaleString('en-IN')}
                                </p>
                            </div>
                            {hasChanges && (
                                <div className="flex items-center gap-1.5 text-amber-600">
                                    <AlertCircle size={14} />
                                    <span className="text-xs font-medium">Unsaved changes</span>
                                </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={isUpdating || !hasChanges}
                                className={`px-6 py-2.5 text-sm font-medium text-white rounded-xl transition-all ${
                                    isUpdating || !hasChanges
                                        ? 'bg-gray-300 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 shadow-lg shadow-blue-500/25'
                                }`}
                            >
                                {isUpdating ? (
                                    <span className="flex items-center gap-2">
                                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                                        Saving...
                                    </span>
                                ) : (
                                    'Save Changes'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default EditOrderModal;
