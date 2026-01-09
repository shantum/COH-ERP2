/**
 * EditOrderModal component
 * Comprehensive modal for editing order details, customer info, and line items
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    X, Undo2, Plus, User, Phone, Mail, MapPin, Calendar, Package,
    ShoppingBag, RefreshCw, Hash, FileText, CreditCard, Search,
    AlertCircle, Check, Trash2, ChevronDown, ChevronUp, History, Clock
} from 'lucide-react';
import { customersApi } from '../../services/api';
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
    isAddingLine,
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
