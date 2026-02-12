/**
 * Ledgers Page - Inventory Transaction Audit Interface
 *
 * PURPOSE: Primary audit interface for 134K+ inventory transactions.
 * Three tabs: Inward (stock received), Outward (stock dispatched), Materials (fabric txns).
 * Server-side search, filtering, and pagination.
 *
 * DATA SOURCE:
 * - Inward/Outward: getLedgerTransactions server function
 * - Materials: getAllFabricColourTransactions server function
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
    Search, Trash2, ChevronLeft, ChevronRight,
    ArrowDownCircle, ArrowUpCircle, FileSpreadsheet, Monitor,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { invalidateOrderView } from '../hooks/orders/orderMutationUtils';
import { Route } from '../routes/_authenticated/ledgers';
import type { LedgersLoaderData } from '../routes/_authenticated/ledgers';
import { useDebounce } from '../hooks/useDebounce';

// Server Functions
import { getLedgerTransactions, type LedgerTransactionItem, type LedgerTransactionsResult } from '../server/functions/inventory';
import { getAllFabricColourTransactions } from '../server/functions/fabricColours';
import { deleteTransaction as deleteInventoryTransaction } from '../server/functions/inventoryMutations';
import { deleteFabricColourTransaction } from '../server/functions/fabricColourMutations';

type Tab = 'inward' | 'outward' | 'materials';

// ============================================
// HELPER: Format number with commas
// ============================================

function formatNumber(n: number): string {
    return n.toLocaleString('en-IN');
}

// ============================================
// HELPER: Format reason for display
// ============================================

function formatReason(reason: string | null): string {
    if (!reason) return '-';
    return reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function Ledgers() {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    // Route state
    const loaderData = Route.useLoaderData() as LedgersLoaderData;
    const search = Route.useSearch();
    const activeTab = search.tab;
    const page = search.page;
    const limit = search.limit;

    // Local search input state with debounce
    const [searchInput, setSearchInput] = useState(search.search || '');
    const debouncedSearch = useDebounce(searchInput, 400);

    // Sync debounced search to URL (resets to page 1)
    useEffect(() => {
        const currentUrlSearch = search.search || '';
        if (debouncedSearch !== currentUrlSearch) {
            navigate({
                to: '/ledgers',
                search: {
                    ...search,
                    search: debouncedSearch || undefined,
                    page: 1,
                },
                replace: true,
            });
        }
    }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

    // Reset search input when tab changes
    useEffect(() => {
        setSearchInput(search.search || '');
    }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

    // URL navigation helper
    const setSearchParam = useCallback((updates: Partial<typeof search>) => {
        navigate({
            to: '/ledgers',
            search: { ...search, ...updates, page: 1 },
            replace: true,
        });
    }, [navigate, search]);

    const setPage = useCallback((newPage: number) => {
        navigate({
            to: '/ledgers',
            search: { ...search, page: newPage },
            replace: true,
        });
    }, [navigate, search]);

    // ============================================
    // INWARD/OUTWARD DATA (server-side pagination)
    // ============================================

    const offset = (page - 1) * limit;

    const { data: ledgerData, isLoading: ledgerLoading } = useQuery<LedgerTransactionsResult>({
        queryKey: ['ledgerTransactions', activeTab, search.search, search.reason, search.location, search.origin, page, limit],
        queryFn: () => getLedgerTransactions({
            data: {
                txnType: activeTab as 'inward' | 'outward',
                ...(search.search ? { search: search.search } : {}),
                ...(search.reason ? { reason: search.reason } : {}),
                ...(search.location ? { location: search.location } : {}),
                origin: search.origin,
                limit,
                offset,
            },
        }),
        enabled: activeTab !== 'materials',
        initialData: loaderData.ledger ?? undefined,
    });

    // ============================================
    // MATERIALS DATA (client-side, existing pattern)
    // ============================================

    interface FabricColourTransaction {
        id: string;
        fabricColour?: {
            colourName: string;
            colourHex?: string | null;
            fabric?: {
                name: string;
                material?: { name: string } | null;
            } | null;
        } | null;
        txnType: string;
        reason: string;
        createdAt: string;
        qty: number;
        unit: string;
        notes?: string | null;
        costPerUnit?: number | null;
        party?: { name: string } | null;
        createdBy?: { name: string } | null;
    }

    const { data: materialTxns, isLoading: materialsLoading } = useQuery<FabricColourTransaction[]>({
        queryKey: ['allFabricColourTransactions'],
        queryFn: async () => {
            const result = await getAllFabricColourTransactions({ data: { limit: 1000, days: 365 } });
            return result.transactions.map((t): FabricColourTransaction => ({
                id: t.id,
                txnType: t.txnType,
                reason: t.reason,
                createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(t.createdAt as Date).toISOString(),
                qty: Number(t.qty),
                unit: t.unit,
                notes: t.notes,
                costPerUnit: t.costPerUnit ? Number(t.costPerUnit) : null,
                fabricColour: t.fabricColour,
                party: t.party,
                createdBy: t.createdBy
            }));
        },
        enabled: activeTab === 'materials'
    });

    // Filter materials client-side (search only, no pagination needed for ~1K records)
    const filteredMaterials = materialTxns?.filter((txn) => {
        if (search.search) {
            const s = search.search.toLowerCase();
            const colourMatch = txn.fabricColour?.colourName?.toLowerCase().includes(s);
            const fabricMatch = txn.fabricColour?.fabric?.name?.toLowerCase().includes(s);
            const materialMatch = txn.fabricColour?.fabric?.material?.name?.toLowerCase().includes(s);
            if (!colourMatch && !fabricMatch && !materialMatch) return false;
        }
        return true;
    });

    // ============================================
    // DELETE MUTATIONS
    // ============================================

    const deleteInventoryTxnMutation = useMutation({
        mutationFn: async (txnId: string) => {
            const result = await deleteInventoryTransaction({ data: { transactionId: txnId } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to delete transaction');
            }
            return result;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['ledgerTransactions'] });
            queryClient.invalidateQueries({ queryKey: ['inventoryBalance'] });
            if (data?.data?.message?.includes('production')) {
                queryClient.invalidateQueries({ queryKey: ['productionBatches'] });
                queryClient.invalidateQueries({ queryKey: ['allFabricTransactions'] });
                queryClient.invalidateQueries({ queryKey: ['fabricStock'] });
            }
            if (data?.data?.message?.includes('allocation') || data?.data?.message?.includes('queue')) {
                invalidateOrderView(queryClient, 'open');
            }
        },
        onError: (err: Error) => alert(err.message || 'Failed to delete transaction')
    });

    const deleteMaterialsTxnMutation = useMutation({
        mutationFn: async (txnId: string) => {
            const result = await deleteFabricColourTransaction({ data: { txnId } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to delete transaction');
            }
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['allFabricColourTransactions'] });
            queryClient.invalidateQueries({ queryKey: ['fabricColourStock'] });
        },
        onError: (err: Error) => alert(err.message || 'Failed to delete transaction')
    });

    // ============================================
    // RENDER
    // ============================================

    const tabs: { key: Tab; label: string }[] = [
        { key: 'inward', label: 'Inward' },
        { key: 'outward', label: 'Outward' },
        { key: 'materials', label: 'Materials' },
    ];

    return (
        <div className="space-y-4 md:space-y-5">
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Ledgers</h1>

            {/* Tabs */}
            <div className="border-b border-gray-200">
                <nav className="flex gap-6">
                    {tabs.map(t => (
                        <button
                            key={t.key}
                            onClick={() => navigate({
                                to: '/ledgers',
                                search: { tab: t.key, page: 1, limit, origin: 'all' },
                            })}
                            className={`pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                                activeTab === t.key
                                    ? 'border-primary-600 text-primary-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </nav>
            </div>

            {/* Inward / Outward Tabs */}
            {activeTab !== 'materials' && (
                <InwardOutwardTab
                    data={ledgerData}
                    isLoading={ledgerLoading}
                    tab={activeTab}
                    search={search}
                    searchInput={searchInput}
                    setSearchInput={setSearchInput}
                    setSearchParam={setSearchParam}
                    page={page}
                    limit={limit}
                    setPage={setPage}
                    isAdmin={isAdmin}
                    onDelete={(id) => {
                        if (confirm('Delete this transaction? This will affect inventory balances.')) {
                            deleteInventoryTxnMutation.mutate(id);
                        }
                    }}
                />
            )}

            {/* Materials Tab */}
            {activeTab === 'materials' && (
                <MaterialsTab
                    data={filteredMaterials}
                    isLoading={materialsLoading}
                    searchInput={searchInput}
                    setSearchInput={setSearchInput}
                    isAdmin={isAdmin}
                    onDelete={(id) => {
                        if (confirm('Delete this fabric transaction?')) {
                            deleteMaterialsTxnMutation.mutate(id);
                        }
                    }}
                />
            )}
        </div>
    );
}

// ============================================
// INWARD/OUTWARD TAB COMPONENT
// ============================================

interface InwardOutwardTabProps {
    data: LedgerTransactionsResult | undefined;
    isLoading: boolean;
    tab: 'inward' | 'outward';
    search: {
        tab: string;
        search?: string;
        reason?: string;
        location?: string;
        origin: string;
        page: number;
        limit: number;
    };
    searchInput: string;
    setSearchInput: (v: string) => void;
    setSearchParam: (updates: Record<string, string | number | undefined>) => void;
    page: number;
    limit: number;
    setPage: (p: number) => void;
    isAdmin: boolean;
    onDelete: (id: string) => void;
}

function InwardOutwardTab({
    data, isLoading, tab, search, searchInput, setSearchInput,
    setSearchParam, page, limit, setPage, isAdmin, onDelete,
}: InwardOutwardTabProps) {
    const totalPages = data ? Math.ceil(data.pagination.total / limit) : 0;
    const locationLabel = tab === 'inward' ? 'Source' : 'Destination';

    return (
        <div className="space-y-4">
            {/* Filter Bar */}
            <div className="card flex flex-wrap gap-2 md:gap-3 items-center">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search SKU, product, order#..."
                        className="input pl-9 w-full"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                </div>

                {/* Reason filter */}
                <select
                    className="input w-auto max-w-[170px]"
                    value={search.reason || ''}
                    onChange={(e) => setSearchParam({ reason: e.target.value || undefined })}
                >
                    <option value="">All Reasons</option>
                    {data?.availableReasons.map(r => (
                        <option key={r} value={r}>{formatReason(r)}</option>
                    ))}
                </select>

                {/* Location filter */}
                <select
                    className="input w-auto max-w-[170px]"
                    value={search.location || ''}
                    onChange={(e) => setSearchParam({ location: e.target.value || undefined })}
                >
                    <option value="">All {locationLabel}s</option>
                    {data?.availableLocations.map(l => (
                        <option key={l} value={l}>{l}</option>
                    ))}
                </select>

                {/* Origin filter */}
                <select
                    className="input w-auto max-w-[140px]"
                    value={search.origin}
                    onChange={(e) => setSearchParam({ origin: e.target.value })}
                >
                    <option value="all">All Origin</option>
                    <option value="sheet">Sheet Only</option>
                    <option value="app">App Only</option>
                </select>
            </div>

            {/* Stats Row */}
            {data && !isLoading && (
                <div className="flex items-center gap-4 text-sm text-gray-600 px-1">
                    <span className="font-medium">{formatNumber(data.stats.totalCount)} txns</span>
                    <span className="text-gray-300">|</span>
                    <span className={tab === 'inward' ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                        {tab === 'inward' ? '+' : '-'}{formatNumber(data.stats.totalQty)} units
                    </span>
                    <span className="text-gray-300">|</span>
                    <span>{formatNumber(data.stats.distinctSkuCount)} SKUs</span>
                </div>
            )}

            {/* Table */}
            {isLoading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                </div>
            ) : !data || data.items.length === 0 ? (
                <div className="card text-center py-12 text-gray-500">No transactions found</div>
            ) : (
                <>
                    <div className="card p-0 overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                                    <th className="px-3 py-2.5">Date</th>
                                    <th className="px-3 py-2.5">SKU Code</th>
                                    <th className="px-3 py-2.5">Product</th>
                                    <th className="px-3 py-2.5">Color</th>
                                    <th className="px-3 py-2.5">Size</th>
                                    <th className="px-3 py-2.5 text-right">Qty</th>
                                    <th className="px-3 py-2.5">Reason</th>
                                    <th className="px-3 py-2.5">{locationLabel}</th>
                                    {tab === 'inward' && <th className="px-3 py-2.5">Performed By</th>}
                                    {tab === 'inward' && <th className="px-3 py-2.5">Tailor #</th>}
                                    {tab === 'inward' && <th className="px-3 py-2.5">Barcode</th>}
                                    {tab === 'outward' && <th className="px-3 py-2.5">Order #</th>}
                                    <th className="px-3 py-2.5">Origin</th>
                                    {isAdmin && <th className="px-3 py-2.5 w-10"></th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {data.items.map((txn) => (
                                    <LedgerRow
                                        key={txn.id}
                                        txn={txn}
                                        tab={tab}
                                        isAdmin={isAdmin}
                                        onDelete={onDelete}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <Pagination
                        page={page}
                        totalPages={totalPages}
                        total={data.pagination.total}
                        offset={data.pagination.offset}
                        itemCount={data.items.length}
                        setPage={setPage}
                    />
                </>
            )}
        </div>
    );
}

// ============================================
// LEDGER TABLE ROW
// ============================================

function LedgerRow({ txn, tab, isAdmin, onDelete }: {
    txn: LedgerTransactionItem;
    tab: 'inward' | 'outward';
    isAdmin: boolean;
    onDelete: (id: string) => void;
}) {
    const isInward = tab === 'inward';
    const location = isInward ? txn.source : txn.destination;
    const date = new Date(txn.createdAt);

    return (
        <tr className="hover:bg-gray-50 transition-colors">
            <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs">
                {date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                <br />
                <span className="text-gray-400">{date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
            </td>
            <td className="px-3 py-2 font-mono text-xs font-medium text-gray-900 whitespace-nowrap">
                {txn.sku?.skuCode || '-'}
            </td>
            <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate" title={txn.sku?.variation?.product?.name}>
                {txn.sku?.variation?.product?.name || '-'}
            </td>
            <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                {txn.sku?.variation?.colorName || '-'}
            </td>
            <td className="px-3 py-2 text-gray-600 text-center">
                {txn.sku?.size || '-'}
            </td>
            <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${isInward ? 'text-green-700' : 'text-red-700'}`}>
                {isInward ? '+' : '-'}{txn.qty}
            </td>
            <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs capitalize">
                {formatReason(txn.reason)}
            </td>
            <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">
                {location || '-'}
            </td>
            {isInward && (
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs">
                    {txn.performedBy || '-'}
                </td>
            )}
            {isInward && (
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs">
                    {txn.tailorNumber || '-'}
                </td>
            )}
            {isInward && (
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs font-mono">
                    {txn.repackingBarcode || '-'}
                </td>
            )}
            {!isInward && (
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap text-xs font-medium">
                    {txn.orderNumber ? `#${txn.orderNumber}` : '-'}
                </td>
            )}
            <td className="px-3 py-2 whitespace-nowrap">
                {txn.isSheetImported ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                        <FileSpreadsheet size={10} />
                        Sheet
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                        <Monitor size={10} />
                        App
                    </span>
                )}
            </td>
            {isAdmin && (
                <td className="px-3 py-2">
                    <button
                        onClick={() => onDelete(txn.id)}
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Delete transaction"
                    >
                        <Trash2 size={14} />
                    </button>
                </td>
            )}
        </tr>
    );
}

// ============================================
// MATERIALS TAB COMPONENT
// ============================================

interface MaterialsTabProps {
    data: Array<{
        id: string;
        fabricColour?: {
            colourName: string;
            colourHex?: string | null;
            fabric?: {
                name: string;
                material?: { name: string } | null;
            } | null;
        } | null;
        txnType: string;
        reason: string;
        createdAt: string;
        qty: number;
        unit: string;
        notes?: string | null;
        costPerUnit?: number | null;
        party?: { name: string } | null;
        createdBy?: { name: string } | null;
    }> | undefined;
    isLoading: boolean;
    searchInput: string;
    setSearchInput: (v: string) => void;
    isAdmin: boolean;
    onDelete: (id: string) => void;
}

function MaterialsTab({ data, isLoading, searchInput, setSearchInput, isAdmin, onDelete }: MaterialsTabProps) {
    return (
        <div className="space-y-4">
            {/* Filter Bar */}
            <div className="card flex flex-wrap gap-2 md:gap-3 items-center">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search material, fabric, colour..."
                        className="input pl-9 w-full"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                </div>
                <span className="text-sm text-gray-500">
                    {data?.length || 0} transactions
                </span>
            </div>

            {/* Table */}
            {isLoading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                </div>
            ) : !data || data.length === 0 ? (
                <div className="card text-center py-12 text-gray-500">No transactions found</div>
            ) : (
                <div className="card p-0 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                                <th className="px-3 py-2.5">Date</th>
                                <th className="px-3 py-2.5">Material</th>
                                <th className="px-3 py-2.5">Fabric</th>
                                <th className="px-3 py-2.5">Colour</th>
                                <th className="px-3 py-2.5">Type</th>
                                <th className="px-3 py-2.5 text-right">Qty</th>
                                <th className="px-3 py-2.5">Reason</th>
                                <th className="px-3 py-2.5">Cost/Unit</th>
                                <th className="px-3 py-2.5">Supplier</th>
                                <th className="px-3 py-2.5">Created By</th>
                                {isAdmin && <th className="px-3 py-2.5 w-10"></th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {data.map((txn) => {
                                const date = new Date(txn.createdAt);
                                const isInward = txn.txnType === 'inward';
                                return (
                                    <tr key={txn.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs">
                                            {date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                                            <br />
                                            <span className="text-gray-400">{date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                                        </td>
                                        <td className="px-3 py-2 text-gray-700 text-xs">
                                            {txn.fabricColour?.fabric?.material?.name || '-'}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700 text-xs">
                                            {txn.fabricColour?.fabric?.name || '-'}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap">
                                            <div className="flex items-center gap-1.5">
                                                <div
                                                    className="w-4 h-4 rounded-full border border-gray-300 shrink-0"
                                                    style={{ backgroundColor: txn.fabricColour?.colourHex || '#ccc' }}
                                                />
                                                <span className="text-gray-700 text-xs">{txn.fabricColour?.colourName || '-'}</span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap">
                                            {isInward ? (
                                                <span className="inline-flex items-center gap-0.5 text-green-700 text-xs font-medium">
                                                    <ArrowDownCircle size={12} /> In
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-0.5 text-red-700 text-xs font-medium">
                                                    <ArrowUpCircle size={12} /> Out
                                                </span>
                                            )}
                                        </td>
                                        <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${isInward ? 'text-green-700' : 'text-red-700'}`}>
                                            {isInward ? '+' : '-'}{txn.qty} {txn.unit}
                                        </td>
                                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs capitalize">
                                            {txn.reason.replace(/_/g, ' ')}
                                        </td>
                                        <td className="px-3 py-2 text-gray-600 text-xs">
                                            {txn.costPerUnit ? `\u20B9${txn.costPerUnit}` : '-'}
                                        </td>
                                        <td className="px-3 py-2 text-gray-600 text-xs">
                                            {txn.party?.name || '-'}
                                        </td>
                                        <td className="px-3 py-2 text-gray-500 text-xs">
                                            {txn.createdBy?.name || 'System'}
                                        </td>
                                        {isAdmin && (
                                            <td className="px-3 py-2">
                                                <button
                                                    onClick={() => onDelete(txn.id)}
                                                    className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                    title="Delete transaction"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ============================================
// PAGINATION COMPONENT
// ============================================

function Pagination({ page, totalPages, total, offset, itemCount, setPage }: {
    page: number;
    totalPages: number;
    total: number;
    offset: number;
    itemCount: number;
    setPage: (p: number) => void;
}) {
    const start = offset + 1;
    const end = offset + itemCount;

    return (
        <div className="flex items-center justify-between text-sm text-gray-600 px-1">
            <span>
                {formatNumber(start)}-{formatNumber(end)} of {formatNumber(total)}
            </span>
            <div className="flex items-center gap-2">
                <button
                    onClick={() => setPage(page - 1)}
                    disabled={page <= 1}
                    className="p-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-gray-500">
                    Page {page} of {totalPages}
                </span>
                <button
                    onClick={() => setPage(page + 1)}
                    disabled={page >= totalPages}
                    className="p-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );
}
