import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi, productsApi, inventoryApi, fabricsApi, productionApi, adminApi } from '../services/api';
import { useState } from 'react';
import { Plus, X, Trash2, ChevronRight, Check, ChevronLeft, Undo2, ChevronDown, Search } from 'lucide-react';

export default function Orders() {
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<'open' | 'shipped'>('open');
    const { data: openOrders, isLoading: loadingOpen } = useQuery({ queryKey: ['openOrders'], queryFn: () => ordersApi.getOpen().then(r => r.data) });
    const { data: shippedOrders, isLoading: loadingShipped } = useQuery({ queryKey: ['shippedOrders'], queryFn: () => ordersApi.getShipped().then(r => r.data) });
    const { data: allSkus } = useQuery({ queryKey: ['allSkus'], queryFn: () => productsApi.getAllSkus().then(r => r.data) });
    const { data: inventoryBalance } = useQuery({ queryKey: ['inventoryBalance'], queryFn: () => inventoryApi.getBalance().then(r => r.data) });
    const { data: fabricStock } = useQuery({ queryKey: ['fabricStock'], queryFn: () => fabricsApi.getStockAnalysis().then(r => r.data) });
    const { data: channels } = useQuery({ queryKey: ['orderChannels'], queryFn: () => adminApi.getChannels().then(r => r.data) });
    const { data: lockedDates } = useQuery({ queryKey: ['lockedProductionDates'], queryFn: () => productionApi.getLockedDates().then(r => r.data) });
    const [selectedOrder, setSelectedOrder] = useState<any>(null);
    const [shipForm, setShipForm] = useState({ awbNumber: '', courier: '' });
    const [showCreateOrder, setShowCreateOrder] = useState(false);
    const [orderForm, setOrderForm] = useState({ customerName: '', customerEmail: '', customerPhone: '', channel: 'offline' });
    const [orderLines, setOrderLines] = useState<{ skuId: string; qty: number; unitPrice: number }[]>([]);
    const [allocatingLines, setAllocatingLines] = useState<Set<string>>(new Set());
    const [shippingChecked, setShippingChecked] = useState<Set<string>>(new Set());
    const [pendingShipOrder, setPendingShipOrder] = useState<any>(null);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(25);
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');

    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: ['openOrders'] });
        queryClient.invalidateQueries({ queryKey: ['shippedOrders'] });
        queryClient.invalidateQueries({ queryKey: ['inventoryBalance'] });
    };

    const ship = useMutation({
        mutationFn: ({ id, data }: any) => ordersApi.ship(id, data),
        onSuccess: () => {
            invalidateAll();
            setSelectedOrder(null);
            setPendingShipOrder(null);
            setShipForm({ awbNumber: '', courier: '' });
            setShippingChecked(new Set());
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to ship order');
        }
    });

    const handleShippingCheck = (lineId: string, order: any) => {
        const newChecked = new Set(shippingChecked);
        if (newChecked.has(lineId)) {
            newChecked.delete(lineId);
        } else {
            newChecked.add(lineId);
        }
        setShippingChecked(newChecked);

        // Check if all lines of this order are now checked
        const orderLineIds = order.orderLines?.map((l: any) => l.id) || [];
        const allChecked = orderLineIds.every((id: string) => newChecked.has(id));

        if (allChecked && orderLineIds.length > 0) {
            setPendingShipOrder(order);
        }
    };

    const allocate = useMutation({
        mutationFn: (lineId: string) => ordersApi.allocateLine(lineId),
        onMutate: (lineId) => setAllocatingLines(p => new Set(p).add(lineId)),
        onSettled: (_, __, lineId) => { setAllocatingLines(p => { const n = new Set(p); n.delete(lineId); return n; }); invalidateAll(); }
    });

    const unallocate = useMutation({
        mutationFn: (lineId: string) => ordersApi.unallocateLine(lineId),
        onMutate: (lineId) => setAllocatingLines(p => new Set(p).add(lineId)),
        onSettled: (_, __, lineId) => { setAllocatingLines(p => { const n = new Set(p); n.delete(lineId); return n; }); invalidateAll(); }
    });

    const pickLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.pickLine(lineId),
        onMutate: (lineId) => setAllocatingLines(p => new Set(p).add(lineId)),
        onSettled: (_, __, lineId) => { setAllocatingLines(p => { const n = new Set(p); n.delete(lineId); return n; }); invalidateAll(); }
    });

    const unpickLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.unpickLine(lineId),
        onMutate: (lineId) => setAllocatingLines(p => new Set(p).add(lineId)),
        onSettled: (_, __, lineId) => { setAllocatingLines(p => { const n = new Set(p); n.delete(lineId); return n; }); invalidateAll(); }
    });

    const createBatch = useMutation({
        mutationFn: (data: any) => productionApi.createBatch(data),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to add to production')
    });

    const isDateLocked = (dateStr: string) => lockedDates?.includes(dateStr) || false;

    const updateBatch = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => productionApi.updateBatch(id, data),
        onSuccess: () => invalidateAll(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update batch')
    });

    const deleteBatch = useMutation({
        mutationFn: (id: string) => productionApi.deleteBatch(id),
        onSuccess: () => invalidateAll()
    });

    const createOrder = useMutation({
        mutationFn: (data: any) => ordersApi.create(data),
        onSuccess: () => { invalidateAll(); setShowCreateOrder(false); setOrderForm({ customerName: '', customerEmail: '', customerPhone: '', channel: 'offline' }); setOrderLines([]); setLineSelections({}); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create order')
    });

    const deleteOrder = useMutation({
        mutationFn: (id: string) => ordersApi.delete(id),
        onSuccess: () => { invalidateAll(); setSelectedOrder(null); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to delete order')
    });

    const unship = useMutation({
        mutationFn: (id: string) => ordersApi.unship(id),
        onSuccess: () => { invalidateAll(); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to unship order')
    });

    const getSkuBalance = (skuId: string) => {
        const inv = inventoryBalance?.find((i: any) => i.skuId === skuId);
        return inv?.availableBalance ?? inv?.currentBalance ?? 0;
    };

    const getFabricBalance = (fabricId: string) => {
        const fab = fabricStock?.find((f: any) => f.fabricId === fabricId);
        return fab ? parseFloat(fab.currentBalance) : 0;
    };

    const parseCity = (shippingAddress: string | null) => {
        if (!shippingAddress) return '-';
        try {
            const addr = JSON.parse(shippingAddress);
            return addr.city || '-';
        } catch {
            return '-';
        }
    };

    const formatDateTime = (dateStr: string) => {
        const date = new Date(dateStr);
        return {
            date: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
            time: date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
        };
    };

    // Flatten orders into order lines for table display
    const flattenOrders = (orders: any[]) => {
        if (!orders) return [];
        const rows: any[] = [];
        orders.forEach(order => {
            order.orderLines?.forEach((line: any, idx: number) => {
                const fabricId = line.sku?.variation?.fabric?.id;
                const skuStock = getSkuBalance(line.skuId);
                const fabricBal = fabricId ? getFabricBalance(fabricId) : 0;
                const productionBatch = line.productionBatch;
                rows.push({
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    orderDate: order.orderDate,
                    customerName: order.customerName,
                    city: parseCity(order.shippingAddress),
                    productName: line.sku?.variation?.product?.name || '-',
                    colorName: line.sku?.variation?.colorName || '-',
                    size: line.sku?.size || '-',
                    skuCode: line.sku?.skuCode || '-',
                    skuId: line.skuId,
                    qty: line.qty,
                    lineId: line.id,
                    lineStatus: line.lineStatus,
                    skuStock,
                    fabricBalance: fabricBal,
                    shopifyStatus: order.shopifyFulfillmentStatus || '-',
                    productionBatch,
                    productionBatchId: productionBatch?.id,
                    productionDate: productionBatch?.batchDate?.split('T')[0],
                    isFirstLine: idx === 0,
                    totalLines: order.orderLines.length,
                    fulfillmentStage: order.fulfillmentStage,
                    order: order
                });
            });
        });
        return rows;
    };

    const addLine = () => setOrderLines([...orderLines, { skuId: '', qty: 1, unitPrice: 0 }]);
    const removeLine = (idx: number) => setOrderLines(orderLines.filter((_, i) => i !== idx));
    const updateLine = (idx: number, field: string, value: any) => {
        const newLines = [...orderLines];
        (newLines[idx] as any)[field] = value;
        if (field === 'skuId') {
            const sku = allSkus?.find((s: any) => s.id === value);
            if (sku) newLines[idx].unitPrice = Number(sku.mrp);
        }
        setOrderLines(newLines);
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
            .map((sku: any) => ({ id: sku.id, size: sku.size, stock: getSkuBalance(sku.id), mrp: sku.mrp }))
            .sort((a: any, b: any) => {
                const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
                return sizeOrder.indexOf(a.size) - sizeOrder.indexOf(b.size);
            });
    };

    const [lineSelections, setLineSelections] = useState<Record<number, { productId: string; variationId: string }>>({});

    const handleCreateOrder = (e: React.FormEvent) => {
        e.preventDefault();
        if (orderLines.length === 0) return alert('Add at least one item');
        const totalAmount = orderLines.reduce((sum, l) => sum + (l.qty * l.unitPrice), 0);
        createOrder.mutate({
            ...orderForm,
            orderNumber: `COH-${Date.now().toString().slice(-6)}`,
            totalAmount,
            lines: orderLines.map(l => ({ skuId: l.skuId, qty: l.qty, unitPrice: l.unitPrice }))
        });
    };

    const isLoading = tab === 'open' ? loadingOpen : loadingShipped;
    const openRows = flattenOrders(openOrders);
    const shippedRows = flattenOrders(shippedOrders);

    // Filter by search query (order number)
    const filterBySearch = (rows: any[]) => {
        if (!searchQuery.trim()) return rows;
        const query = searchQuery.toLowerCase();
        return rows.filter(row => row.orderNumber?.toLowerCase().includes(query));
    };

    const filteredOpenRows = filterBySearch(openRows);
    const filteredShippedRows = filterBySearch(shippedRows);

    // Filter shipped orders for accordion view
    const filteredShippedOrders = searchQuery.trim()
        ? shippedOrders?.filter((order: any) => order.orderNumber?.toLowerCase().includes(searchQuery.toLowerCase()))
        : shippedOrders;

    // Pagination logic
    const currentRows = tab === 'open' ? filteredOpenRows : filteredShippedRows;
    const totalRows = currentRows.length;
    const totalPages = Math.ceil(totalRows / pageSize);
    const startIndex = (page - 1) * pageSize;
    const paginatedRows = currentRows.slice(startIndex, startIndex + pageSize);

    // Reset page when switching tabs
    const handleTabChange = (newTab: 'open' | 'shipped') => {
        setTab(newTab);
        setPage(1);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search order #..."
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                            className="pl-9 pr-3 py-1.5 text-sm border rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-gray-200"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <button onClick={() => setShowCreateOrder(true)} className="btn-primary flex items-center text-sm"><Plus size={18} className="mr-1" />New Order</button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-4 border-b text-sm">
                <button className={`pb-2 font-medium ${tab === 'open' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => handleTabChange('open')}>
                    Open <span className="text-gray-400 ml-1">({searchQuery ? `${new Set(filteredOpenRows.map(r => r.orderId)).size}/` : ''}{openOrders?.length || 0})</span>
                </button>
                <button className={`pb-2 font-medium ${tab === 'shipped' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => handleTabChange('shipped')}>
                    Shipped <span className="text-gray-400 ml-1">({searchQuery ? `${filteredShippedOrders?.length || 0}/` : ''}{shippedOrders?.length || 0})</span>
                </button>
            </div>

            {isLoading && <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div></div>}

            {/* Open Orders Table */}
            {!isLoading && tab === 'open' && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b text-left text-gray-500 text-xs uppercase tracking-wide">
                                <th className="pb-2 pr-3 font-medium">Date</th>
                                <th className="pb-2 pr-3 font-medium">Order #</th>
                                <th className="pb-2 pr-3 font-medium">Customer</th>
                                <th className="pb-2 pr-3 font-medium">SKU</th>
                                <th className="pb-2 pr-3 font-medium">Item</th>
                                <th className="pb-2 pr-3 font-medium text-center">Qty</th>
                                <th className="pb-2 pr-3 font-medium text-center">Stock</th>
                                <th className="pb-2 pr-3 font-medium text-center">Fabric</th>
                                <th className="pb-2 pr-3 font-medium text-center w-12">Alloc</th>
                                <th className="pb-2 pr-3 font-medium">Production</th>
                                <th className="pb-2 pr-3 font-medium text-center w-12">Picked</th>
                                <th className="pb-2 pr-3 font-medium text-center w-12">Ship</th>
                                <th className="pb-2 pr-3 font-medium">AWB</th>
                                <th className="pb-2 pr-3 font-medium">Courier</th>
                                <th className="pb-2 font-medium w-6"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedRows.map((row, idx) => {
                                const dt = formatDateTime(row.orderDate);
                                const hasStock = row.skuStock >= row.qty;
                                const isAllocated = row.lineStatus === 'allocated' || row.lineStatus === 'picked' || row.lineStatus === 'packed';
                                const isPending = row.lineStatus === 'pending';
                                const canAllocate = isPending && hasStock;
                                const isToggling = allocatingLines.has(row.lineId);
                                const hasProductionDate = !!row.productionBatchId;

                                // Check if ALL lines in this order are allocated (or beyond)
                                const allLinesAllocated = row.order?.orderLines?.every((line: any) =>
                                    line.lineStatus === 'allocated' || line.lineStatus === 'picked' || line.lineStatus === 'packed'
                                );

                                // Row styling based on status
                                let rowBgClass = '';
                                if (row.lineStatus === 'packed') {
                                    rowBgClass = 'bg-green-50 hover:bg-green-100';
                                } else if (row.lineStatus === 'picked') {
                                    rowBgClass = 'bg-emerald-50 hover:bg-emerald-100';
                                } else if (allLinesAllocated) {
                                    rowBgClass = 'bg-green-200 hover:bg-green-300';  // Darkest green: ready to ship
                                } else if (isAllocated) {
                                    rowBgClass = 'bg-green-100 hover:bg-green-200';  // Medium green: this item allocated
                                } else if (hasStock && isPending) {
                                    rowBgClass = 'bg-green-50 hover:bg-green-100';  // Light green: stock available but not allocated
                                } else if (hasProductionDate) {
                                    rowBgClass = 'bg-amber-50 hover:bg-amber-100';
                                } else {
                                    rowBgClass = 'hover:bg-gray-50';
                                }

                                return (
                                    <tr
                                        key={`${row.orderId}-${idx}`}
                                        className={`border-b border-gray-100 cursor-pointer ${rowBgClass} ${row.isFirstLine ? 'border-t-2 border-t-gray-300' : 'text-gray-500'}`}
                                        onClick={() => setSelectedOrder(row.order)}
                                    >
                                        <td className="py-2 pr-3">
                                            {row.isFirstLine ? (
                                                <div>
                                                    <span className="text-gray-900">{dt.date}</span>
                                                    <span className="text-gray-400 ml-1 text-xs">{dt.time}</span>
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="py-2 pr-3">
                                            {row.isFirstLine ? (
                                                <span className="text-gray-600 font-mono text-xs">{row.orderNumber}</span>
                                            ) : null}
                                        </td>
                                        <td className="py-2 pr-3">
                                            {row.isFirstLine ? (
                                                <div>
                                                    <span className="text-gray-900">{row.customerName}</span>
                                                    {row.city && <p className="text-xs text-gray-500">{row.city}</p>}
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="py-2 pr-3 font-mono text-xs text-gray-500">{row.skuCode}</td>
                                        <td className="py-2 pr-3 text-gray-700">{row.productName} - {row.colorName} - {row.size}</td>
                                        <td className="py-2 pr-3 text-center">{row.qty}</td>
                                        <td className="py-2 pr-3 text-center">
                                            <span className={`text-xs ${hasStock ? 'text-green-600' : 'text-red-500'}`}>
                                                {row.skuStock}
                                            </span>
                                        </td>
                                        <td className="py-2 pr-3 text-center">
                                            <span className="text-xs text-gray-500">{row.fabricBalance.toFixed(1)}m</span>
                                        </td>
                                        <td className="py-2 pr-3 text-center" onClick={(e) => e.stopPropagation()}>
                                            {isAllocated ? (
                                                <button
                                                    onClick={() => row.lineStatus === 'allocated' && unallocate.mutate(row.lineId)}
                                                    disabled={isToggling || row.lineStatus !== 'allocated'}
                                                    className={`w-5 h-5 rounded flex items-center justify-center ${
                                                        row.lineStatus === 'allocated'
                                                            ? 'bg-purple-100 text-purple-600 hover:bg-purple-200'
                                                            : 'bg-green-100 text-green-600'
                                                    }`}
                                                    title={row.lineStatus === 'allocated' ? 'Click to unallocate' : row.lineStatus}
                                                >
                                                    <Check size={12} />
                                                </button>
                                            ) : canAllocate ? (
                                                <button
                                                    onClick={() => allocate.mutate(row.lineId)}
                                                    disabled={isToggling}
                                                    className="w-5 h-5 rounded border border-gray-300 hover:border-purple-400 hover:bg-purple-50 flex items-center justify-center"
                                                    title="Click to allocate"
                                                >
                                                    {isToggling ? <span className="animate-spin text-xs">...</span> : null}
                                                </button>
                                            ) : (
                                                <span className="text-gray-300">-</span>
                                            )}
                                        </td>
                                        <td className="py-2 pr-3" onClick={(e) => e.stopPropagation()}>
                                            {/* Show production date for pending items (even with stock available) */}
                                            {row.lineStatus === 'pending' && (row.productionBatchId || !hasStock) ? (
                                                row.productionBatchId ? (
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="date"
                                                            className={`text-xs border rounded px-1 py-0.5 w-28 ${
                                                                isDateLocked(row.productionDate || '')
                                                                    ? 'border-red-200 bg-red-50'
                                                                    : 'border-orange-200 bg-orange-50'
                                                            }`}
                                                            value={row.productionDate || ''}
                                                            min={new Date().toISOString().split('T')[0]}
                                                            onChange={(e) => {
                                                                if (isDateLocked(e.target.value)) {
                                                                    alert(`Production date ${e.target.value} is locked. Cannot move items to this date.`);
                                                                    return;
                                                                }
                                                                updateBatch.mutate({ id: row.productionBatchId, data: { batchDate: e.target.value } });
                                                            }}
                                                        />
                                                        <button
                                                            onClick={() => deleteBatch.mutate(row.productionBatchId)}
                                                            className="text-gray-400 hover:text-red-500"
                                                            title="Remove from production"
                                                        >
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <input
                                                        type="date"
                                                        className="text-xs border border-gray-200 rounded px-1 py-0.5 w-28 text-gray-400 hover:border-orange-300 hover:text-gray-600"
                                                        placeholder="Schedule"
                                                        min={new Date().toISOString().split('T')[0]}
                                                        onChange={(e) => {
                                                            if (e.target.value) {
                                                                if (isDateLocked(e.target.value)) {
                                                                    alert(`Production date ${e.target.value} is locked. Cannot add items to this date.`);
                                                                    e.target.value = '';
                                                                    return;
                                                                }
                                                                createBatch.mutate({
                                                                    skuId: row.skuId,
                                                                    qtyPlanned: row.qty,
                                                                    priority: 'order_fulfillment',
                                                                    sourceOrderLineId: row.lineId,
                                                                    batchDate: e.target.value,
                                                                    notes: `For order ${row.orderNumber}`
                                                                });
                                                            }
                                                        }}
                                                    />
                                                )
                                            ) : allLinesAllocated ? (
                                                <span className="text-xs text-green-700 font-medium">ready to ship</span>
                                            ) : isAllocated ? (
                                                <span className="text-xs text-green-600">allocated</span>
                                            ) : hasStock ? (
                                                <span className="text-xs text-gray-400">-</span>
                                            ) : null}
                                        </td>
                                        <td className="py-2 pr-3 text-center" onClick={(e) => e.stopPropagation()}>
                                            {(row.lineStatus === 'allocated' || row.lineStatus === 'picked') && (
                                                <button
                                                    onClick={() => row.lineStatus === 'picked' ? unpickLine.mutate(row.lineId) : pickLine.mutate(row.lineId)}
                                                    disabled={isToggling}
                                                    className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                                                        row.lineStatus === 'picked'
                                                            ? 'bg-green-500 text-white hover:bg-green-600'
                                                            : 'border-2 border-gray-300 hover:border-green-400 hover:bg-green-50'
                                                    }`}
                                                >
                                                    {isToggling ? (
                                                        <span className="animate-spin text-xs">...</span>
                                                    ) : row.lineStatus === 'picked' ? (
                                                        <Check size={12} />
                                                    ) : null}
                                                </button>
                                            )}
                                        </td>
                                        <td className="py-2 pr-3 text-center" onClick={(e) => e.stopPropagation()}>
                                            {allLinesAllocated && (
                                                <input
                                                    type="checkbox"
                                                    checked={shippingChecked.has(row.lineId)}
                                                    onChange={() => handleShippingCheck(row.lineId, row.order)}
                                                    className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
                                                />
                                            )}
                                        </td>
                                        <td className="py-2 pr-3">
                                            {row.isFirstLine && row.order?.awbNumber && (
                                                <span className="text-xs font-mono text-gray-500">{row.order.awbNumber}</span>
                                            )}
                                        </td>
                                        <td className="py-2 pr-3">
                                            {row.isFirstLine && row.order?.courier && (
                                                <span className="text-xs text-blue-600">{row.order.courier}</span>
                                            )}
                                        </td>
                                        <td className="py-2 text-gray-300">
                                            {row.isFirstLine && <ChevronRight size={14} />}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {totalRows === 0 && (
                        <div className="text-center text-gray-400 py-12">No orders</div>
                    )}

                    {/* Pagination Controls */}
                    {totalRows > 0 && (
                        <div className="flex items-center justify-between border-t pt-3 mt-3">
                            <div className="text-sm text-gray-500">
                                Showing {startIndex + 1}-{Math.min(startIndex + pageSize, totalRows)} of {totalRows} items
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                    className="p-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <ChevronLeft size={16} />
                                </button>
                                <div className="flex items-center gap-1">
                                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                        let pageNum;
                                        if (totalPages <= 5) {
                                            pageNum = i + 1;
                                        } else if (page <= 3) {
                                            pageNum = i + 1;
                                        } else if (page >= totalPages - 2) {
                                            pageNum = totalPages - 4 + i;
                                        } else {
                                            pageNum = page - 2 + i;
                                        }
                                        return (
                                            <button
                                                key={pageNum}
                                                onClick={() => setPage(pageNum)}
                                                className={`w-8 h-8 rounded text-sm ${
                                                    page === pageNum
                                                        ? 'bg-gray-900 text-white'
                                                        : 'hover:bg-gray-100'
                                                }`}
                                            >
                                                {pageNum}
                                            </button>
                                        );
                                    })}
                                </div>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page === totalPages}
                                    className="p-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Shipped Orders Accordion - Grouped by Ship Date */}
            {!isLoading && tab === 'shipped' && (
                <div className="space-y-3">
                    {filteredShippedOrders?.length === 0 && (
                        <div className="text-center text-gray-400 py-12">{searchQuery ? 'No orders found' : 'No shipped orders'}</div>
                    )}
                    {(() => {
                        // Group orders by shipping date
                        const groupedByDate: Record<string, any[]> = {};
                        filteredShippedOrders?.forEach((order: any) => {
                            const shipDate = order.shippedAt
                                ? new Date(order.shippedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                                : 'Unknown';
                            if (!groupedByDate[shipDate]) groupedByDate[shipDate] = [];
                            groupedByDate[shipDate].push(order);
                        });

                        return Object.entries(groupedByDate).map(([shipDate, orders]) => {
                            const isDateExpanded = expandedOrders.has(shipDate);
                            const totalItems = orders.reduce((sum: number, o: any) => sum + (o.orderLines?.length || 0), 0);

                            return (
                                <div key={shipDate} className="border rounded-lg overflow-hidden">
                                    {/* Date Header */}
                                    <div
                                        className="flex items-center justify-between px-4 py-3 bg-gray-100 hover:bg-gray-200 cursor-pointer"
                                        onClick={() => {
                                            const newExpanded = new Set(expandedOrders);
                                            if (isDateExpanded) {
                                                newExpanded.delete(shipDate);
                                            } else {
                                                newExpanded.add(shipDate);
                                            }
                                            setExpandedOrders(newExpanded);
                                        }}
                                    >
                                        <div className="flex items-center gap-4">
                                            <ChevronDown
                                                size={18}
                                                className={`text-gray-500 transition-transform ${isDateExpanded ? 'rotate-180' : ''}`}
                                            />
                                            <span className="text-gray-900 font-semibold">{shipDate}</span>
                                            <span className="text-gray-500 text-sm">
                                                {orders.length} order{orders.length !== 1 ? 's' : ''} • {totalItems} item{totalItems !== 1 ? 's' : ''}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Expanded Orders for this Date */}
                                    {isDateExpanded && (
                                        <div className="divide-y">
                                            {orders.map((order: any) => {
                                                const dt = formatDateTime(order.orderDate);
                                                const isOrderExpanded = expandedOrders.has(order.id);

                                                return (
                                                    <div key={order.id} className="bg-white">
                                                        {/* Order Row - Clickable Sub-Accordion */}
                                                        <div
                                                            className="flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 cursor-pointer"
                                                            onClick={() => {
                                                                const newExpanded = new Set(expandedOrders);
                                                                if (isOrderExpanded) {
                                                                    newExpanded.delete(order.id);
                                                                } else {
                                                                    newExpanded.add(order.id);
                                                                }
                                                                setExpandedOrders(newExpanded);
                                                            }}
                                                        >
                                                            <div className="flex items-center gap-4">
                                                                <ChevronDown
                                                                    size={14}
                                                                    className={`text-gray-400 transition-transform ${isOrderExpanded ? 'rotate-180' : ''}`}
                                                                />
                                                                <span className="text-gray-600 font-mono text-xs">{order.orderNumber}</span>
                                                                <span className="text-gray-900">{order.customerName}</span>
                                                                <span className="text-gray-500 text-sm">{parseCity(order.shippingAddress)}</span>
                                                                <span className="text-gray-400 text-xs">Ordered: {dt.date}</span>
                                                                <span className="text-gray-400 text-xs">• {order.orderLines?.length} item{order.orderLines?.length !== 1 ? 's' : ''}</span>
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                {order.courier && (
                                                                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                                                        {order.courier}
                                                                    </span>
                                                                )}
                                                                {order.awbNumber && (
                                                                    <span className="text-xs font-mono text-gray-500">{order.awbNumber}</span>
                                                                )}
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (confirm(`Undo shipping for ${order.orderNumber}? This will move it back to open orders.`)) {
                                                                            unship.mutate(order.id);
                                                                        }
                                                                    }}
                                                                    disabled={unship.isPending}
                                                                    className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-orange-600"
                                                                    title="Undo shipping"
                                                                >
                                                                    <Undo2 size={14} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                        {/* Order Lines - Expanded */}
                                                        {isOrderExpanded && (
                                                            <table className="w-full text-sm">
                                                                <tbody>
                                                                    {order.orderLines?.map((line: any) => (
                                                                        <tr key={line.id} className="border-b border-gray-100 bg-white">
                                                                            <td className="py-1.5 pl-12 pr-4 text-gray-700">{line.sku?.variation?.product?.name || '-'}</td>
                                                                            <td className="py-1.5 px-4 text-gray-600">{line.sku?.variation?.colorName || '-'}</td>
                                                                            <td className="py-1.5 px-4 text-gray-600">{line.sku?.size || '-'}</td>
                                                                            <td className="py-1.5 px-4 font-mono text-xs text-gray-500">{line.sku?.skuCode || '-'}</td>
                                                                            <td className="py-1.5 px-4 text-center w-16">{line.qty}</td>
                                                                            <td className="py-1.5 px-4 text-right text-gray-600 w-24">₹{Number(line.unitPrice).toLocaleString()}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        });
                    })()}
                </div>
            )}

            {/* Order Detail Modal */}
            {selectedOrder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-lg font-semibold">{selectedOrder.orderNumber}</h2>
                                <p className="text-sm text-gray-500">{selectedOrder.customerName} • {parseCity(selectedOrder.shippingAddress)}</p>
                            </div>
                            <button onClick={() => setSelectedOrder(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>

                        {/* Order Lines */}
                        <div className="border rounded-lg overflow-hidden mb-4">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="text-left py-2 px-3 font-medium text-gray-600">Item</th>
                                        <th className="text-center py-2 px-3 font-medium text-gray-600">Qty</th>
                                        <th className="text-right py-2 px-3 font-medium text-gray-600">Price</th>
                                        <th className="text-right py-2 px-3 font-medium text-gray-600">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {selectedOrder.orderLines?.map((line: any) => (
                                        <tr key={line.id} className="border-t">
                                            <td className="py-2 px-3">
                                                <p className="font-medium">{line.sku?.skuCode}</p>
                                                <p className="text-xs text-gray-500">{line.sku?.variation?.product?.name} - {line.sku?.size}</p>
                                            </td>
                                            <td className="py-2 px-3 text-center">{line.qty}</td>
                                            <td className="py-2 px-3 text-right">₹{Number(line.unitPrice).toLocaleString()}</td>
                                            <td className="py-2 px-3 text-right">
                                                <span className={`text-xs px-2 py-0.5 rounded ${
                                                    line.lineStatus === 'packed' ? 'bg-green-100 text-green-700' :
                                                    line.lineStatus === 'picked' ? 'bg-blue-100 text-blue-700' :
                                                    line.lineStatus === 'allocated' ? 'bg-purple-100 text-purple-700' :
                                                    'bg-gray-100 text-gray-600'
                                                }`}>
                                                    {line.lineStatus}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex justify-between items-center text-sm mb-4">
                            <span className="text-gray-500">Total</span>
                            <span className="font-semibold">₹{Number(selectedOrder.totalAmount).toLocaleString()}</span>
                        </div>

                        {/* Ship Form */}
                        {selectedOrder.fulfillmentStage === 'ready_to_ship' && selectedOrder.status === 'open' && (
                            <form onSubmit={(e) => { e.preventDefault(); ship.mutate({ id: selectedOrder.id, data: shipForm }); }} className="border-t pt-4 space-y-3">
                                <p className="text-sm font-medium text-gray-700">Ship Order</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <input className="input text-sm" placeholder="AWB Number" value={shipForm.awbNumber} onChange={(e) => setShipForm(f => ({ ...f, awbNumber: e.target.value }))} required />
                                    <input className="input text-sm" placeholder="Courier" value={shipForm.courier} onChange={(e) => setShipForm(f => ({ ...f, courier: e.target.value }))} required />
                                </div>
                                <button type="submit" className="btn-primary w-full text-sm" disabled={ship.isPending}>{ship.isPending ? 'Shipping...' : 'Mark as Shipped'}</button>
                            </form>
                        )}

                        {selectedOrder.status === 'shipped' && (
                            <div className="border-t pt-4">
                                <p className="text-sm text-gray-500">Shipped via <span className="font-medium text-gray-700">{selectedOrder.courier}</span></p>
                                <p className="text-sm text-gray-500">AWB: <span className="font-medium text-gray-700">{selectedOrder.awbNumber}</span></p>
                            </div>
                        )}

                        <div className="flex gap-2 mt-4">
                            <button onClick={() => setSelectedOrder(null)} className="btn-secondary flex-1 text-sm">Close</button>
                            {!selectedOrder.shopifyOrderId && (
                                <button
                                    onClick={() => {
                                        if (confirm(`Delete order ${selectedOrder.orderNumber}? This cannot be undone.`)) {
                                            deleteOrder.mutate(selectedOrder.id);
                                        }
                                    }}
                                    className="btn-secondary text-sm text-red-600 hover:bg-red-50 hover:border-red-200 flex items-center gap-1"
                                    disabled={deleteOrder.isPending}
                                >
                                    <Trash2 size={14} />
                                    {deleteOrder.isPending ? 'Deleting...' : 'Delete'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Create Order Modal */}
            {showCreateOrder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto py-8">
                    <div className="bg-white rounded-xl p-6 w-full max-w-lg">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">New Order</h2>
                            <button onClick={() => setShowCreateOrder(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleCreateOrder} className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Customer Name</label>
                                    <input className="input text-sm" value={orderForm.customerName} onChange={(e) => setOrderForm(f => ({ ...f, customerName: e.target.value }))} required />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Channel</label>
                                    <select className="input text-sm" value={orderForm.channel} onChange={(e) => setOrderForm(f => ({ ...f, channel: e.target.value }))}>
                                        {channels?.map((ch: any) => (
                                            <option key={ch.id} value={ch.id}>{ch.name}</option>
                                        ))}
                                        {(!channels || channels.length === 0) && (
                                            <option value="offline">Offline</option>
                                        )}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Email</label>
                                    <input type="email" className="input text-sm" value={orderForm.customerEmail} onChange={(e) => setOrderForm(f => ({ ...f, customerEmail: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 mb-1 block">Phone</label>
                                    <input className="input text-sm" value={orderForm.customerPhone} onChange={(e) => setOrderForm(f => ({ ...f, customerPhone: e.target.value }))} />
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs text-gray-500">Items</label>
                                    <button type="button" onClick={addLine} className="text-xs text-primary-600 hover:underline">+ Add Item</button>
                                </div>
                                {orderLines.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No items added</p>}
                                <div className="space-y-3">
                                    {orderLines.map((line, idx) => {
                                        const selection = lineSelections[idx] || { productId: '', variationId: '' };
                                        const colors = getColorsForProduct(selection.productId);
                                        const sizes = getSizesForProductColor(selection.variationId);
                                        const selectedSku = allSkus?.find((s: any) => s.id === line.skuId);

                                        return (
                                            <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-2">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-xs text-gray-400">Item {idx + 1}</span>
                                                    <button type="button" onClick={() => removeLine(idx)} className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                                                </div>
                                                {/* Product, Color, Size selection */}
                                                <div className="grid grid-cols-3 gap-2">
                                                    <select
                                                        className="input text-sm"
                                                        value={selection.productId}
                                                        onChange={(e) => {
                                                            setLineSelections(s => ({ ...s, [idx]: { productId: e.target.value, variationId: '' } }));
                                                            updateLine(idx, 'skuId', '');
                                                        }}
                                                    >
                                                        <option value="">Product...</option>
                                                        {getUniqueProducts().map((p: any) => (
                                                            <option key={p.id} value={p.id}>{p.name}</option>
                                                        ))}
                                                    </select>
                                                    <select
                                                        className="input text-sm"
                                                        value={selection.variationId}
                                                        onChange={(e) => {
                                                            setLineSelections(s => ({ ...s, [idx]: { ...s[idx], variationId: e.target.value } }));
                                                            updateLine(idx, 'skuId', '');
                                                        }}
                                                        disabled={!selection.productId}
                                                    >
                                                        <option value="">Colour...</option>
                                                        {colors.map((c: any) => (
                                                            <option key={c.id} value={c.id}>{c.name}</option>
                                                        ))}
                                                    </select>
                                                    <select
                                                        className="input text-sm"
                                                        value={line.skuId}
                                                        onChange={(e) => updateLine(idx, 'skuId', e.target.value)}
                                                        disabled={!selection.variationId}
                                                        required
                                                    >
                                                        <option value="">Size...</option>
                                                        {sizes.map((s: any) => (
                                                            <option key={s.id} value={s.id}>{s.size} ({s.stock} in stock)</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                {/* Or search by SKU */}
                                                <div className="flex items-center gap-2 text-xs text-gray-400">
                                                    <span>or</span>
                                                    <select
                                                        className="input text-xs flex-1"
                                                        value={line.skuId}
                                                        onChange={(e) => {
                                                            updateLine(idx, 'skuId', e.target.value);
                                                            // Populate product/color from SKU
                                                            const sku = allSkus?.find((s: any) => s.id === e.target.value);
                                                            if (sku) {
                                                                setLineSelections(s => ({
                                                                    ...s,
                                                                    [idx]: {
                                                                        productId: sku.variation?.product?.id || '',
                                                                        variationId: sku.variation?.id || ''
                                                                    }
                                                                }));
                                                            }
                                                        }}
                                                    >
                                                        <option value="">Search by SKU code...</option>
                                                        {allSkus?.map((sku: any) => (
                                                            <option key={sku.id} value={sku.id}>
                                                                {sku.skuCode} - {sku.variation?.product?.name} {sku.variation?.colorName} {sku.size} ({getSkuBalance(sku.id)})
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                {/* Qty and Price */}
                                                <div className="flex items-center gap-2">
                                                    {selectedSku && (
                                                        <span className="text-xs text-gray-500 flex-1">
                                                            {selectedSku.skuCode}
                                                        </span>
                                                    )}
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-xs text-gray-400">Qty:</span>
                                                        <input type="number" className="input text-sm w-14 text-center" value={line.qty} onChange={(e) => updateLine(idx, 'qty', Number(e.target.value))} min={1} />
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-xs text-gray-400">₹</span>
                                                        <input type="number" className="input text-sm w-20 text-right" value={line.unitPrice} onChange={(e) => updateLine(idx, 'unitPrice', Number(e.target.value))} min={0} />
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {orderLines.length > 0 && <p className="text-right text-sm font-medium mt-2">Total: ₹{orderLines.reduce((sum, l) => sum + (l.qty * l.unitPrice), 0).toLocaleString()}</p>}
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowCreateOrder(false)} className="btn-secondary flex-1 text-sm">Cancel</button>
                                <button type="submit" className="btn-primary flex-1 text-sm" disabled={createOrder.isPending}>{createOrder.isPending ? 'Creating...' : 'Create Order'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Ship Order Modal (from checkbox) */}
            {pendingShipOrder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-lg font-semibold">Ship Order</h2>
                                <p className="text-sm text-gray-500">{pendingShipOrder.orderNumber} • {pendingShipOrder.customerName}</p>
                            </div>
                            <button onClick={() => { setPendingShipOrder(null); setShipForm({ awbNumber: '', courier: '' }); }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={(e) => { e.preventDefault(); ship.mutate({ id: pendingShipOrder.id, data: shipForm }); }} className="space-y-4">
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">AWB Number</label>
                                <input className="input text-sm" placeholder="Enter AWB number" value={shipForm.awbNumber} onChange={(e) => setShipForm(f => ({ ...f, awbNumber: e.target.value }))} required />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Courier</label>
                                <input className="input text-sm" placeholder="Enter courier name" value={shipForm.courier} onChange={(e) => setShipForm(f => ({ ...f, courier: e.target.value }))} required />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => { setPendingShipOrder(null); setShipForm({ awbNumber: '', courier: '' }); }} className="btn-secondary flex-1 text-sm">Cancel</button>
                                <button type="submit" className="btn-primary flex-1 text-sm" disabled={ship.isPending}>{ship.isPending ? 'Shipping...' : 'Mark as Shipped'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
