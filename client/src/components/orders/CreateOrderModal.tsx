/**
 * CreateOrderModal component
 * Clean, compact form for creating a new order
 */

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    RefreshCw,
    Search,
    MapPin,
    ChevronDown,
    ChevronUp,
    Loader2,
    X,
} from 'lucide-react';
import { customersApi } from '../../services/api';
import { trpc } from '../../services/trpc';
import { CustomerSearch } from '../common/CustomerSearch';
import { ProductSearch } from '../common/ProductSearch';

// shadcn/ui components
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
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
    // Display info (stored for UI)
    productName?: string;
    colorName?: string;
    size?: string;
    skuCode?: string;
    stock?: number;
    imageUrl?: string;
}

interface CreateOrderModalProps {
    allSkus: any[];
    channels: any[];
    inventoryBalance: any[];
    onCreate: (data: any) => void;
    onClose: () => void;
    isCreating: boolean;
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
                            src={line.imageUrl}
                            alt={line.productName || 'Product'}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                                // Hide broken image and show fallback
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
        channel: '', // Empty - must be selected first
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
    // Track original prices for exchange toggle reversion
    const [originalPrices, setOriginalPrices] = useState<Map<number, number>>(
        new Map()
    );
    // Track fetched balances for SKUs not in pre-fetched inventory (on-demand fetch)
    const [fetchedBalances, setFetchedBalances] = useState<Map<string, number>>(
        new Map()
    );
    // Track SKUs currently being fetched to avoid duplicate requests
    const [fetchingSkuIds, setFetchingSkuIds] = useState<Set<string>>(new Set());

    // tRPC utilities for on-demand fetching
    const trpcUtils = trpc.useUtils();

    // Handler to fetch balances for SKUs on-demand
    const handleFetchBalances = useCallback(
        (skuIds: string[]) => {
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
        },
        [fetchedBalances, fetchingSkuIds, trpcUtils.inventory.getBalances]
    );

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
        setAddressForm((f) => ({ ...f, [field]: value }));
    };

    // Handle customer selection from search
    const handleSelectCustomer = (customer: any) => {
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

    // Clear linked customer when manually editing fields
    const handleCustomerFieldChange = (field: string, value: string) => {
        setOrderForm((f) => ({
            ...f,
            [field]: value,
            // Clear customerId if user manually edits - they're entering a new customer
            customerId: null,
        }));
    };

    const handleSelectSku = (sku: any, stock: number) => {
        const mrpPrice = Number(sku.mrp) || 0;
        // Get image URL - prefer variation image, fallback to product image
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

        // Store original price for this line
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

        // Update original price tracking when user manually changes price
        setOriginalPrices((prev) => new Map(prev).set(idx, price));
    };

    const removeLine = (idx: number) => {
        setOrderLines(orderLines.filter((_, i) => i !== idx));
        // Clean up price tracking
        setOriginalPrices((prev) => {
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

    // Handle exchange toggle
    const handleExchangeToggle = (isExchange: boolean) => {
        // Get default channel for exchange orders
        const defaultChannel = channels?.[0]?.id || 'offline';

        setOrderForm((f) => ({
            ...f,
            isExchange,
            // Set channel if not already set
            channel: f.channel || defaultChannel,
        }));

        if (isExchange) {
            // Zero out all prices and preserve originals
            setOrderLines((lines) =>
                lines.map((line, idx) => {
                    // Store current price as original if not already stored
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
            // Restore original prices
            setOrderLines((lines) =>
                lines.map((line, idx) => ({
                    ...line,
                    unitPrice: originalPrices.get(idx) || line.unitPrice,
                }))
            );
        }
    };

    const handleSubmit = (e: React.FormEvent, bypassContactWarning = false) => {
        e.preventDefault();
        if (orderLines.length === 0) {
            alert('Add at least one item');
            return;
        }

        // Check for missing contact info
        const hasEmail = !!orderForm.customerEmail?.trim();
        const hasPhone = !!orderForm.customerPhone?.trim();
        if (!hasEmail && !hasPhone && !bypassContactWarning) {
            setShowContactWarning(true);
            return;
        }

        // Reset warning and proceed
        setShowContactWarning(false);

        const totalAmount = orderLines.reduce(
            (sum, l) => sum + l.qty * l.unitPrice,
            0
        );
        const prefix = orderForm.isExchange ? 'EXC' : 'COH';
        onCreate({
            ...orderForm,
            // Send undefined instead of empty strings for optional fields
            customerEmail: orderForm.customerEmail?.trim() || undefined,
            customerPhone: orderForm.customerPhone?.trim() || undefined,
            orderNumber: `${prefix}-${Date.now().toString().slice(-6)}`,
            totalAmount,
            shippingAddress: stringifyAddress(addressForm),
            // Convert shipByDate to ISO string if provided
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

    // Check if address has any data
    const hasAddressData = Object.values(addressForm).some((v) => v && v.trim());

    // Format address for display
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
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md p-0 gap-0 max-h-[85vh] flex flex-col overflow-hidden">
                {/* Header */}
                <DialogHeader className="px-4 py-3 border-b shrink-0">
                    <DialogTitle className="text-base flex items-center gap-2">
                        {orderForm.isExchange ? (
                            <>
                                <RefreshCw className="h-4 w-4 text-amber-500" />
                                Exchange Order
                            </>
                        ) : (
                            'New Order'
                        )}
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                        {/* Channel Tabs */}
                        <div>
                            <Label className="text-xs text-muted-foreground mb-1.5 block">Channel *</Label>
                            <div className="flex flex-wrap gap-1.5">
                                {/* Regular channels (excluding Shopify) */}
                                {channels?.filter((ch: any) => ch.name?.toLowerCase() !== 'shopify').map((ch: any) => {
                                    const name = ch.name?.toLowerCase() || '';
                                    const isSelected = orderForm.channel === ch.id && !orderForm.isExchange;

                                    // Channel-specific colors (pastel palette)
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
                                {(!channels || channels.filter((ch: any) => ch.name?.toLowerCase() !== 'shopify').length === 0) && (
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
                            {/* Customer */}
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

                            {/* Email & Phone */}
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
                                        placeholder="+91 98765 43210"
                                        value={orderForm.customerPhone}
                                        onChange={(e) => handleCustomerFieldChange('customerPhone', e.target.value)}
                                    />
                                </div>
                            </div>

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
                                    {/* Clear address button */}
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
                                        allSkus={allSkus}
                                        inventoryBalance={inventoryBalance}
                                        onSelect={handleSelectSku}
                                        onCancel={() => setIsAddingItem(false)}
                                        fetchedBalances={fetchedBalances}
                                        onFetchBalances={handleFetchBalances}
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
                                {/* Ship by date - full width */}
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
                                {/* Payment row */}
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
                    <div className="px-4 py-3 border-t bg-muted/30 shrink-0">
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
                                        onClick={(e) => handleSubmit(e as any, true)}
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
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={onClose}
                                    className="flex-1 h-9"
                                >
                                    Cancel
                                </Button>
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
            </DialogContent>
        </Dialog>
    );
}

export default CreateOrderModal;
