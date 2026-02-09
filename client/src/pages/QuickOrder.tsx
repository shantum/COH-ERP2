/**
 * QuickOrder page - Simple order form with optional SKU search
 *
 * Type SKU codes directly OR click the search icon to find products.
 * On submit: resolves any unresolved SKU codes → IDs, creates order in ERP, pushes to Google Sheet.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Plus, Loader2, Zap, Trash2, Search, RefreshCw } from 'lucide-react';
import { getChannels } from '../server/functions/admin';
import { resolveSkuCodes } from '../server/functions/products';
import { getOrderForExchange, type OrderForExchange } from '../server/functions/orders';
import { ProductSearch, type SKUData } from '../components/common/ProductSearch';
import { useOrderCrudMutations } from '../hooks/orders/useOrderCrudMutations';
import { showSuccess, showError } from '../utils/toast';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ============================================
// TYPES
// ============================================

interface SkuLine {
    skuCode: string;
    qty: number;
    /** Pre-resolved ID (from search or blur-lookup) */
    skuId?: string;
    mrp?: number;
    productName?: string;
    colorName?: string;
    size?: string;
}

// ============================================
// CHANNEL COLORS
// ============================================

const CHANNEL_COLORS: Record<string, { active: string; inactive: string }> = {
    offline: {
        active: 'bg-slate-700 text-white border-slate-700',
        inactive: 'hover:bg-slate-50 hover:border-slate-300',
    },
    nykaa: {
        active: 'bg-pink-500 text-white border-pink-500',
        inactive: 'hover:bg-pink-50 hover:border-pink-200',
    },
    myntra: {
        active: 'bg-rose-500 text-white border-rose-500',
        inactive: 'hover:bg-rose-50 hover:border-rose-200',
    },
    ajio: {
        active: 'bg-violet-500 text-white border-violet-500',
        inactive: 'hover:bg-violet-50 hover:border-violet-200',
    },
};

const DEFAULT_CHANNEL_COLOR = {
    active: 'bg-primary text-primary-foreground border-primary',
    inactive: 'hover:bg-muted',
};

// ============================================
// MAIN PAGE
// ============================================

export default function QuickOrder() {
    const navigate = useNavigate();

    // Form state
    const [channel, setChannel] = useState('');
    const [customerId, setCustomerId] = useState<string | null>(null);
    const [customerName, setCustomerName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [city, setCity] = useState('');
    const [orderNote, setOrderNote] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<'Prepaid' | 'COD'>('Prepaid');
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid'>('pending');
    const [lines, setLines] = useState<SkuLine[]>([{ skuCode: '', qty: 1 }]);
    const [isResolving, setIsResolving] = useState(false);
    const [searchingIdx, setSearchingIdx] = useState<number | null>(null);

    // Exchange state
    const [isExchange, setIsExchange] = useState(false);
    const [sourceOrder, setSourceOrder] = useState<OrderForExchange | null>(null);
    const [orderNumberSearch, setOrderNumberSearch] = useState('');
    const [isSearchingOrder, setIsSearchingOrder] = useState(false);
    const [orderSearchError, setOrderSearchError] = useState('');

    // Fetch channels
    const getChannelsFn = useServerFn(getChannels);
    const { data: channels = [] } = useQuery({
        queryKey: ['orderChannels'],
        queryFn: async () => {
            const result = await getChannelsFn();
            if (!result.success) throw new Error(result.error?.message || 'Failed to fetch channels');
            return result.data;
        },
        staleTime: 300000,
    });

    // Server functions
    const resolveSkuCodesFn = useServerFn(resolveSkuCodes);
    const getOrderForExchangeFn = useServerFn(getOrderForExchange);

    // Create order mutation
    const { createOrder } = useOrderCrudMutations({
        onCreateSuccess: () => {
            showSuccess('Order created and pushed to sheet');
            navigate({ to: '/orders', search: { view: 'open', page: 1, limit: 250 } });
        },
    });

    const goBack = () => navigate({ to: '/orders', search: { view: 'open', page: 1, limit: 250 } });

    const channelsWithoutShopify =
        channels?.filter((ch: any) => ch.name?.toLowerCase() !== 'shopify') || [];

    // Exchange handlers
    const handleExchangeToggle = (on: boolean) => {
        setIsExchange(on);
        if (on) {
            // Default channel to first available
            if (!channel && channelsWithoutShopify.length > 0) {
                setChannel(channelsWithoutShopify[0].id);
            }
        } else {
            setSourceOrder(null);
            setOrderNumberSearch('');
            setOrderSearchError('');
        }
    };

    const handleOrderLookup = async () => {
        if (!orderNumberSearch.trim()) return;
        setIsSearchingOrder(true);
        setOrderSearchError('');

        try {
            const result = await getOrderForExchangeFn({ data: { orderNumber: orderNumberSearch.trim() } });
            if (result.success && result.data) {
                setSourceOrder(result.data);
                setCustomerName(result.data.customerName);
                setCustomerId(result.data.customerId);
                setPhone(result.data.customerPhone || '');
                setEmail(result.data.customerEmail || '');
                // Parse city from shipping address
                if (result.data.shippingAddress) {
                    try {
                        const addr = JSON.parse(result.data.shippingAddress);
                        setCity(addr.city || '');
                    } catch { /* ignore */ }
                }
            } else {
                setOrderSearchError(result.error || 'Order not found');
            }
        } catch {
            setOrderSearchError('Failed to look up order');
        } finally {
            setIsSearchingOrder(false);
        }
    };

    const handleClearSourceOrder = () => {
        setSourceOrder(null);
        setOrderNumberSearch('');
        setOrderSearchError('');
        setCustomerName('');
        setCustomerId(null);
        setPhone('');
        setEmail('');
        setCity('');
    };

    // Line handlers
    const updateLine = (idx: number, field: keyof SkuLine, value: string | number) => {
        setLines((prev) => prev.map((l, i) => {
            if (i !== idx) return l;
            // If user manually edits the SKU code, clear all resolved details
            if (field === 'skuCode') {
                return { ...l, skuCode: value as string, skuId: undefined, mrp: undefined, productName: undefined, colorName: undefined, size: undefined };
            }
            return { ...l, [field]: value };
        }));
    };

    const handleSearchSelect = (idx: number, sku: SKUData) => {
        setLines((prev) => prev.map((l, i) =>
            i === idx
                ? {
                    ...l,
                    skuCode: sku.skuCode || '',
                    skuId: sku.id,
                    mrp: Number(sku.mrp) || 0,
                    productName: sku.variation?.product?.name || 'Unknown',
                    colorName: sku.variation?.colorName || '',
                    size: sku.size || '',
                }
                : l,
        ));
        setSearchingIdx(null);
    };

    // Resolve a single SKU code on blur (so user sees product details before submitting)
    const handleSkuBlur = async (idx: number) => {
        const line = lines[idx];
        // Skip if already resolved or empty
        if (!line || line.skuId || !line.skuCode.trim()) return;

        try {
            const resolved = await resolveSkuCodesFn({ data: { skuCodes: [line.skuCode.trim()] } });
            if (resolved.length > 0) {
                const r = resolved[0];
                setLines((prev) => prev.map((l, i) =>
                    i === idx && l.skuCode === line.skuCode // Only update if code hasn't changed
                        ? { ...l, skuId: r.skuId, mrp: r.mrp ?? 0, productName: r.productName, colorName: r.colorName, size: r.size }
                        : l,
                ));
            }
        } catch {
            // Silently fail — will show error on submit
        }
    };

    const addLine = () => {
        setLines((prev) => [...prev, { skuCode: '', qty: 1 }]);
    };

    const removeLine = (idx: number) => {
        setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
        if (searchingIdx === idx) setSearchingIdx(null);
    };

    // Validation
    const validLines = lines.filter((l) => l.skuCode.trim() && l.qty > 0);
    const isReady = channel && customerName.trim() && validLines.length > 0;
    const isBusy = isResolving || createOrder.isPending;

    // Order number preview
    const previewOrderNumber = (() => {
        if (isExchange && sourceOrder) {
            const sourceNumeric = sourceOrder.orderNumber.replace(/\D/g, '').slice(-6) || 'X';
            return `EXC-${sourceNumeric}-${sourceOrder.exchangeCount + 1}`;
        }
        if (isExchange) return `EXC-${Date.now().toString().slice(-8)}`;
        return `COH-${Date.now().toString().slice(-8)}`;
    })();

    // Submit: resolve SKU codes → IDs, then create order
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isReady || isBusy) return;

        setIsResolving(true);

        try {
            // 1. Split lines into already-resolved (from search) and need-resolution (typed)
            const needResolution = validLines.filter((l) => !l.skuId);
            let codeMap = new Map<string, { skuId: string; mrp: number }>();

            if (needResolution.length > 0) {
                const skuCodes = needResolution.map((l) => l.skuCode.trim());
                const resolved = await resolveSkuCodesFn({ data: { skuCodes } });
                codeMap = new Map(resolved.map((r) => [r.skuCode.toLowerCase(), { skuId: r.skuId, mrp: r.mrp ?? 0 }]));

                // Check for unresolved SKUs
                const missing = skuCodes.filter((code) => !codeMap.has(code.toLowerCase()));
                if (missing.length > 0) {
                    showError(`SKU not found: ${missing.join(', ')}`);
                    setIsResolving(false);
                    return;
                }
            }

            // 2. Build order lines — use pre-resolved ID if available, otherwise from resolution
            const orderLines = validLines.map((l) => {
                if (l.skuId) {
                    return { skuId: l.skuId, qty: l.qty, unitPrice: l.mrp ?? 0 };
                }
                const match = codeMap.get(l.skuCode.trim().toLowerCase())!;
                return { skuId: match.skuId, qty: l.qty, unitPrice: match.mrp ?? 0 };
            });

            const totalAmount = orderLines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);

            // 3. Create order
            createOrder.mutate({
                channel,
                customerName: customerName.trim(),
                ...(customerId ? { customerId } : {}),
                ...(email.trim() ? { customerEmail: email.trim() } : {}),
                ...(phone.trim() ? { customerPhone: phone.trim() } : {}),
                ...(city.trim() ? { shippingAddress: JSON.stringify({ city: city.trim() }) } : {}),
                ...(orderNote.trim() ? { internalNotes: orderNote.trim() } : {}),
                paymentMethod,
                paymentStatus,
                totalAmount,
                isExchange,
                ...(sourceOrder ? { originalOrderId: sourceOrder.id } : {}),
                lines: orderLines,
            });
        } catch (error: unknown) {
            showError(error instanceof Error ? error.message : 'Failed to resolve SKU codes');
        } finally {
            setIsResolving(false);
        }
    };

    return (
        <div className="max-w-xl mx-auto pb-8">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <Button variant="ghost" size="sm" onClick={goBack} className="h-8 px-2">
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1">
                    <h1 className="text-lg font-semibold flex items-center gap-2">
                        <Zap className="h-5 w-5" />
                        Quick Order
                    </h1>
                    <p className="text-xs text-muted-foreground">
                        Creates in ERP + pushes to Google Sheet
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Order #</p>
                    <p className={cn(
                        'text-sm font-mono font-semibold',
                        isExchange ? 'text-amber-600' : 'text-foreground',
                    )}>
                        {previewOrderNumber}
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
                {/* ── Channel ── */}
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">
                        Channel *
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                        {channelsWithoutShopify.map((ch: any) => {
                            const name = ch.name?.toLowerCase() || '';
                            const isSelected = channel === ch.id && !isExchange;
                            const colors = CHANNEL_COLORS[name] || DEFAULT_CHANNEL_COLOR;
                            return (
                                <button
                                    key={ch.id}
                                    type="button"
                                    onClick={() => { setChannel(ch.id); handleExchangeToggle(false); }}
                                    className={cn(
                                        'px-3.5 py-1.5 text-xs font-medium rounded-md border border-border transition-colors',
                                        isSelected ? colors.active : colors.inactive,
                                    )}
                                >
                                    {ch.name}
                                </button>
                            );
                        })}
                        {/* Exchange */}
                        <button
                            type="button"
                            onClick={() => handleExchangeToggle(true)}
                            className={cn(
                                'px-3.5 py-1.5 text-xs font-medium rounded-md border border-border transition-colors flex items-center gap-1.5',
                                isExchange
                                    ? 'bg-amber-500 text-white border-amber-500'
                                    : 'hover:bg-amber-50 hover:border-amber-200',
                            )}
                        >
                            <RefreshCw className="h-3 w-3" />
                            Exchange
                        </button>
                    </div>
                </div>

                {/* ── Source Order (Exchange mode) ── */}
                {isExchange && (
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Source Order
                        </label>
                        {!sourceOrder ? (
                            <div className="space-y-2">
                                <div className="flex gap-2">
                                    <Input
                                        placeholder="Enter order number..."
                                        value={orderNumberSearch}
                                        onChange={(e) => setOrderNumberSearch(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleOrderLookup(); } }}
                                        className="h-9 flex-1"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleOrderLookup}
                                        disabled={isSearchingOrder || !orderNumberSearch.trim()}
                                        className="h-9 px-3"
                                    >
                                        {isSearchingOrder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                                    </Button>
                                </div>
                                {orderSearchError && <p className="text-xs text-destructive">{orderSearchError}</p>}
                                <p className="text-xs text-muted-foreground">Look up order to auto-fill customer details</p>
                            </div>
                        ) : (
                            <div className="p-3 border rounded-md bg-amber-50/50 border-amber-200/50 space-y-1">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <RefreshCw className="h-3.5 w-3.5 text-amber-600" />
                                        <span className="font-medium text-sm">{sourceOrder.orderNumber}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleClearSourceOrder}
                                        className="text-xs text-muted-foreground hover:text-foreground"
                                    >
                                        Change
                                    </button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {sourceOrder.customerName} · {sourceOrder.orderLines.length} items · ₹{sourceOrder.totalAmount.toLocaleString('en-IN')}
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Rest (disabled until channel selected) ── */}
                <div
                    className={cn(
                        'space-y-5 transition-opacity',
                        !channel && 'opacity-40 pointer-events-none',
                    )}
                >
                    {/* ── Customer Info ── */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                Name *
                            </label>
                            <Input
                                placeholder="Customer name"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                className="h-9"
                                required
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                Phone
                            </label>
                            <Input
                                placeholder="Phone"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                className="h-9"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                Email
                            </label>
                            <Input
                                type="email"
                                placeholder="Email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="h-9"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                City
                            </label>
                            <Input
                                placeholder="City"
                                value={city}
                                onChange={(e) => setCity(e.target.value)}
                                className="h-9"
                            />
                        </div>
                    </div>

                    {/* ── SKU Lines ── */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-medium text-muted-foreground">
                                Items *
                            </label>
                            <button
                                type="button"
                                onClick={addLine}
                                className="text-xs text-primary hover:underline flex items-center gap-1"
                            >
                                <Plus className="h-3 w-3" />
                                Add row
                            </button>
                        </div>

                        <div className="space-y-2">
                            {/* Header */}
                            <div className="grid grid-cols-[1fr_80px_32px] gap-2 px-1">
                                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                    SKU Code
                                </span>
                                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                    Qty
                                </span>
                                <span />
                            </div>

                            {lines.map((line, idx) => (
                                <div key={idx} className="space-y-1">
                                    <div className="grid grid-cols-[1fr_80px_32px] gap-2 items-center">
                                        <div className="relative">
                                            <Input
                                                placeholder="e.g. COH-ABC-M"
                                                value={line.skuCode}
                                                onChange={(e) => updateLine(idx, 'skuCode', e.target.value)}
                                                onBlur={() => handleSkuBlur(idx)}
                                                className={cn(
                                                    'h-9 font-mono text-sm pr-8',
                                                    line.skuId && 'border-emerald-300 bg-emerald-50/50',
                                                )}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setSearchingIdx(searchingIdx === idx ? null : idx)}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                            >
                                                <Search className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                        <Input
                                            type="number"
                                            min={1}
                                            value={line.qty}
                                            onChange={(e) =>
                                                updateLine(idx, 'qty', Math.max(1, Number(e.target.value) || 1))
                                            }
                                            className="h-9 text-center"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeLine(idx)}
                                            disabled={lines.length <= 1}
                                            className={cn(
                                                'h-8 w-8 flex items-center justify-center rounded-md transition-colors',
                                                lines.length <= 1
                                                    ? 'text-muted-foreground/30 cursor-not-allowed'
                                                    : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10',
                                            )}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                    {/* Product details confirmation */}
                                    {line.productName && (
                                        <p className="text-xs text-emerald-700 bg-emerald-50 rounded px-2 py-1 ml-1">
                                            {line.productName}
                                            {line.colorName ? ` · ${line.colorName}` : ''}
                                            {line.size ? ` · ${line.size}` : ''}
                                        </p>
                                    )}
                                    {searchingIdx === idx && (
                                        <ProductSearch
                                            onSelect={(sku) => handleSearchSelect(idx, sku)}
                                            onCancel={() => setSearchingIdx(null)}
                                            maxResultsHeight="14rem"
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ── Order Note ── */}
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Order Note
                        </label>
                        <textarea
                            placeholder="Any notes..."
                            value={orderNote}
                            onChange={(e) => setOrderNote(e.target.value)}
                            className="w-full h-16 px-3 py-2 text-sm border rounded-md bg-transparent resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                        />
                    </div>

                    {/* ── Payment ── */}
                    <div className="flex gap-4">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                Payment
                            </label>
                            <div className="flex rounded-md border overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setPaymentMethod('Prepaid')}
                                    className={cn(
                                        'px-3 py-1.5 text-xs font-medium transition-colors',
                                        paymentMethod === 'Prepaid'
                                            ? 'bg-emerald-500 text-white'
                                            : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                                    )}
                                >
                                    Prepaid
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPaymentMethod('COD')}
                                    className={cn(
                                        'px-3 py-1.5 text-xs font-medium border-l transition-colors',
                                        paymentMethod === 'COD'
                                            ? 'bg-amber-500 text-white'
                                            : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                                    )}
                                >
                                    COD
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                Status
                            </label>
                            <div className="flex rounded-md border overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setPaymentStatus('pending')}
                                    className={cn(
                                        'px-3 py-1.5 text-xs font-medium transition-colors',
                                        paymentStatus === 'pending'
                                            ? 'bg-amber-500 text-white'
                                            : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                                    )}
                                >
                                    Pending
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPaymentStatus('paid')}
                                    className={cn(
                                        'px-3 py-1.5 text-xs font-medium border-l transition-colors',
                                        paymentStatus === 'paid'
                                            ? 'bg-emerald-500 text-white'
                                            : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                                    )}
                                >
                                    Paid
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Submit ── */}
                <div className="flex gap-3 pt-2">
                    <Button type="button" variant="outline" onClick={goBack} className="flex-1">
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        disabled={!isReady || isBusy}
                        className={cn('flex-1', isExchange && 'bg-amber-500 hover:bg-amber-600')}
                    >
                        {isBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            isExchange ? 'Create Exchange' : 'Create Order'
                        )}
                    </Button>
                </div>
            </form>
        </div>
    );
}
