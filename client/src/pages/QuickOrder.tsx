/**
 * QuickOrder page - Simple order form matching COH Google Sheet columns
 *
 * Fields map to "Orders from COH" sheet:
 * A: Order Date (auto), B: Order# (auto), C: Name, D: City,
 * E: Phone, F: Channel, G: SKU, I: Qty, K: Order Note
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import {
    ArrowLeft,
    Plus,
    X,
    Loader2,
    Search,
    Minus,
    Zap,
} from 'lucide-react';
import { getChannels } from '../server/functions/admin';
import { useOrderCrudMutations } from '../hooks/orders/useOrderCrudMutations';
import { ProductSearch, type SKUData } from '../components/common/ProductSearch';
import { CustomerSearch } from '../components/common/CustomerSearch';
import { getOptimizedImageUrl } from '../utils/imageOptimization';
import { showSuccess } from '../utils/toast';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ============================================
// TYPES
// ============================================

interface OrderLine {
    skuId: string;
    qty: number;
    unitPrice: number;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    imageUrl: string;
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
// LINE ITEM ROW
// ============================================

function LineItem({
    line,
    onQtyChange,
    onRemove,
}: {
    line: OrderLine;
    onQtyChange: (qty: number) => void;
    onRemove: () => void;
}) {
    return (
        <div className="group flex items-center gap-3 py-2.5 px-3 rounded-lg border bg-card hover:border-ring/50 transition-colors">
            {/* Thumbnail */}
            <div className="w-10 h-10 rounded-md bg-muted border overflow-hidden shrink-0">
                {line.imageUrl ? (
                    <img
                        src={getOptimizedImageUrl(line.imageUrl, 'sm') || line.imageUrl}
                        alt={line.productName}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs font-bold">
                        {line.productName?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                )}
            </div>

            {/* Product details */}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{line.productName}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs text-muted-foreground">{line.colorName}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-xs font-medium">{line.size}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-xs text-muted-foreground font-mono">{line.skuCode}</span>
                </div>
            </div>

            {/* Qty controls */}
            <div className="flex items-center border rounded-md shrink-0">
                <button
                    type="button"
                    onClick={() => onQtyChange(Math.max(1, line.qty - 1))}
                    className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-l-md"
                >
                    <Minus className="h-3 w-3" />
                </button>
                <input
                    type="number"
                    value={line.qty}
                    onChange={(e) => onQtyChange(Math.max(1, Number(e.target.value) || 1))}
                    className="h-7 w-10 text-center bg-transparent border-x text-sm focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    min={1}
                />
                <button
                    type="button"
                    onClick={() => onQtyChange(line.qty + 1)}
                    className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-r-md"
                >
                    <Plus className="h-3 w-3" />
                </button>
            </div>

            {/* Price */}
            <div className="shrink-0 text-right w-16">
                <span className="text-sm font-medium">
                    ₹{(line.qty * line.unitPrice).toLocaleString('en-IN')}
                </span>
            </div>

            {/* Remove */}
            <button
                type="button"
                onClick={onRemove}
                className="shrink-0 h-6 w-6 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

// ============================================
// MAIN PAGE
// ============================================

export default function QuickOrder() {
    const navigate = useNavigate();

    // Form state
    const [channel, setChannel] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [customerId, setCustomerId] = useState<string | null>(null);
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [city, setCity] = useState('');
    const [orderNote, setOrderNote] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<'Prepaid' | 'COD'>('Prepaid');
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid'>('pending');
    const [lines, setLines] = useState<OrderLine[]>([]);
    const [showProductSearch, setShowProductSearch] = useState(false);
    const [showCustomerSearch, setShowCustomerSearch] = useState(false);

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

    // Create order mutation
    const { createOrder } = useOrderCrudMutations({
        onCreateSuccess: () => {
            showSuccess('Order created and pushed to sheet');
            navigate({ to: '/orders', search: { view: 'open', page: 1, limit: 250 } });
        },
    });

    const goBack = () => navigate({ to: '/orders', search: { view: 'open', page: 1, limit: 250 } });

    // Handlers
    const handleSelectSku = (sku: SKUData, _stock: number) => {
        const newLine: OrderLine = {
            skuId: sku.id,
            qty: 1,
            unitPrice: Number(sku.mrp) || 0,
            skuCode: sku.skuCode || '-',
            productName: sku.variation?.product?.name || 'Unknown',
            colorName: sku.variation?.colorName || '-',
            size: sku.size || '-',
            imageUrl: sku.variation?.imageUrl || sku.variation?.product?.imageUrl || '',
        };
        setLines((prev) => [...prev, newLine]);
        setShowProductSearch(false);
    };

    const handleSelectCustomer = (customer: any) => {
        const firstName = customer.firstName || '';
        const lastName = customer.lastName || '';
        const displayName = firstName || lastName
            ? `${firstName} ${lastName}`.trim()
            : customer.email?.split('@')[0] || '';

        setCustomerId(customer.id);
        setCustomerName(displayName);
        setEmail(customer.email || '');
        setPhone(customer.phone || '');
        setShowCustomerSearch(false);
    };

    const updateLineQty = (idx: number, qty: number) => {
        setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, qty } : l)));
    };

    const removeLine = (idx: number) => {
        setLines((prev) => prev.filter((_, i) => i !== idx));
    };

    const totalAmount = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
    const totalItems = lines.reduce((sum, l) => sum + l.qty, 0);
    const isReady = channel && customerName.trim() && lines.length > 0;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!isReady) return;

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
            lines: lines.map((l) => ({
                skuId: l.skuId,
                qty: l.qty,
                unitPrice: l.unitPrice,
            })),
        });
    };

    const channelsWithoutShopify = channels?.filter(
        (ch: any) => ch.name?.toLowerCase() !== 'shopify'
    ) || [];

    return (
        <div className="max-w-2xl mx-auto pb-8">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <Button variant="ghost" size="sm" onClick={goBack} className="h-8 px-2">
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-lg font-semibold flex items-center gap-2">
                        <Zap className="h-5 w-5" />
                        Quick Order
                    </h1>
                    <p className="text-xs text-muted-foreground">Creates in ERP + pushes to Google Sheet</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
                {/* ── Channel ── */}
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">Channel *</label>
                    <div className="flex flex-wrap gap-1.5">
                        {channelsWithoutShopify.map((ch: any) => {
                            const name = ch.name?.toLowerCase() || '';
                            const isSelected = channel === ch.id;
                            const colors = CHANNEL_COLORS[name] || DEFAULT_CHANNEL_COLOR;

                            return (
                                <button
                                    key={ch.id}
                                    type="button"
                                    onClick={() => setChannel(ch.id)}
                                    className={cn(
                                        'px-3.5 py-1.5 text-xs font-medium rounded-md border border-border transition-colors',
                                        isSelected ? colors.active : colors.inactive,
                                    )}
                                >
                                    {ch.name}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* ── Rest (disabled until channel selected) ── */}
                <div className={cn('space-y-5 transition-opacity', !channel && 'opacity-40 pointer-events-none')}>
                    {/* ── Customer ── */}
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Customer *</label>
                        <div className="relative">
                            <Input
                                placeholder="Customer name..."
                                value={customerName}
                                onChange={(e) => {
                                    setCustomerName(e.target.value);
                                    setCustomerId(null);
                                }}
                                className="h-9 pr-9"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowCustomerSearch(!showCustomerSearch)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                <Search className="h-3.5 w-3.5" />
                            </button>
                            {showCustomerSearch && (
                                <CustomerSearch
                                    onSelect={handleSelectCustomer}
                                    onCancel={() => setShowCustomerSearch(false)}
                                    initialQuery={customerName}
                                    showTags
                                />
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Phone</label>
                            <Input
                                placeholder="Phone..."
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                className="h-9"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email</label>
                            <Input
                                type="email"
                                placeholder="Email..."
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="h-9"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">City</label>
                            <Input
                                placeholder="City..."
                                value={city}
                                onChange={(e) => setCity(e.target.value)}
                                className="h-9"
                            />
                        </div>
                    </div>

                    {/* ── Items ── */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-medium text-muted-foreground">Items *</label>
                            {lines.length > 0 && !showProductSearch && (
                                <button
                                    type="button"
                                    onClick={() => setShowProductSearch(true)}
                                    className="text-xs text-primary hover:underline flex items-center gap-1"
                                >
                                    <Plus className="h-3 w-3" />
                                    Add item
                                </button>
                            )}
                        </div>

                        {/* Line items */}
                        {lines.length > 0 && (
                            <div className="space-y-1.5 mb-3">
                                {lines.map((line, idx) => (
                                    <LineItem
                                        key={`${line.skuId}-${idx}`}
                                        line={line}
                                        onQtyChange={(qty) => updateLineQty(idx, qty)}
                                        onRemove={() => removeLine(idx)}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Product search */}
                        {showProductSearch ? (
                            <ProductSearch
                                onSelect={handleSelectSku}
                                onCancel={() => setShowProductSearch(false)}
                            />
                        ) : lines.length === 0 ? (
                            <button
                                type="button"
                                onClick={() => setShowProductSearch(true)}
                                className="w-full py-6 border-2 border-dashed rounded-lg text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                            >
                                <Search className="h-4 w-4 inline mr-2" />
                                Search products to add...
                            </button>
                        ) : null}
                    </div>

                    {/* ── Order Note ── */}
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Order Note</label>
                        <textarea
                            placeholder="Any notes for this order..."
                            value={orderNote}
                            onChange={(e) => setOrderNote(e.target.value)}
                            className="w-full h-16 px-3 py-2 text-sm border rounded-md bg-transparent resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                        />
                    </div>

                    {/* ── Payment ── */}
                    <div className="flex gap-4">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Payment</label>
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
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Status</label>
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

                {/* ── Footer ── */}
                {lines.length > 0 && (
                    <div className="pt-4 border-t">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-sm text-muted-foreground">
                                {totalItems} item{totalItems !== 1 ? 's' : ''}
                            </span>
                            <span className="text-lg font-semibold">
                                ₹{totalAmount.toLocaleString('en-IN')}
                            </span>
                        </div>
                    </div>
                )}

                <div className="flex gap-3">
                    <Button type="button" variant="outline" onClick={goBack} className="flex-1">
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        disabled={!isReady || createOrder.isPending}
                        className="flex-1"
                    >
                        {createOrder.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            'Create Order'
                        )}
                    </Button>
                </div>
            </form>
        </div>
    );
}
