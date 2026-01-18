import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionApi } from '../services/api';
import { useState, useMemo } from 'react';
import { Plus, CheckCircle, X, ChevronDown, ChevronRight, Lock, Unlock, Copy, Check, Undo2, Trash2, Scissors, FlaskConical } from 'lucide-react';
import { sortBySizeOrder } from '../constants/sizes';
import { AddToPlanModal } from '../components/production/AddToPlanModal';

// Default date range for production batches (14 days past to 45 days future)
const getDefaultDateRange = () => {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 14);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 45);
    return {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
    };
};

export default function Production() {
    const queryClient = useQueryClient();

    // UI state - declared first so queries can reference them
    const [tab, setTab] = useState<'schedule' | 'capacity' | 'tailors'>('schedule');
    const [showPlanner, setShowPlanner] = useState(false); // Start collapsed for performance
    const [showComplete, setShowComplete] = useState<any>(null);
    const [qtyCompleted, setQtyCompleted] = useState(0);
    const [customConfirmed, setCustomConfirmed] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [addModalDate, setAddModalDate] = useState<string | null>(null);
    const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
    const [copiedDate, setCopiedDate] = useState<string | null>(null);
    const [requirementsLimit, setRequirementsLimit] = useState(10);

    // Memoize date range to prevent query key changes on every render
    const dateRange = useMemo(() => getDefaultDateRange(), []);

    // Queries - some are lazy loaded based on UI state
    const { data: batches, isLoading } = useQuery({
        queryKey: ['productionBatches', dateRange.startDate, dateRange.endDate],
        queryFn: () => productionApi.getBatches({ startDate: dateRange.startDate, endDate: dateRange.endDate }).then(r => r.data)
    });
    const { data: capacity } = useQuery({ queryKey: ['productionCapacity'], queryFn: () => productionApi.getCapacity().then(r => r.data) });
    const { data: tailors } = useQuery({ queryKey: ['tailors'], queryFn: () => productionApi.getTailors().then(r => r.data) });
    const { data: lockedDates } = useQuery({ queryKey: ['lockedProductionDates'], queryFn: () => productionApi.getLockedDates().then(r => r.data) });
    const { data: requirements, isLoading: requirementsLoading } = useQuery({
        queryKey: ['productionRequirements'],
        queryFn: () => productionApi.getRequirements().then(r => r.data),
        enabled: showPlanner, // Lazy load - only fetch when section is expanded
    });

    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: ['productionBatches'] });
        queryClient.invalidateQueries({ queryKey: ['productionCapacity'] });
        queryClient.invalidateQueries({ queryKey: ['productionRequirements'] });
    };

    // Optimistic update helper for batch status changes
    const optimisticBatchUpdate = (batchId: string, updates: Partial<{ status: string; qtyCompleted: number }>) => {
        const queryKey = ['productionBatches', dateRange.startDate, dateRange.endDate];
        queryClient.setQueryData(queryKey, (old: any) => {
            if (!old) return old;
            return old.map((batch: any) =>
                batch.id === batchId ? { ...batch, ...updates } : batch
            );
        });
    };

    const completeBatch = useMutation({
        mutationFn: ({ id, data }: any) => productionApi.completeBatch(id, data),
        onMutate: async ({ id, data }) => {
            await queryClient.cancelQueries({ queryKey: ['productionBatches'] });
            optimisticBatchUpdate(id, { status: 'completed', qtyCompleted: data.qtyCompleted });
        },
        onSuccess: () => { invalidateAll(); setShowComplete(null); },
        onError: () => invalidateAll()
    });

    const deleteBatch = useMutation({
        mutationFn: (id: string) => productionApi.deleteBatch(id),
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: ['productionBatches'] });
            const queryKey = ['productionBatches', dateRange.startDate, dateRange.endDate];
            queryClient.setQueryData(queryKey, (old: any) =>
                old ? old.filter((batch: any) => batch.id !== id) : old
            );
        },
        onSuccess: invalidateAll,
        onError: () => invalidateAll()
    });

    const uncompleteBatch = useMutation({
        mutationFn: (id: string) => productionApi.uncompleteBatch(id),
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: ['productionBatches'] });
            // Backend resets to 'planned' status, not 'in_progress'
            optimisticBatchUpdate(id, { status: 'planned', qtyCompleted: 0 });
        },
        onSuccess: invalidateAll,
        onError: () => invalidateAll()
    });
    const createBatch = useMutation({
        mutationFn: (data: any) => productionApi.createBatch(data),
        onSuccess: invalidateAll,
        onError: (error: any) => { alert(error.response?.data?.error || 'Failed to add item'); }
    });
    const lockDate = useMutation({
        mutationFn: (date: string) => productionApi.lockDate(date),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lockedProductionDates'] }); }
    });
    const unlockDate = useMutation({
        mutationFn: (date: string) => productionApi.unlockDate(date),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lockedProductionDates'] }); }
    });

    // Check if date is locked
    const isDateLocked = (dateStr: string) => lockedDates?.includes(dateStr) || false;

    // Copy production plan to clipboard
    const copyToClipboard = (group: any) => {
        // For custom SKUs and samples, don't consolidate - each batch is unique
        // For regular SKUs, consolidate by SKU ID
        const consolidatedMap = new Map<string, { sku: any; totalQty: number; notes: string[]; isCustomSku: boolean; isSampleBatch: boolean; customization: any; sampleInfo: any }>();
        const specialBatches: any[] = []; // Custom and sample batches

        group.batches.forEach((batch: any) => {
            // Sample batches are kept separate
            if (batch.isSampleBatch) {
                specialBatches.push({
                    sku: null,
                    totalQty: batch.qtyPlanned,
                    notes: batch.notes ? [batch.notes] : [],
                    isCustomSku: false,
                    isSampleBatch: true,
                    customization: null,
                    sampleInfo: batch.sampleInfo
                });
            }
            // Custom SKU batches are kept separate (not consolidated)
            else if (batch.isCustomSku) {
                specialBatches.push({
                    sku: batch.sku,
                    totalQty: batch.qtyPlanned,
                    notes: batch.notes ? [batch.notes] : [],
                    isCustomSku: true,
                    isSampleBatch: false,
                    customization: batch.customization,
                    sampleInfo: null
                });
            } else {
                const key = batch.skuId;
                if (!consolidatedMap.has(key)) {
                    consolidatedMap.set(key, { sku: batch.sku, totalQty: 0, notes: [], isCustomSku: false, isSampleBatch: false, customization: null, sampleInfo: null });
                }
                const entry = consolidatedMap.get(key)!;
                entry.totalQty += batch.qtyPlanned;
                if (batch.notes) entry.notes.push(batch.notes);
            }
        });

        // Combine regular consolidated entries with special batches (samples first, then custom)
        const consolidated = [
            ...specialBatches.filter(b => b.isSampleBatch), // Samples first
            ...Array.from(consolidatedMap.values()),
            ...specialBatches.filter(b => !b.isSampleBatch) // Custom SKUs
        ].sort((a, b) => {
            // Samples come first
            if (a.isSampleBatch && !b.isSampleBatch) return -1;
            if (!a.isSampleBatch && b.isSampleBatch) return 1;
            // Then sort by product name
            const productCompare = (a.sku?.variation?.product?.name || '').localeCompare(b.sku?.variation?.product?.name || '');
            if (productCompare !== 0) return productCompare;
            const colorCompare = (a.sku?.variation?.colorName || '').localeCompare(b.sku?.variation?.colorName || '');
            if (colorCompare !== 0) return colorCompare;
            return sortBySizeOrder(a.sku?.size || '', b.sku?.size || '');
        });

        // Format date as "19 Aug 2025"
        const date = new Date(group.date);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const formattedDate = `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;

        // Format as numbered list
        const lines = [`*Production Plan ${formattedDate}*\n`];
        let totalPcs = 0;

        consolidated.forEach((entry, index) => {
            const qty = entry.totalQty;
            totalPcs += qty;
            let line: string;

            // Handle sample batches - format like regular items: Name - Size - Colour - qty - code
            if (entry.isSampleBatch && entry.sampleInfo) {
                const sampleSize = entry.sampleInfo.sampleSize || '-';
                const sampleColour = entry.sampleInfo.sampleColour || '-';
                line = `${index + 1}. ${entry.sampleInfo.sampleName} - ${sampleSize} - ${sampleColour} - ${qty}pc - ${entry.sampleInfo.sampleCode}`;
                if (entry.notes.length > 0) {
                    line += ` (${entry.notes.join(', ')})`;
                }
            }
            // Handle custom SKU batches
            else if (entry.isCustomSku && entry.customization) {
                const product = entry.sku?.variation?.product?.name || '';
                const size = entry.sku?.size || '';
                const color = entry.sku?.variation?.colorName || '';
                const skuCode = entry.sku?.skuCode || '';
                line = `${index + 1}. ${product} - ${size} - ${color} - ${qty}pc - ${skuCode}`;

                const customParts = ['[CUSTOM'];
                if (entry.customization.type && entry.customization.value) {
                    customParts.push(`: ${entry.customization.type} ${entry.customization.value}`);
                }
                customParts.push(']');
                line += ` ${customParts.join('')}`;

                if (entry.customization.notes) {
                    line += ` (Notes: ${entry.customization.notes})`;
                }

                if (entry.customization.linkedOrder) {
                    line += ` - For Order: ${entry.customization.linkedOrder.orderNumber}`;
                    if (entry.customization.linkedOrder.customerName) {
                        line += ` (${entry.customization.linkedOrder.customerName})`;
                    }
                }
            }
            // Handle regular batches
            else {
                const product = entry.sku?.variation?.product?.name || '';
                const size = entry.sku?.size || '';
                const color = entry.sku?.variation?.colorName || '';
                const skuCode = entry.sku?.skuCode || '';
                line = `${index + 1}. ${product} - ${size} - ${color} - ${qty}pc - ${skuCode}`;
                if (entry.notes.length > 0) {
                    line += ` (${entry.notes.join(', ')})`;
                }
            }
            lines.push(line);
        });

        lines.push(`\n*Total ${totalPcs} pcs*`);

        navigator.clipboard.writeText(lines.join('\n')).then(() => {
            setCopiedDate(group.date);
            setTimeout(() => setCopiedDate(null), 2000);
        });
    };

    // Group and consolidate batches by date, then by product/color
    const groupBatchesByDate = (batches: any[]) => {
        if (!batches) return [];
        const groups: Record<string, any[]> = {};

        batches.forEach(batch => {
            const dateKey = new Date(batch.batchDate).toISOString().split('T')[0];
            if (!groups[dateKey]) groups[dateKey] = [];
            groups[dateKey].push(batch);
        });

        // Sort dates descending (most recent first), but put future dates at top
        const today = new Date().toISOString().split('T')[0];
        return Object.entries(groups)
            .sort(([a], [b]) => {
                if (a >= today && b < today) return -1;
                if (a < today && b >= today) return 1;
                return b.localeCompare(a);
            })
            .map(([date, items]) => {
                // Group batches by product → color for consolidated view
                const productGroups: Record<string, { product: any; colorGroups: Record<string, { color: string; skus: any[] }> }> = {};

                items.forEach(batch => {
                    const product = batch.sku?.variation?.product;
                    const productName = product?.name || 'Unknown';
                    const colorName = batch.sku?.variation?.colorName || 'Unknown';

                    if (!productGroups[productName]) {
                        productGroups[productName] = { product, colorGroups: {} };
                    }
                    if (!productGroups[productName].colorGroups[colorName]) {
                        productGroups[productName].colorGroups[colorName] = { color: colorName, skus: [] };
                    }

                    // Check if this SKU already exists, consolidate if so
                    const existingSku = productGroups[productName].colorGroups[colorName].skus.find(
                        s => s.skuId === batch.skuId && s.status === batch.status
                    );
                    if (existingSku) {
                        existingSku.qtyPlanned += batch.qtyPlanned;
                        existingSku.qtyCompleted += batch.qtyCompleted;
                        existingSku.batchIds.push(batch.id);
                    } else {
                        productGroups[productName].colorGroups[colorName].skus.push({
                            skuId: batch.skuId,
                            size: batch.sku?.size,
                            skuCode: batch.sku?.skuCode,
                            qtyPlanned: batch.qtyPlanned,
                            qtyCompleted: batch.qtyCompleted,
                            status: batch.status,
                            batchIds: [batch.id],
                            originalBatch: batch // Keep reference for actions
                        });
                    }
                });

                // Convert to array and sort
                const consolidatedGroups = Object.entries(productGroups)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([productName, data]) => ({
                        productName,
                        product: data.product,
                        colors: Object.entries(data.colorGroups)
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([colorName, colorData]) => ({
                                colorName,
                                skus: colorData.skus.sort((a, b) => sortBySizeOrder(a.size || '', b.size || ''))
                            }))
                    }));

                return {
                    date,
                    displayDate: formatDate(date),
                    isToday: date === today,
                    isFuture: date > today,
                    isPast: date < today,
                    isLocked: isDateLocked(date),
                    batches: items, // Keep original for actions
                    consolidatedGroups,
                    totalPlanned: items.reduce((sum, b) => sum + b.qtyPlanned, 0),
                    totalCompleted: items.reduce((sum, b) => sum + b.qtyCompleted, 0),
                    allCompleted: items.every(b => b.status === 'completed'),
                    hasInProgress: items.some(b => b.status === 'in_progress')
                };
            });
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        if (date.getTime() === today.getTime()) return 'Today';
        if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';

        return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    };

    const toggleDate = (date: string) => {
        const newSet = new Set(expandedDates);
        if (newSet.has(date)) newSet.delete(date);
        else newSet.add(date);
        setExpandedDates(newSet);
    };

    const dateGroups = groupBatchesByDate(batches);

    // Expand today and tomorrow by default
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    if (expandedDates.size === 0 && dateGroups.length > 0) {
        const initial = new Set<string>();
        dateGroups.forEach(g => {
            if (g.date === today || g.date === tomorrow || g.isFuture) {
                initial.add(g.date);
            }
        });
        if (initial.size > 0) setExpandedDates(initial);
    }

    if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div></div>;

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h1 className="text-xl md:text-2xl font-bold text-gray-900">Production</h1>
                <button
                    onClick={() => {
                        setAddModalDate(today);
                        setShowAddModal(true);
                    }}
                    className="btn-primary flex items-center text-sm w-full sm:w-auto justify-center"
                >
                    <Plus size={18} className="mr-1" />Add to Plan
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 md:gap-4 border-b text-sm overflow-x-auto">
                <button className={`pb-2 font-medium ${tab === 'schedule' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => setTab('schedule')}>Schedule</button>
                <button className={`pb-2 font-medium ${tab === 'capacity' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => setTab('capacity')}>Capacity</button>
                <button className={`pb-2 font-medium ${tab === 'tailors' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => setTab('tailors')}>Tailors</button>
            </div>

            {/* Schedule Tab with Planner Section */}
            {tab === 'schedule' && (
                <div className="space-y-4">
                    {/* Production Requirements Section (Collapsible, Lazy Loaded) - Order-wise */}
                    <div className="border border-red-200 rounded-lg overflow-hidden">
                        <div
                            className="flex items-center justify-between px-4 py-3 bg-red-50 cursor-pointer"
                            onClick={() => setShowPlanner(!showPlanner)}
                        >
                            <div className="flex items-center gap-3">
                                {showPlanner ? <ChevronDown size={16} className="text-red-400" /> : <ChevronRight size={16} className="text-red-400" />}
                                <span className="font-medium text-red-800">Production Queue</span>
                                {requirementsLoading ? (
                                    <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs">Loading...</span>
                                ) : requirements?.summary ? (
                                    <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                                        {requirements.summary.totalLinesNeedingProduction} items • {requirements.summary.totalUnitsNeeded} units
                                    </span>
                                ) : !showPlanner ? (
                                    <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs">Click to load</span>
                                ) : null}
                            </div>
                            {requirements?.summary && (
                                <span className="text-xs text-red-600">{requirements.summary.totalOrdersAffected} orders</span>
                            )}
                        </div>

                        {showPlanner && (
                            requirementsLoading ? (
                                <div className="flex justify-center p-6 bg-white">
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-400"></div>
                                </div>
                            ) : requirements?.requirements?.length === 0 ? (
                                <div className="flex items-center gap-3 px-4 py-3 bg-green-50">
                                    <CheckCircle size={20} className="text-green-500" />
                                    <span className="text-sm text-green-700">All caught up! No pending production requirements from open orders.</span>
                                </div>
                            ) : requirements?.requirements?.length > 0 ? (
                            <div className="bg-white table-scroll-container">
                                <table className="w-full text-sm" style={{ minWidth: '700px' }}>
                                        <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                                            <tr>
                                                <th className="px-3 py-2">Order</th>
                                                <th className="px-3 py-2">Product</th>
                                                <th className="px-3 py-2 text-center">Qty</th>
                                                <th className="px-3 py-2 text-center">Planned</th>
                                                <th className="px-3 py-2 text-center">Need</th>
                                                <th className="px-3 py-2">Schedule For</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {requirements.requirements.slice(0, requirementsLimit).map((item: any) => (
                                                <tr key={item.orderLineId} className="hover:bg-gray-50">
                                                    <td className="px-3 py-2">
                                                        <div className="font-medium text-gray-900 text-xs">{item.orderNumber}</div>
                                                        <div className="text-gray-400 text-xs">{new Date(item.orderDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <div className="font-medium text-gray-900 text-xs">{item.productName}</div>
                                                        <div className="text-gray-500 text-xs">{item.colorName} / {item.size}</div>
                                                    </td>
                                                    <td className="px-3 py-2 text-center font-medium text-xs">{item.qty}</td>
                                                    <td className="px-3 py-2 text-center text-xs">
                                                        {item.scheduledForLine > 0 ? (
                                                            <span className="text-blue-600">{item.scheduledForLine}</span>
                                                        ) : (
                                                            <span className="text-gray-400">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
                                                        <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">{item.shortage}</span>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="date"
                                                                className="text-xs border rounded px-2 py-1 w-32"
                                                                defaultValue={new Date().toISOString().split('T')[0]}
                                                                min={new Date().toISOString().split('T')[0]}
                                                                id={`date-${item.orderLineId}`}
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    const dateInput = document.getElementById(`date-${item.orderLineId}`) as HTMLInputElement;
                                                                    const selectedDate = dateInput?.value || new Date().toISOString().split('T')[0];
                                                                    if (lockedDates?.includes(selectedDate)) {
                                                                        alert('This date is locked. Please select another date.');
                                                                        return;
                                                                    }
                                                                    createBatch.mutate({
                                                                        skuId: item.skuId,
                                                                        qtyPlanned: item.shortage,
                                                                        batchDate: selectedDate,
                                                                        sourceOrderLineId: item.orderLineId
                                                                    });
                                                                }}
                                                                disabled={createBatch.isPending}
                                                                className="text-xs px-2 py-1 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
                                                            >
                                                                + Add
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {/* Pagination controls */}
                                    {requirements.requirements.length > 10 && (
                                        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t">
                                            <span className="text-xs text-gray-500">
                                                Showing {Math.min(requirementsLimit, requirements.requirements.length)} of {requirements.requirements.length} items
                                            </span>
                                            <div className="flex gap-2">
                                                {requirementsLimit < requirements.requirements.length && (
                                                    <button
                                                        onClick={() => setRequirementsLimit(prev => Math.min(prev + 10, requirements.requirements.length))}
                                                        className="text-xs px-3 py-1.5 text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded"
                                                    >
                                                        Show More (+10)
                                                    </button>
                                                )}
                                                {requirementsLimit < requirements.requirements.length && (
                                                    <button
                                                        onClick={() => setRequirementsLimit(requirements.requirements.length)}
                                                        className="text-xs px-3 py-1.5 text-gray-600 hover:text-gray-700 hover:bg-gray-100 rounded"
                                                    >
                                                        Show All
                                                    </button>
                                                )}
                                                {requirementsLimit > 10 && (
                                                    <button
                                                        onClick={() => setRequirementsLimit(10)}
                                                        className="text-xs px-3 py-1.5 text-gray-600 hover:text-gray-700 hover:bg-gray-100 rounded"
                                                    >
                                                        Show Less
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                            </div>
                            ) : null
                        )}
                    </div>

                    {/* Date-wise Schedule */}
                    <div className="space-y-2">
                        {dateGroups.length === 0 && (
                            <div className="text-center text-gray-400 py-12">No production scheduled</div>
                        )}
                    {dateGroups.map(group => (
                        <div key={group.date} className={`border rounded-lg overflow-hidden ${group.isLocked ? 'border-red-200' : group.isToday ? 'border-orange-300' : 'border-gray-200'}`}>
                            {/* Date Header */}
                            <div
                                className={`flex items-center justify-between px-4 py-2 cursor-pointer ${
                                    group.isLocked ? 'bg-red-50' :
                                    group.isToday ? 'bg-orange-50' :
                                    group.isFuture ? 'bg-blue-50' :
                                    'bg-gray-50'
                                }`}
                                onClick={() => toggleDate(group.date)}
                            >
                                <div className="flex items-center gap-3">
                                    {expandedDates.has(group.date) ?
                                        <ChevronDown size={16} className="text-gray-400" /> :
                                        <ChevronRight size={16} className="text-gray-400" />
                                    }
                                    <span className={`font-medium ${group.isLocked ? 'text-red-700' : group.isToday ? 'text-orange-700' : group.isFuture ? 'text-blue-700' : 'text-gray-700'}`}>
                                        {group.displayDate}
                                    </span>
                                    <span className="text-xs text-gray-400">{group.date}</span>
                                    {group.isLocked && (
                                        <span className="flex items-center gap-1 text-xs text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                                            <Lock size={10} /> Locked
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-4 text-sm">
                                    <span className="text-gray-500">{group.batches.length} items</span>
                                    <span className={group.allCompleted ? 'text-green-600' : group.hasInProgress ? 'text-yellow-600' : 'text-gray-500'}>
                                        {group.totalCompleted}/{group.totalPlanned} done
                                    </span>
                                    {group.isLocked ? (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); unlockDate.mutate(group.date); }}
                                            className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                                            title="Unlock this date"
                                        >
                                            <Unlock size={14} />
                                        </button>
                                    ) : (
                                        <>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setAddModalDate(group.date); setShowAddModal(true); }}
                                                className="text-xs text-gray-400 hover:text-gray-600"
                                                title="Add item"
                                            >
                                                <Plus size={14} />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); lockDate.mutate(group.date); }}
                                                className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1"
                                                title="Lock this date"
                                            >
                                                <Lock size={14} />
                                            </button>
                                        </>
                                    )}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); copyToClipboard(group); }}
                                        className={`text-xs flex items-center gap-1 ${copiedDate === group.date ? 'text-green-600' : 'text-gray-400 hover:text-gray-600'}`}
                                        title="Copy to clipboard"
                                    >
                                        {copiedDate === group.date ? <Check size={14} /> : <Copy size={14} />}
                                    </button>
                                </div>
                            </div>

                            {/* Batch Items - Individual rows */}
                            {expandedDates.has(group.date) && (
                                <div className="table-scroll-container">
                                <table className="w-full text-sm bg-white" style={{ minWidth: '900px' }}>
                                    <thead>
                                        <tr className="border-t text-left text-gray-500 text-xs uppercase tracking-wide">
                                            <th className="py-2 px-4 font-medium">Batch #</th>
                                            <th className="py-2 px-4 font-medium">Style</th>
                                            <th className="py-2 px-4 font-medium">SKU</th>
                                            <th className="py-2 px-4 font-medium">Product Name</th>
                                            <th className="py-2 px-4 font-medium">Colour</th>
                                            <th className="py-2 px-4 font-medium">Size</th>
                                            <th className="py-2 px-4 font-medium text-center">Qty</th>
                                            <th className="py-2 px-4 font-medium">Customization</th>
                                            <th className="py-2 px-4 font-medium">Status</th>
                                            <th className="py-2 px-4 font-medium w-24"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {group.batches
                                            .sort((a: any, b: any) => {
                                                // Samples come first
                                                if (a.isSampleBatch && !b.isSampleBatch) return -1;
                                                if (!a.isSampleBatch && b.isSampleBatch) return 1;
                                                const productCompare = (a.sku?.variation?.product?.name || a.sampleInfo?.sampleName || '').localeCompare(b.sku?.variation?.product?.name || b.sampleInfo?.sampleName || '');
                                                if (productCompare !== 0) return productCompare;
                                                const colorCompare = (a.sku?.variation?.colorName || '').localeCompare(b.sku?.variation?.colorName || '');
                                                if (colorCompare !== 0) return colorCompare;
                                                return sortBySizeOrder(a.sku?.size || '', b.sku?.size || '');
                                            })
                                            .map((batch: any) => (
                                            <tr key={batch.id} className={`border-t hover:bg-gray-50 ${batch.isSampleBatch ? 'bg-purple-50/50' : batch.isCustomSku ? 'bg-orange-50/50' : ''}`}>
                                                <td className="py-2 px-4 font-mono text-xs text-gray-500">
                                                    {batch.isSampleBatch ? (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                                                            <FlaskConical size={10} />
                                                            {batch.sampleInfo?.sampleCode || 'SAMPLE'}
                                                        </span>
                                                    ) : (
                                                        batch.batchCode || '-'
                                                    )}
                                                </td>
                                                <td className="py-2 px-4 font-mono text-xs text-gray-600">
                                                    {batch.isSampleBatch ? '-' : (batch.sku?.variation?.product?.styleCode || '-')}
                                                </td>
                                                <td className="py-2 px-4 font-mono text-xs text-gray-500">
                                                    <div className="flex items-center gap-1.5">
                                                        {batch.isSampleBatch ? (
                                                            <span className="text-purple-600 italic">Sample</span>
                                                        ) : (
                                                            <>
                                                                {batch.isCustomSku && (
                                                                    <Scissors size={12} className="text-orange-500 flex-shrink-0" />
                                                                )}
                                                                <span>{batch.sku?.skuCode}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-2 px-4 font-medium text-gray-900">
                                                    {batch.isSampleBatch ? batch.sampleInfo?.sampleName : batch.sku?.variation?.product?.name}
                                                </td>
                                                <td className="py-2 px-4 text-gray-600">
                                                    {batch.isSampleBatch
                                                        ? (batch.sampleInfo?.sampleColour || <span className="text-gray-400">-</span>)
                                                        : batch.sku?.variation?.colorName}
                                                </td>
                                                <td className="py-2 px-4 text-gray-600">
                                                    {batch.isSampleBatch
                                                        ? (batch.sampleInfo?.sampleSize || <span className="text-gray-400">-</span>)
                                                        : batch.sku?.size}
                                                </td>
                                                <td className="py-2 px-4 text-center font-medium">{batch.qtyPlanned}</td>
                                                <td className="py-2 px-4">
                                                    {batch.isSampleBatch ? (
                                                        <div className="space-y-1">
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium border border-purple-200">
                                                                <FlaskConical size={10} />
                                                                SAMPLE
                                                            </span>
                                                            {batch.notes && (
                                                                <div className="text-xs text-purple-600 italic" title={batch.notes}>
                                                                    {batch.notes.length > 30
                                                                        ? batch.notes.substring(0, 30) + '...'
                                                                        : batch.notes}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : batch.isCustomSku && batch.customization ? (
                                                        <div className="space-y-1">
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-medium border border-orange-200">
                                                                <Scissors size={10} />
                                                                CUSTOM
                                                            </span>
                                                            <div className="text-xs">
                                                                {batch.customization.type && (
                                                                    <div className="text-orange-800 font-medium">
                                                                        {batch.customization.type}: {batch.customization.value}
                                                                    </div>
                                                                )}
                                                                {batch.customization.notes && (
                                                                    <div className="text-orange-600 italic" title={batch.customization.notes}>
                                                                        {batch.customization.notes.length > 30
                                                                            ? batch.customization.notes.substring(0, 30) + '...'
                                                                            : batch.customization.notes}
                                                                    </div>
                                                                )}
                                                                {batch.customization.linkedOrder && (
                                                                    <div className="text-gray-500 mt-0.5">
                                                                        For: {batch.customization.linkedOrder.orderNumber}
                                                                        {batch.customization.linkedOrder.customerName && (
                                                                            <span className="text-gray-400"> ({batch.customization.linkedOrder.customerName})</span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-400 text-xs">-</span>
                                                    )}
                                                </td>
                                                <td className="py-2 px-4">
                                                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                                                        batch.status === 'completed' ? 'bg-green-100 text-green-700' :
                                                        batch.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-gray-100 text-gray-600'
                                                    }`}>
                                                        {batch.status === 'in_progress' ? 'in progress' : batch.status}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-4">
                                                    <div className="flex items-center gap-2">
                                                        {(batch.status === 'planned' || batch.status === 'in_progress') && (
                                                            <button
                                                                onClick={() => {
                                                                    setShowComplete(batch);
                                                                    setQtyCompleted(batch.qtyPlanned);
                                                                    setCustomConfirmed(false);
                                                                }}
                                                                className="text-green-600 hover:text-green-800"
                                                                title="Mark Complete"
                                                            >
                                                                <CheckCircle size={14} />
                                                            </button>
                                                        )}
                                                        {batch.status === 'planned' && !group.isLocked && (
                                                            <button
                                                                onClick={() => deleteBatch.mutate(batch.id)}
                                                                className="text-gray-400 hover:text-red-500"
                                                                title="Delete"
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        )}
                                                        {batch.status === 'completed' && !group.isLocked && (
                                                            <>
                                                                <button
                                                                    onClick={() => uncompleteBatch.mutate(batch.id)}
                                                                    className="text-orange-500 hover:text-orange-700"
                                                                    title="Undo completion"
                                                                >
                                                                    <Undo2 size={14} />
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        if (confirm('Delete this completed batch? This will also reverse inventory changes.')) {
                                                                            uncompleteBatch.mutate(batch.id, {
                                                                                onSuccess: () => {
                                                                                    deleteBatch.mutate(batch.id);
                                                                                }
                                                                            });
                                                                        }
                                                                    }}
                                                                    className="text-gray-400 hover:text-red-500"
                                                                    title="Delete batch"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </>
                                                        )}
                                                        {batch.status === 'completed' && group.isLocked && (
                                                            <CheckCircle size={14} className="text-green-500" />
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            )}
                        </div>
                    ))}
                    </div>
                </div>
            )}

            {/* Capacity */}
            {tab === 'capacity' && (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {capacity?.map((t: any) => (
                        <div key={t.tailorId} className="card">
                            <h3 className="font-semibold">{t.tailorName}</h3>
                            <div className="mt-3">
                                <div className="flex justify-between text-sm mb-1"><span>Utilization</span><span>{t.utilizationPct}%</span></div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div className={`h-2 rounded-full ${Number(t.utilizationPct) > 90 ? 'bg-red-500' : Number(t.utilizationPct) > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, t.utilizationPct)}%` }} />
                                </div>
                            </div>
                            <p className="text-sm text-gray-500 mt-2">{t.allocatedMins} / {t.dailyCapacityMins} mins</p>
                            <p className="text-sm text-gray-500">{t.batches?.length || 0} batches today</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Tailors */}
            {tab === 'tailors' && (
                <div className="table-scroll-container">
                    <table className="w-full text-sm" style={{ minWidth: '500px' }}>
                        <thead>
                            <tr className="border-b text-left text-gray-500 text-xs uppercase tracking-wide">
                                <th className="pb-2 pr-4 font-medium">Name</th>
                                <th className="pb-2 pr-4 font-medium">Specializations</th>
                                <th className="pb-2 pr-4 font-medium text-right">Daily Capacity</th>
                                <th className="pb-2 font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tailors?.map((t: any) => (
                                <tr key={t.id} className="border-b border-gray-100">
                                    <td className="py-2 pr-4 font-medium">{t.name}</td>
                                    <td className="py-2 pr-4 text-gray-600">{t.specializations?.join(', ') || '-'}</td>
                                    <td className="py-2 pr-4 text-right">{t.dailyCapacityMins} mins</td>
                                    <td className="py-2">
                                        <span className={`text-xs ${t.isActive ? 'text-green-600' : 'text-red-500'}`}>
                                            {t.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Complete Modal */}
            {showComplete && (() => {
                // Detect custom SKU by flag OR by code pattern (e.g., 10291013-C01)
                const skuCode = showComplete.sku?.skuCode || '';
                const isCustomByPattern = /-C\d{2}$/.test(skuCode);
                const isCustomSku = showComplete.isCustomSku || showComplete.sku?.isCustomSku || isCustomByPattern;

                return (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-sm">
                        <h2 className="text-lg font-semibold mb-2">Complete Batch</h2>
                        <p className="text-sm text-gray-500 mb-4">{skuCode} - Planned: {showComplete.qtyPlanned}</p>

                        {/* Custom SKU details */}
                        {isCustomSku && (
                            <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                                <div className="flex items-center gap-2 mb-2">
                                    <Scissors size={14} className="text-orange-600" />
                                    <span className="text-sm font-medium text-orange-700">Custom Item</span>
                                </div>
                                {showComplete.customization?.type && (
                                    <p className="text-xs text-orange-600">
                                        {showComplete.customization.type}: {showComplete.customization.value}
                                    </p>
                                )}
                                {showComplete.customization?.notes && (
                                    <p className="text-xs text-orange-600 mt-1 italic">
                                        Notes: {showComplete.customization.notes}
                                    </p>
                                )}
                                {showComplete.customization?.linkedOrder && (
                                    <p className="text-xs text-gray-600 mt-1">
                                        For Order: {showComplete.customization.linkedOrder.orderNumber}
                                        {showComplete.customization.linkedOrder.customerName && (
                                            <span> ({showComplete.customization.linkedOrder.customerName})</span>
                                        )}
                                    </p>
                                )}
                                {!showComplete.customization && isCustomByPattern && (
                                    <p className="text-xs text-orange-600">
                                        Custom SKU detected by code pattern
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="mb-4">
                            <label className="text-xs text-gray-500 mb-1 block">Quantity Completed</label>
                            <input type="number" className="input text-sm" value={qtyCompleted} onChange={(e) => setQtyCompleted(Number(e.target.value))} min={1} max={showComplete.qtyPlanned} />
                        </div>

                        {/* Custom SKU confirmation checkbox */}
                        {isCustomSku && (
                            <label className="flex items-start gap-3 mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer hover:bg-amber-100 transition-colors">
                                <input
                                    type="checkbox"
                                    checked={customConfirmed}
                                    onChange={(e) => setCustomConfirmed(e.target.checked)}
                                    className="mt-0.5 w-4 h-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                                />
                                <span className="text-sm text-amber-800">
                                    I confirm that the <strong>customization has been completed and checked</strong> before inwarding this item.
                                </span>
                            </label>
                        )}

                        <div className="flex gap-3">
                            <button type="button" onClick={() => setShowComplete(null)} className="btn-secondary flex-1 text-sm">Cancel</button>
                            <button
                                onClick={() => completeBatch.mutate({ id: showComplete.id, data: { qtyCompleted } })}
                                className="btn-primary flex-1 text-sm"
                                disabled={completeBatch.isPending || (isCustomSku && !customConfirmed)}
                            >
                                {completeBatch.isPending ? 'Completing...' : 'Complete'}
                            </button>
                        </div>

                        {/* Warning if checkbox not checked */}
                        {isCustomSku && !customConfirmed && (
                            <p className="text-xs text-amber-600 mt-2 text-center">
                                Please confirm customization is complete to proceed
                            </p>
                        )}
                    </div>
                </div>
                );
            })()}

            {/* Add to Plan Modal */}
            <AddToPlanModal
                open={showAddModal}
                onOpenChange={setShowAddModal}
                defaultDate={addModalDate || today}
                lockedDates={lockedDates || []}
            />
        </div>
    );
}
