import React, { useState, useMemo, useCallback } from 'react';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { X, Trash2, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);
import { getParties } from '@/server/functions/materialsMutations';
import type { Party } from '@/server/functions/materialsMutations';
import {
    getAllFabricColourTransactions,
} from '@/server/functions/fabricColours';
import {
    createFabricColourTransaction,
    deleteFabricColourTransaction,
} from '@/server/functions/fabricColourMutations';
import { getCatalogFilters } from '../../server/functions/products';
import { useAuth } from '../../hooks/useAuth';
import { fmt, fmtInt, type TxnRow } from './shared';

// ── Cell Renderers ──────────────────────────────────────────

const ColourCellRenderer = React.memo(function ColourCellRenderer(
    params: ICellRendererParams<TxnRow>
) {
    const row = params.data;
    if (!row) return null;
    const hex = row.fabricColour.colourHex;
    return (
        <div className="flex items-center gap-2">
            {hex && (
                <span
                    className="inline-block h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-slate-200"
                    style={{ backgroundColor: hex }}
                />
            )}
            <span>{row.fabricColour.colourName}</span>
        </div>
    );
});

const TypeBadgeCellRenderer = React.memo(function TypeBadgeCellRenderer(
    params: ICellRendererParams<TxnRow>
) {
    const txnType = params.data?.txnType;
    if (!txnType) return null;
    const isIn = txnType === 'inward';
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                isIn ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            )}
        >
            {isIn ? 'In' : 'Out'}
        </span>
    );
});

// ── Main Tab ────────────────────────────────────────────────

export default function TransactionsTab() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    // Filter state
    const [typeFilter, setTypeFilter] = useState<'all' | 'inward' | 'outward'>('all');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [searchText, setSearchText] = useState('');
    const [supplierFilter, setSupplierFilter] = useState('');
    const [page, setPage] = useState(0);
    const pageSize = 100;

    // Record inward modal
    const [showRecordInward, setShowRecordInward] = useState(false);
    const [inwardForm, setInwardForm] = useState({
        fabricColourId: '', qty: '', unit: 'meter' as 'meter' | 'kg' | 'yard',
        reason: 'supplier_receipt', costPerUnit: '', partyId: '', notes: '',
    });

    // Confirm delete
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    // Server functions
    const getAllTxnsFn = useServerFn(getAllFabricColourTransactions);
    const createTxnFn = useServerFn(createFabricColourTransaction);
    const deleteTxnFn = useServerFn(deleteFabricColourTransaction);
    const getPartiesFn = useServerFn(getParties);
    const getCatalogFiltersFn = useServerFn(getCatalogFilters);

    // Build server params (only server-supported filters)
    const serverParams = useMemo(() => ({
        limit: pageSize,
        offset: page * pageSize,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
    }), [page, startDate, endDate]);

    // Fetch transactions
    const { data: txnData, isLoading } = useQuery({
        queryKey: ['materials', 'transactions', 'getAllFabricColourTransactions', serverParams],
        queryFn: () => getAllTxnsFn({ data: serverParams }),
    });

    // Fetch parties
    const { data: partiesData } = useQuery({
        queryKey: ['parties'],
        queryFn: () => getPartiesFn(),
    });
    const parties: Party[] = partiesData?.parties ?? [];

    // Fetch catalog filters for fabric colour picker
    const { data: catalogData } = useQuery({
        queryKey: ['catalogFilters'],
        queryFn: () => getCatalogFiltersFn(),
        enabled: showRecordInward,
    });
    const fabricColours = catalogData?.fabricColours ?? [];

    // Client-side filtering (type, search, supplier)
    const filteredTransactions = useMemo(() => {
        const txns = (txnData?.transactions ?? []) as TxnRow[];
        return txns.filter((txn) => {
            if (typeFilter !== 'all' && txn.txnType !== typeFilter) return false;
            if (supplierFilter && txn.partyId !== supplierFilter) return false;
            if (searchText) {
                const q = searchText.toLowerCase();
                const matchesColour = txn.fabricColour.colourName.toLowerCase().includes(q);
                const matchesFabric = txn.fabricColour.fabric.name.toLowerCase().includes(q);
                const matchesMaterial = txn.fabricColour.fabric.material?.name.toLowerCase().includes(q) ?? false;
                if (!matchesColour && !matchesFabric && !matchesMaterial) return false;
            }
            return true;
        });
    }, [txnData?.transactions, typeFilter, supplierFilter, searchText]);

    // Stats
    const stats = useMemo(() => {
        const txns = filteredTransactions;
        let totalInward = 0;
        let totalOutward = 0;
        const colourSet = new Set<string>();
        for (const txn of txns) {
            if (txn.txnType === 'inward') totalInward += txn.qty;
            else totalOutward += txn.qty;
            colourSet.add(txn.fabricColourId);
        }
        return {
            total: txns.length,
            totalInward,
            totalOutward,
            distinctColours: colourSet.size,
        };
    }, [filteredTransactions]);

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: (txnId: string) => deleteTxnFn({ data: { txnId } }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['allFabricColourTransactions'] });
            queryClient.invalidateQueries({ queryKey: ['materials', 'transactions'] });
            queryClient.invalidateQueries({ queryKey: ['fabricReceipts'] });
            queryClient.invalidateQueries({ queryKey: ['materialsTree'] });
            setDeleteConfirmId(null);
        },
        onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : 'Failed to delete';
            alert(msg);
        },
    });

    // Create mutation
    const createMutation = useMutation({
        mutationFn: (data: {
            fabricColourId: string;
            txnType: 'inward' | 'outward';
            qty: number;
            unit: 'meter' | 'kg' | 'yard';
            reason: string;
            costPerUnit?: number | null;
            partyId?: string | null;
            notes?: string | null;
        }) => createTxnFn({ data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['allFabricColourTransactions'] });
            queryClient.invalidateQueries({ queryKey: ['materials', 'transactions'] });
            queryClient.invalidateQueries({ queryKey: ['fabricReceipts'] });
            queryClient.invalidateQueries({ queryKey: ['materialsTree'] });
            setShowRecordInward(false);
            setInwardForm({
                fabricColourId: '', qty: '', unit: 'meter', reason: 'supplier_receipt',
                costPerUnit: '', partyId: '', notes: '',
            });
        },
        onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : 'Failed to create transaction';
            alert(msg);
        },
    });

    const handleSubmitInward = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (!inwardForm.fabricColourId || !inwardForm.qty) return;
        createMutation.mutate({
            fabricColourId: inwardForm.fabricColourId,
            txnType: 'inward',
            qty: parseFloat(inwardForm.qty),
            unit: inwardForm.unit,
            reason: inwardForm.reason,
            ...(inwardForm.costPerUnit ? { costPerUnit: parseFloat(inwardForm.costPerUnit) } : {}),
            ...(inwardForm.partyId ? { partyId: inwardForm.partyId } : {}),
            ...(inwardForm.notes ? { notes: inwardForm.notes } : {}),
        });
    }, [inwardForm, createMutation]);

    const handleDelete = useCallback((id: string) => {
        setDeleteConfirmId(id);
    }, []);

    const confirmDelete = useCallback(() => {
        if (deleteConfirmId) {
            deleteMutation.mutate(deleteConfirmId);
        }
    }, [deleteConfirmId, deleteMutation]);

    // AG-Grid column defs
    const columnDefs = useMemo((): ColDef<TxnRow>[] => [
        {
            headerName: 'Date',
            field: 'createdAt',
            width: 140,
            valueFormatter: (params) => {
                if (!params.value) return '';
                return new Date(params.value).toLocaleDateString('en-IN', {
                    day: '2-digit', month: 'short', year: 'numeric',
                });
            },
            sortable: true,
        },
        {
            headerName: 'Material',
            width: 120,
            valueGetter: (params) => params.data?.fabricColour.fabric.material?.name ?? '--',
            sortable: true,
        },
        {
            headerName: 'Fabric',
            width: 130,
            valueGetter: (params) => params.data?.fabricColour.fabric.name ?? '--',
            sortable: true,
        },
        {
            headerName: 'Colour',
            width: 150,
            cellRenderer: ColourCellRenderer,
            valueGetter: (params) => params.data?.fabricColour.colourName ?? '',
            sortable: true,
        },
        {
            headerName: 'Type',
            width: 80,
            cellRenderer: TypeBadgeCellRenderer,
            valueGetter: (params) => params.data?.txnType ?? '',
            sortable: true,
        },
        {
            headerName: 'Qty',
            width: 100,
            valueGetter: (params) => {
                if (!params.data) return '';
                return `${fmt(params.data.qty)} ${params.data.unit}`;
            },
            sortable: true,
        },
        {
            headerName: 'Reason',
            field: 'reason',
            width: 140,
            valueFormatter: (params) => {
                if (!params.value) return '';
                return String(params.value).replace(/_/g, ' ');
            },
        },
        {
            headerName: 'Cost/Unit',
            field: 'costPerUnit',
            width: 100,
            valueFormatter: (params) => params.value != null ? `₹${fmt(params.value)}` : '--',
            sortable: true,
        },
        {
            headerName: 'Supplier',
            width: 130,
            valueGetter: (params) => params.data?.party?.name ?? '--',
            sortable: true,
        },
        {
            headerName: 'Created By',
            width: 120,
            valueGetter: (params) => params.data?.createdBy?.name ?? '--',
        },
        ...(isAdmin ? [{
            headerName: '',
            width: 50,
            cellRenderer: (params: ICellRendererParams<TxnRow>) => {
                if (!params.data) return null;
                return (
                    <button
                        type="button"
                        onClick={() => handleDelete(params.data!.id)}
                        className="text-red-400 hover:text-red-600 transition-colors p-1"
                        title="Delete transaction"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                );
            },
            sortable: false,
            filter: false,
        } as ColDef<TxnRow>] : []),
    ], [isAdmin, handleDelete]);

    const defaultColDef = useMemo((): ColDef => ({
        resizable: true,
        suppressMovable: true,
    }), []);

    const totalPages = Math.ceil((txnData?.total ?? 0) / pageSize);

    return (
        <>
            <div className="flex flex-col gap-4 overflow-auto p-6" style={{ height: 'calc(100vh - 120px)' }}>
                {/* Header with Record Inward button */}
                <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-800">Fabric Colour Transactions</h2>
                    <button
                        type="button"
                        onClick={() => setShowRecordInward(true)}
                        className="btn-primary flex items-center gap-1.5 text-sm"
                    >
                        <Plus className="h-4 w-4" />
                        Record Inward
                    </button>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div className="rounded-xl bg-slate-50 p-4 shadow-sm ring-1 ring-slate-200">
                        <div className="text-xs font-medium text-slate-500">Total Transactions</div>
                        <div className="mt-1 text-2xl font-bold text-slate-900">{fmtInt(stats.total)}</div>
                    </div>
                    <div className="rounded-xl bg-green-50 p-4 shadow-sm ring-1 ring-green-100">
                        <div className="text-xs font-medium text-green-700">Total Inward</div>
                        <div className="mt-1 text-2xl font-bold text-green-900">{fmt(stats.totalInward)}</div>
                    </div>
                    <div className="rounded-xl bg-red-50 p-4 shadow-sm ring-1 ring-red-100">
                        <div className="text-xs font-medium text-red-700">Total Outward</div>
                        <div className="mt-1 text-2xl font-bold text-red-900">{fmt(stats.totalOutward)}</div>
                    </div>
                    <div className="rounded-xl bg-blue-50 p-4 shadow-sm ring-1 ring-blue-100">
                        <div className="text-xs font-medium text-blue-700">Distinct Colours</div>
                        <div className="mt-1 text-2xl font-bold text-blue-900">{fmtInt(stats.distinctColours)}</div>
                    </div>
                </div>

                {/* Filter Bar */}
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
                    <select
                        className="input w-32 text-sm"
                        value={typeFilter}
                        onChange={(e) => { setTypeFilter(e.target.value as 'all' | 'inward' | 'outward'); setPage(0); }}
                    >
                        <option value="all">All Types</option>
                        <option value="inward">Inward</option>
                        <option value="outward">Outward</option>
                    </select>
                    <input
                        type="date"
                        className="input w-36 text-sm"
                        value={startDate}
                        onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
                        placeholder="Start date"
                    />
                    <input
                        type="date"
                        className="input w-36 text-sm"
                        value={endDate}
                        onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
                        placeholder="End date"
                    />
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            className="input w-48 pl-8 text-sm"
                            value={searchText}
                            onChange={(e) => { setSearchText(e.target.value); setPage(0); }}
                            placeholder="Search colour/fabric..."
                        />
                    </div>
                    <select
                        className="input w-40 text-sm"
                        value={supplierFilter}
                        onChange={(e) => { setSupplierFilter(e.target.value); setPage(0); }}
                    >
                        <option value="">All Suppliers</option>
                        {parties.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                    {(typeFilter !== 'all' || startDate || endDate || searchText || supplierFilter) && (
                        <button
                            type="button"
                            onClick={() => {
                                setTypeFilter('all');
                                setStartDate('');
                                setEndDate('');
                                setSearchText('');
                                setSupplierFilter('');
                                setPage(0);
                            }}
                            className="text-xs text-slate-500 hover:text-slate-700 underline"
                        >
                            Clear filters
                        </button>
                    )}
                </div>

                {/* AG-Grid Table */}
                <div className="ag-theme-alpine flex-1 rounded-xl bg-white shadow-sm ring-1 ring-slate-200" style={{ minHeight: '400px' }}>
                    <AgGridReact<TxnRow>
                        rowData={filteredTransactions}
                        columnDefs={columnDefs}
                        defaultColDef={defaultColDef}
                        rowHeight={36}
                        headerHeight={38}
                        loading={isLoading}
                        overlayNoRowsTemplate="No transactions found"
                        suppressCellFocus
                        animateRows={false}
                    />
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between text-sm text-slate-600">
                        <span>
                            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, txnData?.total ?? 0)} of {fmtInt(txnData?.total ?? 0)}
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                disabled={page === 0}
                                onClick={() => setPage(p => p - 1)}
                                className="rounded border px-3 py-1 text-sm disabled:opacity-40 hover:bg-slate-50"
                            >
                                Prev
                            </button>
                            <span>Page {page + 1} of {totalPages}</span>
                            <button
                                type="button"
                                disabled={page >= totalPages - 1}
                                onClick={() => setPage(p => p + 1)}
                                className="rounded border px-3 py-1 text-sm disabled:opacity-40 hover:bg-slate-50"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Record Inward Modal */}
            {showRecordInward && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Record Inward</h2>
                            <button onClick={() => setShowRecordInward(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmitInward} className="space-y-4">
                            <div>
                                <label className="label">Fabric Colour *</label>
                                <select
                                    className="input"
                                    value={inwardForm.fabricColourId}
                                    onChange={(e) => setInwardForm(f => ({ ...f, fabricColourId: e.target.value }))}
                                    required
                                >
                                    <option value="">Select fabric colour...</option>
                                    {fabricColours.map((fc) => (
                                        <option key={fc.id} value={fc.id}>
                                            {fc.materialName} &gt; {fc.fabricName} &gt; {fc.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="label">Quantity *</label>
                                    <input
                                        className="input"
                                        type="number"
                                        step="0.01"
                                        value={inwardForm.qty}
                                        onChange={(e) => setInwardForm(f => ({ ...f, qty: e.target.value }))}
                                        placeholder="0.00"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Unit</label>
                                    <select
                                        className="input"
                                        value={inwardForm.unit}
                                        onChange={(e) => setInwardForm(f => ({ ...f, unit: e.target.value as 'meter' | 'kg' | 'yard' }))}
                                    >
                                        <option value="meter">Meter</option>
                                        <option value="kg">Kg</option>
                                        <option value="yard">Yard</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Reason</label>
                                <select
                                    className="input"
                                    value={inwardForm.reason}
                                    onChange={(e) => setInwardForm(f => ({ ...f, reason: e.target.value }))}
                                >
                                    <option value="supplier_receipt">Supplier Receipt</option>
                                    <option value="return">Return</option>
                                    <option value="transfer_in">Transfer In</option>
                                    <option value="adjustment">Adjustment</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                            <div>
                                <label className="label">Cost/Unit (INR, optional)</label>
                                <input
                                    className="input"
                                    type="number"
                                    step="0.01"
                                    value={inwardForm.costPerUnit}
                                    onChange={(e) => setInwardForm(f => ({ ...f, costPerUnit: e.target.value }))}
                                    placeholder="0.00"
                                />
                            </div>
                            <div>
                                <label className="label">Supplier</label>
                                <select
                                    className="input"
                                    value={inwardForm.partyId}
                                    onChange={(e) => setInwardForm(f => ({ ...f, partyId: e.target.value }))}
                                >
                                    <option value="">Select supplier...</option>
                                    {parties.map((p) => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="label">Notes (optional)</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    value={inwardForm.notes}
                                    onChange={(e) => setInwardForm(f => ({ ...f, notes: e.target.value }))}
                                    placeholder="Invoice ref, quality notes..."
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowRecordInward(false)} className="btn-secondary flex-1">
                                    Cancel
                                </button>
                                <button type="submit" className="btn-primary flex-1" disabled={createMutation.isPending}>
                                    {createMutation.isPending ? 'Adding...' : 'Record Inward'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            {deleteConfirmId && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-sm">
                        <h3 className="text-lg font-semibold mb-2">Confirm Delete</h3>
                        <p className="text-sm text-slate-600 mb-4">
                            Are you sure you want to delete this transaction? This cannot be undone.
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => setDeleteConfirmId(null)}
                                className="btn-secondary flex-1"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmDelete}
                                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                                disabled={deleteMutation.isPending}
                            >
                                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
