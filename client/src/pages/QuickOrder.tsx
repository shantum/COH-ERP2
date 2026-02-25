/**
 * QuickOrder page - Simple order form with optional SKU search
 *
 * Type SKU codes directly OR click the search icon to find products.
 * On submit: resolves any unresolved SKU codes → IDs, creates order in ERP, pushes to Google Sheet.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Plus, Loader2, Zap, Trash2, Search, RefreshCw, AlertCircle, CheckCircle2, Package } from 'lucide-react';
import { computeOrderGst } from '@coh/shared';
import { getChannels } from '../server/functions/admin';
import { getCustomerAddresses, searchCustomers, type CustomerSearchItem } from '../server/functions/customers';
import { resolveSkuCodes } from '../server/functions/products';
import { getOrderForExchange, searchOrdersForExchange, type OrderForExchange, type OrderSearchHit } from '../server/functions/orders';
import { ProductSearch, type SKUData } from '../components/common/ProductSearch';
import { useOrderCrudMutations } from '../hooks/orders/useOrderCrudMutations';
import { getOptimizedImageUrl } from '../utils/imageOptimization';
import { showSuccess, showError } from '../utils/toast';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
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
    imageUrl?: string;
}

interface DraftOrderLine {
    skuId: string;
    qty: number;
    unitPrice: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function applyDiscountAcrossAmounts(amounts: number[], discount: number): { discounted: number[]; appliedDiscount: number } {
    const safeAmounts = amounts.map((amount) => Math.max(0, round2(amount)));
    const gross = round2(safeAmounts.reduce((sum, amount) => sum + amount, 0));
    const cappedDiscount = round2(Math.min(Math.max(0, discount), gross));

    if (gross <= 0 || cappedDiscount <= 0) {
        return { discounted: safeAmounts, appliedDiscount: 0 };
    }

    let allocatedDiscount = 0;
    const lastIdx = safeAmounts.length - 1;

    const discounted = safeAmounts.map((amount, idx) => {
        const lineDiscount = idx === lastIdx
            ? round2(cappedDiscount - allocatedDiscount)
            : round2((amount / gross) * cappedDiscount);
        allocatedDiscount = round2(allocatedDiscount + lineDiscount);
        return round2(Math.max(0, amount - lineDiscount));
    });

    const finalDiscountApplied = round2(gross - discounted.reduce((sum, amount) => sum + amount, 0));
    return { discounted, appliedDiscount: finalDiscountApplied };
}

function applyDiscountToOrderLines(lines: DraftOrderLine[], discount: number): {
    lines: DraftOrderLine[];
    gross: number;
    appliedDiscount: number;
    netTotal: number;
} {
    const lineGrossAmounts = lines.map((line) => round2(line.qty * line.unitPrice));
    const { discounted, appliedDiscount } = applyDiscountAcrossAmounts(lineGrossAmounts, discount);
    const discountedLines = lines.map((line, idx) => ({
        ...line,
        unitPrice: line.qty > 0 ? discounted[idx] / line.qty : 0,
    }));
    const netTotal = round2(discounted.reduce((sum, amount) => sum + amount, 0));
    const gross = round2(lineGrossAmounts.reduce((sum, amount) => sum + amount, 0));

    return {
        lines: discountedLines,
        gross,
        appliedDiscount,
        netTotal,
    };
}

const INDIA_STATES = [
    'Andhra Pradesh',
    'Arunachal Pradesh',
    'Assam',
    'Bihar',
    'Chhattisgarh',
    'Goa',
    'Gujarat',
    'Haryana',
    'Himachal Pradesh',
    'Jharkhand',
    'Karnataka',
    'Kerala',
    'Madhya Pradesh',
    'Maharashtra',
    'Manipur',
    'Meghalaya',
    'Mizoram',
    'Nagaland',
    'Odisha',
    'Punjab',
    'Rajasthan',
    'Sikkim',
    'Tamil Nadu',
    'Telangana',
    'Tripura',
    'Uttar Pradesh',
    'Uttarakhand',
    'West Bengal',
    'Andaman and Nicobar Islands',
    'Chandigarh',
    'Dadra and Nagar Haveli and Daman and Diu',
    'Delhi',
    'Jammu and Kashmir',
    'Ladakh',
    'Lakshadweep',
    'Puducherry',
] as const;

const normalizePhone = (value: string) => value.replace(/\D/g, '');
const normalizeStateName = (value: string) => {
    const state = value.trim();
    if (!state) return '';
    const matched = INDIA_STATES.find((candidate) => candidate.toLowerCase() === state.toLowerCase());
    return matched || state;
};

const getCustomerDisplayName = (customer: CustomerSearchItem): string => {
    const first = customer.firstName || '';
    const last = customer.lastName || '';
    if (first || last) return `${first} ${last}`.trim();
    return customer.email?.split('@')[0] || customer.phone || 'Existing customer';
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
    const [stateName, setStateName] = useState('');
    const [manualDiscount, setManualDiscount] = useState(0);
    const [manualDiscountType, setManualDiscountType] = useState<'amount' | 'percent'>('amount');
    const [orderNote, setOrderNote] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<'Prepaid' | 'COD'>('Prepaid');
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid'>('pending');
    const [lines, setLines] = useState<SkuLine[]>([{ skuCode: '', qty: 1 }]);
    const [isResolving, setIsResolving] = useState(false);
    const [searchingIdx, setSearchingIdx] = useState<number | null>(null);
    const [resolvingSkuIdx, setResolvingSkuIdx] = useState<number | null>(null);

    // Exchange state
    const [isExchange, setIsExchange] = useState(false);
    const [sourceOrder, setSourceOrder] = useState<OrderForExchange | null>(null);
    const [orderNumberSearch, setOrderNumberSearch] = useState('');
    const [isSearchingOrder, setIsSearchingOrder] = useState(false);
    const [orderSearchError, setOrderSearchError] = useState('');
    const [orderSearchResults, setOrderSearchResults] = useState<OrderSearchHit[]>([]);
    const [showOrderDropdown, setShowOrderDropdown] = useState(false);
    const orderSearchRef = useRef<HTMLDivElement>(null);
    const orderSearchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const [isPhoneFieldFocused, setIsPhoneFieldFocused] = useState(false);
    const [phoneAutoMatchedKey, setPhoneAutoMatchedKey] = useState('');

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
    const searchOrdersForExchangeFn = useServerFn(searchOrdersForExchange);
    const searchCustomersFn = useServerFn(searchCustomers);
    const getCustomerAddressesFn = useServerFn(getCustomerAddresses);

    // Create order mutation
    const { createOrder } = useOrderCrudMutations({
        onCreateSuccess: () => {
            showSuccess('Order created and pushed to sheet');
            navigate({ to: '/orders', search: { view: 'all', page: 1, limit: 250 } });
        },
    });

    const goBack = () => navigate({ to: '/orders', search: { view: 'all', page: 1, limit: 250 } });

    const channelsWithoutShopify =
        channels?.filter((ch: { id: string; name: string }) => ch.name?.toLowerCase() !== 'shopify') || [];
    const offlineChannel = useMemo(
        () => channelsWithoutShopify.find((ch: { id: string; name: string }) => ch.name?.trim().toLowerCase() === 'offline')
            || channelsWithoutShopify[0]
            || null,
        [channelsWithoutShopify],
    );

    useEffect(() => {
        if (offlineChannel?.id && channel !== offlineChannel.id) {
            setChannel(offlineChannel.id);
        }
    }, [offlineChannel?.id, channel]);

    const phoneDigits = normalizePhone(phone);
    const phoneLast10 = phoneDigits.slice(-10);
    const { data: phoneCustomerCandidates = [], isFetching: isSearchingPhoneCustomers } = useQuery({
        queryKey: ['quick-order-phone-customers', phoneDigits],
        queryFn: () => searchCustomersFn({ data: { search: phoneDigits, limit: 12 } }),
        enabled: phoneDigits.length >= 6,
        staleTime: 30000,
    });

    const phoneMatches = useMemo(() => {
        if (!phoneDigits) return [];

        const score = (customer: CustomerSearchItem) => {
            const d = normalizePhone(customer.phone || '');
            const last10 = d.slice(-10);
            if (d === phoneDigits) return 4;
            if (phoneLast10.length >= 10 && last10 === phoneLast10) return 3;
            if (d.startsWith(phoneDigits)) return 2;
            if (d.includes(phoneDigits) || phoneDigits.includes(d)) return 1;
            return 0;
        };

        return phoneCustomerCandidates
            .filter((customer) => score(customer) > 0)
            .sort((a, b) => score(b) - score(a));
    }, [phoneCustomerCandidates, phoneDigits, phoneLast10]);

    const exactPhoneMatch = useMemo(() => (
        phoneMatches.find((customer) => {
            const d = normalizePhone(customer.phone || '');
            return d === phoneDigits || (phoneLast10.length >= 10 && d.slice(-10) === phoneLast10);
        }) || null
    ), [phoneMatches, phoneDigits, phoneLast10]);

    const phoneLookupMessage = useMemo(() => {
        if (!phoneDigits) {
            return { tone: 'muted' as const, text: 'Phone is the primary lookup key for existing customers.' };
        }
        if (phoneDigits.length < 6) {
            return { tone: 'muted' as const, text: `Enter ${6 - phoneDigits.length} more digit${6 - phoneDigits.length === 1 ? '' : 's'} to search existing customers.` };
        }
        if (isSearchingPhoneCustomers) {
            return { tone: 'muted' as const, text: 'Searching existing customers...' };
        }
        if (customerId && (exactPhoneMatch?.id === customerId || sourceOrder)) {
            return { tone: 'success' as const, text: 'Existing customer matched and auto-filled.' };
        }
        if (exactPhoneMatch) {
            return { tone: 'success' as const, text: 'Exact phone match found. Select it to auto-fill details.' };
        }
        if (phoneMatches.length > 0) {
            return { tone: 'info' as const, text: `${phoneMatches.length} possible existing customer match${phoneMatches.length === 1 ? '' : 'es'} found.` };
        }
        return { tone: 'warning' as const, text: 'No existing customer found. Continue as a new customer.' };
    }, [phoneDigits, isSearchingPhoneCustomers, customerId, exactPhoneMatch, phoneMatches.length]);

    const applyCustomerAddress = async (nextCustomerId: string) => {
        try {
            const addresses = await getCustomerAddressesFn({ data: { customerId: nextCustomerId } });
            const latestAddress = addresses[0];
            if (!latestAddress) return;

            const detectedCity = latestAddress.city?.trim() || '';
            if (detectedCity) {
                setCity(detectedCity);
            }
            const detectedState = latestAddress.province?.trim() || '';
            if (detectedState) {
                setStateName(normalizeStateName(detectedState));
            }
        } catch {
            // Address hydration failure should never block quick order flow.
        }
    };

    const handlePhoneMatchSelect = (customer: CustomerSearchItem) => {
        setCustomerId(customer.id);
        setCustomerName(getCustomerDisplayName(customer));
        setEmail(customer.email || '');
        setPhone(customer.phone || phone);
        setPhoneAutoMatchedKey(normalizePhone(customer.phone || phone));
        setIsPhoneFieldFocused(false);
        void applyCustomerAddress(customer.id);
    };

    useEffect(() => {
        if (phoneDigits.length < 10) {
            setPhoneAutoMatchedKey('');
            return;
        }
        if (phoneAutoMatchedKey === phoneDigits) return;

        if (exactPhoneMatch) {
            handlePhoneMatchSelect(exactPhoneMatch);
        }
    }, [phoneDigits, exactPhoneMatch, phoneAutoMatchedKey]);

    // Exchange handlers
    const handleExchangeToggle = (on: boolean) => {
        setIsExchange(on);
        if (!on) {
            setSourceOrder(null);
            setOrderNumberSearch('');
            setOrderSearchError('');
            setOrderSearchResults([]);
            setShowOrderDropdown(false);
            setPhoneAutoMatchedKey('');
        }
    };

    const orderSearchSeqRef = useRef(0);

    const handleOrderSearchChange = (value: string) => {
        setOrderNumberSearch(value);
        setOrderSearchError('');

        if (orderSearchDebounceRef.current) clearTimeout(orderSearchDebounceRef.current);

        if (value.trim().length < 2) {
            setOrderSearchResults([]);
            setShowOrderDropdown(false);
            setIsSearchingOrder(false);
            orderSearchSeqRef.current++;
            return;
        }

        setIsSearchingOrder(true);
        orderSearchDebounceRef.current = setTimeout(async () => {
            const seq = ++orderSearchSeqRef.current;
            const q = value.trim();
            try {
                const result = await searchOrdersForExchangeFn({ data: { query: q } });
                // Only apply if no newer search has started
                if (orderSearchSeqRef.current !== seq) return;
                if (result.success && result.data) {
                    setOrderSearchResults(result.data);
                    setShowOrderDropdown(result.data.length > 0);
                }
            } catch {
                // Silently fail for live search
            } finally {
                if (orderSearchSeqRef.current === seq) {
                    setIsSearchingOrder(false);
                }
            }
        }, 300);
    };

    const handleOrderSearchSelect = async (hit: OrderSearchHit) => {
        setShowOrderDropdown(false);
        setOrderNumberSearch(hit.orderNumber);
        setIsSearchingOrder(true);
        setOrderSearchError('');

        try {
            const result = await getOrderForExchangeFn({ data: { orderNumber: hit.orderNumber } });
            if (result.success && result.data) {
                setSourceOrder(result.data);
                setCustomerName(result.data.customerName);
                setCustomerId(result.data.customerId);
                setPhone(result.data.customerPhone || '');
                setPhoneAutoMatchedKey(normalizePhone(result.data.customerPhone || ''));
                setEmail(result.data.customerEmail || '');
                if (result.data.shippingAddress) {
                    try {
                        const addr = JSON.parse(result.data.shippingAddress);
                        setCity(addr.city || '');
                        setStateName(normalizeStateName(addr.state || ''));
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

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (orderSearchRef.current && !orderSearchRef.current.contains(e.target as Node)) {
                setShowOrderDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleClearSourceOrder = () => {
        setSourceOrder(null);
        setOrderNumberSearch('');
        setOrderSearchError('');
        setOrderSearchResults([]);
        setShowOrderDropdown(false);
        setCustomerName('');
        setCustomerId(null);
        setPhone('');
        setPhoneAutoMatchedKey('');
        setEmail('');
        setCity('');
        setStateName('');
    };

    // Line handlers
    const updateLine = (idx: number, field: keyof SkuLine, value: string | number) => {
        setLines((prev) => prev.map((l, i) => {
            if (i !== idx) return l;
            // If user manually edits the SKU code, clear all resolved details
            if (field === 'skuCode') {
                return { ...l, skuCode: value as string, skuId: undefined, mrp: undefined, productName: undefined, colorName: undefined, size: undefined, imageUrl: undefined };
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
                    imageUrl: sku.variation?.imageUrl || sku.variation?.product?.imageUrl || undefined,
                }
                : l,
        ));
        setSearchingIdx(null);
    };

    // Resolve a single SKU code on blur (so user sees product details before submitting)
    const handleSkuBlur = async (idx: number, openSearchOnMiss = false) => {
        const line = lines[idx];
        // Skip if already resolved or empty
        if (!line || line.skuId || !line.skuCode.trim()) return;

        setResolvingSkuIdx(idx);

        try {
            const resolved = await resolveSkuCodesFn({ data: { skuCodes: [line.skuCode.trim()] } });
            if (resolved.length > 0) {
                const r = resolved[0];
                setLines((prev) => prev.map((l, i) =>
                    i === idx && l.skuCode === line.skuCode // Only update if code hasn't changed
                        ? { ...l, skuId: r.skuId, mrp: r.mrp ?? 0, productName: r.productName, colorName: r.colorName, size: r.size }
                        : l,
                ));
            } else if (openSearchOnMiss) {
                setSearchingIdx(idx);
            }
        } catch {
            // Silently fail — will show error on submit
            if (openSearchOnMiss) {
                setSearchingIdx(idx);
            }
        } finally {
            setResolvingSkuIdx((current) => (current === idx ? null : current));
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
    const isReady = Boolean(channel && phoneDigits.length >= 10 && customerName.trim() && validLines.length > 0);
    const isBusy = isResolving || createOrder.isPending;
    const grossBeforeDiscount = validLines.reduce((sum, line) => sum + line.qty * (line.mrp ?? 0), 0);
    const discountInputValue = round2(Math.max(0, manualDiscount || 0));
    const discountAppliedToPreview = round2(
        manualDiscountType === 'percent'
            ? Math.min(Math.max(0, grossBeforeDiscount * (discountInputValue / 100)), grossBeforeDiscount)
            : Math.min(discountInputValue, grossBeforeDiscount),
    );
    const grossAfterDiscount = round2(Math.max(0, grossBeforeDiscount - discountAppliedToPreview));
    const resolvedLines = validLines.filter((line) => Boolean(line.skuId)).length;
    const unresolvedLines = validLines.length - resolvedLines;
    const formatMoney = (amount: number) =>
        `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const gstPreview = useMemo(() => {
        const pricedBaseAmounts = validLines
            .filter((line) => (line.mrp ?? 0) > 0)
            .map((line) => ({
                amount: round2(line.qty * (line.mrp ?? 0)),
                mrp: line.mrp ?? 0,
                qty: line.qty,
            }));

        if (pricedBaseAmounts.length === 0) return null;

        const { discounted } = applyDiscountAcrossAmounts(
            pricedBaseAmounts.map((line) => line.amount),
            discountAppliedToPreview,
        );
        const pricedLines = pricedBaseAmounts.map((line, idx) => ({
            ...line,
            amount: discounted[idx],
        }));

        return computeOrderGst(pricedLines, stateName.trim() || null);
    }, [validLines, stateName, discountAppliedToPreview]);

    const gstByRate = useMemo(() => {
        if (!gstPreview) return [];
        const map = new Map<number, { taxable: number; gst: number; gross: number }>();

        gstPreview.lines.forEach((line) => {
            const current = map.get(line.gstRate) || { taxable: 0, gst: 0, gross: 0 };
            map.set(line.gstRate, {
                taxable: current.taxable + line.taxableValue,
                gst: current.gst + line.gstAmount,
                gross: current.gross + line.amount,
            });
        });

        return Array.from(map.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([rate, values]) => ({ rate, ...values }));
    }, [gstPreview]);

    const pricedLinesCount = validLines.filter((line) => (line.mrp ?? 0) > 0).length;
    const unpricedLines = validLines.length - pricedLinesCount;
    const stateSelectValue = INDIA_STATES.includes(stateName as (typeof INDIA_STATES)[number]) ? stateName : '__none__';
    const payableAmount = gstPreview?.total ?? grossAfterDiscount;
    const hasValidPayable = isExchange || payableAmount > 0;
    const canSubmit = isReady && hasValidPayable;
    const taxModeLabel = gstPreview ? (gstPreview.gstType === 'cgst_sgst' ? 'CGST/SGST' : 'IGST') : '--';
    const payoutLabel = paymentMethod === 'COD'
        ? 'Cash To Collect'
        : paymentStatus === 'paid'
            ? 'Amount Received'
            : 'Amount Pending';

    // Order number preview (format: COH-MMYYXXXX or EXC-MMYYXXXX)
    const previewOrderNumber = (() => {
        const prefix = isExchange ? 'EXC' : 'COH';
        const now = new Date();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yy = String(now.getFullYear()).slice(-2);
        return `${prefix}-${mm}${yy}____`;
    })();

    // Submit: resolve SKU codes → IDs, then create order
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit || isBusy) return;

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
            const baseOrderLines: DraftOrderLine[] = validLines.map((l) => {
                if (l.skuId) {
                    return { skuId: l.skuId, qty: l.qty, unitPrice: l.mrp ?? 0 };
                }
                const match = codeMap.get(l.skuCode.trim().toLowerCase())!;
                return { skuId: match.skuId, qty: l.qty, unitPrice: match.mrp ?? 0 };
            });

            const discountedOrder = applyDiscountToOrderLines(baseOrderLines, discountAppliedToPreview);
            const orderLines = discountedOrder.lines;
            const totalAmount = discountedOrder.netTotal;

            if (!isExchange && totalAmount <= 0) {
                showError('Total amount must be greater than zero for non-exchange orders');
                setIsResolving(false);
                return;
            }

            const discountNote = discountedOrder.appliedDiscount > 0
                ? `Manual discount applied (${manualDiscountType === 'percent' ? `${discountInputValue}%` : 'fixed'}): -${formatMoney(discountedOrder.appliedDiscount)}`
                : '';
            const combinedInternalNotes = [orderNote.trim(), discountNote].filter(Boolean).join('\n');

            // 3. Create order
            createOrder.mutate({
                channel,
                customerName: customerName.trim(),
                ...(customerId ? { customerId } : {}),
                ...(email.trim() ? { customerEmail: email.trim() } : {}),
                ...(phone.trim() ? { customerPhone: phone.trim() } : {}),
                ...((city.trim() || stateName.trim())
                    ? { shippingAddress: JSON.stringify({ city: city.trim(), state: stateName.trim() }) }
                    : {}),
                ...(combinedInternalNotes ? { internalNotes: combinedInternalNotes } : {}),
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
        <div className="mx-auto max-w-6xl pb-10">
            <div className="mb-6 rounded-2xl border border-border/70 bg-gradient-to-r from-background via-background to-muted/40 p-4 sm:p-5">
                <div className="flex flex-wrap items-start gap-3 sm:items-center">
                    <Button variant="ghost" size="sm" onClick={goBack} className="h-8 px-2">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div className="min-w-0 flex-1">
                        <h1 className="flex items-center gap-2 text-xl font-semibold">
                            <Zap className="h-5 w-5 text-primary" />
                            Quick Order POS
                        </h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Fast billing flow with SKU entry, tax split, and instant order push.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="info">POS</Badge>
                        <Badge variant={isExchange ? 'warning' : 'secondary'}>
                            {isExchange ? 'Exchange Mode' : 'Fresh Order'}
                        </Badge>
                        <Badge variant="outline" className="font-mono">
                            {previewOrderNumber}
                        </Badge>
                    </div>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-5">
                    <Card className="border-border/70 shadow-sm">
                        <CardHeader className="pb-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                    <CardTitle className="text-base">Order Mode</CardTitle>
                                    <CardDescription>Toggle exchange mode when linking to an existing order.</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between rounded-lg border border-amber-200/60 bg-amber-50/40 p-3">
                                <div>
                                    <p className="text-sm font-medium text-amber-900">Exchange Order</p>
                                    <p className="text-xs text-amber-700/90">
                                        Link to an existing order and auto-fill customer details.
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    {isExchange && <Badge variant="warning">Enabled</Badge>}
                                    <Switch checked={isExchange} onCheckedChange={handleExchangeToggle} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {isExchange && (
                        <Card className="border-amber-200/70 bg-amber-50/20 shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Source Order</CardTitle>
                                <CardDescription>Find an existing order to create an exchange.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {!sourceOrder ? (
                                    <>
                                        <div className="relative" ref={orderSearchRef}>
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                                <Input
                                                    placeholder="Search by order number, customer name, or phone..."
                                                    value={orderNumberSearch}
                                                    onChange={(e) => handleOrderSearchChange(e.target.value)}
                                                    onFocus={() => { if (orderSearchResults.length > 0) setShowOrderDropdown(true); }}
                                                    className="h-10 pl-9 pr-9"
                                                    autoComplete="off"
                                                />
                                                {isSearchingOrder && (
                                                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                                                )}
                                            </div>
                                            {showOrderDropdown && orderSearchResults.length > 0 && (
                                                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg">
                                                    <ul className="max-h-64 overflow-auto py-1">
                                                        {orderSearchResults.map((hit) => (
                                                            <li key={hit.id}>
                                                                <button
                                                                    type="button"
                                                                    className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors"
                                                                    onClick={() => handleOrderSearchSelect(hit)}
                                                                >
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="font-medium text-sm">{hit.orderNumber}</span>
                                                                            <span className="text-xs text-muted-foreground">· {hit.itemCount} items · ₹{hit.totalAmount.toLocaleString('en-IN')}</span>
                                                                        </div>
                                                                        <p className="text-xs text-muted-foreground mt-0.5">
                                                                            {hit.customerName}
                                                                            {hit.customerPhone ? ` · ${hit.customerPhone}` : ''}
                                                                            {' · '}
                                                                            {new Date(hit.orderDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                                        </p>
                                                                    </div>
                                                                </button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                        {orderSearchError && <p className="text-xs text-destructive">{orderSearchError}</p>}
                                    </>
                                ) : (
                                    <div className="space-y-2 rounded-lg border border-amber-300/70 bg-background p-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <RefreshCw className="h-3.5 w-3.5 text-amber-600" />
                                                <span className="font-medium text-sm">{sourceOrder.orderNumber}</span>
                                            </div>
                                            <Button type="button" variant="ghost" size="sm" onClick={handleClearSourceOrder} className="h-7 px-2 text-xs">
                                                Change
                                            </Button>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {sourceOrder.customerName} · {sourceOrder.orderLines.length} items · ₹{sourceOrder.totalAmount.toLocaleString('en-IN')}
                                        </p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    <Card className="border-border/70 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Customer Details</CardTitle>
                            <CardDescription>Required fields are marked with an asterisk.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-3 sm:grid-cols-2">
                            <div className="relative space-y-1.5 sm:col-span-2">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="quick-order-phone">Phone Number *</Label>
                                    {isSearchingPhoneCustomers && phoneDigits.length >= 6 && (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                    )}
                                </div>
                                <Input
                                    id="quick-order-phone"
                                    placeholder="Enter phone to auto-match existing customer"
                                    value={phone}
                                    onFocus={() => setIsPhoneFieldFocused(true)}
                                    onBlur={() => setTimeout(() => setIsPhoneFieldFocused(false), 120)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && isPhoneFieldFocused && phoneDigits.length >= 6) {
                                            const bestMatch = exactPhoneMatch || phoneMatches[0];
                                            if (bestMatch) {
                                                e.preventDefault();
                                                handlePhoneMatchSelect(bestMatch);
                                            }
                                        }
                                    }}
                                    onChange={(e) => {
                                        const next = e.target.value;
                                        setPhone(next);
                                        setPhoneAutoMatchedKey('');

                                        if (customerId && normalizePhone(next) !== normalizePhone(phone)) {
                                            setCustomerId(null);
                                        }
                                    }}
                                    className="h-10"
                                    required
                                />
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p
                                        className={cn(
                                            'text-xs',
                                            phoneLookupMessage.tone === 'success' && 'text-emerald-700',
                                            phoneLookupMessage.tone === 'warning' && 'text-amber-700',
                                            phoneLookupMessage.tone === 'info' && 'text-sky-700',
                                            phoneLookupMessage.tone === 'muted' && 'text-muted-foreground',
                                        )}
                                    >
                                        {phoneLookupMessage.text}
                                    </p>
                                    {phoneDigits.length >= 6 && phoneMatches.length > 0 && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-2 text-[11px]"
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => {
                                                const bestMatch = exactPhoneMatch || phoneMatches[0];
                                                if (bestMatch) handlePhoneMatchSelect(bestMatch);
                                            }}
                                        >
                                            Auto-fill best match
                                        </Button>
                                    )}
                                </div>

                                {isPhoneFieldFocused && phoneDigits.length >= 6 && (
                                    <div className="absolute left-0 right-0 z-40 overflow-hidden rounded-md border border-border bg-popover shadow-md">
                                        <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                                            <span>Existing customers</span>
                                            <span>{phoneMatches.length} match{phoneMatches.length === 1 ? '' : 'es'}</span>
                                        </div>
                                        {isSearchingPhoneCustomers && (
                                            <div className="flex items-center gap-2 border-b border-border/60 bg-sky-50/60 px-3 py-2 text-xs text-sky-700">
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                <span>Searching customers...</span>
                                            </div>
                                        )}
                                        <div className="max-h-48 overflow-y-auto">
                                            {isSearchingPhoneCustomers && phoneMatches.length === 0 ? (
                                                <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    <span>Looking up existing customers...</span>
                                                </div>
                                            ) : phoneMatches.length > 0 ? (
                                                phoneMatches.slice(0, 6).map((customer) => {
                                                    const matchedPhone = normalizePhone(customer.phone || '');
                                                    const isExact = matchedPhone === phoneDigits || (phoneLast10.length >= 10 && matchedPhone.slice(-10) === phoneLast10);
                                                    return (
                                                        <button
                                                            key={customer.id}
                                                            type="button"
                                                            className="flex w-full items-start justify-between border-b border-border/60 px-3 py-2 text-left last:border-b-0 hover:bg-accent"
                                                            onMouseDown={(e) => e.preventDefault()}
                                                            onClick={() => handlePhoneMatchSelect(customer)}
                                                        >
                                                            <div>
                                                                <p className="text-sm font-medium">{getCustomerDisplayName(customer)}</p>
                                                                <p className="text-xs text-muted-foreground">
                                                                    {[customer.phone, customer.email].filter(Boolean).join(' · ')}
                                                                </p>
                                                            </div>
                                                            <Badge variant={isExact ? 'success' : 'outline'} className="text-[10px]">
                                                                {isExact ? 'Exact' : 'Use'}
                                                            </Badge>
                                                        </button>
                                                    );
                                                })
                                            ) : (
                                                <p className="px-3 py-2 text-xs text-muted-foreground">
                                                    No existing customer found for this phone.
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            className="w-full border-t border-border/60 px-3 py-2 text-left text-xs font-medium text-sky-700 transition-colors hover:bg-sky-50"
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => {
                                                setCustomerId(null);
                                                setIsPhoneFieldFocused(false);
                                            }}
                                        >
                                            Continue as new customer with this phone
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-1.5 sm:col-span-2">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="quick-order-name">Customer Name *</Label>
                                    {customerId && <Badge variant="success" className="text-[10px]">Existing customer matched</Badge>}
                                </div>
                                <Input
                                    id="quick-order-name"
                                    placeholder="Customer name"
                                    value={customerName}
                                    onChange={(e) => setCustomerName(e.target.value)}
                                    className="h-10"
                                    required
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="quick-order-email">Email</Label>
                                <Input
                                    id="quick-order-email"
                                    type="email"
                                    placeholder="Email address"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="h-10"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="quick-order-city">City</Label>
                                <Input
                                    id="quick-order-city"
                                    placeholder="Shipping city"
                                    value={city}
                                    onChange={(e) => setCity(e.target.value)}
                                    className="h-10"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="quick-order-state">State (for GST split)</Label>
                                <Select
                                    value={stateSelectValue}
                                    onValueChange={(value) => setStateName(value === '__none__' ? '' : value)}
                                >
                                    <SelectTrigger id="quick-order-state" className="h-10">
                                        <SelectValue placeholder="Select state" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">Not set</SelectItem>
                                        {INDIA_STATES.map((state) => (
                                            <SelectItem key={state} value={state}>
                                                {state}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-border/70 shadow-sm">
                        <CardHeader className="pb-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                    <CardTitle className="text-base">Items</CardTitle>
                                    <CardDescription>Add SKU codes directly or use search.</CardDescription>
                                </div>
                                <Button type="button" variant="outline" size="sm" onClick={addLine} className="h-8">
                                    <Plus className="mr-1 h-3.5 w-3.5" />
                                    Add row
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {lines.map((line, idx) => (
                                <div key={idx} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="text-[11px]">
                                                Line {idx + 1}
                                            </Badge>
                                            {line.skuId ? (
                                                <Badge variant="success" className="text-[11px]">Resolved</Badge>
                                            ) : line.skuCode.trim() ? (
                                                <Badge variant="warning" className="text-[11px]">Pending resolve</Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-[11px]">Pending SKU</Badge>
                                            )}
                                        </div>
                                        <Button
                                            type="button"
                                            variant={searchingIdx === idx ? 'secondary' : 'outline'}
                                            size="sm"
                                            onClick={() => setSearchingIdx(searchingIdx === idx ? null : idx)}
                                            className="h-7 px-2 text-[11px]"
                                        >
                                            <Search className="mr-1 h-3 w-3" />
                                            {searchingIdx === idx ? 'Hide search' : 'Find product'}
                                        </Button>
                                    </div>

                                    <div className="grid gap-3 sm:grid-cols-[168px_minmax(0,1fr)]">
                                        <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
                                            <div className="relative h-40 w-full bg-slate-50 p-1.5">
                                                {line.imageUrl ? (
                                                    <img
                                                        src={getOptimizedImageUrl(line.imageUrl, 'lg') || line.imageUrl}
                                                        alt={line.productName || line.skuCode || 'Variation'}
                                                        className="h-full w-full object-contain"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                                                        <Package className="h-6 w-6" />
                                                        <span className="text-[11px]">No preview</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="border-t border-border/70 bg-muted/30 px-2 py-1 text-center text-[10px] text-muted-foreground">
                                                Variation Preview
                                            </div>
                                        </div>

                                        <div className="flex h-full flex-col gap-2">
                                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_108px_96px_42px] sm:items-center">
                                                <div className="relative">
                                                    <Input
                                                        placeholder="e.g. COH-ABC-M"
                                                        value={line.skuCode}
                                                        onChange={(e) => updateLine(idx, 'skuCode', e.target.value)}
                                                        onBlur={() => void handleSkuBlur(idx)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                void handleSkuBlur(idx, true);
                                                            }
                                                        }}
                                                        className={cn(
                                                            'h-10 font-mono text-sm',
                                                            line.skuId && 'border-emerald-300 bg-emerald-50/50',
                                                        )}
                                                    />
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={!line.skuCode.trim() || Boolean(line.skuId) || resolvingSkuIdx === idx}
                                                    onClick={() => void handleSkuBlur(idx, true)}
                                                    className="h-10 text-xs"
                                                >
                                                    {resolvingSkuIdx === idx ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    ) : (
                                                        'Resolve'
                                                    )}
                                                </Button>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    value={line.qty}
                                                    onChange={(e) =>
                                                        updateLine(idx, 'qty', Math.max(1, Number(e.target.value) || 1))
                                                    }
                                                    className="h-10 text-center"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removeLine(idx)}
                                                    disabled={lines.length <= 1}
                                                    className={cn(
                                                        'flex h-10 w-10 items-center justify-center rounded-md border transition-colors',
                                                        lines.length <= 1
                                                            ? 'cursor-not-allowed border-border/40 text-muted-foreground/40'
                                                            : 'border-border text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive',
                                                    )}
                                                    aria-label={`Remove line ${idx + 1}`}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>

                                            {line.productName && (
                                                <p className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                                                    <span className="font-medium">{line.productName}</span>
                                                    {line.colorName ? ` · ${line.colorName}` : ''}
                                                    {line.size ? ` · ${line.size}` : ''}
                                                </p>
                                            )}

                                            <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-[11px] text-muted-foreground">
                                                <span>Enter SKU and press Enter to resolve quickly.</span>
                                                {!line.skuId && line.skuCode.trim() && (
                                                    <button
                                                        type="button"
                                                        className="text-sky-700 hover:text-sky-800"
                                                        onClick={() => setSearchingIdx(idx)}
                                                    >
                                                        Search by product name instead
                                                    </button>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 rounded-md bg-background px-2.5 py-2 text-xs sm:grid-cols-4">
                                                <div>
                                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">MRP</p>
                                                    <p className="font-medium">{line.mrp ? formatMoney(line.mrp) : '--'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Qty</p>
                                                    <p className="font-medium">{line.qty}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tax Slab</p>
                                                    <p className="font-medium">
                                                        {line.mrp ? (line.mrp > 2500 ? '18%' : '5%') : '--'}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Line Total</p>
                                                    <p className="font-semibold">{line.mrp ? formatMoney(line.qty * line.mrp) : '--'}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {searchingIdx === idx && (
                                        <div className="mt-2">
                                            <ProductSearch
                                                onSelect={(sku) => handleSearchSelect(idx, sku)}
                                                onCancel={() => setSearchingIdx(null)}
                                                initialQuery={line.skuCode.trim()}
                                                placeholder="Search by SKU, product name, color, or size"
                                                maxResultsHeight="14rem"
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    <Card className="border-border/70 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Payment & Notes</CardTitle>
                            <CardDescription>Set payment method and completion status.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label>Payment Method</Label>
                                    <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border">
                                        <button
                                            type="button"
                                            onClick={() => setPaymentMethod('Prepaid')}
                                            className={cn(
                                                'px-3 py-2 text-xs font-medium transition-colors',
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
                                                'border-l px-3 py-2 text-xs font-medium transition-colors',
                                                paymentMethod === 'COD'
                                                    ? 'bg-amber-500 text-white'
                                                    : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                                            )}
                                        >
                                            COD
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Payment Status</Label>
                                    <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border">
                                        <button
                                            type="button"
                                            onClick={() => setPaymentStatus('pending')}
                                            className={cn(
                                                'px-3 py-2 text-xs font-medium transition-colors',
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
                                                'border-l px-3 py-2 text-xs font-medium transition-colors',
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

                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="quick-order-discount">
                                        Manual Discount ({manualDiscountType === 'percent' ? '%' : '₹'})
                                    </Label>
                                    <span className="text-xs text-muted-foreground">
                                        Applied: {formatMoney(discountAppliedToPreview)}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border">
                                    <button
                                        type="button"
                                        onClick={() => setManualDiscountType('amount')}
                                        className={cn(
                                            'px-3 py-2 text-xs font-medium transition-colors',
                                            manualDiscountType === 'amount'
                                                ? 'bg-sky-600 text-white'
                                                : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                                        )}
                                    >
                                        Amount (₹)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setManualDiscountType('percent')}
                                        className={cn(
                                            'border-l px-3 py-2 text-xs font-medium transition-colors',
                                            manualDiscountType === 'percent'
                                                ? 'bg-sky-600 text-white'
                                                : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                                        )}
                                    >
                                        Percent (%)
                                    </button>
                                </div>
                                <Input
                                    id="quick-order-discount"
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={manualDiscount}
                                    onChange={(e) => {
                                        const raw = Number(e.target.value);
                                        const nextValue = Number.isFinite(raw) ? Math.max(0, raw) : 0;
                                        setManualDiscount(manualDiscountType === 'percent' ? Math.min(100, nextValue) : nextValue);
                                    }}
                                    className="h-10"
                                />
                                <p className="text-xs text-muted-foreground">
                                    {manualDiscountType === 'percent'
                                        ? 'Percent discount is calculated on gross amount and distributed proportionally across lines.'
                                        : 'Discount is proportionally distributed across line prices before saving.'}
                                </p>
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="quick-order-note">Order Note</Label>
                                <Textarea
                                    id="quick-order-note"
                                    placeholder="Any internal note for this order..."
                                    value={orderNote}
                                    onChange={(e) => setOrderNote(e.target.value)}
                                    className="min-h-[84px] resize-none"
                                />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="h-fit lg:sticky lg:top-4">
                    <Card className="border-border/70 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">POS Receipt</CardTitle>
                            <CardDescription>Live bill preview with taxable and GST breakup.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 text-slate-100 shadow-inner">
                                <div className="mb-2 flex items-center justify-between font-mono text-xs text-slate-400">
                                    <span>COH POS CHECKOUT</span>
                                    <span>{previewOrderNumber}</span>
                                </div>
                                <div className="mb-3 h-px border-t border-dashed border-slate-700" />

                                <div className="space-y-2 font-mono text-sm">
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-400">Gross (MRP incl. GST)</span>
                                        <span>{formatMoney(grossBeforeDiscount)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-400">Manual Discount</span>
                                        <span className="text-rose-300">-{formatMoney(discountAppliedToPreview)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-400">Taxable Subtotal</span>
                                        <span>{formatMoney(gstPreview?.subtotal ?? grossAfterDiscount)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-400">GST Total</span>
                                        <span>{formatMoney(gstPreview?.gstAmount ?? 0)}</span>
                                    </div>
                                    {gstPreview && (
                                        gstPreview.gstType === 'cgst_sgst' ? (
                                            <>
                                                <div className="flex items-center justify-between text-xs text-slate-300">
                                                    <span>CGST</span>
                                                    <span>{formatMoney(gstPreview.cgstAmount)}</span>
                                                </div>
                                                <div className="flex items-center justify-between text-xs text-slate-300">
                                                    <span>SGST</span>
                                                    <span>{formatMoney(gstPreview.sgstAmount)}</span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex items-center justify-between text-xs text-slate-300">
                                                <span>IGST</span>
                                                <span>{formatMoney(gstPreview.igstAmount)}</span>
                                            </div>
                                        )
                                    )}
                                    {gstByRate.map((slab) => (
                                        <div key={slab.rate} className="flex items-center justify-between text-xs text-slate-400">
                                            <span>GST {slab.rate}% slab</span>
                                            <span>{formatMoney(slab.gst)}</span>
                                        </div>
                                    ))}
                                </div>

                                <div className="my-3 h-px border-t border-dashed border-slate-700" />
                                <div className="rounded-md bg-emerald-500/15 px-2.5 py-2 font-mono">
                                    <div className="flex items-center justify-between text-xs text-emerald-200">
                                        <span>{payoutLabel}</span>
                                        <span>{formatMoney(payableAmount)}</span>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-base font-semibold text-emerald-50">
                                        <span>TOTAL PAYABLE</span>
                                        <span>{formatMoney(payableAmount)}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Resolved</p>
                                    <p className="text-lg font-semibold">{resolvedLines}</p>
                                </div>
                                <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tax Mode</p>
                                    <p className="text-xs font-semibold leading-tight">
                                        {taxModeLabel}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Avg GST</p>
                                    <p className="text-lg font-semibold">{gstPreview ? `${gstPreview.effectiveGstRate}%` : '--'}</p>
                                </div>
                            </div>

                            <div className="rounded-lg border border-border/70 bg-muted/10 p-3 text-sm">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="font-medium">Readiness</span>
                                    <Badge variant={canSubmit ? 'success' : 'secondary'}>
                                        {canSubmit ? 'Ready to submit' : 'Incomplete'}
                                    </Badge>
                                </div>
                                <div className="space-y-1.5 text-muted-foreground">
                                    <div className="flex items-center gap-2">
                                        {phoneDigits.length >= 10 ? (
                                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                        ) : (
                                            <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                                        )}
                                        <span>Phone captured</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {customerName.trim() ? (
                                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                        ) : (
                                            <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                                        )}
                                        <span>Customer name entered</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {validLines.length > 0 ? (
                                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                        ) : (
                                            <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                                        )}
                                        <span>At least one valid SKU line</span>
                                    </div>
                                    {!isExchange && (
                                        <div className="flex items-center gap-2">
                                            {payableAmount > 0 ? (
                                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                            ) : (
                                                <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                                            )}
                                            <span>Payable amount above zero</span>
                                        </div>
                                    )}
                                    {unresolvedLines > 0 && (
                                        <p className="pt-1 text-xs text-amber-700">
                                            {unresolvedLines} SKU line{unresolvedLines === 1 ? '' : 's'} will be resolved at submit.
                                        </p>
                                    )}
                                    {unpricedLines > 0 && (
                                        <p className="pt-1 text-xs text-amber-700">
                                            {unpricedLines} line{unpricedLines === 1 ? '' : 's'} missing MRP in preview.
                                        </p>
                                    )}
                                    {!stateName.trim() && (
                                        <p className="pt-1 text-xs text-muted-foreground">
                                            State not set, GST split defaults to IGST.
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Button
                                    type="submit"
                                    disabled={!canSubmit || isBusy}
                                    className={cn('w-full', isExchange && 'bg-amber-500 hover:bg-amber-600')}
                                >
                                    {isBusy ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Creating...
                                        </>
                                    ) : (
                                        isExchange ? 'Create Exchange Order' : 'Create Order'
                                    )}
                                </Button>
                                <Button type="button" variant="outline" onClick={goBack} className="w-full">
                                    Cancel
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </form>
        </div>
    );
}
