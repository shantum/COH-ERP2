/**
 * CreateOrderForm - Reusable order creation form
 * Used by both CreateOrderModal (dialog) and /new-order (full page)
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    RefreshCw,
    Search,
    MapPin,
    ChevronDown,
    ChevronUp,
    Loader2,
    X,
} from 'lucide-react';
import { CustomerSearch } from '../common/CustomerSearch';
import { ProductSearch, type SKUData } from '../common/ProductSearch';
import { getCustomerAddresses } from '../../server/functions/customers';
import { getOrderForExchange, type OrderForExchange } from '../../server/functions/orders';
import { getOptimizedImageUrl } from '../../utils/imageOptimization';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

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
    productName?: string;
    colorName?: string;
    size?: string;
    skuCode?: string;
    stock?: number;
    imageUrl?: string;
}

/** Channel option for order creation */
interface ChannelOption {
    id: string;
    name: string;
}

/** Data shape passed to onCreate callback */
export interface CreateOrderData {
    customerId: string | null;
    customerName: string;
    customerEmail?: string;
    customerPhone?: string;
    channel: string;
    isExchange: boolean;
    paymentMethod: 'Prepaid' | 'COD';
    paymentStatus: 'pending' | 'paid';
    shipByDate?: string;
    orderNumber: undefined;
    totalAmount: number;
    shippingAddress: string;
    originalOrderId: string | null;
    lines: Array<{ skuId: string; qty: number; unitPrice: number }>;
}

export interface CreateOrderFormProps {
    channels: ChannelOption[];
    onCreate: (data: CreateOrderData) => void;
    isCreating: boolean;
    onCancel?: () => void;
    /** When true, uses wider layout suitable for full-page rendering */
    fullPage?: boolean;
}

// Item card with full product details
function ItemCard({
    line,
    onUpdateQty,
    onUpdatePrice,
    onRemove,
}: {
    line: OrderLine;
    onUpdateQty: (qty: number) => void;
    onUpdatePrice: (price: number) => void;
    onRemove: () => void;
}) {
    return (
        <div className="group relative border rounded-lg p-3 bg-card hover:border-ring transition-colors">
            {/* Remove button */}
            <button
                type="button"
                onClick={onRemove}
                className="absolute top-2 right-2 h-6 w-6 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
            >
                <X className="h-3.5 w-3.5" />
            </button>

            {/* Product Info Row */}
            <div className="flex gap-3 mb-3 pr-6">
                {/* Thumbnail */}
                <div className="w-14 h-14 rounded-md bg-gradient-to-br from-slate-100 to-slate-200 border flex items-center justify-center shrink-0 overflow-hidden">
                    {line.imageUrl ? (
                        <img
                            src={getOptimizedImageUrl(line.imageUrl, 'md') || line.imageUrl}
                            alt={line.productName || 'Product'}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                            }}
                        />
                    ) : null}
                    <span className={cn(
                        "text-xl font-semibold text-slate-400",
                        line.imageUrl && "hidden"
                    )}>
                        {line.productName?.charAt(0)?.toUpperCase() || '?'}
                    </span>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm leading-tight line-clamp-2">{line.productName}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                        <span className="inline-block px-1.5 py-0.5 bg-muted rounded text-[10px]">{line.colorName}</span>
                        <span className="mx-1">·</span>
                        <span className="inline-block px-1.5 py-0.5 bg-muted rounded text-[10px]">{line.size}</span>
                    </p>
                </div>
            </div>

            {/* Qty & Price Row */}
            <div className="flex items-center gap-3 pt-2 border-t">
                {/* Qty */}
                <div className="flex items-center border rounded">
                    <button
                        type="button"
                        onClick={() => onUpdateQty(Math.max(1, line.qty - 1))}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        -
                    </button>
                    <input
                        type="number"
                        value={line.qty}
                        onChange={(e) => onUpdateQty(Math.max(1, Number(e.target.value)))}
                        className="h-7 w-10 text-center bg-transparent border-x text-sm focus:outline-none"
                        min={1}
                    />
                    <button
                        type="button"
                        onClick={() => onUpdateQty(line.qty + 1)}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        +
                    </button>
                </div>

                {/* Price */}
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">×</span>
                    <span className="text-xs text-muted-foreground">₹</span>
                    <input
                        type="number"
                        value={line.unitPrice}
                        onChange={(e) => onUpdatePrice(Number(e.target.value))}
                        className="h-7 w-16 text-right bg-transparent border rounded px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        min={0}
                    />
                </div>

                {/* Total */}
                <div className="ml-auto text-right">
                    <span className="font-semibold text-sm">
                        ₹{(line.qty * line.unitPrice).toLocaleString('en-IN')}
                    </span>
                </div>
            </div>
        </div>
    );
}

// Helper to stringify address
function stringifyAddress(addr: AddressData): string {
    return JSON.stringify(addr);
}

export function CreateOrderForm({
    channels,
    onCreate,
    isCreating,
    onCancel,
    fullPage = false,
}: CreateOrderFormProps) {
    const [orderForm, setOrderForm] = useState({
        customerId: '' as string | null,
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        channel: '',
        isExchange: false,
        paymentMethod: 'Prepaid' as 'Prepaid' | 'COD',
        paymentStatus: 'pending' as 'pending' | 'paid',
        shipByDate: '',
    });

    const isChannelSelected = !!orderForm.channel;
    const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
    const [isAddingItem, setIsAddingItem] = useState(false);
    const [isSearchingCustomer, setIsSearchingCustomer] = useState(false);
    const [addressForm, setAddressForm] = useState<AddressData>({});
    const [isAddressExpanded, setIsAddressExpanded] = useState(false);
    const [isManualAddressOpen, setIsManualAddressOpen] = useState(false);
    const [showContactWarning, setShowContactWarning] = useState(false);
    const [originalPrices, setOriginalPrices] = useState<Map<number, number>>(
        new Map()
    );

    // Exchange order state
    const [sourceOrder, setSourceOrder] = useState<OrderForExchange | null>(null);
    const [orderNumberSearch, setOrderNumberSearch] = useState('');
    const [isSearchingOrder, setIsSearchingOrder] = useState(false);
    const [orderSearchError, setOrderSearchError] = useState('');

    const getCustomerAddressesFn = useServerFn(getCustomerAddresses);
    const getOrderForExchangeFn = useServerFn(getOrderForExchange);

    const { data: pastAddressesData, isLoading: isLoadingAddresses } = useQuery({
        queryKey: ['customer-addresses', orderForm.customerId],
        queryFn: () => getCustomerAddressesFn({ data: { customerId: orderForm.customerId! } }),
        enabled: isAddressExpanded && !!orderForm.customerId,
        staleTime: 60 * 1000,
    });

    const pastAddresses: AddressData[] = pastAddressesData || [];

    const handleSelectPastAddress = (addr: AddressData) => {
        setAddressForm(addr);
        setIsAddressExpanded(false);
    };

    const handleAddressChange = (field: keyof AddressData, value: string) => {
        setAddressForm((f) => ({ ...f, [field]: value }));
    };

    const handleSelectCustomer = (customer: { id: string; firstName?: string; lastName?: string; email?: string; phone?: string }) => {
        const firstName = customer.firstName || '';
        const lastName = customer.lastName || '';
        const displayName =
            firstName || lastName
                ? `${firstName} ${lastName}`.trim()
                : customer.email?.split('@')[0] || '';

        setOrderForm((f) => ({
            ...f,
            customerId: customer.id,
            customerName: displayName,
            customerEmail: customer.email || '',
            customerPhone: customer.phone || '',
        }));
        setIsSearchingCustomer(false);
    };

    const handleCustomerFieldChange = (field: string, value: string) => {
        setOrderForm((f) => ({
            ...f,
            [field]: value,
            customerId: null,
        }));
    };

    const handleOrderLookup = async () => {
        if (!orderNumberSearch.trim()) return;

        setIsSearchingOrder(true);
        setOrderSearchError('');

        try {
            const result = await getOrderForExchangeFn({ data: { orderNumber: orderNumberSearch.trim() } });

            if (result.success && result.data) {
                const order = result.data;
                setSourceOrder(order);

                setOrderForm(f => ({
                    ...f,
                    customerId: order.customerId,
                    customerName: order.customerName,
                    customerEmail: order.customerEmail || '',
                    customerPhone: order.customerPhone || '',
                }));

                if (order.shippingAddress) {
                    try {
                        setAddressForm(JSON.parse(order.shippingAddress));
                    } catch {
                        // Ignore parse errors
                    }
                }
            } else {
                setOrderSearchError(result.error || 'Order not found');
            }
        } catch (error: unknown) {
            setOrderSearchError('Failed to look up order');
        } finally {
            setIsSearchingOrder(false);
        }
    };

    const handleClearSourceOrder = () => {
        setSourceOrder(null);
        setOrderNumberSearch('');
        setOrderSearchError('');
        setOrderForm(f => ({
            ...f,
            customerId: null,
            customerName: '',
            customerEmail: '',
            customerPhone: '',
        }));
        setAddressForm({});
    };

    const handleSelectSku = (sku: SKUData, stock: number) => {
        const mrpPrice = Number(sku.mrp) || 0;
        const imageUrl = sku.variation?.imageUrl || sku.variation?.product?.imageUrl || '';
        const newLine: OrderLine = {
            skuId: sku.id,
            qty: 1,
            unitPrice: orderForm.isExchange ? 0 : mrpPrice,
            productName: sku.variation?.product?.name || 'Unknown',
            colorName: sku.variation?.colorName || '-',
            size: sku.size || '-',
            skuCode: sku.skuCode || '-',
            stock: stock,
            imageUrl: imageUrl,
        };

        const newIndex = orderLines.length;
        setOriginalPrices((prev) => new Map(prev).set(newIndex, mrpPrice));

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

        setOriginalPrices((prev) => new Map(prev).set(idx, price));
    };

    const removeLine = (idx: number) => {
        setOrderLines(orderLines.filter((_, i) => i !== idx));
        setOriginalPrices((prev) => {
            const updated = new Map(prev);
            updated.delete(idx);
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

    const handleExchangeToggle = (isExchange: boolean) => {
        const defaultChannel = channels?.[0]?.id || 'offline';

        setOrderForm((f) => ({
            ...f,
            isExchange,
            channel: f.channel || defaultChannel,
        }));

        if (isExchange) {
            setOrderLines((lines) =>
                lines.map((line, idx) => {
                    setOriginalPrices((prev) => {
                        const updated = new Map(prev);
                        if (!updated.has(idx)) {
                            updated.set(idx, line.unitPrice);
                        }
                        return updated;
                    });
                    return { ...line, unitPrice: 0 };
                })
            );
        } else {
            setOrderLines((lines) =>
                lines.map((line, idx) => ({
                    ...line,
                    unitPrice: originalPrices.get(idx) || line.unitPrice,
                }))
            );
            setSourceOrder(null);
            setOrderNumberSearch('');
            setOrderSearchError('');
        }
    };

    const handleSubmit = (e: React.FormEvent, bypassContactWarning = false) => {
        e.preventDefault();
        if (orderLines.length === 0) {
            alert('Add at least one item');
            return;
        }

        const hasEmail = !!orderForm.customerEmail?.trim();
        const hasPhone = !!orderForm.customerPhone?.trim();
        if (!hasEmail && !hasPhone && !bypassContactWarning) {
            setShowContactWarning(true);
            return;
        }

        setShowContactWarning(false);

        const totalAmount = orderLines.reduce(
            (sum, l) => sum + l.qty * l.unitPrice,
            0
        );
        onCreate({
            ...orderForm,
            customerEmail: orderForm.customerEmail?.trim() || undefined,
            customerPhone: orderForm.customerPhone?.trim() || undefined,
            orderNumber: undefined,
            totalAmount,
            shippingAddress: stringifyAddress(addressForm),
            originalOrderId: sourceOrder?.id || null,
            shipByDate: orderForm.shipByDate
                ? new Date(orderForm.shipByDate).toISOString()
                : undefined,
            lines: orderLines.map((l) => ({
                skuId: l.skuId,
                qty: l.qty,
                unitPrice: l.unitPrice,
            })),
        });
    };

    const totalAmount = orderLines.reduce(
        (sum, l) => sum + l.qty * l.unitPrice,
        0
    );
    const totalItems = orderLines.reduce((sum, l) => sum + l.qty, 0);

    const hasAddressData = Object.values(addressForm).some((v) => v && v.trim());

    const addressDisplay = [
        addressForm.address1,
        addressForm.address2,
        addressForm.city,
        addressForm.province,
        addressForm.zip,
        addressForm.country,
    ]
        .filter(Boolean)
        .join(', ');

    return (
        <form onSubmit={handleSubmit} className={cn(
            'flex flex-col',
            fullPage ? 'gap-6' : 'min-h-0 flex-1'
        )}>
            {/* Scrollable Content */}
            <div className={cn(
                'space-y-3',
                fullPage ? '' : 'flex-1 overflow-y-auto px-4 py-3'
            )}>
                {/* Channel Tabs */}
                <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Channel *</Label>
                    <div className="flex flex-wrap gap-1.5">
                        {/* Regular channels (excluding Shopify) */}
                        {channels?.filter((ch: ChannelOption) => ch.name?.toLowerCase() !== 'shopify').map((ch: ChannelOption) => {
                            const name = ch.name?.toLowerCase() || '';
                            const isSelected = orderForm.channel === ch.id && !orderForm.isExchange;

                            const colorMap: Record<string, string> = {
                                offline: isSelected
                                    ? 'bg-slate-700 text-white border-slate-700'
                                    : 'hover:bg-slate-50 hover:border-slate-300',
                                nykaa: isSelected
                                    ? 'bg-pink-400 text-white border-pink-400'
                                    : 'hover:bg-pink-50 hover:border-pink-200',
                                myntra: isSelected
                                    ? 'bg-rose-400 text-white border-rose-400'
                                    : 'hover:bg-rose-50 hover:border-rose-200',
                                ajio: isSelected
                                    ? 'bg-violet-400 text-white border-violet-400'
                                    : 'hover:bg-violet-50 hover:border-violet-200',
                            };
                            const colorClasses = colorMap[name] || (isSelected
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'hover:bg-muted');

                            return (
                                <button
                                    key={ch.id}
                                    type="button"
                                    onClick={() => {
                                        setOrderForm((f) => ({ ...f, channel: ch.id, isExchange: false }));
                                    }}
                                    className={cn(
                                        'px-3 py-1.5 text-xs font-medium rounded-md border border-border transition-colors',
                                        colorClasses
                                    )}
                                >
                                    {ch.name}
                                </button>
                            );
                        })}
                        {(!channels || channels.filter((ch: ChannelOption) => ch.name?.toLowerCase() !== 'shopify').length === 0) && (
                            <button
                                type="button"
                                onClick={() => {
                                    setOrderForm((f) => ({ ...f, channel: 'offline', isExchange: false }));
                                }}
                                className={cn(
                                    'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
                                    orderForm.channel === 'offline' && !orderForm.isExchange
                                        ? 'bg-slate-700 text-white border-slate-700'
                                        : 'bg-background hover:bg-slate-50 border-border hover:border-slate-300'
                                )}
                            >
                                Offline
                            </button>
                        )}
                        {/* Exchange option */}
                        <button
                            type="button"
                            onClick={() => handleExchangeToggle(true)}
                            className={cn(
                                'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors flex items-center gap-1.5',
                                orderForm.isExchange
                                    ? 'bg-amber-400 text-white border-amber-400'
                                    : 'bg-background hover:bg-amber-50 border-border hover:border-amber-200'
                            )}
                        >
                            <RefreshCw className="h-3 w-3" />
                            Exchange
                        </button>
                    </div>
                </div>

                {/* Rest - Disabled until channel selected */}
                <div className={cn(
                    'space-y-3 transition-opacity',
                    !isChannelSelected && 'opacity-40 pointer-events-none'
                )}>
                    {/* Source Order Lookup - Exchange mode only */}
                    {orderForm.isExchange && (
                        <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Source Order</Label>

                            {!sourceOrder ? (
                                <div className="space-y-2">
                                    <div className="flex gap-2">
                                        <Input
                                            className="h-8 text-sm flex-1"
                                            placeholder="Enter order number..."
                                            value={orderNumberSearch}
                                            onChange={(e) => setOrderNumberSearch(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleOrderLookup())}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleOrderLookup}
                                            disabled={isSearchingOrder || !orderNumberSearch.trim()}
                                            className="h-8 px-3"
                                        >
                                            {isSearchingOrder ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Search className="h-3.5 w-3.5" />
                                            )}
                                        </Button>
                                    </div>
                                    {orderSearchError && (
                                        <p className="text-xs text-destructive">{orderSearchError}</p>
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                        Look up existing order to auto-fill customer info
                                    </p>
                                </div>
                            ) : (
                                <div className="p-3 border rounded-md bg-amber-50/50 border-amber-200/50 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <RefreshCw className="h-3.5 w-3.5 text-amber-600" />
                                            <span className="font-medium text-sm">{sourceOrder.orderNumber}</span>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleClearSourceOrder}
                                            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                                        >
                                            Change
                                        </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {sourceOrder.customerName} · {sourceOrder.orderLines.length} items · ₹{sourceOrder.totalAmount.toLocaleString('en-IN')}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Customer - Show simplified version when source order is selected */}
                    {orderForm.isExchange && sourceOrder ? (
                        <div className="p-3 border rounded-md bg-muted/30 space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs text-muted-foreground">Customer (from source order)</Label>
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium">{orderForm.customerName}</p>
                                <p className="text-xs text-muted-foreground">
                                    {[orderForm.customerEmail, orderForm.customerPhone].filter(Boolean).join(' \u00b7 ') || 'No contact info'}
                                </p>
                            </div>
                        </div>
                    ) : (
                        /* Customer - Normal mode */
                        <div>
                            <Label className="text-xs text-muted-foreground">Customer *</Label>
                            <div className="relative">
                                <Input
                                    className="h-8 text-sm pr-8"
                                    placeholder="Name..."
                                    value={orderForm.customerName}
                                    onChange={(e) => handleCustomerFieldChange('customerName', e.target.value)}
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setIsSearchingCustomer(!isSearchingCustomer)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                    <Search className="h-3.5 w-3.5" />
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
                    )}

                    {/* Email & Phone - Hide when source order is selected */}
                    {!(orderForm.isExchange && sourceOrder) && (
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <Label className="text-xs text-muted-foreground">Email</Label>
                            <Input
                                type="email"
                                className="h-8 text-sm"
                                placeholder="email@example.com"
                                value={orderForm.customerEmail}
                                onChange={(e) => handleCustomerFieldChange('customerEmail', e.target.value)}
                            />
                        </div>
                        <div>
                            <Label className="text-xs text-muted-foreground">Phone</Label>
                            <Input
                                className="h-8 text-sm"
                                placeholder="Phone number..."
                                value={orderForm.customerPhone}
                                onChange={(e) => handleCustomerFieldChange('customerPhone', e.target.value)}
                            />
                        </div>
                    </div>
                    )}

                    {/* Address Section */}
                    <div className="space-y-2">
                        {/* Address Toggle Button */}
                        <div className={cn(
                            'flex items-center gap-2 px-3 py-2 text-sm border rounded-md transition-colors',
                            hasAddressData
                                ? 'border-green-200 bg-green-50 text-green-700'
                                : 'text-muted-foreground hover:bg-muted/50'
                        )}>
                            <button
                                type="button"
                                onClick={() => setIsAddressExpanded(!isAddressExpanded)}
                                className="flex-1 flex items-center gap-2 text-left min-w-0"
                            >
                                <MapPin className="h-3.5 w-3.5 shrink-0" />
                                <span className="flex-1 truncate text-xs">
                                    {hasAddressData ? addressDisplay : 'Add shipping address...'}
                                </span>
                                {isAddressExpanded ? (
                                    <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                                ) : (
                                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                                )}
                            </button>
                            {hasAddressData && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setAddressForm({});
                                        setIsAddressExpanded(false);
                                    }}
                                    className="h-5 w-5 flex items-center justify-center rounded-full hover:bg-green-200 text-green-600 transition-colors"
                                    title="Clear address"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            )}
                        </div>

                        {/* Expanded Address Panel */}
                        {isAddressExpanded && (
                            <div className="border rounded-md overflow-hidden">
                                {/* Saved Addresses */}
                                {orderForm.customerId && (
                                    <div className="p-3 bg-muted/30">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs font-medium text-muted-foreground">Saved Addresses</span>
                                            {isLoadingAddresses && (
                                                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                            )}
                                        </div>

                                        {isLoadingAddresses ? (
                                            <div className="flex items-center justify-center py-4">
                                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                <span className="ml-2 text-xs text-muted-foreground">Loading addresses...</span>
                                            </div>
                                        ) : pastAddresses.length > 0 ? (
                                            <div className="space-y-1.5">
                                                {pastAddresses.slice(0, 3).map((addr, idx) => {
                                                    const isSelected = addr.address1 === addressForm.address1 && addr.zip === addressForm.zip;
                                                    return (
                                                        <button
                                                            key={idx}
                                                            type="button"
                                                            onClick={() => {
                                                                handleSelectPastAddress(addr);
                                                                setIsAddressExpanded(false);
                                                            }}
                                                            className={cn(
                                                                'w-full text-left p-2.5 rounded-md border transition-all text-xs',
                                                                isSelected
                                                                    ? 'bg-primary/5 border-primary/30 ring-1 ring-primary/20'
                                                                    : 'bg-background border-transparent hover:bg-background hover:border-border'
                                                            )}
                                                        >
                                                            <div className="flex items-start gap-2">
                                                                <MapPin className={cn(
                                                                    'h-3.5 w-3.5 mt-0.5 shrink-0',
                                                                    isSelected ? 'text-primary' : 'text-muted-foreground'
                                                                )} />
                                                                <div className="flex-1 min-w-0">
                                                                    {(addr.first_name || addr.last_name) && (
                                                                        <p className="font-medium truncate">
                                                                            {[addr.first_name, addr.last_name].filter(Boolean).join(' ')}
                                                                        </p>
                                                                    )}
                                                                    <p className="text-muted-foreground truncate">
                                                                        {[addr.address1, addr.city, addr.province, addr.zip].filter(Boolean).join(', ')}
                                                                    </p>
                                                                </div>
                                                                {isSelected && (
                                                                    <span className="text-[10px] text-primary font-medium">Selected</span>
                                                                )}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <p className="text-xs text-muted-foreground/70 py-2 text-center">
                                                No saved addresses found
                                            </p>
                                        )}
                                    </div>
                                )}

                                {/* Manual Entry Toggle */}
                                <div className="border-t">
                                    <button
                                        type="button"
                                        onClick={() => setIsManualAddressOpen(!isManualAddressOpen)}
                                        className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
                                    >
                                        <span>Enter address manually</span>
                                        {isManualAddressOpen ? (
                                            <ChevronUp className="h-3 w-3" />
                                        ) : (
                                            <ChevronDown className="h-3 w-3" />
                                        )}
                                    </button>

                                    {/* Manual Entry Form */}
                                    {isManualAddressOpen && (
                                        <div className="p-3 pt-0 space-y-2">
                                            <div className="grid grid-cols-2 gap-2">
                                                <Input
                                                    className="h-7 text-xs"
                                                    placeholder="First name"
                                                    value={addressForm.first_name || ''}
                                                    onChange={(e) => handleAddressChange('first_name', e.target.value)}
                                                />
                                                <Input
                                                    className="h-7 text-xs"
                                                    placeholder="Last name"
                                                    value={addressForm.last_name || ''}
                                                    onChange={(e) => handleAddressChange('last_name', e.target.value)}
                                                />
                                            </div>
                                            <Input
                                                className="h-7 text-xs"
                                                placeholder="Address line 1"
                                                value={addressForm.address1 || ''}
                                                onChange={(e) => handleAddressChange('address1', e.target.value)}
                                            />
                                            <Input
                                                className="h-7 text-xs"
                                                placeholder="Address line 2"
                                                value={addressForm.address2 || ''}
                                                onChange={(e) => handleAddressChange('address2', e.target.value)}
                                            />
                                            <div className="grid grid-cols-3 gap-2">
                                                <Input
                                                    className="h-7 text-xs"
                                                    placeholder="City"
                                                    value={addressForm.city || ''}
                                                    onChange={(e) => handleAddressChange('city', e.target.value)}
                                                />
                                                <Input
                                                    className="h-7 text-xs"
                                                    placeholder="State"
                                                    value={addressForm.province || ''}
                                                    onChange={(e) => handleAddressChange('province', e.target.value)}
                                                />
                                                <Input
                                                    className="h-7 text-xs"
                                                    placeholder="ZIP"
                                                    value={addressForm.zip || ''}
                                                    onChange={(e) => handleAddressChange('zip', e.target.value)}
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <Input
                                                    className="h-7 text-xs"
                                                    placeholder="Country"
                                                    value={addressForm.country || ''}
                                                    onChange={(e) => handleAddressChange('country', e.target.value)}
                                                />
                                                <Input
                                                    className="h-7 text-xs"
                                                    placeholder="Phone"
                                                    value={addressForm.phone || ''}
                                                    onChange={(e) => handleAddressChange('phone', e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Items */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <Label className="text-xs text-muted-foreground">Items</Label>
                            {!isAddingItem && orderLines.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setIsAddingItem(true)}
                                    className="text-xs text-primary hover:underline"
                                >
                                    + Add
                                </button>
                            )}
                        </div>

                        {orderLines.length > 0 && (
                            <div className="space-y-2 mb-2">
                                {orderLines.map((line, idx) => (
                                    <ItemCard
                                        key={`${line.skuId}-${idx}`}
                                        line={line}
                                        onUpdateQty={(qty) => updateLineQty(idx, qty)}
                                        onUpdatePrice={(price) => updateLinePrice(idx, price)}
                                        onRemove={() => removeLine(idx)}
                                    />
                                ))}
                            </div>
                        )}

                        {isAddingItem ? (
                            <ProductSearch
                                onSelect={handleSelectSku}
                                onCancel={() => setIsAddingItem(false)}
                            />
                        ) : orderLines.length === 0 ? (
                            <button
                                type="button"
                                onClick={() => setIsAddingItem(true)}
                                className="w-full py-4 border-2 border-dashed rounded-md text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                            >
                                <Search className="h-4 w-4 inline mr-2" />
                                Search products...
                            </button>
                        ) : null}
                    </div>

                    {/* Ship By + Payment Row */}
                    <div className="pt-2 border-t space-y-2">
                        <div>
                            <Label className="text-xs text-muted-foreground">Ship by</Label>
                            <Input
                                type="date"
                                className="h-8 text-xs w-full"
                                value={orderForm.shipByDate}
                                onChange={(e) =>
                                    setOrderForm((f) => ({ ...f, shipByDate: e.target.value }))
                                }
                                min={new Date().toISOString().split('T')[0]}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <Label className="text-xs text-muted-foreground">Payment</Label>
                                <Select
                                    value={orderForm.paymentMethod}
                                    onValueChange={(value) =>
                                        setOrderForm((f) => ({ ...f, paymentMethod: value as 'Prepaid' | 'COD' }))
                                    }
                                >
                                    <SelectTrigger className={cn(
                                        'h-8 text-xs',
                                        orderForm.paymentMethod === 'Prepaid' ? 'text-green-600' : 'text-amber-600'
                                    )}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Prepaid">Prepaid</SelectItem>
                                        <SelectItem value="COD">COD</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label className="text-xs text-muted-foreground">Status</Label>
                                <Select
                                    value={orderForm.paymentStatus}
                                    onValueChange={(value) =>
                                        setOrderForm((f) => ({ ...f, paymentStatus: value as 'pending' | 'paid' }))
                                    }
                                >
                                    <SelectTrigger className={cn(
                                        'h-8 text-xs',
                                        orderForm.paymentStatus === 'paid' ? 'text-green-600' : 'text-amber-600'
                                    )}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="pending">Pending</SelectItem>
                                        <SelectItem value="paid">Paid</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className={cn(
                'border-t bg-muted/30 shrink-0',
                fullPage ? 'p-4 rounded-b-lg' : 'px-4 py-3'
            )}>
                {/* Total */}
                {orderLines.length > 0 && !showContactWarning && (
                    <div className="flex items-center justify-between mb-3 text-sm">
                        <span className="text-muted-foreground">
                            {totalItems} item{totalItems !== 1 ? 's' : ''}
                        </span>
                        <span className={cn(
                            'font-semibold',
                            totalAmount === 0 && orderForm.isExchange && 'text-amber-600'
                        )}>
                            ₹{totalAmount.toLocaleString('en-IN')}
                        </span>
                    </div>
                )}

                {/* Missing Contact Warning */}
                {showContactWarning && (
                    <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-md">
                        <p className="text-xs text-amber-800 font-medium mb-1">
                            Missing contact information
                        </p>
                        <p className="text-xs text-amber-700 mb-3">
                            No email or phone provided. You can add this later, but it may affect order communication.
                        </p>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setShowContactWarning(false)}
                                className="flex-1 h-7 text-xs"
                            >
                                Go Back
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                onClick={(e) => handleSubmit(e as unknown as React.FormEvent, true)}
                                disabled={isCreating}
                                className="flex-1 h-7 text-xs bg-amber-500 hover:bg-amber-600"
                            >
                                {isCreating ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                    'Create Anyway'
                                )}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Buttons */}
                {!showContactWarning && (
                    <div className="flex gap-2">
                        {onCancel && (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={onCancel}
                                className="flex-1 h-9"
                            >
                                Cancel
                            </Button>
                        )}
                        <Button
                            type="submit"
                            disabled={isCreating || orderLines.length === 0 || !isChannelSelected}
                            className={cn(
                                'flex-1 h-9',
                                orderForm.isExchange && 'bg-amber-500 hover:bg-amber-600'
                            )}
                        >
                            {isCreating ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                `Create ${orderForm.isExchange ? 'Exchange' : 'Order'}`
                            )}
                        </Button>
                    </div>
                )}
            </div>
        </form>
    );
}

export default CreateOrderForm;
