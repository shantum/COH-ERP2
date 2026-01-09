/**
 * CreateOrderModal component
 * Multi-step form for creating a new order with intuitive product search
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Trash2, Package, RefreshCw, Plus, ShoppingBag, User, Mail, Phone, Hash, Search, UserCheck } from 'lucide-react';
import { getSkuBalance } from '../../utils/orderHelpers';
import { customersApi } from '../../services/api';

interface OrderLine {
    skuId: string;
    qty: number;
    unitPrice: number;
    // Display info (stored for UI)
    productName?: string;
    colorName?: string;
    size?: string;
    skuCode?: string;
    stock?: number;
}

interface CreateOrderModalProps {
    allSkus: any[];
    channels: any[];
    inventoryBalance: any[];
    onCreate: (data: any) => void;
    onClose: () => void;
    isCreating: boolean;
}

// Product Search Component
function ProductSearch({
    allSkus,
    inventoryBalance,
    onSelect,
    onCancel
}: {
    allSkus: any[];
    inventoryBalance: any[];
    onSelect: (sku: any, stock: number) => void;
    onCancel: () => void;
}) {
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Filter SKUs based on search query - supports multi-word search
    const filteredSkus = useMemo(() => {
        if (!query.trim()) return allSkus?.slice(0, 30) || [];

        // Split query into words and check if ALL words match somewhere
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);

        return (allSkus || []).filter((sku: any) => {
            const productName = sku.variation?.product?.name?.toLowerCase() || '';
            const colorName = sku.variation?.colorName?.toLowerCase() || '';
            const size = sku.size?.toLowerCase() || '';
            const skuCode = sku.skuCode?.toLowerCase() || '';

            // Combined searchable text
            const searchText = `${productName} ${colorName} ${size} ${skuCode}`;

            // All words must match somewhere in the combined text
            return words.every(word => searchText.includes(word));
        }).slice(0, 50);
    }, [allSkus, query]);

    // Sort results: by product name, then color, then size order (XS → 4XL)
    const sortedSkus = useMemo(() => {
        const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];

        return [...filteredSkus].sort((a: any, b: any) => {
            // First sort by product name
            const nameA = a.variation?.product?.name || '';
            const nameB = b.variation?.product?.name || '';
            const nameCompare = nameA.localeCompare(nameB);
            if (nameCompare !== 0) return nameCompare;

            // Then by color
            const colorA = a.variation?.colorName || '';
            const colorB = b.variation?.colorName || '';
            const colorCompare = colorA.localeCompare(colorB);
            if (colorCompare !== 0) return colorCompare;

            // Then by size order (XS → 4XL)
            const sizeA = a.size || '';
            const sizeB = b.size || '';
            const sizeIndexA = sizeOrder.indexOf(sizeA);
            const sizeIndexB = sizeOrder.indexOf(sizeB);

            // If both sizes are in our order list, use that order
            if (sizeIndexA !== -1 && sizeIndexB !== -1) {
                return sizeIndexA - sizeIndexB;
            }
            // Unknown sizes go to the end
            if (sizeIndexA === -1 && sizeIndexB !== -1) return 1;
            if (sizeIndexA !== -1 && sizeIndexB === -1) return -1;

            // Both unknown, sort alphabetically
            return sizeA.localeCompare(sizeB);
        });
    }, [filteredSkus]);

    return (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm">
            {/* Search Input */}
            <div className="p-3 border-b border-gray-100">
                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="e.g. pima crew blue xs"
                        className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                        autoComplete="off"
                    />
                </div>
            </div>

            {/* Results - Simple List */}
            <div className="max-h-72 overflow-y-auto">
                {sortedSkus.length === 0 ? (
                    <div className="p-6 text-center">
                        <Package size={24} className="mx-auto text-gray-300 mb-2" />
                        <p className="text-sm text-gray-500">No products found</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {sortedSkus.map((sku: any) => {
                            const stockNum = getSkuBalance(inventoryBalance, sku.id);
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
                                        <div className="flex items-center gap-2">
                                            <span className={`text-sm font-medium ${isOutOfStock ? 'text-gray-400' : 'text-gray-900'}`}>
                                                {sku.variation?.product?.name}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <span className={`text-xs ${isOutOfStock ? 'text-gray-400' : 'text-gray-600'}`}>
                                                {sku.variation?.colorName}
                                            </span>
                                            <span className="text-gray-300">·</span>
                                            <span className={`text-xs font-medium ${isOutOfStock ? 'text-gray-400' : 'text-gray-700'}`}>
                                                {sku.size}
                                            </span>
                                            <span className="text-gray-300">·</span>
                                            <span className="text-xs text-gray-400 font-mono">
                                                {sku.skuCode}
                                            </span>
                                        </div>
                                    </div>
                                    <div className={`shrink-0 ml-3 px-2 py-1 rounded text-xs font-medium ${
                                        isOutOfStock
                                            ? 'bg-gray-100 text-gray-500'
                                            : isLowStock
                                            ? 'bg-amber-100 text-amber-700'
                                            : 'bg-green-100 text-green-700'
                                    }`}>
                                        {stockNum}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                    {sortedSkus.length} result{sortedSkus.length !== 1 ? 's' : ''}
                </span>
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

    // Debounce search query to avoid too many API calls
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(query);
        }, 300);
        return () => clearTimeout(timer);
    }, [query]);

    // Fetch customers with server-side search
    const { data: customersData, isLoading } = useQuery({
        queryKey: ['customers-search', debouncedQuery],
        queryFn: () => {
            const params: Record<string, string> = { limit: '50' };
            if (debouncedQuery.trim()) {
                params.search = debouncedQuery.trim();
            }
            return customersApi.getAll(params);
        },
        staleTime: 30 * 1000, // Cache for 30 seconds
    });

    // API returns array directly via axios .data
    const customers = customersData?.data || [];

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const getDisplayName = (customer: any) => {
        const firstName = customer.firstName || '';
        const lastName = customer.lastName || '';
        if (firstName || lastName) {
            return `${firstName} ${lastName}`.trim();
        }
        return customer.email?.split('@')[0] || 'Unknown';
    };

    return (
        <div className="absolute z-50 w-full mt-1 border border-gray-200 rounded-xl bg-white overflow-hidden shadow-lg">
            {/* Search Input */}
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

            {/* Results */}
            <div className="max-h-48 overflow-y-auto">
                {isLoading ? (
                    <div className="p-4 text-center">
                        <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                        <p className="text-xs text-gray-500">Searching...</p>
                    </div>
                ) : customers.length === 0 ? (
                    <div className="p-4 text-center">
                        <User size={20} className="mx-auto text-gray-300 mb-1" />
                        <p className="text-xs text-gray-500">
                            {query.trim() ? 'No customers found' : 'Type to search customers'}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">Or enter details for new customer</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {customers.map((customer: any) => (
                            <button
                                key={customer.id}
                                type="button"
                                onClick={() => onSelect(customer)}
                                className="w-full px-3 py-2 flex items-start justify-between hover:bg-blue-50 transition-colors text-left"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-gray-900">
                                            {getDisplayName(customer)}
                                        </span>
                                        {customer.tags && (
                                            <span className="shrink-0 px-1.5 py-0.5 text-[10px] bg-purple-100 text-purple-600 rounded">
                                                {customer.tags.split(',')[0]}
                                            </span>
                                        )}
                                    </div>
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

            {/* Footer */}
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                    {customers.length} customer{customers.length !== 1 ? 's' : ''}{customers.length >= 50 ? '+' : ''}
                </span>
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded transition-colors"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

// Selected Item Display
function SelectedItemCard({
    line,
    onUpdateQty,
    onUpdatePrice,
    onRemove
}: {
    line: OrderLine;
    onUpdateQty: (qty: number) => void;
    onUpdatePrice: (price: number) => void;
    onRemove: () => void;
}) {
    const lineTotal = line.qty * line.unitPrice;

    return (
        <div className="group relative bg-gradient-to-r from-white to-gray-50 rounded-xl border border-gray-200 hover:border-gray-300 transition-all overflow-hidden">
            {/* Color accent bar */}
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-400 to-blue-600" />

            <div className="pl-4 pr-3 py-3">
                {/* Header Row */}
                <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-gray-900 truncate">
                                {line.productName}
                            </span>
                            <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 rounded">
                                {line.skuCode}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span className="inline-flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded-full bg-gray-300" style={{ background: 'linear-gradient(135deg, #ddd 0%, #999 100%)' }} />
                                {line.colorName}
                            </span>
                            <span>·</span>
                            <span>Size {line.size}</span>
                            {line.stock !== undefined && (
                                <>
                                    <span>·</span>
                                    <span className={line.stock <= 3 ? 'text-amber-600' : 'text-green-600'}>
                                        {line.stock} in stock
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onRemove}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>

                {/* Qty and Price Row */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">Qty</span>
                            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => onUpdateQty(Math.max(1, line.qty - 1))}
                                    className="px-2 py-1 text-gray-500 hover:bg-gray-100 transition-colors"
                                >
                                    −
                                </button>
                                <input
                                    type="number"
                                    value={line.qty}
                                    onChange={(e) => onUpdateQty(Math.max(1, Number(e.target.value)))}
                                    className="w-10 py-1 text-sm text-center border-x border-gray-200 bg-white outline-none"
                                    min={1}
                                />
                                <button
                                    type="button"
                                    onClick={() => onUpdateQty(line.qty + 1)}
                                    className="px-2 py-1 text-gray-500 hover:bg-gray-100 transition-colors"
                                >
                                    +
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-xs text-gray-500">@</span>
                            <span className="text-gray-500">₹</span>
                            <input
                                type="number"
                                value={line.unitPrice}
                                onChange={(e) => onUpdatePrice(Number(e.target.value))}
                                className="w-20 px-2 py-1 text-sm text-right border border-gray-200 rounded-lg bg-white focus:border-blue-400 outline-none transition-all"
                                min={0}
                            />
                        </div>
                    </div>
                    <div className="text-right">
                        <span className="text-sm font-semibold text-gray-900">
                            ₹{lineTotal.toLocaleString('en-IN')}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function CreateOrderModal({
    allSkus,
    channels,
    inventoryBalance,
    onCreate,
    onClose,
    isCreating,
}: CreateOrderModalProps) {
    const [orderForm, setOrderForm] = useState({
        customerId: '' as string | null,
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        channel: 'offline',
        isExchange: false,
        shipByDate: '',
    });
    const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
    const [isAddingItem, setIsAddingItem] = useState(false);
    const [isSearchingCustomer, setIsSearchingCustomer] = useState(false);

    // Handle customer selection from search
    const handleSelectCustomer = (customer: any) => {
        const firstName = customer.firstName || '';
        const lastName = customer.lastName || '';
        const displayName = (firstName || lastName)
            ? `${firstName} ${lastName}`.trim()
            : customer.email?.split('@')[0] || '';

        setOrderForm(f => ({
            ...f,
            customerId: customer.id,
            customerName: displayName,
            customerEmail: customer.email || '',
            customerPhone: customer.phone || '',
        }));
        setIsSearchingCustomer(false);
    };

    // Clear linked customer when manually editing fields
    const handleCustomerFieldChange = (field: string, value: string) => {
        setOrderForm(f => ({
            ...f,
            [field]: value,
            // Clear customerId if user manually edits - they're entering a new customer
            customerId: null,
        }));
    };

    const handleSelectSku = (sku: any, stock: number) => {
        const newLine: OrderLine = {
            skuId: sku.id,
            qty: 1,
            unitPrice: Number(sku.mrp) || 0,
            productName: sku.variation?.product?.name || 'Unknown',
            colorName: sku.variation?.colorName || '-',
            size: sku.size || '-',
            skuCode: sku.skuCode || '-',
            stock: stock,
        };
        setOrderLines([...orderLines, newLine]);
        setIsAddingItem(false);
    };

    const updateLineQty = (idx: number, qty: number) => {
        const newLines = [...orderLines];
        newLines[idx].qty = qty;
        setOrderLines(newLines);
    };

    const updateLinePrice = (idx: number, price: number) => {
        const newLines = [...orderLines];
        newLines[idx].unitPrice = price;
        setOrderLines(newLines);
    };

    const removeLine = (idx: number) => {
        setOrderLines(orderLines.filter((_, i) => i !== idx));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (orderLines.length === 0) {
            alert('Add at least one item');
            return;
        }
        const totalAmount = orderLines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
        const prefix = orderForm.isExchange ? 'EXC' : 'COH';
        onCreate({
            ...orderForm,
            orderNumber: `${prefix}-${Date.now().toString().slice(-6)}`,
            totalAmount,
            // Convert shipByDate to ISO string if provided
            shipByDate: orderForm.shipByDate ? new Date(orderForm.shipByDate).toISOString() : undefined,
            lines: orderLines.map((l) => ({
                skuId: l.skuId,
                qty: l.qty,
                unitPrice: l.unitPrice,
            })),
        });
    };

    const totalAmount = orderLines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
    const totalItems = orderLines.reduce((sum, l) => sum + l.qty, 0);

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 overflow-y-auto py-8">
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
                style={{
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05)'
                }}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-xl ${orderForm.isExchange ? 'bg-amber-100' : 'bg-blue-100'} transition-colors duration-300`}>
                                {orderForm.isExchange ? (
                                    <RefreshCw size={18} className="text-amber-600" />
                                ) : (
                                    <ShoppingBag size={18} className="text-blue-600" />
                                )}
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">
                                    {orderForm.isExchange ? 'Exchange Order' : 'New Order'}
                                </h2>
                                <p className="text-xs text-gray-500">
                                    {orderForm.isExchange ? 'Create replacement order' : 'Create a new customer order'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="px-6 py-5 space-y-5 max-h-[calc(100vh-280px)] overflow-y-auto">
                        {/* Order Type Toggle - Segmented Control */}
                        <div className="relative">
                            <div className="flex p-1 bg-gray-100 rounded-xl">
                                <button
                                    type="button"
                                    onClick={() => setOrderForm((f) => ({ ...f, isExchange: false }))}
                                    className={`relative flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                                        !orderForm.isExchange
                                            ? 'bg-white text-gray-900 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    <Package size={16} className={!orderForm.isExchange ? 'text-blue-600' : ''} />
                                    <span>Regular Order</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setOrderForm((f) => ({ ...f, isExchange: true }))}
                                    className={`relative flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                                        orderForm.isExchange
                                            ? 'bg-white text-gray-900 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    <RefreshCw size={16} className={orderForm.isExchange ? 'text-amber-600' : ''} />
                                    <span>Exchange</span>
                                </button>
                            </div>
                        </div>

                        {/* Customer Section */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
                                <User size={12} />
                                Customer Details
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2 sm:col-span-1">
                                    <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                        Customer Name <span className="text-red-400">*</span>
                                        {orderForm.customerId && (
                                            <span className="ml-2 inline-flex items-center gap-1 text-green-600 font-normal">
                                                <UserCheck size={10} />
                                                linked
                                            </span>
                                        )}
                                    </label>
                                    <div className="relative">
                                        {orderForm.customerId ? (
                                            <UserCheck size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-green-500" />
                                        ) : (
                                            <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        )}
                                        <input
                                            className={`w-full pl-9 pr-8 py-2.5 text-sm border rounded-lg outline-none transition-all ${
                                                orderForm.customerId
                                                    ? 'border-green-200 bg-green-50 focus:bg-white focus:border-green-400 focus:ring-2 focus:ring-green-100'
                                                    : 'border-gray-200 bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
                                            }`}
                                            placeholder="Search or enter name..."
                                            value={orderForm.customerName}
                                            onChange={(e) => handleCustomerFieldChange('customerName', e.target.value)}
                                            onFocus={() => setIsSearchingCustomer(true)}
                                            required
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
                                                initialQuery={orderForm.customerName}
                                            />
                                        )}
                                    </div>
                                </div>
                                <div className="col-span-2 sm:col-span-1">
                                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Channel</label>
                                    <div className="relative">
                                        <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <select
                                            className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all appearance-none cursor-pointer"
                                            value={orderForm.channel}
                                            onChange={(e) =>
                                                setOrderForm((f) => ({ ...f, channel: e.target.value }))
                                            }
                                        >
                                            {channels?.map((ch: any) => (
                                                <option key={ch.id} value={ch.id}>
                                                    {ch.name}
                                                </option>
                                            ))}
                                            {(!channels || channels.length === 0) && (
                                                <option value="offline">Offline</option>
                                            )}
                                        </select>
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
                                    <div className="relative">
                                        <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                            type="email"
                                            className={`w-full pl-9 pr-3 py-2.5 text-sm border rounded-lg outline-none transition-all ${
                                                orderForm.customerId && orderForm.customerEmail
                                                    ? 'border-green-200 bg-green-50/50'
                                                    : 'border-gray-200 bg-gray-50'
                                            } focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100`}
                                            placeholder="email@example.com"
                                            value={orderForm.customerEmail}
                                            onChange={(e) => handleCustomerFieldChange('customerEmail', e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                        Phone
                                        {orderForm.customerId && !orderForm.customerPhone && (
                                            <span className="ml-1 text-gray-400 font-normal">(not on file)</span>
                                        )}
                                    </label>
                                    <div className="relative">
                                        <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                            className={`w-full pl-9 pr-3 py-2.5 text-sm border rounded-lg outline-none transition-all ${
                                                orderForm.customerId && orderForm.customerPhone
                                                    ? 'border-green-200 bg-green-50/50'
                                                    : 'border-gray-200 bg-gray-50'
                                            } focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100`}
                                            placeholder="+91 98765 43210"
                                            value={orderForm.customerPhone}
                                            onChange={(e) => handleCustomerFieldChange('customerPhone', e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Ship By Date */}
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                    Ship By Date <span className="text-gray-400 font-normal">(optional)</span>
                                </label>
                                <input
                                    type="date"
                                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                                    value={orderForm.shipByDate}
                                    onChange={(e) =>
                                        setOrderForm((f) => ({ ...f, shipByDate: e.target.value }))
                                    }
                                    min={new Date().toISOString().split('T')[0]}
                                />
                            </div>
                        </div>

                        {/* Divider */}
                        <div className="border-t border-dashed border-gray-200" />

                        {/* Items Section */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
                                    <Package size={12} />
                                    Order Items
                                    {orderLines.length > 0 && (
                                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-semibold">
                                            {totalItems}
                                        </span>
                                    )}
                                </div>
                                {!isAddingItem && orderLines.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setIsAddingItem(true)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                                    >
                                        <Plus size={14} />
                                        Add Item
                                    </button>
                                )}
                            </div>

                            {/* Selected Items */}
                            {orderLines.length > 0 && (
                                <div className="space-y-2">
                                    {orderLines.map((line, idx) => (
                                        <SelectedItemCard
                                            key={`${line.skuId}-${idx}`}
                                            line={line}
                                            onUpdateQty={(qty) => updateLineQty(idx, qty)}
                                            onUpdatePrice={(price) => updateLinePrice(idx, price)}
                                            onRemove={() => removeLine(idx)}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* Add Item / Search */}
                            {isAddingItem ? (
                                <ProductSearch
                                    allSkus={allSkus}
                                    inventoryBalance={inventoryBalance}
                                    onSelect={handleSelectSku}
                                    onCancel={() => setIsAddingItem(false)}
                                />
                            ) : orderLines.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-8 px-4 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                                    <div className="p-3 bg-gray-100 rounded-full mb-3">
                                        <Search size={24} className="text-gray-400" />
                                    </div>
                                    <p className="text-sm font-medium text-gray-500 mb-1">Add products to order</p>
                                    <p className="text-xs text-gray-400 mb-3">Search by name, color, size, or SKU code</p>
                                    <button
                                        type="button"
                                        onClick={() => setIsAddingItem(true)}
                                        className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
                                    >
                                        <Search size={16} />
                                        Search Products
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50">
                        {/* Total */}
                        {orderLines.length > 0 && (
                            <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200">
                                <div>
                                    <span className="text-sm text-gray-600">Order Total</span>
                                    <span className="text-xs text-gray-400 ml-2">
                                        ({totalItems} item{totalItems !== 1 ? 's' : ''})
                                    </span>
                                </div>
                                <span className={`text-xl font-semibold ${totalAmount === 0 && orderForm.isExchange ? 'text-amber-600' : 'text-gray-900'}`}>
                                    ₹{totalAmount.toLocaleString('en-IN')}
                                    {totalAmount === 0 && orderForm.isExchange && (
                                        <span className="ml-2 text-xs font-normal text-amber-500">Exchange</span>
                                    )}
                                </span>
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isCreating || orderLines.length === 0}
                                className={`flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-xl transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
                                    orderForm.isExchange
                                        ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600'
                                        : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700'
                                }`}
                            >
                                {isCreating ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        Creating...
                                    </span>
                                ) : (
                                    `Create ${orderForm.isExchange ? 'Exchange' : 'Order'}`
                                )}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default CreateOrderModal;
