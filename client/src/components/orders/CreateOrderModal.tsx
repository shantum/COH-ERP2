/**
 * CreateOrderModal component
 * Multi-step form for creating a new order with intuitive product search
 */

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Trash2, Package, RefreshCw, Plus, ShoppingBag, User, Mail, Phone, Hash, Search, UserCheck, MapPin, ChevronDown, ChevronUp, History, Clock, Check, FileText, Calendar, Info } from 'lucide-react';
import { customersApi } from '../../services/api';
import { trpc } from '../../services/trpc';
import { CustomerSearch } from '../common/CustomerSearch';
import { ProductSearch } from '../common/ProductSearch';

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

// Helper to stringify address
function stringifyAddress(addr: AddressData): string {
    return JSON.stringify(addr);
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
        paymentMethod: 'Prepaid' as 'Prepaid' | 'COD',
        paymentStatus: 'pending' as 'pending' | 'paid',
        shipByDate: '',
    });
    const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
    const [isAddingItem, setIsAddingItem] = useState(false);
    const [isSearchingCustomer, setIsSearchingCustomer] = useState(false);
    const [addressForm, setAddressForm] = useState<AddressData>({});
    const [isAddressExpanded, setIsAddressExpanded] = useState(false);
    // Track original prices for exchange toggle reversion
    const [originalPrices, setOriginalPrices] = useState<Map<number, number>>(new Map());
    // Track fetched balances for SKUs not in pre-fetched inventory (on-demand fetch)
    const [fetchedBalances, setFetchedBalances] = useState<Map<string, number>>(new Map());
    // Track SKUs currently being fetched to avoid duplicate requests
    const [fetchingSkuIds, setFetchingSkuIds] = useState<Set<string>>(new Set());

    // tRPC utilities for on-demand fetching
    const trpcUtils = trpc.useUtils();

    // Handler to fetch balances for SKUs on-demand
    const handleFetchBalances = useCallback((skuIds: string[]) => {
        // Filter out SKUs already fetched or currently being fetched
        const newSkuIds = skuIds.filter(
            (id) => !fetchedBalances.has(id) && !fetchingSkuIds.has(id)
        );

        if (newSkuIds.length === 0) return;

        // Mark SKUs as being fetched
        setFetchingSkuIds((prev) => {
            const next = new Set(prev);
            newSkuIds.forEach((id) => next.add(id));
            return next;
        });

        // Fetch balances using tRPC
        trpcUtils.inventory.getBalances
            .fetch({ skuIds: newSkuIds })
            .then((balances) => {
                setFetchedBalances((prev) => {
                    const next = new Map(prev);
                    balances.forEach((b: any) => {
                        next.set(b.skuId, b.availableBalance ?? b.currentBalance ?? 0);
                    });
                    return next;
                });
            })
            .catch((error) => {
                // Silently handle errors - UI will show 0 stock
                console.error('Failed to fetch inventory balances:', error);
            })
            .finally(() => {
                // Remove from fetching set
                setFetchingSkuIds((prev) => {
                    const next = new Set(prev);
                    newSkuIds.forEach((id) => next.delete(id));
                    return next;
                });
            });
    }, [fetchedBalances, fetchingSkuIds, trpcUtils.inventory.getBalances]);

    // Fetch past addresses when address section is expanded and customer exists
    const { data: pastAddressesData, isLoading: isLoadingAddresses } = useQuery({
        queryKey: ['customer-addresses', orderForm.customerId],
        queryFn: () => customersApi.getAddresses(orderForm.customerId!),
        enabled: isAddressExpanded && !!orderForm.customerId,
        staleTime: 60 * 1000, // Cache for 1 minute
    });

    const pastAddresses: AddressData[] = pastAddressesData?.data || [];

    const handleSelectPastAddress = (addr: AddressData) => {
        setAddressForm(addr);
        // Minimize the address section after selection
        setIsAddressExpanded(false);
    };

    const handleAddressChange = (field: keyof AddressData, value: string) => {
        setAddressForm(f => ({ ...f, [field]: value }));
    };

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
        const mrpPrice = Number(sku.mrp) || 0;
        const newLine: OrderLine = {
            skuId: sku.id,
            qty: 1,
            unitPrice: orderForm.isExchange ? 0 : mrpPrice,
            productName: sku.variation?.product?.name || 'Unknown',
            colorName: sku.variation?.colorName || '-',
            size: sku.size || '-',
            skuCode: sku.skuCode || '-',
            stock: stock,
        };

        // Store original price for this line
        const newIndex = orderLines.length;
        setOriginalPrices(prev => new Map(prev).set(newIndex, mrpPrice));

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

        // Update original price tracking when user manually changes price
        setOriginalPrices(prev => new Map(prev).set(idx, price));
    };

    const removeLine = (idx: number) => {
        setOrderLines(orderLines.filter((_, i) => i !== idx));
        // Clean up price tracking
        setOriginalPrices(prev => {
            const updated = new Map(prev);
            updated.delete(idx);
            // Re-index remaining prices
            const reindexed = new Map<number, number>();
            updated.forEach((price, oldIdx) => {
                if (oldIdx > idx) {
                    reindexed.set(oldIdx - 1, price);
                } else {
                    reindexed.set(oldIdx, price);
                }
            });
            return reindexed;
        });
    };

    // Handle exchange checkbox toggle
    const handleExchangeToggle = (isExchange: boolean) => {
        setOrderForm(f => ({ ...f, isExchange }));

        if (isExchange) {
            // Zero out all prices and preserve originals
            setOrderLines(lines => lines.map((line, idx) => {
                // Store current price as original if not already stored
                setOriginalPrices(prev => {
                    const updated = new Map(prev);
                    if (!updated.has(idx)) {
                        updated.set(idx, line.unitPrice);
                    }
                    return updated;
                });
                return { ...line, unitPrice: 0 };
            }));
        } else {
            // Restore original prices
            setOrderLines(lines => lines.map((line, idx) => ({
                ...line,
                unitPrice: originalPrices.get(idx) || line.unitPrice
            })));
        }
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
            shippingAddress: stringifyAddress(addressForm),
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
                        {/* Exchange Info Banner - Only shown when exchange is checked */}
                        {orderForm.isExchange && (
                            <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                                <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-amber-900 font-medium">Exchange order</p>
                                    <p className="text-xs text-amber-700 mt-0.5">
                                        All product prices are set to ₹0. You can adjust them if needed.
                                    </p>
                                </div>
                            </div>
                        )}

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
                                            className={`w-full pl-9 pr-8 py-2.5 text-sm border rounded-lg outline-none transition-all ${orderForm.customerId
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
                                                showTags
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

                            {/* Exchange Checkbox & Payment Method Row */}
                            <div className="flex items-stretch gap-3">
                                {/* Exchange Checkbox */}
                                <div className="flex-1 flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                    <label className="flex items-start gap-3 cursor-pointer flex-1">
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={orderForm.isExchange}
                                                onChange={(e) => handleExchangeToggle(e.target.checked)}
                                                className="peer appearance-none w-5 h-5 border-2 border-gray-300 rounded bg-white checked:bg-amber-500 checked:border-amber-500 transition-all cursor-pointer focus:ring-2 focus:ring-amber-200 focus:ring-offset-1"
                                            />
                                            <svg
                                                className="absolute w-3 h-3 text-white pointer-events-none left-1 top-1 opacity-0 peer-checked:opacity-100 transition-opacity"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                        </div>
                                        <div className="flex-1 min-w-0 select-none">
                                            <div className="flex items-center gap-2">
                                                <RefreshCw size={14} className={orderForm.isExchange ? 'text-amber-600' : 'text-gray-400'} />
                                                <span className={`text-sm font-medium ${orderForm.isExchange ? 'text-gray-900' : 'text-gray-600'}`}>
                                                    Exchange
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-0.5">
                                                Prices set to zero
                                            </p>
                                        </div>
                                    </label>
                                </div>

                                {/* Payment Method Toggle */}
                                <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                    <button
                                        type="button"
                                        onClick={() => setOrderForm(f => ({ ...f, paymentMethod: 'Prepaid' }))}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${orderForm.paymentMethod === 'Prepaid'
                                            ? 'bg-green-500 text-white shadow-sm'
                                            : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                                            }`}
                                    >
                                        Prepaid
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setOrderForm(f => ({ ...f, paymentMethod: 'COD' }))}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${orderForm.paymentMethod === 'COD'
                                            ? 'bg-amber-500 text-white shadow-sm'
                                            : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                                            }`}
                                    >
                                        COD
                                    </button>
                                </div>
                            </div>

                            {/* Payment Status Row */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Payment Status</label>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setOrderForm(f => ({ ...f, paymentStatus: 'pending' }))}
                                            className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all ${orderForm.paymentStatus === 'pending'
                                                    ? 'bg-amber-500 text-white shadow-sm'
                                                    : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                                                }`}
                                        >
                                            Pending
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setOrderForm(f => ({ ...f, paymentStatus: 'paid' }))}
                                            className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all ${orderForm.paymentStatus === 'paid'
                                                    ? 'bg-green-500 text-white shadow-sm'
                                                    : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                                                }`}
                                        >
                                            Paid
                                        </button>
                                    </div>
                                </div>
                                <div></div> {/* Empty column for alignment */}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
                                    <div className="relative">
                                        <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                            type="email"
                                            className={`w-full pl-9 pr-3 py-2.5 text-sm border rounded-lg outline-none transition-all ${orderForm.customerId && orderForm.customerEmail
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
                                            className={`w-full pl-9 pr-3 py-2.5 text-sm border rounded-lg outline-none transition-all ${orderForm.customerId && orderForm.customerPhone
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
                                <div className="relative">
                                    <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="date"
                                        className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                                        value={orderForm.shipByDate}
                                        onChange={(e) =>
                                            setOrderForm((f) => ({ ...f, shipByDate: e.target.value }))
                                        }
                                        min={new Date().toISOString().split('T')[0]}
                                    />
                                </div>
                            </div>

                            {/* Shipping Address - Expandable */}
                            <div className="col-span-2">
                                <button
                                    type="button"
                                    onClick={() => setIsAddressExpanded(!isAddressExpanded)}
                                    className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left ${hasAddressData
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
                                        {orderForm.customerId && (
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
                                                                    className={`group relative w-full p-3 rounded-lg border text-left transition-all ${isSelected
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
                                                                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${(addr as any).source === 'shopify'
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
                                    fetchedBalances={fetchedBalances}
                                    onFetchBalances={handleFetchBalances}
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
                                className={`flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-xl transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${orderForm.isExchange
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
