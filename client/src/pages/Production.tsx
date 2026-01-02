import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionApi, productsApi } from '../services/api';
import { useState } from 'react';
import { Plus, Play, CheckCircle, X, ChevronDown, ChevronRight, Lock, Unlock, Copy, Check, Undo2, Trash2 } from 'lucide-react';

export default function Production() {
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<'schedule' | 'capacity' | 'tailors'>('schedule');
    const [showPlanner, setShowPlanner] = useState(true);
    const { data: batches, isLoading } = useQuery({ queryKey: ['productionBatches'], queryFn: () => productionApi.getBatches().then(r => r.data) });
    const { data: capacity } = useQuery({ queryKey: ['productionCapacity'], queryFn: () => productionApi.getCapacity().then(r => r.data) });
    const { data: tailors } = useQuery({ queryKey: ['tailors'], queryFn: () => productionApi.getTailors().then(r => r.data) });
    const { data: allSkus } = useQuery({ queryKey: ['allSkus'], queryFn: () => productsApi.getAllSkus().then(r => r.data) });
    const { data: lockedDates } = useQuery({ queryKey: ['lockedProductionDates'], queryFn: () => productionApi.getLockedDates().then(r => r.data) });
    const { data: requirements } = useQuery({ queryKey: ['productionRequirements'], queryFn: () => productionApi.getRequirements().then(r => r.data) });

    const [showComplete, setShowComplete] = useState<any>(null);
    const [qtyCompleted, setQtyCompleted] = useState(0);
    const [showAddItem, setShowAddItem] = useState<string | null>(null); // date string
    const [newItem, setNewItem] = useState({ skuId: '', qty: 1 });
    const [itemSelection, setItemSelection] = useState({ productId: '', variationId: '' });
    const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
    const [copiedDate, setCopiedDate] = useState<string | null>(null);

    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: ['productionBatches'] });
        queryClient.invalidateQueries({ queryKey: ['productionCapacity'] });
        queryClient.invalidateQueries({ queryKey: ['productionRequirements'] });
    };

    const startBatch = useMutation({ mutationFn: (id: string) => productionApi.startBatch(id), onSuccess: invalidateAll });
    const completeBatch = useMutation({ mutationFn: ({ id, data }: any) => productionApi.completeBatch(id, data), onSuccess: () => { invalidateAll(); setShowComplete(null); } });
    const deleteBatch = useMutation({ mutationFn: (id: string) => productionApi.deleteBatch(id), onSuccess: invalidateAll });
    const uncompleteBatch = useMutation({ mutationFn: (id: string) => productionApi.uncompleteBatch(id), onSuccess: invalidateAll });
    const createBatch = useMutation({
        mutationFn: (data: any) => productionApi.createBatch(data),
        onSuccess: () => { invalidateAll(); setShowAddItem(null); setNewItem({ skuId: '', qty: 1 }); setItemSelection({ productId: '', variationId: '' }); },
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
        // Consolidate batches by SKU
        const consolidatedMap = new Map<string, { sku: any; totalQty: number; notes: string[] }>();
        group.batches.forEach((batch: any) => {
            const key = batch.skuId;
            if (!consolidatedMap.has(key)) {
                consolidatedMap.set(key, { sku: batch.sku, totalQty: 0, notes: [] });
            }
            const entry = consolidatedMap.get(key)!;
            entry.totalQty += batch.qtyPlanned;
            if (batch.notes) entry.notes.push(batch.notes);
        });

        const consolidated = Array.from(consolidatedMap.values())
            .sort((a, b) => {
                const productCompare = (a.sku?.variation?.product?.name || '').localeCompare(b.sku?.variation?.product?.name || '');
                if (productCompare !== 0) return productCompare;
                const colorCompare = (a.sku?.variation?.colorName || '').localeCompare(b.sku?.variation?.colorName || '');
                if (colorCompare !== 0) return colorCompare;
                const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];
                return sizeOrder.indexOf(a.sku?.size) - sizeOrder.indexOf(b.sku?.size);
            });

        // Format date as "19 Aug 2025"
        const date = new Date(group.date);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const formattedDate = `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;

        // Format as numbered list
        const lines = [`*Production Plan ${formattedDate}*\n`];
        let totalPcs = 0;

        consolidated.forEach((entry, index) => {
            const product = entry.sku?.variation?.product?.name || '';
            const size = entry.sku?.size || '';
            const color = entry.sku?.variation?.colorName || '';
            const styleCode = entry.sku?.variation?.product?.styleCode || '';
            const qty = entry.totalQty;
            totalPcs += qty;

            let line = `${index + 1}. ${product} - ${size} - ${color} - ${qty} pc - ${styleCode}`;
            if (entry.notes.length > 0) {
                line += ` (${entry.notes.join(', ')})`;
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
                                skus: colorData.skus.sort((a, b) => {
                                    const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];
                                    return sizeOrder.indexOf(a.size) - sizeOrder.indexOf(b.size);
                                })
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

    const handleAddItem = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showAddItem || !newItem.skuId) return;
        createBatch.mutate({
            skuId: newItem.skuId,
            qtyPlanned: newItem.qty,
            priority: 'stock_replenishment',
            batchDate: showAddItem
        });
    };

    // SKU selection helpers
    const getUniqueProducts = () => {
        if (!allSkus) return [];
        const products = new Map();
        allSkus.forEach((sku: any) => {
            const product = sku.variation?.product;
            if (product && !products.has(product.id)) {
                products.set(product.id, { id: product.id, name: product.name });
            }
        });
        return Array.from(products.values()).sort((a, b) => a.name.localeCompare(b.name));
    };

    const getColorsForProduct = (productId: string) => {
        if (!allSkus || !productId) return [];
        const colors = new Map();
        allSkus.forEach((sku: any) => {
            if (sku.variation?.product?.id === productId) {
                const variation = sku.variation;
                if (!colors.has(variation.id)) {
                    colors.set(variation.id, { id: variation.id, name: variation.colorName });
                }
            }
        });
        return Array.from(colors.values()).sort((a, b) => a.name.localeCompare(b.name));
    };

    const getSizesForProductColor = (variationId: string) => {
        if (!allSkus || !variationId) return [];
        return allSkus
            .filter((sku: any) => sku.variation?.id === variationId)
            .map((sku: any) => ({ id: sku.id, size: sku.size, skuCode: sku.skuCode }))
            .sort((a: any, b: any) => {
                const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];
                return sizeOrder.indexOf(a.size) - sizeOrder.indexOf(b.size);
            });
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
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Production</h1>
                <button
                    onClick={() => setShowAddItem(today)}
                    className="btn-primary flex items-center text-sm"
                >
                    <Plus size={18} className="mr-1" />Add to Plan
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-4 border-b text-sm">
                <button className={`pb-2 font-medium ${tab === 'schedule' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => setTab('schedule')}>Schedule</button>
                <button className={`pb-2 font-medium ${tab === 'capacity' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => setTab('capacity')}>Capacity</button>
                <button className={`pb-2 font-medium ${tab === 'tailors' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => setTab('tailors')}>Tailors</button>
            </div>

            {/* Schedule Tab with Planner Section */}
            {tab === 'schedule' && (
                <div className="space-y-4">
                    {/* Production Requirements Section (Collapsible) - Order-wise */}
                    {requirements?.requirements?.length > 0 && (
                        <div className="border border-red-200 rounded-lg overflow-hidden">
                            <div
                                className="flex items-center justify-between px-4 py-3 bg-red-50 cursor-pointer"
                                onClick={() => setShowPlanner(!showPlanner)}
                            >
                                <div className="flex items-center gap-3">
                                    {showPlanner ? <ChevronDown size={16} className="text-red-400" /> : <ChevronRight size={16} className="text-red-400" />}
                                    <span className="font-medium text-red-800">Production Requirements</span>
                                    <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                                        {requirements.summary.totalLinesNeedingProduction} items • {requirements.summary.totalUnitsNeeded} units
                                    </span>
                                </div>
                                <span className="text-xs text-red-600">{requirements.summary.totalOrdersAffected} orders</span>
                            </div>

                            {showPlanner && (
                                <div className="bg-white">
                                    <table className="w-full text-sm">
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
                                            {requirements.requirements.map((item: any) => (
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
                                </div>
                            )}
                        </div>
                    )}

                    {/* All caught up message */}
                    {requirements?.requirements?.length === 0 && (
                        <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
                            <CheckCircle size={20} className="text-green-500" />
                            <span className="text-sm text-green-700">All caught up! No pending production requirements from open orders.</span>
                        </div>
                    )}

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
                                                onClick={(e) => { e.stopPropagation(); setShowAddItem(group.date); }}
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
                                <table className="w-full text-sm bg-white">
                                    <thead>
                                        <tr className="border-t text-left text-gray-500 text-xs uppercase tracking-wide">
                                            <th className="py-2 px-4 font-medium">Batch #</th>
                                            <th className="py-2 px-4 font-medium">Style</th>
                                            <th className="py-2 px-4 font-medium">SKU</th>
                                            <th className="py-2 px-4 font-medium">Product Name</th>
                                            <th className="py-2 px-4 font-medium">Colour</th>
                                            <th className="py-2 px-4 font-medium">Size</th>
                                            <th className="py-2 px-4 font-medium text-center">Qty</th>
                                            <th className="py-2 px-4 font-medium">Status</th>
                                            <th className="py-2 px-4 font-medium w-24"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {group.batches
                                            .sort((a: any, b: any) => {
                                                const productCompare = (a.sku?.variation?.product?.name || '').localeCompare(b.sku?.variation?.product?.name || '');
                                                if (productCompare !== 0) return productCompare;
                                                const colorCompare = (a.sku?.variation?.colorName || '').localeCompare(b.sku?.variation?.colorName || '');
                                                if (colorCompare !== 0) return colorCompare;
                                                const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];
                                                return sizeOrder.indexOf(a.sku?.size) - sizeOrder.indexOf(b.sku?.size);
                                            })
                                            .map((batch: any) => (
                                            <tr key={batch.id} className="border-t hover:bg-gray-50">
                                                <td className="py-2 px-4 font-mono text-xs text-gray-500">{batch.batchCode || '-'}</td>
                                                <td className="py-2 px-4 font-mono text-xs text-gray-600">{batch.sku?.variation?.product?.styleCode || '-'}</td>
                                                <td className="py-2 px-4 font-mono text-xs text-gray-500">{batch.sku?.skuCode}</td>
                                                <td className="py-2 px-4 font-medium text-gray-900">{batch.sku?.variation?.product?.name}</td>
                                                <td className="py-2 px-4 text-gray-600">{batch.sku?.variation?.colorName}</td>
                                                <td className="py-2 px-4 text-gray-600">{batch.sku?.size}</td>
                                                <td className="py-2 px-4 text-center font-medium">{batch.qtyPlanned}</td>
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
                                                        {batch.status === 'planned' && !group.isLocked && (
                                                            <>
                                                                <button
                                                                    onClick={() => startBatch.mutate(batch.id)}
                                                                    className="text-blue-600 hover:text-blue-800"
                                                                    title="Start"
                                                                >
                                                                    <Play size={14} />
                                                                </button>
                                                                <button
                                                                    onClick={() => deleteBatch.mutate(batch.id)}
                                                                    className="text-gray-400 hover:text-red-500"
                                                                    title="Delete"
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                            </>
                                                        )}
                                                        {batch.status === 'in_progress' && (
                                                            <button
                                                                onClick={() => {
                                                                    setShowComplete(batch);
                                                                    setQtyCompleted(batch.qtyPlanned);
                                                                }}
                                                                className="text-green-600 hover:text-green-800"
                                                                title="Mark Complete"
                                                            >
                                                                <CheckCircle size={14} />
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
                                                                            uncompleteBatch.mutate(batch.id);
                                                                            setTimeout(() => deleteBatch.mutate(batch.id), 500);
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
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
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
            {showComplete && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-sm">
                        <h2 className="text-lg font-semibold mb-2">Complete Batch</h2>
                        <p className="text-sm text-gray-500 mb-4">{showComplete.sku?.skuCode} - Planned: {showComplete.qtyPlanned}</p>
                        <div className="mb-4">
                            <label className="text-xs text-gray-500 mb-1 block">Quantity Completed</label>
                            <input type="number" className="input text-sm" value={qtyCompleted} onChange={(e) => setQtyCompleted(Number(e.target.value))} min={1} max={showComplete.qtyPlanned} />
                        </div>
                        <div className="flex gap-3">
                            <button type="button" onClick={() => setShowComplete(null)} className="btn-secondary flex-1 text-sm">Cancel</button>
                            <button onClick={() => completeBatch.mutate({ id: showComplete.id, data: { qtyCompleted } })} className="btn-primary flex-1 text-sm" disabled={completeBatch.isPending}>
                                {completeBatch.isPending ? 'Completing...' : 'Complete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Item Modal */}
            {showAddItem && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add to Production</h2>
                            <button onClick={() => setShowAddItem(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleAddItem} className="space-y-4">
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Production Date</label>
                                <input
                                    type="date"
                                    className="input text-sm"
                                    value={showAddItem}
                                    min={new Date().toISOString().split('T')[0]}
                                    onChange={(e) => setShowAddItem(e.target.value)}
                                />
                            </div>

                            {/* Product → Color → Size Cascading Selection */}
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Product</label>
                                <select
                                    className="input text-sm"
                                    value={itemSelection.productId}
                                    onChange={(e) => {
                                        setItemSelection({ productId: e.target.value, variationId: '' });
                                        setNewItem(n => ({ ...n, skuId: '' }));
                                    }}
                                >
                                    <option value="">Select product...</option>
                                    {getUniqueProducts().map((p: any) => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                            {itemSelection.productId && (
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Color</label>
                                    <select
                                        className="input text-sm"
                                        value={itemSelection.variationId}
                                        onChange={(e) => {
                                            setItemSelection(s => ({ ...s, variationId: e.target.value }));
                                            setNewItem(n => ({ ...n, skuId: '' }));
                                        }}
                                    >
                                        <option value="">Select color...</option>
                                        {getColorsForProduct(itemSelection.productId).map((c: any) => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            {itemSelection.variationId && (
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Size</label>
                                    <select
                                        className="input text-sm"
                                        value={newItem.skuId}
                                        onChange={(e) => setNewItem(n => ({ ...n, skuId: e.target.value }))}
                                        required
                                    >
                                        <option value="">Select size...</option>
                                        {getSizesForProductColor(itemSelection.variationId).map((s: any) => (
                                            <option key={s.id} value={s.id}>{s.size} ({s.skuCode})</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Divider */}
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                                <div className="flex-1 border-t" />
                                <span>or search by SKU code</span>
                                <div className="flex-1 border-t" />
                            </div>

                            {/* Direct SKU Search */}
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">SKU Code</label>
                                <select
                                    className="input text-sm"
                                    value={newItem.skuId}
                                    onChange={(e) => {
                                        setNewItem(n => ({ ...n, skuId: e.target.value }));
                                        setItemSelection({ productId: '', variationId: '' });
                                    }}
                                >
                                    <option value="">Search SKU...</option>
                                    {allSkus?.map((sku: any) => (
                                        <option key={sku.id} value={sku.id}>
                                            {sku.skuCode} - {sku.variation?.product?.name} {sku.size}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Quantity</label>
                                <input
                                    type="number"
                                    className="input text-sm"
                                    value={newItem.qty}
                                    onChange={(e) => setNewItem(n => ({ ...n, qty: Number(e.target.value) }))}
                                    min={1}
                                    required
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddItem(null)} className="btn-secondary flex-1 text-sm">Cancel</button>
                                <button type="submit" className="btn-primary flex-1 text-sm" disabled={createBatch.isPending}>
                                    {createBatch.isPending ? 'Adding...' : 'Add to Plan'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
