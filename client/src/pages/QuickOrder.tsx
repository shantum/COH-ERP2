/**
 * QuickOrder page - Dead simple order form
 *
 * All text fields, no search components. Type SKU codes directly.
 * On submit: resolves SKU codes → IDs, creates order in ERP, pushes to Google Sheet.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Plus, Loader2, Zap, Trash2 } from 'lucide-react';
import { getChannels } from '../server/functions/admin';
import { resolveSkuCodes } from '../server/functions/products';
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
    const [customerName, setCustomerName] = useState('');
    const [phone, setPhone] = useState('');
    const [city, setCity] = useState('');
    const [orderNote, setOrderNote] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<'Prepaid' | 'COD'>('Prepaid');
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid'>('pending');
    const [lines, setLines] = useState<SkuLine[]>([{ skuCode: '', qty: 1 }]);
    const [isResolving, setIsResolving] = useState(false);

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

    // Resolve SKU codes server function
    const resolveSkuCodesFn = useServerFn(resolveSkuCodes);

    // Create order mutation
    const { createOrder } = useOrderCrudMutations({
        onCreateSuccess: () => {
            showSuccess('Order created and pushed to sheet');
            navigate({ to: '/orders', search: { view: 'open', page: 1, limit: 250 } });
        },
    });

    const goBack = () => navigate({ to: '/orders', search: { view: 'open', page: 1, limit: 250 } });

    // Line handlers
    const updateLine = (idx: number, field: keyof SkuLine, value: string | number) => {
        setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
    };

    const addLine = () => {
        setLines((prev) => [...prev, { skuCode: '', qty: 1 }]);
    };

    const removeLine = (idx: number) => {
        setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
    };

    // Validation
    const validLines = lines.filter((l) => l.skuCode.trim() && l.qty > 0);
    const isReady = channel && customerName.trim() && validLines.length > 0;
    const isBusy = isResolving || createOrder.isPending;

    // Submit: resolve SKU codes → IDs, then create order
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isReady || isBusy) return;

        setIsResolving(true);

        try {
            // 1. Resolve SKU codes to IDs
            const skuCodes = validLines.map((l) => l.skuCode.trim());
            const resolved = await resolveSkuCodesFn({ data: { skuCodes } });

            // Build a map: skuCode → resolved data
            const codeMap = new Map(resolved.map((r) => [r.skuCode.toLowerCase(), r]));

            // Check for unresolved SKUs
            const missing = skuCodes.filter((code) => !codeMap.has(code.toLowerCase()));
            if (missing.length > 0) {
                showError(`SKU not found: ${missing.join(', ')}`);
                setIsResolving(false);
                return;
            }

            // 2. Build order lines with resolved IDs
            const orderLines = validLines.map((l) => {
                const match = codeMap.get(l.skuCode.trim().toLowerCase())!;
                return {
                    skuId: match.skuId,
                    qty: l.qty,
                    unitPrice: match.mrp ?? 0,
                };
            });

            const totalAmount = orderLines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);

            // 3. Create order
            createOrder.mutate({
                channel,
                customerName: customerName.trim(),
                ...(phone.trim() ? { customerPhone: phone.trim() } : {}),
                ...(city.trim() ? { shippingAddress: JSON.stringify({ city: city.trim() }) } : {}),
                ...(orderNote.trim() ? { internalNotes: orderNote.trim() } : {}),
                paymentMethod,
                paymentStatus,
                totalAmount,
                lines: orderLines,
            });
        } catch (error: unknown) {
            showError(error instanceof Error ? error.message : 'Failed to resolve SKU codes');
        } finally {
            setIsResolving(false);
        }
    };

    const channelsWithoutShopify =
        channels?.filter((ch: any) => ch.name?.toLowerCase() !== 'shopify') || [];

    return (
        <div className="max-w-xl mx-auto pb-8">
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
                    <p className="text-xs text-muted-foreground">
                        Creates in ERP + pushes to Google Sheet
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
                <div
                    className={cn(
                        'space-y-5 transition-opacity',
                        !channel && 'opacity-40 pointer-events-none',
                    )}
                >
                    {/* ── Customer Info ── */}
                    <div className="grid grid-cols-3 gap-3">
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
                                <div
                                    key={idx}
                                    className="grid grid-cols-[1fr_80px_32px] gap-2 items-center"
                                >
                                    <Input
                                        placeholder="e.g. COH-ABC-M"
                                        value={line.skuCode}
                                        onChange={(e) => updateLine(idx, 'skuCode', e.target.value)}
                                        className="h-9 font-mono text-sm"
                                    />
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
                    <Button type="submit" disabled={!isReady || isBusy} className="flex-1">
                        {isBusy ? (
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
