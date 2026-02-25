/**
 * Inventory Adjustments Page
 *
 * Unified page for adjusting both finished goods (SKU) and fabric stock.
 * Two tabs: Finished Goods and Fabric.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { scanLookup, type ScanLookupResult } from '@/server/functions/returns';
import {
    adjustInventory,
    getRecentAdjustments,
    type AdjustInventoryResult,
    type RecentSkuAdjustment,
    type RecentFabricAdjustment,
} from '@/server/functions/inventoryMutations';
import { getFabricColoursFlat, type FabricColourFlatRow } from '@/server/functions/materials';
import { createFabricColourTransaction } from '@/server/functions/fabricColourMutations';
import { getOptimizedImageUrl } from '@/utils/imageOptimization';
import {
    Sliders,
    Plus,
    Minus,
    Check,
    AlertTriangle,
    Package,
    Layers,
    ArrowUpCircle,
    ArrowDownCircle,
} from 'lucide-react';

// ============================================
// CONSTANTS
// ============================================

const SKU_ADD_REASONS = [
    { value: 'found_stock', label: 'Found Stock' },
    { value: 'correction', label: 'Inventory Correction' },
    { value: 'return_unlinked', label: 'Unlinked Return' },
    { value: 'other', label: 'Other' },
] as const;

const SKU_REMOVE_REASONS = [
    { value: 'damaged', label: 'Damaged' },
    { value: 'shrinkage', label: 'Shrinkage' },
    { value: 'theft_loss', label: 'Theft/Loss' },
    { value: 'correction', label: 'Inventory Correction' },
    { value: 'sample', label: 'Sample/Gift' },
    { value: 'other', label: 'Other' },
] as const;

const FABRIC_ADD_REASONS = [
    { value: 'found_stock', label: 'Found Stock' },
    { value: 'correction', label: 'Inventory Correction' },
    { value: 'other', label: 'Other' },
] as const;

const FABRIC_REMOVE_REASONS = [
    { value: 'damaged', label: 'Damaged' },
    { value: 'shrinkage', label: 'Shrinkage' },
    { value: 'theft_loss', label: 'Theft/Loss' },
    { value: 'correction', label: 'Inventory Correction' },
    { value: 'sample', label: 'Sample/Gift' },
    { value: 'other', label: 'Other' },
] as const;

type Direction = 'add' | 'remove';
type Tab = 'sku' | 'fabric';

// ============================================
// FINISHED GOODS TAB
// ============================================

function FinishedGoodsTab() {
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);

    const [skuCode, setSkuCode] = useState('');
    const [lookupResult, setLookupResult] = useState<ScanLookupResult | null>(null);
    const [direction, setDirection] = useState<Direction>('add');
    const [qty, setQty] = useState<number>(1);
    const [reason, setReason] = useState('');
    const [notes, setNotes] = useState('');
    const [success, setSuccess] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const scanLookupFn = useServerFn(scanLookup);
    const adjustInventoryFn = useServerFn(adjustInventory);

    // Auto-focus
    useEffect(() => { inputRef.current?.focus(); }, []);

    // Auto-clear messages
    useEffect(() => {
        if (success) { const t = setTimeout(() => setSuccess(null), 4000); return () => clearTimeout(t); }
    }, [success]);
    useEffect(() => {
        if (error) { const t = setTimeout(() => setError(null), 5000); return () => clearTimeout(t); }
    }, [error]);

    // Reset reason when direction changes
    useEffect(() => { setReason(''); }, [direction]);

    const reasons = direction === 'add' ? SKU_ADD_REASONS : SKU_REMOVE_REASONS;

    // Lookup mutation
    const lookupMutation = useMutation({
        mutationFn: async (code: string) => {
            return scanLookupFn({ data: { code } });
        },
        onSuccess: (data) => {
            setLookupResult(data);
            setError(null);
        },
        onError: (err: Error) => {
            setLookupResult(null);
            setError(err.message || 'SKU not found');
        },
    });

    const handleLookup = useCallback(() => {
        const code = skuCode.trim();
        if (!code) return;
        lookupMutation.mutate(code);
    }, [skuCode, lookupMutation]);

    // Adjust mutation
    const adjustMutation = useMutation({
        mutationFn: async () => {
            const result = await adjustInventoryFn({
                data: {
                    skuCode: lookupResult!.sku.skuCode,
                    qty,
                    direction,
                    reason,
                    ...(notes ? { notes } : {}),
                },
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Adjustment failed');
            }
            return result.data as AdjustInventoryResult;
        },
        onSuccess: (data) => {
            const sign = data.direction === 'add' ? '+' : '-';
            setSuccess(
                `${sign}${data.qty} ${data.skuCode} (${data.productName} - ${data.colorName} / ${data.size}). New balance: ${data.newBalance}`
            );
            // Reset form
            setSkuCode('');
            setLookupResult(null);
            setQty(1);
            setReason('');
            setNotes('');
            inputRef.current?.focus();
            // Invalidate caches
            queryClient.invalidateQueries({ queryKey: ['inventory'] });
            queryClient.invalidateQueries({ queryKey: ['recent-adjustments'] });
        },
        onError: (err: Error) => {
            setError(err.message || 'Adjustment failed');
        },
    });

    const canSubmit = lookupResult && qty > 0 && reason && !adjustMutation.isPending;

    return (
        <div className="space-y-6">
            {/* Messages */}
            {success && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-3">
                    <Check size={20} />
                    <span className="font-medium">{success}</span>
                </div>
            )}
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3">
                    <AlertTriangle size={20} />
                    <span className="font-medium">{error}</span>
                </div>
            )}

            {/* SKU Search */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">SKU Code</label>
                <div className="flex items-center gap-3">
                    <div className="flex-1">
                        <input
                            ref={inputRef}
                            type="text"
                            value={skuCode}
                            onChange={(e) => setSkuCode(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleLookup(); } }}
                            placeholder="Scan or type SKU code..."
                            className="input text-lg font-mono w-full"
                            autoFocus
                        />
                    </div>
                    <button
                        onClick={handleLookup}
                        disabled={!skuCode.trim() || lookupMutation.isPending}
                        className="btn btn-primary px-6"
                    >
                        {lookupMutation.isPending ? 'Looking up...' : 'Lookup'}
                    </button>
                </div>
            </div>

            {/* SKU Info Card */}
            {lookupResult && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex items-start gap-4">
                        {lookupResult.sku.imageUrl && (
                            <img
                                src={getOptimizedImageUrl(lookupResult.sku.imageUrl, 'md') ?? undefined}
                                alt={lookupResult.sku.productName}
                                className="w-20 h-20 rounded-lg object-cover border border-gray-200"
                            />
                        )}
                        <div className="flex-1">
                            <h3 className="text-lg font-semibold text-gray-900">
                                {lookupResult.sku.productName}
                            </h3>
                            <p className="text-sm text-gray-600">
                                {lookupResult.sku.colorName} / {lookupResult.sku.size}
                            </p>
                            <p className="text-sm font-mono text-gray-500 mt-1">
                                {lookupResult.sku.skuCode}
                            </p>
                        </div>
                        <div className="text-right">
                            <div className="text-sm text-gray-500">Current Balance</div>
                            <div className="text-2xl font-bold text-gray-900">{lookupResult.currentBalance}</div>
                            <div className="text-xs text-gray-500">Available: {lookupResult.availableBalance}</div>
                        </div>
                    </div>

                    {/* Direction Toggle */}
                    <div className="mt-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Direction</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setDirection('add')}
                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 font-medium transition-all ${
                                    direction === 'add'
                                        ? 'border-green-500 bg-green-50 text-green-700'
                                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                                }`}
                            >
                                <Plus size={20} />
                                Add Stock
                            </button>
                            <button
                                onClick={() => setDirection('remove')}
                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 font-medium transition-all ${
                                    direction === 'remove'
                                        ? 'border-red-500 bg-red-50 text-red-700'
                                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                                }`}
                            >
                                <Minus size={20} />
                                Remove Stock
                            </button>
                        </div>
                    </div>

                    {/* Quantity */}
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Quantity</label>
                        <input
                            type="number"
                            value={qty}
                            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                            min={1}
                            step={1}
                            className="input w-32 text-lg"
                        />
                    </div>

                    {/* Reason */}
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Reason</label>
                        <select
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="input w-full"
                        >
                            <option value="">Select reason...</option>
                            {reasons.map((r) => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Notes */}
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Notes (optional)</label>
                        <input
                            type="text"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Additional details..."
                            className="input w-full"
                        />
                    </div>

                    {/* Submit */}
                    <div className="mt-6">
                        <button
                            onClick={() => adjustMutation.mutate()}
                            disabled={!canSubmit}
                            className={`btn w-full py-3 text-lg font-medium ${
                                direction === 'add'
                                    ? 'bg-green-600 hover:bg-green-700 text-white'
                                    : 'bg-red-600 hover:bg-red-700 text-white'
                            } disabled:opacity-50 disabled:cursor-not-allowed rounded-lg`}
                        >
                            {adjustMutation.isPending
                                ? 'Processing...'
                                : `${direction === 'add' ? 'Add' : 'Remove'} ${qty} unit${qty > 1 ? 's' : ''}`}
                        </button>
                    </div>
                </div>
            )}

            {/* Recent Adjustments */}
            <RecentAdjustmentsTable type="sku" />
        </div>
    );
}

// ============================================
// FABRIC TAB
// ============================================

function FabricTab() {
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedFabric, setSelectedFabric] = useState<FabricColourFlatRow | null>(null);
    const [showDropdown, setShowDropdown] = useState(false);
    const [direction, setDirection] = useState<Direction>('add');
    const [qty, setQty] = useState<number>(1);
    const [reason, setReason] = useState('');
    const [notes, setNotes] = useState('');
    const [success, setSuccess] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const getFabricColoursFlatFn = useServerFn(getFabricColoursFlat);
    const createFabricTxnFn = useServerFn(createFabricColourTransaction);

    // Auto-focus
    useEffect(() => { inputRef.current?.focus(); }, []);

    // Auto-clear messages
    useEffect(() => {
        if (success) { const t = setTimeout(() => setSuccess(null), 4000); return () => clearTimeout(t); }
    }, [success]);
    useEffect(() => {
        if (error) { const t = setTimeout(() => setError(null), 5000); return () => clearTimeout(t); }
    }, [error]);

    // Reset reason when direction changes
    useEffect(() => { setReason(''); }, [direction]);

    const reasons = direction === 'add' ? FABRIC_ADD_REASONS : FABRIC_REMOVE_REASONS;

    // Fabric colour search
    const { data: fabricResults } = useQuery({
        queryKey: ['fabric-colours-flat', searchTerm],
        queryFn: async () => {
            const result = await getFabricColoursFlatFn({
                data: {
                    ...(searchTerm.length >= 2 ? { search: searchTerm } : {}),
                },
            });
            return result.items;
        },
        enabled: searchTerm.length >= 2,
        staleTime: 30_000,
    });

    // Fabric transaction mutation
    const fabricMutation = useMutation({
        mutationFn: async () => {
            if (!selectedFabric) throw new Error('No fabric selected');
            return createFabricTxnFn({
                data: {
                    fabricColourId: selectedFabric.id,
                    txnType: direction === 'add' ? 'inward' : 'outward',
                    qty,
                    unit: (selectedFabric.unit as 'meter' | 'kg' | 'yard') || 'meter',
                    reason,
                    ...(notes ? { notes } : {}),
                },
            });
        },
        onSuccess: () => {
            const sign = direction === 'add' ? '+' : '-';
            setSuccess(
                `${sign}${qty} ${selectedFabric!.unit || 'units'} of ${selectedFabric!.materialName} > ${selectedFabric!.fabricName} > ${selectedFabric!.colourName}`
            );
            // Reset
            setSearchTerm('');
            setSelectedFabric(null);
            setQty(1);
            setReason('');
            setNotes('');
            inputRef.current?.focus();
            // Invalidate caches
            queryClient.invalidateQueries({ queryKey: ['fabric'] });
            queryClient.invalidateQueries({ queryKey: ['recent-adjustments'] });
            queryClient.invalidateQueries({ queryKey: ['fabric-colours-flat'] });
        },
        onError: (err: Error) => {
            setError(err.message || 'Transaction failed');
        },
    });

    const canSubmit = selectedFabric && qty > 0 && reason && !fabricMutation.isPending;

    return (
        <div className="space-y-6">
            {/* Messages */}
            {success && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-3">
                    <Check size={20} />
                    <span className="font-medium">{success}</span>
                </div>
            )}
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3">
                    <AlertTriangle size={20} />
                    <span className="font-medium">{error}</span>
                </div>
            )}

            {/* Fabric Search */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Search Fabric Colour</label>
                <div className="relative">
                    <input
                        ref={inputRef}
                        type="text"
                        value={searchTerm}
                        onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setShowDropdown(true);
                            if (!e.target.value) setSelectedFabric(null);
                        }}
                        onFocus={() => setShowDropdown(true)}
                        placeholder="Search by material, fabric, or colour name..."
                        className="input text-lg w-full"
                        autoFocus
                    />
                    {/* Dropdown */}
                    {showDropdown && fabricResults && fabricResults.length > 0 && !selectedFabric && (
                        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                            {fabricResults.map((fc) => (
                                <button
                                    key={fc.id}
                                    onClick={() => {
                                        setSelectedFabric(fc);
                                        setSearchTerm(`${fc.materialName} > ${fc.fabricName} > ${fc.colourName}`);
                                        setShowDropdown(false);
                                    }}
                                    className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                                >
                                    <div className="font-medium text-gray-900">
                                        {fc.materialName} &gt; {fc.fabricName} &gt; {fc.colourName}
                                    </div>
                                    <div className="text-sm text-gray-500">
                                        Balance: {fc.currentBalance} {fc.unit || 'units'}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Selected Fabric Info + Form */}
            {selectedFabric && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900">
                                {selectedFabric.materialName} &gt; {selectedFabric.fabricName} &gt; {selectedFabric.colourName}
                            </h3>
                            <p className="text-sm text-gray-500 mt-1">
                                {selectedFabric.composition || 'No composition info'}
                                {selectedFabric.weight ? ` | ${selectedFabric.weight} ${selectedFabric.weightUnit || 'gsm'}` : ''}
                            </p>
                        </div>
                        <div className="text-right">
                            <div className="text-sm text-gray-500">Current Balance</div>
                            <div className="text-2xl font-bold text-gray-900">
                                {selectedFabric.currentBalance}
                            </div>
                            <div className="text-xs text-gray-500">{selectedFabric.unit || 'units'}</div>
                        </div>
                    </div>

                    {/* Direction Toggle */}
                    <div className="mt-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Direction</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setDirection('add')}
                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 font-medium transition-all ${
                                    direction === 'add'
                                        ? 'border-green-500 bg-green-50 text-green-700'
                                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                                }`}
                            >
                                <Plus size={20} />
                                Add Stock
                            </button>
                            <button
                                onClick={() => setDirection('remove')}
                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 font-medium transition-all ${
                                    direction === 'remove'
                                        ? 'border-red-500 bg-red-50 text-red-700'
                                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                                }`}
                            >
                                <Minus size={20} />
                                Remove Stock
                            </button>
                        </div>
                    </div>

                    {/* Quantity */}
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Quantity ({selectedFabric.unit || 'units'})
                        </label>
                        <input
                            type="number"
                            value={qty}
                            onChange={(e) => setQty(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                            min={0.01}
                            step={0.1}
                            className="input w-32 text-lg"
                        />
                    </div>

                    {/* Reason */}
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Reason</label>
                        <select
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="input w-full"
                        >
                            <option value="">Select reason...</option>
                            {reasons.map((r) => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Notes */}
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Notes (optional)</label>
                        <input
                            type="text"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Additional details..."
                            className="input w-full"
                        />
                    </div>

                    {/* Submit */}
                    <div className="mt-6">
                        <button
                            onClick={() => fabricMutation.mutate()}
                            disabled={!canSubmit}
                            className={`btn w-full py-3 text-lg font-medium ${
                                direction === 'add'
                                    ? 'bg-green-600 hover:bg-green-700 text-white'
                                    : 'bg-red-600 hover:bg-red-700 text-white'
                            } disabled:opacity-50 disabled:cursor-not-allowed rounded-lg`}
                        >
                            {fabricMutation.isPending
                                ? 'Processing...'
                                : `${direction === 'add' ? 'Add' : 'Remove'} ${qty} ${selectedFabric.unit || 'units'}`}
                        </button>
                    </div>
                </div>
            )}

            {/* Recent Adjustments */}
            <RecentAdjustmentsTable type="fabric" />
        </div>
    );
}

// ============================================
// RECENT ADJUSTMENTS TABLE
// ============================================

function RecentAdjustmentsTable({ type }: { type: Tab }) {
    const getRecentAdjustmentsFn = useServerFn(getRecentAdjustments);

    const { data, isLoading } = useQuery({
        queryKey: ['recent-adjustments', type],
        queryFn: async () => {
            return getRecentAdjustmentsFn({ data: { type, limit: 20 } });
        },
        refetchInterval: 30_000,
    });

    if (isLoading) {
        return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
                <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
            </div>
        );
    }

    const isEmpty = !data || (data.type === 'sku' ? data.items.length === 0 : data.items.length === 0);

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Recent Adjustments</h3>
            </div>
            {isEmpty ? (
                <div className="text-center py-12 text-gray-500">
                    <Sliders size={40} className="mx-auto mb-3 text-gray-400" />
                    <p className="text-sm">No recent adjustments</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">Date</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">
                                    {type === 'sku' ? 'SKU' : 'Fabric'}
                                </th>
                                <th className="px-4 py-3 text-center font-semibold text-gray-700">Direction</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">Qty</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">Reason</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">Notes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {data?.type === 'sku' &&
                                (data.items as RecentSkuAdjustment[]).map((txn) => (
                                    <tr key={txn.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                                            {new Date(txn.createdAt).toLocaleDateString('en-IN', {
                                                day: '2-digit',
                                                month: 'short',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-gray-900">{txn.skuCode}</div>
                                            <div className="text-xs text-gray-500">
                                                {txn.productName} - {txn.colorName} / {txn.size}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {txn.txnType === 'inward' ? (
                                                <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                                                    <ArrowUpCircle size={16} /> In
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                                                    <ArrowDownCircle size={16} /> Out
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium">
                                            {txn.qty}
                                        </td>
                                        <td className="px-4 py-3 text-gray-600 capitalize">
                                            {txn.reason.replace(/_/g, ' ')}
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">
                                            {txn.notes || '-'}
                                        </td>
                                    </tr>
                                ))}
                            {data?.type === 'fabric' &&
                                (data.items as RecentFabricAdjustment[]).map((txn) => (
                                    <tr key={txn.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                                            {new Date(txn.createdAt).toLocaleDateString('en-IN', {
                                                day: '2-digit',
                                                month: 'short',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-gray-900">
                                                {txn.materialName} &gt; {txn.fabricName}
                                            </div>
                                            <div className="text-xs text-gray-500">{txn.colourName}</div>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {txn.txnType === 'inward' ? (
                                                <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                                                    <ArrowUpCircle size={16} /> In
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                                                    <ArrowDownCircle size={16} /> Out
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium">
                                            {txn.qty} {txn.unit}
                                        </td>
                                        <td className="px-4 py-3 text-gray-600 capitalize">
                                            {txn.reason.replace(/_/g, ' ')}
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">
                                            {txn.notes || '-'}
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ============================================
// MAIN PAGE COMPONENT
// ============================================

export default function InventoryAdjustments() {
    const [activeTab, setActiveTab] = useState<Tab>('sku');

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10 shadow-sm">
                <div className="max-w-4xl mx-auto">
                    <div className="flex items-center gap-3">
                        <Sliders className="text-blue-600" size={28} />
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">Inventory Adjustments</h1>
                            <p className="text-sm text-gray-600">Adjust finished goods and fabric stock</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto p-4">
                {/* Tab Switcher */}
                <div className="flex gap-2 mb-6">
                    <button
                        onClick={() => setActiveTab('sku')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all ${
                            activeTab === 'sku'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                        }`}
                    >
                        <Package size={18} />
                        Finished Goods
                    </button>
                    <button
                        onClick={() => setActiveTab('fabric')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all ${
                            activeTab === 'fabric'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                        }`}
                    >
                        <Layers size={18} />
                        Fabric
                    </button>
                </div>

                {/* Tab Content */}
                {activeTab === 'sku' ? <FinishedGoodsTab /> : <FabricTab />}
            </div>
        </div>
    );
}
