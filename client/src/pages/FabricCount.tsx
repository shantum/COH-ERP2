/**
 * FabricCount — Mobile-first page for warehouse staff to enter physical fabric stock counts.
 * Counts go into a "pending" pool for admin review.
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { ArrowLeft, Check, Search, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import ConfirmModal from '@/components/common/ConfirmModal';
import {
    getFabricColoursForCount,
    getMyRecentCounts,
    submitStockCount,
    deleteStockCount,
} from '@/server/functions/fabricStockCount';

interface FabricColourItem {
    id: string;
    colourName: string;
    colourHex: string | null;
    code: string | null;
    currentBalance: number;
    fabricName: string;
    materialName: string;
    unit: string;
    thumbnails: Array<{ imageUrl: string; productName: string }>;
}

interface RecentCount {
    id: string;
    fabricColourId: string;
    colourName: string;
    colourHex: string | null;
    fabricName: string;
    unit: string;
    physicalQty: number;
    systemQty: number;
    status: string;
    notes: string | null;
    countedAt: string;
}

type View = 'search' | 'enter' | 'success';

export default function FabricCount() {
    const queryClient = useQueryClient();
    const [view, setView] = useState<View>('search');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<FabricColourItem | null>(null);
    const [qty, setQty] = useState('');
    const [notes, setNotes] = useState('');
    const [deleteCountId, setDeleteCountId] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const qtyRef = useRef<HTMLInputElement>(null);

    // Server fn wrappers
    const getColoursFn = useServerFn(getFabricColoursForCount);
    const getRecentFn = useServerFn(getMyRecentCounts);
    const submitFn = useServerFn(submitStockCount);
    const deleteFn = useServerFn(deleteStockCount);

    // Fetch fabric colours
    const { data: coloursData, isLoading: coloursLoading } = useQuery({
        queryKey: ['fabricStockCount', 'colours'],
        queryFn: () => getColoursFn({ data: undefined }),
    });
    const colours = coloursData?.items ?? [];

    // Fetch recent counts
    const { data: recentData } = useQuery({
        queryKey: ['fabricStockCount', 'myRecent'],
        queryFn: () => getRecentFn({ data: undefined }),
        refetchInterval: 30000,
    });
    const recentCounts: RecentCount[] = recentData?.counts ?? [];

    // Filter colours by search
    const filtered = useMemo(() => {
        if (!search.trim()) return colours;
        const q = search.toLowerCase();
        return colours.filter(
            (c) =>
                c.colourName.toLowerCase().includes(q) ||
                c.fabricName.toLowerCase().includes(q) ||
                c.materialName.toLowerCase().includes(q) ||
                (c.code && c.code.toLowerCase().includes(q))
        );
    }, [colours, search]);

    // Submit mutation
    const submitMutation = useMutation({
        mutationFn: async () => {
            if (!selected) throw new Error('No fabric selected');
            const parsedQty = parseFloat(qty);
            if (isNaN(parsedQty) || parsedQty < 0) throw new Error('Invalid quantity');
            return submitFn({
                data: {
                    fabricColourId: selected.id,
                    physicalQty: parsedQty,
                    ...(notes.trim() ? { notes: notes.trim() } : {}),
                },
            });
        },
        onSuccess: (result) => {
            if (result.success) {
                setView('success');
                queryClient.invalidateQueries({ queryKey: ['fabricStockCount', 'myRecent'] });
            }
        },
    });

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteFn({ data: { id } }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricStockCount', 'myRecent'] });
        },
    });

    // Auto-focus
    useEffect(() => {
        if (view === 'search') searchRef.current?.focus();
        if (view === 'enter') qtyRef.current?.focus();
    }, [view]);

    const handleSelect = (item: FabricColourItem) => {
        setSelected(item);
        setQty('');
        setNotes('');
        setView('enter');
    };

    const handleBack = () => {
        setView('search');
        setSelected(null);
        setQty('');
        setNotes('');
    };

    const handleCountAnother = () => {
        setView('search');
        setSelected(null);
        setSearch('');
        setQty('');
        setNotes('');
    };

    const fmtQty = (n: number) =>
        n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

    // ── SEARCH VIEW ──────────────────────────────────────
    if (view === 'search') {
        return (
            <div className="min-h-screen bg-gray-50 pb-4">
                {/* Header */}
                <div className="sticky top-0 z-10 bg-white border-b px-4 py-3">
                    <h1 className="text-lg font-semibold text-gray-900">Fabric Stock Count</h1>
                    <div className="mt-2 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                            ref={searchRef}
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search fabric or colour..."
                            className="w-full pl-10 pr-10 py-3 text-base border rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        {search && (
                            <button
                                onClick={() => setSearch('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                            >
                                <X className="h-4 w-4 text-gray-400" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Fabric list */}
                <div className="px-4 mt-2">
                    {coloursLoading ? (
                        <div className="py-12 text-center text-gray-500">Loading fabrics...</div>
                    ) : filtered.length === 0 ? (
                        <div className="py-12 text-center text-gray-500">
                            {search ? 'No fabrics match your search' : 'No active fabrics found'}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {filtered.map((c) => (
                                <button
                                    key={c.id}
                                    onClick={() => handleSelect(c)}
                                    className="w-full text-left px-4 py-3 bg-white rounded-lg border hover:bg-blue-50 active:bg-blue-100 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        {/* Colour swatch */}
                                        <div
                                            className="w-8 h-8 rounded-full border-2 border-gray-200 flex-shrink-0"
                                            style={{ backgroundColor: c.colourHex ?? '#e5e7eb' }}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-gray-900">
                                                {c.fabricName} — {c.colourName}
                                            </div>
                                            <div className="text-sm text-gray-500">
                                                System: {fmtQty(c.currentBalance)} {c.unit}
                                                {c.code && <span className="ml-2 text-gray-400">{c.code}</span>}
                                            </div>
                                        </div>
                                        {/* Product thumbnails */}
                                        {c.thumbnails.length > 0 && (
                                            <div className="flex gap-1 flex-shrink-0">
                                                {c.thumbnails.map((t, i) => (
                                                    <img
                                                        key={i}
                                                        src={t.imageUrl}
                                                        alt={t.productName}
                                                        title={t.productName}
                                                        className="h-10 max-w-[40px] rounded border border-gray-200 object-contain bg-white"
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Recent counts */}
                {recentCounts.length > 0 && (
                    <div className="px-4 mt-6">
                        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                            My Counts Today
                        </h2>
                        <div className="space-y-1">
                            {recentCounts.map((c) => (
                                <div
                                    key={c.id}
                                    className="flex items-center gap-3 px-4 py-3 bg-white rounded-lg border"
                                >
                                    <div
                                        className="w-6 h-6 rounded-full border flex-shrink-0"
                                        style={{ backgroundColor: c.colourHex ?? '#e5e7eb' }}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-gray-900 truncate">
                                            {c.fabricName} — {c.colourName}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            Counted: {fmtQty(c.physicalQty)} {c.unit}
                                        </div>
                                    </div>
                                    <span
                                        className={cn(
                                            'text-xs px-2 py-0.5 rounded-full font-medium',
                                            c.status === 'pending' && 'bg-amber-100 text-amber-700',
                                            c.status === 'applied' && 'bg-green-100 text-green-700',
                                            c.status === 'discarded' && 'bg-red-100 text-red-700'
                                        )}
                                    >
                                        {c.status}
                                    </span>
                                    {c.status === 'pending' && (
                                        <button
                                            onClick={() => setDeleteCountId(c.id)}
                                            className="p-2 text-gray-400 hover:text-red-500"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <ConfirmModal
                    isOpen={!!deleteCountId}
                    onClose={() => setDeleteCountId(null)}
                    onConfirm={() => {
                        if (deleteCountId) deleteMutation.mutate(deleteCountId);
                    }}
                    title="Delete Count"
                    message="Delete this count? This action cannot be undone."
                    confirmText="Delete"
                    confirmVariant="danger"
                />
            </div>
        );
    }

    // ── ENTER VIEW ───────────────────────────────────────
    if (view === 'enter' && selected) {
        const parsedQty = parseFloat(qty);
        const isValid = !isNaN(parsedQty) && parsedQty >= 0 && qty.trim() !== '';

        return (
            <div className="min-h-screen bg-gray-50">
                {/* Header */}
                <div className="sticky top-0 z-10 bg-white border-b px-4 py-3">
                    <button
                        onClick={handleBack}
                        className="flex items-center gap-1 text-blue-600 font-medium -ml-1"
                    >
                        <ArrowLeft className="h-5 w-5" />
                        Back
                    </button>
                </div>

                <div className="px-4 py-6">
                    {/* Fabric info */}
                    <div className="flex items-center gap-3 mb-6">
                        <div
                            className="w-12 h-12 rounded-full border-2 border-gray-200 flex-shrink-0"
                            style={{ backgroundColor: selected.colourHex ?? '#e5e7eb' }}
                        />
                        <div>
                            <div className="text-xl font-semibold text-gray-900">
                                {selected.colourName}
                            </div>
                            <div className="text-base text-gray-500">
                                {selected.fabricName}
                            </div>
                        </div>
                    </div>

                    {/* System qty */}
                    <div className="bg-blue-50 rounded-lg p-4 mb-6">
                        <div className="text-sm text-blue-600 font-medium">System Balance</div>
                        <div className="text-2xl font-bold text-blue-900">
                            {fmtQty(selected.currentBalance)} <span className="text-lg font-normal">{selected.unit}</span>
                        </div>
                    </div>

                    {/* Physical qty input */}
                    <label className="block mb-2 text-sm font-medium text-gray-700">
                        Physical Count ({selected.unit})
                    </label>
                    <input
                        ref={qtyRef}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        placeholder="0"
                        className="w-full text-3xl font-bold text-center py-4 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    />

                    {/* Variance preview */}
                    {isValid && (
                        <div className="mt-3 text-center">
                            {(() => {
                                const variance = parsedQty - selected.currentBalance;
                                if (Math.abs(variance) < 0.01) {
                                    return <span className="text-green-600 font-medium">No variance — matches system</span>;
                                }
                                return (
                                    <span className={cn(
                                        'font-medium',
                                        variance > 0 ? 'text-blue-600' : 'text-red-600'
                                    )}>
                                        Variance: {variance > 0 ? '+' : ''}{fmtQty(variance)} {selected.unit}
                                    </span>
                                );
                            })()}
                        </div>
                    )}

                    {/* Notes */}
                    <label className="block mt-6 mb-2 text-sm font-medium text-gray-700">
                        Notes (optional)
                    </label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Any notes about this count..."
                        rows={2}
                        className="w-full px-4 py-3 border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white resize-none"
                    />

                    {/* Submit */}
                    <button
                        onClick={() => submitMutation.mutate()}
                        disabled={!isValid || submitMutation.isPending}
                        className={cn(
                            'w-full mt-6 py-4 rounded-xl text-lg font-semibold transition-colors',
                            isValid && !submitMutation.isPending
                                ? 'bg-green-600 text-white active:bg-green-700'
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        )}
                    >
                        {submitMutation.isPending ? 'Saving...' : 'Submit Count'}
                    </button>

                    {submitMutation.isError && (
                        <div className="mt-3 text-center text-red-600 text-sm">
                            {submitMutation.error instanceof Error
                                ? submitMutation.error.message
                                : 'Failed to save count'}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── SUCCESS VIEW ─────────────────────────────────────
    if (view === 'success') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
                <div className="text-center">
                    <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
                        <Check className="h-10 w-10 text-green-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Saved!</h2>
                    <p className="text-gray-500 mb-8">
                        {selected && (
                            <>
                                {selected.fabricName} — {selected.colourName}
                                <br />
                                Counted: {fmtQty(parseFloat(qty))} {selected.unit}
                            </>
                        )}
                    </p>
                    <button
                        onClick={handleCountAnother}
                        className="w-full py-4 rounded-xl text-lg font-semibold bg-blue-600 text-white active:bg-blue-700 transition-colors"
                    >
                        Count Another
                    </button>
                </div>
            </div>
        );
    }

    return null;
}
