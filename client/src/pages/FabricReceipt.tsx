/**
 * Fabric Receipt Entry Page
 *
 * Page for recording fabric received from suppliers (inward transactions).
 * Features:
 * - Form with fabric colour selector, quantity, cost, supplier
 * - Recent receipts log with inline editing
 * - Success/error flash messages
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { getRouteApi } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import {
    Package,
    Plus,
    Check,
    AlertCircle,
    Search,
    X,
    ChevronsUpDown,
    Pencil,
    Trash2,
} from 'lucide-react';
import { CreateFabricReceiptSchema, type CreateFabricReceiptInput } from '@coh/shared';

import { getCatalogFilters } from '../server/functions/products';
import { getRecentFabricReceipts } from '../server/functions/fabricColours';
import {
    createFabricColourTransaction,
    updateFabricColourTransaction,
    deleteFabricColourTransaction,
} from '../server/functions/fabricColourMutations';
import { getParties, createParty } from '../server/functions/materialsMutations';
import type { FabricColour } from '../components/products/unified-edit/types';
import { ColorSwatch } from '../components/products/unified-edit/shared/FabricSelector';
import { useAuth } from '../hooks/useAuth';
import { getOptimizedImageUrl } from '../utils/imageOptimization';

// ============================================
// TYPES
// ============================================

interface FabricReceiptTransaction {
    id: string;
    fabricColourId: string;
    txnType: string;
    qty: number;
    unit: string;
    costPerUnit: number | null;
    partyId: string | null;
    notes: string | null;
    createdAt: string | Date;
    fabricColour: {
        id: string;
        colourName: string;
        colourHex: string | null;
        fabric: {
            id: string;
            name: string;
            material: { id: string; name: string } | null;
        };
    };
    party: { id: string; name: string } | null;
    createdBy: { id: string; name: string } | null;
}

interface Party {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    isActive: boolean;
}

// ============================================
// ROUTE API
// ============================================

const routeApi = getRouteApi('/_authenticated/fabric-receipt');

// ============================================
// MAIN COMPONENT
// ============================================

export default function FabricReceipt() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const searchParams = routeApi.useSearch();

    // Form state
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const qtyInputRef = useRef<HTMLInputElement>(null);

    // Edit state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValues, setEditValues] = useState<{
        qty?: number;
        costPerUnit?: number | null;
        notes?: string | null;
    }>({});

    // Filter state
    const [daysFilter, setDaysFilter] = useState(searchParams.days ?? 7);

    // Auto-clear messages
    useEffect(() => {
        if (successMessage) {
            const timer = setTimeout(() => setSuccessMessage(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);

    useEffect(() => {
        if (errorMessage) {
            const timer = setTimeout(() => setErrorMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [errorMessage]);

    // Server function hooks
    const getCatalogFiltersFn = useServerFn(getCatalogFilters);
    const getRecentFabricReceiptsFn = useServerFn(getRecentFabricReceipts);
    const getPartiesFn = useServerFn(getParties);

    // Query: Catalog filters (fabric colours)
    const { data: catalogData } = useQuery({
        queryKey: ['catalogFilters'],
        queryFn: () => getCatalogFiltersFn({ data: undefined }),
    });

    // Query: Parties
    const { data: suppliersData } = useQuery({
        queryKey: ['parties'],
        queryFn: () => getPartiesFn({ data: undefined }),
    });

    // Query: Recent receipts
    const { data: receiptsData, isLoading: receiptsLoading } = useQuery({
        queryKey: ['fabricReceipts', daysFilter, searchParams.partyId, searchParams.fabricColourId],
        queryFn: () =>
            getRecentFabricReceiptsFn({
                data: {
                    days: daysFilter,
                    limit: 100,
                    ...(searchParams.partyId ? { partyId: searchParams.partyId } : {}),
                    ...(searchParams.fabricColourId ? { fabricColourId: searchParams.fabricColourId } : {}),
                },
            }),
        refetchInterval: 30000, // Refresh every 30 seconds
    });

    const fabricColours = catalogData?.fabricColours ?? [];
    const suppliers = suppliersData?.parties ?? [];
    const receipts = (receiptsData?.receipts ?? []) as FabricReceiptTransaction[];

    // Form setup
    const {
        control,
        handleSubmit,
        reset,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<CreateFabricReceiptInput>({
        defaultValues: {
            fabricColourId: '',
            qty: undefined,
            unit: 'meter',
            costPerUnit: undefined,
            partyId: undefined,
            notes: '',
        },
    });

    // Mutations
    const createMutation = useMutation({
        mutationFn: (data: CreateFabricReceiptInput) =>
            createFabricColourTransaction({
                data: {
                    ...data,
                    txnType: 'inward',
                    reason: 'supplier_receipt',
                },
            }),
        onSuccess: (result) => {
            if (result.success) {
                setSuccessMessage('Receipt recorded successfully');
                reset();
                queryClient.invalidateQueries({ queryKey: ['fabricReceipts'] });
                queryClient.invalidateQueries({ queryKey: ['allFabricColourTransactions'] });
                qtyInputRef.current?.focus();
            }
        },
        onError: (error: Error) => {
            setErrorMessage(error.message || 'Failed to record receipt');
        },
    });

    const updateMutation = useMutation({
        mutationFn: (data: { id: string; qty?: number; costPerUnit?: number | null; notes?: string | null }) =>
            updateFabricColourTransaction({ data }),
        onSuccess: (result) => {
            if (result.success) {
                setSuccessMessage('Receipt updated');
                setEditingId(null);
                setEditValues({});
                queryClient.invalidateQueries({ queryKey: ['fabricReceipts'] });
                queryClient.invalidateQueries({ queryKey: ['allFabricColourTransactions'] });
            } else if (!result.success && 'error' in result) {
                setErrorMessage(result.error.message);
            }
        },
        onError: (error: Error) => {
            setErrorMessage(error.message || 'Failed to update receipt');
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteFabricColourTransaction({ data: { txnId: id } }),
        onSuccess: (result) => {
            if (result.success) {
                setSuccessMessage('Receipt deleted');
                queryClient.invalidateQueries({ queryKey: ['fabricReceipts'] });
                queryClient.invalidateQueries({ queryKey: ['allFabricColourTransactions'] });
            } else if (!result.success && 'error' in result) {
                setErrorMessage(result.error.message);
            }
        },
        onError: (error: Error) => {
            setErrorMessage(error.message || 'Failed to delete receipt');
        },
    });

    // Form submit with manual Zod validation
    const onSubmit = useCallback(
        (data: CreateFabricReceiptInput) => {
            // Validate with Zod
            const result = CreateFabricReceiptSchema.safeParse(data);
            if (!result.success) {
                // Set form errors from Zod validation
                for (const issue of result.error.issues) {
                    const field = issue.path[0] as keyof CreateFabricReceiptInput;
                    setError(field, { message: issue.message });
                }
                return;
            }
            createMutation.mutate(result.data);
        },
        [createMutation, setError]
    );

    // Edit handlers
    const startEdit = useCallback((receipt: FabricReceiptTransaction) => {
        setEditingId(receipt.id);
        setEditValues({
            qty: receipt.qty,
            costPerUnit: receipt.costPerUnit,
            notes: receipt.notes,
        });
    }, []);

    const cancelEdit = useCallback(() => {
        setEditingId(null);
        setEditValues({});
    }, []);

    const saveEdit = useCallback(() => {
        if (!editingId) return;
        updateMutation.mutate({
            id: editingId,
            ...editValues,
        });
    }, [editingId, editValues, updateMutation]);

    // Stats
    const stats = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayReceipts = receipts.filter((r) => {
            const date = new Date(r.createdAt);
            return date >= today;
        });

        const totalQty = receipts.reduce((sum, r) => sum + r.qty, 0);
        const totalValue = receipts.reduce((sum, r) => sum + r.qty * (r.costPerUnit ?? 0), 0);

        return {
            totalReceipts: receipts.length,
            todayReceipts: todayReceipts.length,
            totalQty: totalQty.toFixed(2),
            totalValue: totalValue.toFixed(0),
        };
    }, [receipts]);

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6">
            <div className="max-w-6xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-100 rounded-lg">
                            <Package className="w-6 h-6 text-green-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Fabric Receipt Entry</h1>
                            <p className="text-sm text-gray-500">Record fabric received from suppliers</p>
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="hidden md:flex items-center gap-6 text-sm">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-green-600">{stats.todayReceipts}</div>
                            <div className="text-gray-500">Today</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-blue-600">{stats.totalQty}m</div>
                            <div className="text-gray-500">Last {daysFilter}d</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-gray-700">₹{stats.totalValue}</div>
                            <div className="text-gray-500">Value</div>
                        </div>
                    </div>
                </div>

                {/* Messages */}
                {successMessage && (
                    <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
                        <Check className="w-5 h-5" />
                        <span>{successMessage}</span>
                    </div>
                )}

                {errorMessage && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
                        <AlertCircle className="w-5 h-5" />
                        <span>{errorMessage}</span>
                    </div>
                )}

                {/* Entry Form */}
                <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-xl shadow-sm border p-6">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4">New Receipt</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Fabric Colour */}
                        <FabricColourField
                            control={control}
                            fabricColours={fabricColours}
                            error={errors.fabricColourId?.message}
                        />

                        {/* Quantity */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">
                                Quantity <span className="text-red-500">*</span>
                            </label>
                            <div className="flex gap-2">
                                <Controller
                                    name="qty"
                                    control={control}
                                    render={({ field }) => (
                                        <input
                                            {...field}
                                            ref={qtyInputRef}
                                            type="number"
                                            step="0.01"
                                            placeholder="0.00"
                                            className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                                errors.qty ? 'border-red-300' : 'border-gray-300'
                                            }`}
                                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                                            value={field.value ?? ''}
                                        />
                                    )}
                                />
                                <Controller
                                    name="unit"
                                    control={control}
                                    render={({ field }) => (
                                        <select {...field} className="w-24 px-2 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                                            <option value="meter">meter</option>
                                            <option value="kg">kg</option>
                                            <option value="yard">yard</option>
                                        </select>
                                    )}
                                />
                            </div>
                            {errors.qty && <p className="text-xs text-red-600">{errors.qty.message}</p>}
                        </div>

                        {/* Cost per Unit */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">Cost per Unit</label>
                            <Controller
                                name="costPerUnit"
                                control={control}
                                render={({ field }) => (
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">₹</span>
                                        <input
                                            {...field}
                                            type="number"
                                            step="0.01"
                                            placeholder="0.00"
                                            className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                            value={field.value ?? ''}
                                        />
                                    </div>
                                )}
                            />
                        </div>

                        {/* Supplier */}
                        <SupplierField control={control} suppliers={suppliers} queryClient={queryClient} />

                        {/* Notes */}
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-sm font-medium text-gray-700">Notes</label>
                            <Controller
                                name="notes"
                                control={control}
                                render={({ field }) => (
                                    <input
                                        {...field}
                                        type="text"
                                        placeholder="Optional notes..."
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        value={field.value ?? ''}
                                    />
                                )}
                            />
                        </div>
                    </div>

                    {/* Submit Button */}
                    <div className="mt-6 flex justify-end">
                        <button
                            type="submit"
                            disabled={isSubmitting || createMutation.isPending}
                            className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Plus className="w-5 h-5" />
                            {createMutation.isPending ? 'Recording...' : 'Record Receipt'}
                        </button>
                    </div>
                </form>

                {/* Recent Receipts */}
                <div className="bg-white rounded-xl shadow-sm border">
                    <div className="p-4 border-b flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-gray-800">Recent Receipts</h2>
                        <div className="flex items-center gap-2">
                            <select
                                value={daysFilter}
                                onChange={(e) => setDaysFilter(parseInt(e.target.value))}
                                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value={1}>Today</option>
                                <option value={7}>Last 7 days</option>
                                <option value={30}>Last 30 days</option>
                            </select>
                        </div>
                    </div>

                    {receiptsLoading ? (
                        <div className="p-8 text-center text-gray-500">Loading receipts...</div>
                    ) : receipts.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">No receipts in the selected period</div>
                    ) : (
                        <div className="divide-y">
                            {receipts.map((receipt) => (
                                <ReceiptRow
                                    key={receipt.id}
                                    receipt={receipt}
                                    isEditing={editingId === receipt.id}
                                    editValues={editingId === receipt.id ? editValues : undefined}
                                    onStartEdit={() => startEdit(receipt)}
                                    onCancelEdit={cancelEdit}
                                    onSaveEdit={saveEdit}
                                    onEditChange={setEditValues}
                                    onDelete={() => deleteMutation.mutate(receipt.id)}
                                    isAdmin={isAdmin}
                                    isSaving={updateMutation.isPending}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ============================================
// FABRIC COLOUR FIELD COMPONENT
// ============================================

interface FabricColourFieldProps {
    control: ReturnType<typeof useForm<CreateFabricReceiptInput>>['control'];
    fabricColours: FabricColour[];
    error?: string;
}

function FabricColourField({ control, fabricColours, error }: FabricColourFieldProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');

    // Filter colours based on search
    const filteredColours = useMemo(() => {
        if (!search.trim()) return fabricColours;
        const query = search.toLowerCase();
        return fabricColours.filter(
            (fc) =>
                fc.name.toLowerCase().includes(query) ||
                fc.fabricName.toLowerCase().includes(query) ||
                fc.materialName.toLowerCase().includes(query)
        );
    }, [fabricColours, search]);

    // Group filtered colours by fabric name
    const groupedColours = useMemo(() => {
        const groups: Record<string, FabricColour[]> = {};
        for (const fc of filteredColours) {
            const key = fc.fabricName;
            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(fc);
        }
        return groups;
    }, [filteredColours]);

    return (
        <Controller
            name="fabricColourId"
            control={control}
            render={({ field }) => {
                const selected = fabricColours.find((fc) => fc.id === field.value);

                return (
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">
                            Fabric Colour <span className="text-red-500">*</span>
                        </label>

                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setIsOpen(!isOpen)}
                                className={`w-full flex items-center justify-between gap-2 px-3 py-2 border rounded-lg text-sm text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    error ? 'border-red-300' : 'border-gray-300'
                                } ${isOpen ? 'ring-2 ring-blue-500' : ''}`}
                            >
                                {selected ? (
                                    <div className="flex items-center gap-2 min-w-0">
                                        <ColorSwatch color={selected.hex} size="sm" />
                                        <span className="truncate">
                                            {selected.fabricName}
                                            <span className="text-gray-400 mx-1">·</span>
                                            {selected.name}
                                        </span>
                                    </div>
                                ) : (
                                    <span className="text-gray-400">Select fabric colour...</span>
                                )}
                                <ChevronsUpDown size={16} className="text-gray-400 flex-shrink-0" />
                            </button>

                            {isOpen && (
                                <>
                                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                                        <div className="p-2 border-b">
                                            <div className="relative">
                                                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                                                <input
                                                    type="text"
                                                    value={search}
                                                    onChange={(e) => setSearch(e.target.value)}
                                                    placeholder="Search..."
                                                    className="w-full pl-7 pr-7 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                    autoFocus
                                                />
                                                {search && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setSearch('')}
                                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="max-h-60 overflow-y-auto">
                                            {filteredColours.length === 0 ? (
                                                <div className="px-3 py-4 text-sm text-gray-500 text-center">
                                                    No fabric colours found
                                                </div>
                                            ) : (
                                                Object.entries(groupedColours).map(([fabricName, colours]) => (
                                                    <div key={fabricName}>
                                                        {/* Fabric group header */}
                                                        <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0">
                                                            {fabricName}
                                                        </div>
                                                        {/* Colour options */}
                                                        {colours.map((fc) => (
                                                            <button
                                                                key={fc.id}
                                                                type="button"
                                                                onClick={() => {
                                                                    field.onChange(fc.id);
                                                                    setIsOpen(false);
                                                                    setSearch('');
                                                                }}
                                                                className={`w-full flex items-center gap-2 px-3 py-2 pl-5 text-sm text-left hover:bg-gray-50 ${
                                                                    field.value === fc.id ? 'bg-blue-50' : ''
                                                                }`}
                                                            >
                                                                <ColorSwatch color={fc.hex} size="sm" />
                                                                <span className="flex-1 truncate">{fc.name}</span>
                                                                {/* Product thumbnails */}
                                                                {fc.productImages && fc.productImages.length > 0 && (
                                                                    <div className="flex -space-x-1">
                                                                        {fc.productImages.map((img, idx) => (
                                                                            <img
                                                                                key={idx}
                                                                                src={getOptimizedImageUrl(img, 'xs') || img}
                                                                                alt=""
                                                                                className="w-6 h-6 rounded border border-white object-cover"
                                                                                loading="lazy"
                                                                            />
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                {field.value === fc.id && <Check size={16} className="text-blue-600" />}
                                                            </button>
                                                        ))}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                    <div className="fixed inset-0 z-40" onClick={() => { setIsOpen(false); setSearch(''); }} />
                                </>
                            )}
                        </div>

                        {error && <p className="text-xs text-red-600">{error}</p>}
                    </div>
                );
            }}
        />
    );
}

// ============================================
// SUPPLIER FIELD COMPONENT
// ============================================

interface SupplierFieldProps {
    control: ReturnType<typeof useForm<CreateFabricReceiptInput>>['control'];
    suppliers: Party[];
    queryClient: ReturnType<typeof useQueryClient>;
}

function SupplierField({ control, suppliers, queryClient }: SupplierFieldProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [newSupplierName, setNewSupplierName] = useState('');

    const createSupplierMutation = useMutation({
        mutationFn: (name: string) => createParty({ data: { name } }),
        onSuccess: (result: { success: boolean }) => {
            if (result.success) {
                queryClient.invalidateQueries({ queryKey: ['parties'] });
                setIsCreating(false);
                setNewSupplierName('');
            }
        },
    });

    const filteredSuppliers = useMemo(() => {
        if (!search.trim()) return suppliers;
        const query = search.toLowerCase();
        return suppliers.filter((s) => s.name.toLowerCase().includes(query));
    }, [suppliers, search]);

    return (
        <Controller
            name="partyId"
            control={control}
            render={({ field }) => {
                const selected = suppliers.find((s) => s.id === field.value);

                return (
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Supplier</label>

                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setIsOpen(!isOpen)}
                                className={`w-full flex items-center justify-between gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    isOpen ? 'ring-2 ring-blue-500' : ''
                                }`}
                            >
                                {selected ? (
                                    <span className="truncate">{selected.name}</span>
                                ) : (
                                    <span className="text-gray-400">Select supplier...</span>
                                )}
                                <ChevronsUpDown size={16} className="text-gray-400 flex-shrink-0" />
                            </button>

                            {isOpen && (
                                <>
                                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                                        <div className="p-2 border-b">
                                            <div className="relative">
                                                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                                                <input
                                                    type="text"
                                                    value={search}
                                                    onChange={(e) => setSearch(e.target.value)}
                                                    placeholder="Search suppliers..."
                                                    className="w-full pl-7 pr-3 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                    autoFocus
                                                />
                                            </div>
                                        </div>

                                        <div className="max-h-48 overflow-y-auto">
                                            {filteredSuppliers.length === 0 && !isCreating ? (
                                                <div className="px-3 py-4 text-sm text-gray-500 text-center">
                                                    No suppliers found
                                                </div>
                                            ) : (
                                                filteredSuppliers.map((s) => (
                                                    <button
                                                        key={s.id}
                                                        type="button"
                                                        onClick={() => {
                                                            field.onChange(s.id);
                                                            setIsOpen(false);
                                                            setSearch('');
                                                        }}
                                                        className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-gray-50 ${
                                                            field.value === s.id ? 'bg-blue-50' : ''
                                                        }`}
                                                    >
                                                        <span>{s.name}</span>
                                                        {field.value === s.id && <Check size={16} className="text-blue-600" />}
                                                    </button>
                                                ))
                                            )}
                                        </div>

                                        {/* Add New Supplier */}
                                        <div className="p-2 border-t">
                                            {isCreating ? (
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={newSupplierName}
                                                        onChange={(e) => setNewSupplierName(e.target.value)}
                                                        placeholder="Supplier name"
                                                        className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                        autoFocus
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (newSupplierName.trim()) {
                                                                createSupplierMutation.mutate(newSupplierName.trim());
                                                            }
                                                        }}
                                                        disabled={!newSupplierName.trim() || createSupplierMutation.isPending}
                                                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                                    >
                                                        {createSupplierMutation.isPending ? '...' : 'Add'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setIsCreating(false);
                                                            setNewSupplierName('');
                                                        }}
                                                        className="px-2 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setIsCreating(true)}
                                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded"
                                                >
                                                    <Plus size={16} />
                                                    Add New Supplier
                                                </button>
                                            )}
                                        </div>

                                        {/* Clear Selection */}
                                        {field.value && (
                                            <div className="p-2 border-t">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        field.onChange(null);
                                                        setIsOpen(false);
                                                    }}
                                                    className="w-full px-3 py-1.5 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded"
                                                >
                                                    Clear selection
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <div className="fixed inset-0 z-40" onClick={() => { setIsOpen(false); setSearch(''); setIsCreating(false); }} />
                                </>
                            )}
                        </div>
                    </div>
                );
            }}
        />
    );
}

// ============================================
// RECEIPT ROW COMPONENT
// ============================================

interface ReceiptRowProps {
    receipt: FabricReceiptTransaction;
    isEditing: boolean;
    editValues?: { qty?: number; costPerUnit?: number | null; notes?: string | null };
    onStartEdit: () => void;
    onCancelEdit: () => void;
    onSaveEdit: () => void;
    onEditChange: (values: { qty?: number; costPerUnit?: number | null; notes?: string | null }) => void;
    onDelete: () => void;
    isAdmin: boolean;
    isSaving: boolean;
}

function ReceiptRow({
    receipt,
    isEditing,
    editValues,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onEditChange,
    onDelete,
    isAdmin,
    isSaving,
}: ReceiptRowProps) {
    const dateStr = useMemo(() => {
        const date = new Date(receipt.createdAt);
        return date.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    }, [receipt.createdAt]);

    return (
        <div className="p-4 hover:bg-gray-50 transition-colors">
            <div className="flex items-start gap-4">
                {/* Colour Swatch */}
                <div
                    className="w-10 h-10 rounded-lg border border-gray-200 flex-shrink-0"
                    style={{ backgroundColor: receipt.fabricColour.colourHex || '#e5e7eb' }}
                />

                {/* Main Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="font-medium text-gray-900">{receipt.fabricColour.colourName}</div>
                            <div className="text-sm text-gray-500">
                                {receipt.fabricColour.fabric.material?.name} → {receipt.fabricColour.fabric.name}
                            </div>
                        </div>

                        {/* Quantity & Cost */}
                        <div className="text-right">
                            {isEditing ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={editValues?.qty ?? ''}
                                        onChange={(e) =>
                                            onEditChange({
                                                ...editValues,
                                                qty: e.target.value ? parseFloat(e.target.value) : undefined,
                                            })
                                        }
                                        className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-right"
                                    />
                                    <span className="text-sm text-gray-500">{receipt.unit}</span>
                                </div>
                            ) : (
                                <div className="text-lg font-semibold text-green-600">
                                    +{receipt.qty} {receipt.unit}
                                </div>
                            )}

                            {isEditing ? (
                                <div className="flex items-center gap-1 mt-1">
                                    <span className="text-sm text-gray-400">₹</span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={editValues?.costPerUnit ?? ''}
                                        onChange={(e) =>
                                            onEditChange({
                                                ...editValues,
                                                costPerUnit: e.target.value ? parseFloat(e.target.value) : null,
                                            })
                                        }
                                        placeholder="0.00"
                                        className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-right"
                                    />
                                    <span className="text-sm text-gray-400">/unit</span>
                                </div>
                            ) : receipt.costPerUnit ? (
                                <div className="text-sm text-gray-500">₹{receipt.costPerUnit}/unit</div>
                            ) : null}
                        </div>
                    </div>

                    {/* Meta info */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                        <span>{dateStr}</span>
                        {receipt.party && (
                            <>
                                <span>•</span>
                                <span>{receipt.party.name}</span>
                            </>
                        )}
                        {receipt.createdBy && (
                            <>
                                <span>•</span>
                                <span>by {receipt.createdBy.name}</span>
                            </>
                        )}
                    </div>

                    {/* Notes */}
                    {isEditing ? (
                        <div className="mt-2">
                            <input
                                type="text"
                                value={editValues?.notes ?? ''}
                                onChange={(e) =>
                                    onEditChange({
                                        ...editValues,
                                        notes: e.target.value || null,
                                    })
                                }
                                placeholder="Notes..."
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                    ) : receipt.notes ? (
                        <div className="mt-1 text-sm text-gray-600 italic">{receipt.notes}</div>
                    ) : null}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                    {isEditing ? (
                        <>
                            <button
                                type="button"
                                onClick={onSaveEdit}
                                disabled={isSaving}
                                className="p-2 text-green-600 hover:bg-green-50 rounded-lg disabled:opacity-50"
                                title="Save"
                            >
                                <Check size={18} />
                            </button>
                            <button
                                type="button"
                                onClick={onCancelEdit}
                                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                                title="Cancel"
                            >
                                <X size={18} />
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={onStartEdit}
                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                                title="Edit"
                            >
                                <Pencil size={18} />
                            </button>
                            {isAdmin && (
                                <button
                                    type="button"
                                    onClick={onDelete}
                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                    title="Delete"
                                >
                                    <Trash2 size={18} />
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
