import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi, productsApi, inventoryApi, fabricsApi, productionApi, adminApi, customersApi } from '../services/api';
import { useState, useMemo, useCallback } from 'react';
import { Plus, X, Trash2, Check, Undo2, ChevronDown, Search, Package, Palette, Layers, ShoppingBag, Calendar, Crown, Medal, Mail, Phone, Pencil, Ban, StickyNote, Archive } from 'lucide-react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, RowStyle } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// Custom compact theme based on Quartz
const compactTheme = themeQuartz.withParams({
    spacing: 4,
    fontSize: 12,
    headerFontSize: 12,
    rowHeight: 28,
    headerHeight: 32,
});

// Default column header names
const DEFAULT_HEADERS: Record<string, string> = {
    orderDate: 'Date',
    orderNumber: 'Order',
    customerName: 'Customer',
    city: 'City',
    customerOrderCount: '#',
    customerLtv: 'LTV',
    skuCode: 'SKU',
    productName: 'Item',
    qty: 'Q',
    skuStock: 'St',
    fabricBalance: 'Fab',
    allocate: 'A',
    production: 'Production',
    notes: 'Notes',
    pick: 'P',
    ship: 'S',
    awb: 'AWB',
    courier: 'Courier',
    actions: '...',
};

// Custom header component that allows editing on double-click
const EditableHeader = (props: any) => {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(props.displayName);

    const handleDoubleClick = () => {
        setEditing(true);
    };

    const handleBlur = () => {
        setEditing(false);
        if (value !== props.displayName) {
            props.setCustomHeader(props.column.colId, value);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            setEditing(false);
            props.setCustomHeader(props.column.colId, value);
        } else if (e.key === 'Escape') {
            setEditing(false);
            setValue(props.displayName);
        }
    };

    if (editing) {
        return (
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                autoFocus
                className="w-full px-1 py-0 text-xs border rounded bg-white"
                style={{ minWidth: '30px' }}
            />
        );
    }

    return (
        <div
            onDoubleClick={handleDoubleClick}
            className="cursor-pointer truncate"
            title={`${props.displayName} (double-click to edit)`}
        >
            {props.displayName}
        </div>
    );
};

export default function Orders() {
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<'open' | 'shipped' | 'cancelled' | 'archived'>('open');
    const { data: openOrders, isLoading: loadingOpen } = useQuery({ queryKey: ['openOrders'], queryFn: () => ordersApi.getOpen().then(r => r.data) });
    const { data: shippedOrders, isLoading: loadingShipped } = useQuery({ queryKey: ['shippedOrders'], queryFn: () => ordersApi.getShipped().then(r => r.data) });
    const { data: cancelledOrders, isLoading: loadingCancelled } = useQuery({ queryKey: ['cancelledOrders'], queryFn: () => ordersApi.getCancelled().then(r => r.data) });
    const { data: archivedOrders, isLoading: loadingArchived } = useQuery({ queryKey: ['archivedOrders'], queryFn: () => ordersApi.getArchived().then(r => r.data) });
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
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [dateRange, setDateRange] = useState<'' | '14' | '30' | '60' | '90' | '180' | '365'>('');
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [customHeaders, setCustomHeaders] = useState<Record<string, string>>(() => {
        const saved = localStorage.getItem('ordersGridHeaders');
        return saved ? JSON.parse(saved) : {};
    });
    const [editingOrder, setEditingOrder] = useState<any>(null);
    const [notesOrder, setNotesOrder] = useState<any>(null);
    const [editForm, setEditForm] = useState({ customerName: '', customerPhone: '', shippingAddress: '' });
    const [notesText, setNotesText] = useState('');

    // Save custom headers to localStorage
    const setCustomHeader = useCallback((colId: string, headerName: string) => {
        setCustomHeaders(prev => {
            const updated = { ...prev, [colId]: headerName };
            localStorage.setItem('ordersGridHeaders', JSON.stringify(updated));
            return updated;
        });
    }, []);

    // Get header name (custom or default)
    const getHeaderName = useCallback((colId: string) => {
        return customHeaders[colId] || DEFAULT_HEADERS[colId] || colId;
    }, [customHeaders]);

    // Fetch customer details when a customer is selected
    const { data: customerDetail, isLoading: customerLoading } = useQuery({
        queryKey: ['customer', selectedCustomerId],
        queryFn: () => customersApi.getById(selectedCustomerId!).then(r => r.data),
        enabled: !!selectedCustomerId
    });

    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: ['openOrders'] });
        queryClient.invalidateQueries({ queryKey: ['shippedOrders'] });
        queryClient.invalidateQueries({ queryKey: ['cancelledOrders'] });
        queryClient.invalidateQueries({ queryKey: ['archivedOrders'] });
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

    const cancelOrder = useMutation({
        mutationFn: ({ id, reason }: { id: string; reason?: string }) => ordersApi.cancel(id, reason),
        onSuccess: () => { invalidateAll(); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to cancel order')
    });

    const updateOrder = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => ordersApi.update(id, data),
        onSuccess: () => { invalidateAll(); setEditingOrder(null); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update order')
    });

    const updateOrderNotes = useMutation({
        mutationFn: ({ id, notes }: { id: string; notes: string }) => ordersApi.update(id, { internalNotes: notes }),
        onSuccess: () => { invalidateAll(); setNotesOrder(null); setNotesText(''); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update notes')
    });

    const uncancelOrder = useMutation({
        mutationFn: (id: string) => ordersApi.uncancel(id),
        onSuccess: () => { invalidateAll(); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to restore order')
    });

    const archiveOrder = useMutation({
        mutationFn: (id: string) => ordersApi.archive(id),
        onSuccess: () => { invalidateAll(); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to archive order')
    });

    const unarchiveOrder = useMutation({
        mutationFn: (id: string) => ordersApi.unarchive(id),
        onSuccess: () => { invalidateAll(); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to restore order')
    });

    const cancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.cancelLine(lineId),
        onSuccess: () => { invalidateAll(); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to cancel line')
    });

    const uncancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.uncancelLine(lineId),
        onSuccess: () => { invalidateAll(); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to restore line')
    });

    const updateLine = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data: any }) => ordersApi.updateLine(lineId, data),
        onSuccess: () => { invalidateAll(); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update line')
    });

    const addLine = useMutation({
        mutationFn: ({ orderId, data }: { orderId: string; data: any }) => ordersApi.addLine(orderId, data),
        onSuccess: () => { invalidateAll(); setEditingOrder(null); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to add line')
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
            date: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
            time: date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
        };
    };

    // Compute customer stats from all orders (open + shipped)
    const customerStats = useMemo(() => {
        const stats: Record<string, { orderCount: number; ltv: number }> = {};
        const allOrders = [...(openOrders || []), ...(shippedOrders || [])];
        allOrders.forEach(order => {
            const key = order.customerEmail || order.customerName || 'unknown';
            if (!stats[key]) {
                stats[key] = { orderCount: 0, ltv: 0 };
            }
            stats[key].orderCount++;
            stats[key].ltv += Number(order.totalAmount) || 0;
        });
        return stats;
    }, [openOrders, shippedOrders]);

    // Flatten orders into order lines for table display (sorted by newest first)
    const flattenOrders = (orders: any[]) => {
        if (!orders) return [];
        // Sort orders by date descending (newest first)
        const sortedOrders = [...orders].sort((a, b) =>
            new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
        );
        const rows: any[] = [];
        sortedOrders.forEach(order => {
            const customerKey = order.customerEmail || order.customerName || 'unknown';
            const custStats = customerStats[customerKey] || { orderCount: 0, ltv: 0 };
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
                    customerOrderCount: custStats.orderCount,
                    customerLtv: custStats.ltv,
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

    const addFormLine = () => setOrderLines([...orderLines, { skuId: '', qty: 1, unitPrice: 0 }]);
    const removeLine = (idx: number) => setOrderLines(orderLines.filter((_, i) => i !== idx));
    const updateFormLine = (idx: number, field: string, value: any) => {
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
                const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];
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

    const isLoading = tab === 'open' ? loadingOpen : tab === 'shipped' ? loadingShipped : tab === 'cancelled' ? loadingCancelled : loadingArchived;
    const openRows = flattenOrders(openOrders);

    // Filter by search query and date range
    const filterRows = (rows: any[]) => {
        let filtered = rows;

        // Filter by search query (order number)
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(row => row.orderNumber?.toLowerCase().includes(query));
        }

        // Filter by date range (open orders only)
        if (tab === 'open' && dateRange) {
            const days = parseInt(dateRange);
            const fromDate = new Date();
            fromDate.setDate(fromDate.getDate() - days);
            fromDate.setHours(0, 0, 0, 0);
            filtered = filtered.filter(row => new Date(row.orderDate) >= fromDate);
        }

        return filtered;
    };

    const filteredOpenRows = filterRows(openRows);

    // Filter shipped orders for accordion view
    const filteredShippedOrders = searchQuery.trim()
        ? shippedOrders?.filter((order: any) => order.orderNumber?.toLowerCase().includes(searchQuery.toLowerCase()))
        : shippedOrders;

    // Count unique orders for display
    const uniqueOpenOrderCount = new Set(filteredOpenRows.map(r => r.orderId)).size;

    const handleTabChange = (newTab: 'open' | 'shipped' | 'cancelled' | 'archived') => {
        setTab(newTab);
    };

    // AG Grid column definitions
    const columnDefs = useMemo<ColDef[]>(() => [
        {
            colId: 'orderDate',
            headerName: getHeaderName('orderDate'),
            field: 'orderDate',
            width: 130,
            valueFormatter: (params) => {
                if (!params.data?.isFirstLine) return '';
                const dt = formatDateTime(params.value);
                return `${dt.date} ${dt.time}`;
            },
            cellClass: 'text-xs',
        },
        {
            colId: 'orderNumber',
            headerName: getHeaderName('orderNumber'),
            field: 'orderNumber',
            width: 110,
            valueFormatter: (params) => params.data?.isFirstLine ? params.value : '',
            cellClass: 'text-xs font-mono text-gray-600',
        },
        {
            colId: 'customerName',
            headerName: getHeaderName('customerName'),
            field: 'customerName',
            width: 130,
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.data?.isFirstLine) return null;
                const order = params.data.order;
                const customerId = order?.customerId;
                return (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (customerId) {
                                setSelectedCustomerId(customerId);
                            }
                        }}
                        className={`text-left truncate max-w-full ${customerId ? 'text-blue-600 hover:text-blue-800 hover:underline' : 'text-gray-700'}`}
                        title={params.value}
                        disabled={!customerId}
                    >
                        {params.value}
                    </button>
                );
            },
            cellClass: 'text-xs',
        },
        {
            colId: 'city',
            headerName: getHeaderName('city'),
            field: 'city',
            width: 80,
            valueFormatter: (params) => params.data?.isFirstLine ? (params.value || '') : '',
            cellClass: 'text-xs text-gray-500',
        },
        {
            colId: 'customerOrderCount',
            headerName: getHeaderName('customerOrderCount'),
            field: 'customerOrderCount',
            width: 40,
            valueFormatter: (params) => params.data?.isFirstLine ? params.value : '',
            cellClass: 'text-xs text-center text-gray-500',
            headerTooltip: 'Customer Order Count',
        },
        {
            colId: 'customerLtv',
            headerName: getHeaderName('customerLtv'),
            field: 'customerLtv',
            width: 70,
            valueFormatter: (params) => {
                if (!params.data?.isFirstLine) return '';
                return `₹${(params.value / 1000).toFixed(0)}k`;
            },
            cellClass: 'text-xs text-right text-gray-500',
            headerTooltip: 'Customer Lifetime Value',
        },
        {
            colId: 'skuCode',
            headerName: getHeaderName('skuCode'),
            field: 'skuCode',
            width: 100,
            cellClass: 'text-xs font-mono text-gray-500',
        },
        {
            colId: 'productName',
            headerName: getHeaderName('productName'),
            field: 'productName',
            flex: 1,
            minWidth: 180,
            valueFormatter: (params) => `${params.value} - ${params.data?.colorName} - ${params.data?.size}`,
            cellClass: 'text-xs',
        },
        {
            colId: 'qty',
            headerName: getHeaderName('qty'),
            field: 'qty',
            width: 45,
            cellClass: 'text-xs text-center',
        },
        {
            colId: 'skuStock',
            headerName: getHeaderName('skuStock'),
            field: 'skuStock',
            width: 45,
            cellRenderer: (params: ICellRendererParams) => {
                const hasStock = params.value >= params.data?.qty;
                return <span className={hasStock ? 'text-green-600' : 'text-red-500'}>{params.value}</span>;
            },
            cellClass: 'text-xs text-center',
        },
        {
            colId: 'fabricBalance',
            headerName: getHeaderName('fabricBalance'),
            field: 'fabricBalance',
            width: 55,
            valueFormatter: (params) => `${params.value?.toFixed(0)}m`,
            cellClass: 'text-xs text-center text-gray-500',
        },
        {
            colId: 'allocate',
            headerName: getHeaderName('allocate'),
            width: 40,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                const hasStock = row.skuStock >= row.qty;
                const isAllocated = row.lineStatus === 'allocated' || row.lineStatus === 'picked' || row.lineStatus === 'packed';
                const isPending = row.lineStatus === 'pending';
                const canAllocate = isPending && hasStock;
                const isToggling = allocatingLines.has(row.lineId);

                if (isAllocated) {
                    return (
                        <button
                            onClick={(e) => { e.stopPropagation(); row.lineStatus === 'allocated' && unallocate.mutate(row.lineId); }}
                            disabled={isToggling || row.lineStatus !== 'allocated'}
                            className={`w-4 h-4 rounded flex items-center justify-center mx-auto ${
                                row.lineStatus === 'allocated' ? 'bg-purple-100 text-purple-600 hover:bg-purple-200' : 'bg-green-100 text-green-600'
                            }`}
                            title={row.lineStatus === 'allocated' ? 'Unallocate' : row.lineStatus}
                        >
                            <Check size={10} />
                        </button>
                    );
                } else if (canAllocate) {
                    return (
                        <button
                            onClick={(e) => { e.stopPropagation(); allocate.mutate(row.lineId); }}
                            disabled={isToggling}
                            className="w-4 h-4 rounded border border-gray-300 hover:border-purple-400 hover:bg-purple-50 flex items-center justify-center mx-auto"
                            title="Allocate"
                        >
                            {isToggling ? <span className="animate-spin">·</span> : null}
                        </button>
                    );
                }
                return <span className="text-gray-300">-</span>;
            },
            cellClass: 'text-center',
        },
        {
            colId: 'production',
            headerName: getHeaderName('production'),
            width: 120,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                const hasStock = row.skuStock >= row.qty;
                const allLinesAllocated = row.order?.orderLines?.every((line: any) =>
                    line.lineStatus === 'allocated' || line.lineStatus === 'picked' || line.lineStatus === 'packed'
                );
                const isAllocated = row.lineStatus === 'allocated' || row.lineStatus === 'picked' || row.lineStatus === 'packed';

                if (row.lineStatus === 'pending' && (row.productionBatchId || !hasStock)) {
                    if (row.productionBatchId) {
                        return (
                            <div className="flex items-center gap-0.5">
                                <input
                                    type="date"
                                    className={`text-xs border rounded px-0.5 py-0 w-24 ${
                                        isDateLocked(row.productionDate || '') ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50'
                                    }`}
                                    value={row.productionDate || ''}
                                    min={new Date().toISOString().split('T')[0]}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                        if (isDateLocked(e.target.value)) {
                                            alert(`Production date ${e.target.value} is locked.`);
                                            return;
                                        }
                                        updateBatch.mutate({ id: row.productionBatchId, data: { batchDate: e.target.value } });
                                    }}
                                />
                                <button onClick={(e) => { e.stopPropagation(); deleteBatch.mutate(row.productionBatchId); }} className="text-gray-400 hover:text-red-500">
                                    <X size={10} />
                                </button>
                            </div>
                        );
                    }
                    return (
                        <input
                            type="date"
                            className="text-xs border border-gray-200 rounded px-0.5 py-0 w-24 text-gray-400 hover:border-orange-300"
                            min={new Date().toISOString().split('T')[0]}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                                if (e.target.value) {
                                    if (isDateLocked(e.target.value)) {
                                        alert(`Date ${e.target.value} is locked.`);
                                        e.target.value = '';
                                        return;
                                    }
                                    createBatch.mutate({
                                        skuId: row.skuId,
                                        qtyPlanned: row.qty,
                                        priority: 'order_fulfillment',
                                        sourceOrderLineId: row.lineId,
                                        batchDate: e.target.value,
                                        notes: `For ${row.orderNumber}`
                                    });
                                }
                            }}
                        />
                    );
                } else if (allLinesAllocated) {
                    return <span className="text-green-700 font-medium text-xs">ready</span>;
                } else if (isAllocated) {
                    return <span className="text-green-600 text-xs">alloc</span>;
                } else if (hasStock) {
                    return <span className="text-gray-300">-</span>;
                }
                return null;
            },
        },
        {
            colId: 'notes',
            headerName: getHeaderName('notes'),
            width: 120,
            editable: (params) => params.data?.isFirstLine,
            valueGetter: (params) => params.data?.isFirstLine ? (params.data.order?.internalNotes || '') : '',
            valueSetter: (params) => {
                if (params.data?.isFirstLine && params.data?.order) {
                    updateOrderNotes.mutate({ id: params.data.order.id, notes: params.newValue });
                }
                return true;
            },
            cellClass: (params) => {
                if (!params.data?.isFirstLine) return 'text-transparent';
                return params.data?.order?.internalNotes ? 'text-xs text-yellow-700 bg-yellow-50' : 'text-xs text-gray-400';
            },
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row?.isFirstLine) return null;
                const notes = row.order?.internalNotes || '';
                if (!notes) return <span className="text-gray-300 italic">click to add</span>;
                return <span title={notes}>{notes.length > 15 ? notes.substring(0, 15) + '...' : notes}</span>;
            },
        },
        {
            colId: 'pick',
            headerName: getHeaderName('pick'),
            width: 35,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                if (row.lineStatus === 'cancelled') return <span className="text-gray-300">-</span>;
                const isToggling = allocatingLines.has(row.lineId);
                if (row.lineStatus === 'allocated' || row.lineStatus === 'picked') {
                    return (
                        <button
                            onClick={(e) => { e.stopPropagation(); row.lineStatus === 'picked' ? unpickLine.mutate(row.lineId) : pickLine.mutate(row.lineId); }}
                            disabled={isToggling}
                            className={`w-4 h-4 rounded flex items-center justify-center mx-auto ${
                                row.lineStatus === 'picked' ? 'bg-green-500 text-white' : 'border border-gray-300 hover:border-green-400'
                            }`}
                        >
                            {row.lineStatus === 'picked' && <Check size={10} />}
                        </button>
                    );
                }
                return null;
            },
            cellClass: 'text-center',
        },
        {
            colId: 'ship',
            headerName: getHeaderName('ship'),
            width: 35,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                const allLinesAllocated = row.order?.orderLines?.every((line: any) =>
                    line.lineStatus === 'allocated' || line.lineStatus === 'picked' || line.lineStatus === 'packed'
                );
                if (allLinesAllocated) {
                    return (
                        <input
                            type="checkbox"
                            checked={shippingChecked.has(row.lineId)}
                            onChange={() => handleShippingCheck(row.lineId, row.order)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-3 h-3 rounded border-gray-300 text-green-600 cursor-pointer"
                        />
                    );
                }
                return null;
            },
            cellClass: 'text-center',
        },
        {
            colId: 'awb',
            headerName: getHeaderName('awb'),
            field: 'order.awbNumber',
            width: 100,
            valueFormatter: (params) => params.data?.isFirstLine ? (params.data.order?.awbNumber || '') : '',
            cellClass: 'text-xs font-mono text-gray-500',
        },
        {
            colId: 'courier',
            headerName: getHeaderName('courier'),
            field: 'order.courier',
            width: 80,
            valueFormatter: (params) => params.data?.isFirstLine ? (params.data.order?.courier || '') : '',
            cellClass: 'text-xs text-blue-600',
        },
        {
            colId: 'actions',
            headerName: getHeaderName('actions'),
            width: 100,
            sortable: false,
            resizable: false,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                const order = row.order;
                const isCancelledLine = row.lineStatus === 'cancelled';

                // Line-level cancel/restore button (shown for all lines)
                const lineAction = (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (isCancelledLine) {
                                uncancelLine.mutate(row.lineId);
                            } else if (confirm(`Cancel this line item?\n\n${row.productName} - ${row.skuCode}`)) {
                                cancelLine.mutate(row.lineId);
                            }
                        }}
                        disabled={cancelLine.isPending || uncancelLine.isPending}
                        className={`p-1 rounded hover:bg-gray-100 ${isCancelledLine ? 'text-green-500 hover:text-green-600' : 'text-gray-400 hover:text-red-500'}`}
                        title={isCancelledLine ? 'Restore line' : 'Cancel line'}
                    >
                        {isCancelledLine ? <Undo2 size={12} /> : <X size={12} />}
                    </button>
                );

                // Order-level actions only on first line
                if (!row.isFirstLine) {
                    return <div className="flex items-center justify-end">{lineAction}</div>;
                }

                return (
                    <div className="flex items-center gap-0.5">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setEditingOrder(order);
                                setEditForm({
                                    customerName: order.customerName || '',
                                    customerPhone: order.customerPhone || '',
                                    shippingAddress: order.shippingAddress || '',
                                });
                            }}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600"
                            title="Edit order"
                        >
                            <Pencil size={12} />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const reason = prompt(`Cancel order ${order.orderNumber}?\n\nEnter cancellation reason (optional):`);
                                if (reason !== null) {
                                    cancelOrder.mutate({ id: order.id, reason: reason || undefined });
                                }
                            }}
                            disabled={cancelOrder.isPending}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-red-600"
                            title="Cancel order"
                        >
                            <Ban size={12} />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Archive order ${order.orderNumber}?\n\nThis will hide it from the open orders list.`)) {
                                    archiveOrder.mutate(order.id);
                                }
                            }}
                            disabled={archiveOrder.isPending}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-600"
                            title="Archive order"
                        >
                            <Archive size={12} />
                        </button>
                        {lineAction}
                    </div>
                );
            },
        },
    ], [allocatingLines, shippingChecked, lockedDates, getHeaderName, cancelOrder, cancelLine, uncancelLine, archiveOrder]);

    const defaultColDef = useMemo<ColDef>(() => ({
        sortable: true,
        resizable: true,
        suppressMovable: true,
        headerComponent: EditableHeader,
        headerComponentParams: {
            setCustomHeader,
        },
    }), [setCustomHeader]);

    // Reset column headers to default
    const resetHeaders = useCallback(() => {
        setCustomHeaders({});
        localStorage.removeItem('ordersGridHeaders');
    }, []);

    const getRowStyle = useCallback((params: any): RowStyle | undefined => {
        const row = params.data;
        if (!row) return undefined;

        // Cancelled lines - gray and strikethrough effect
        if (row.lineStatus === 'cancelled') {
            return { backgroundColor: '#f3f4f6', color: '#9ca3af', textDecoration: 'line-through' };
        }

        const activeLines = row.order?.orderLines?.filter((line: any) => line.lineStatus !== 'cancelled') || [];
        const allLinesAllocated = activeLines.length > 0 && activeLines.every((line: any) =>
            line.lineStatus === 'allocated' || line.lineStatus === 'picked' || line.lineStatus === 'packed'
        );
        const hasStock = row.skuStock >= row.qty;
        const isAllocated = row.lineStatus === 'allocated' || row.lineStatus === 'picked' || row.lineStatus === 'packed';
        const isPending = row.lineStatus === 'pending';
        const hasProductionDate = !!row.productionBatchId;

        if (row.lineStatus === 'packed') return { backgroundColor: '#f0fdf4' };
        if (row.lineStatus === 'picked') return { backgroundColor: '#ecfdf5' };
        if (allLinesAllocated) return { backgroundColor: '#bbf7d0' };
        if (isAllocated) return { backgroundColor: '#dcfce7' };
        if (hasStock && isPending) return { backgroundColor: '#f0fdf4' };
        if (hasProductionDate) return { backgroundColor: '#fffbeb' };
        return undefined;
    }, []);

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
                            onChange={(e) => setSearchQuery(e.target.value)}
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

            {/* Tabs and Date Filter */}
            <div className="flex items-center justify-between border-b">
                <div className="flex gap-4 text-sm">
                    <button className={`pb-2 font-medium ${tab === 'open' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => handleTabChange('open')}>
                        Open <span className="text-gray-400 ml-1">({(searchQuery || dateRange) ? `${uniqueOpenOrderCount}/` : ''}{openOrders?.length || 0})</span>
                    </button>
                    <button className={`pb-2 font-medium ${tab === 'shipped' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => handleTabChange('shipped')}>
                        Shipped <span className="text-gray-400 ml-1">({searchQuery ? `${filteredShippedOrders?.length || 0}/` : ''}{shippedOrders?.length || 0})</span>
                    </button>
                    <button className={`pb-2 font-medium ${tab === 'cancelled' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => handleTabChange('cancelled')}>
                        Cancelled <span className="text-gray-400 ml-1">({cancelledOrders?.length || 0})</span>
                    </button>
                    <button className={`pb-2 font-medium ${tab === 'archived' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`} onClick={() => handleTabChange('archived')}>
                        Archived <span className="text-gray-400 ml-1">({archivedOrders?.length || 0})</span>
                    </button>
                </div>
                {tab === 'open' && (
                    <div className="flex items-center gap-2 pb-2">
                        <select
                            value={dateRange}
                            onChange={(e) => setDateRange(e.target.value as typeof dateRange)}
                            className="text-xs border rounded px-2 py-1 bg-white"
                        >
                            <option value="">All time</option>
                            <option value="14">Last 14 days</option>
                            <option value="30">Last 30 days</option>
                            <option value="60">Last 60 days</option>
                            <option value="90">Last 90 days</option>
                            <option value="180">Last 180 days</option>
                            <option value="365">Last 365 days</option>
                        </select>
                        {Object.keys(customHeaders).length > 0 && (
                            <button
                                onClick={resetHeaders}
                                className="text-xs text-gray-400 hover:text-gray-600"
                                title="Reset column headers to default"
                            >
                                Reset headers
                            </button>
                        )}
                    </div>
                )}
            </div>

            {isLoading && <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div></div>}

            {/* Open Orders Table - AG Grid */}
            {!isLoading && tab === 'open' && filteredOpenRows.length > 0 && (
                <div className="border rounded" style={{ height: '600px', width: '100%' }}>
                    <AgGridReact
                        key={JSON.stringify(customHeaders)}
                        rowData={filteredOpenRows}
                        columnDefs={columnDefs}
                        defaultColDef={defaultColDef}
                        getRowStyle={getRowStyle}
                        theme={compactTheme}
                        rowSelection="multiple"
                        enableCellTextSelection={true}
                        ensureDomOrder={true}
                        cellSelection={true}
                    />
                </div>
            )}
            {!isLoading && tab === 'open' && filteredOpenRows.length === 0 && (
                <div className="text-center text-gray-400 py-12 border rounded">
                    {(searchQuery || dateRange) ? 'No orders match your filters' : 'No open orders'}
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

            {/* Cancelled Orders Tab */}
            {!isLoading && tab === 'cancelled' && (
                <div className="card divide-y">
                    {cancelledOrders?.length === 0 ? (
                        <p className="text-center py-8 text-gray-400">No cancelled orders</p>
                    ) : (
                        cancelledOrders?.map((order: any) => (
                            <div key={order.id} className="p-4 hover:bg-gray-50">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-4">
                                        <span className="text-gray-600 font-mono text-xs">{order.orderNumber}</span>
                                        <span className="text-gray-900">{order.customerName}</span>
                                        <span className="text-gray-500 text-sm">{parseCity(order.shippingAddress)}</span>
                                        <span className="text-gray-400 text-xs">
                                            {new Date(order.orderDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                        </span>
                                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Cancelled</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-gray-400 text-xs">₹{Number(order.totalAmount).toLocaleString()}</span>
                                        <button
                                            onClick={() => {
                                                if (confirm(`Restore order ${order.orderNumber} to open orders?`)) {
                                                    uncancelOrder.mutate(order.id);
                                                }
                                            }}
                                            disabled={uncancelOrder.isPending}
                                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                        >
                                            <Undo2 size={12} /> Restore
                                        </button>
                                    </div>
                                </div>
                                {order.internalNotes && (
                                    <p className="text-xs text-gray-500 ml-4 mt-1">{order.internalNotes}</p>
                                )}
                                <div className="text-xs text-gray-500 mt-2">
                                    {order.orderLines?.map((line: any) => (
                                        <span key={line.id} className="mr-3">
                                            {line.sku?.variation?.product?.name} ({line.sku?.size}) x{line.qty}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Archived Orders Tab */}
            {!isLoading && tab === 'archived' && (
                <div className="card divide-y">
                    {archivedOrders?.length === 0 ? (
                        <p className="text-center py-8 text-gray-400">No archived orders</p>
                    ) : (
                        archivedOrders?.map((order: any) => (
                            <div key={order.id} className="p-4 hover:bg-gray-50">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-4">
                                        <span className="text-gray-600 font-mono text-xs">{order.orderNumber}</span>
                                        <span className="text-gray-900">{order.customerName}</span>
                                        <span className="text-gray-500 text-sm">{parseCity(order.shippingAddress)}</span>
                                        <span className="text-gray-400 text-xs">
                                            {new Date(order.orderDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                        </span>
                                        <span className={`text-xs px-2 py-0.5 rounded ${
                                            order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                                            order.status === 'shipped' || order.status === 'delivered' ? 'bg-green-100 text-green-700' :
                                            'bg-amber-100 text-amber-700'
                                        }`}>
                                            {order.status === 'open' ? 'Was Open' : order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                                        </span>
                                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                            Archived {order.archivedAt ? new Date(order.archivedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-gray-400 text-xs">₹{Number(order.totalAmount).toLocaleString()}</span>
                                        <button
                                            onClick={() => {
                                                if (confirm(`Restore order ${order.orderNumber} from archive?`)) {
                                                    unarchiveOrder.mutate(order.id);
                                                }
                                            }}
                                            disabled={unarchiveOrder.isPending}
                                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                        >
                                            <Undo2 size={12} /> Restore
                                        </button>
                                    </div>
                                </div>
                                {order.internalNotes && (
                                    <p className="text-xs text-gray-500 ml-4 mt-1">{order.internalNotes}</p>
                                )}
                                <div className="text-xs text-gray-500 mt-2">
                                    {order.orderLines?.map((line: any) => (
                                        <span key={line.id} className="mr-3">
                                            {line.sku?.variation?.product?.name} ({line.sku?.size}) x{line.qty}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
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
                                    <button type="button" onClick={addFormLine} className="text-xs text-primary-600 hover:underline">+ Add Item</button>
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
                                                            updateFormLine(idx, 'skuId', '');
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
                                                            updateFormLine(idx, 'skuId', '');
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
                                                        onChange={(e) => updateFormLine(idx, 'skuId', e.target.value)}
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
                                                            updateFormLine(idx, 'skuId', e.target.value);
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
                                                        <input type="number" className="input text-sm w-14 text-center" value={line.qty} onChange={(e) => updateFormLine(idx, 'qty', Number(e.target.value))} min={1} />
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-xs text-gray-400">₹</span>
                                                        <input type="number" className="input text-sm w-20 text-right" value={line.unitPrice} onChange={(e) => updateFormLine(idx, 'unitPrice', Number(e.target.value))} min={0} />
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

            {/* Customer Detail Modal */}
            {selectedCustomerId && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
                        <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                            <h2 className="text-lg font-bold text-gray-900">Customer Details</h2>
                            <button onClick={() => setSelectedCustomerId(null)} className="p-2 hover:bg-gray-200 rounded-lg">
                                <X size={20} />
                            </button>
                        </div>

                        {customerLoading ? (
                            <div className="flex justify-center p-12">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600"></div>
                            </div>
                        ) : customerDetail ? (
                            <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
                                {/* Customer Info Header */}
                                <div className="p-4 border-b">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <div className="flex items-center gap-3 mb-2">
                                                <h3 className="text-lg font-semibold">{customerDetail.firstName} {customerDetail.lastName}</h3>
                                                {customerDetail.customerTier && (
                                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                                        customerDetail.customerTier === 'platinum' ? 'bg-purple-100 text-purple-800' :
                                                        customerDetail.customerTier === 'gold' ? 'bg-yellow-100 text-yellow-800' :
                                                        customerDetail.customerTier === 'silver' ? 'bg-gray-100 text-gray-800' :
                                                        'bg-orange-100 text-orange-800'
                                                    }`}>
                                                        {customerDetail.customerTier === 'platinum' && <Crown size={12} className="inline mr-1" />}
                                                        {customerDetail.customerTier === 'gold' && <Medal size={12} className="inline mr-1" />}
                                                        {customerDetail.customerTier}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                                                <a href={`mailto:${customerDetail.email}`} className="flex items-center gap-1 hover:text-blue-600">
                                                    <Mail size={14} />{customerDetail.email}
                                                </a>
                                                {customerDetail.phone && (
                                                    <a href={`tel:${customerDetail.phone}`} className="flex items-center gap-1 hover:text-blue-600">
                                                        <Phone size={14} />{customerDetail.phone}
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-2xl font-bold text-blue-600">₹{Number(customerDetail.lifetimeValue || 0).toLocaleString()}</p>
                                            <p className="text-sm text-gray-500">Lifetime Value</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Stats Grid */}
                                <div className="grid grid-cols-3 gap-4 p-4 border-b bg-gray-50">
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-gray-900">{customerDetail.totalOrders || 0}</p>
                                        <p className="text-sm text-gray-500">Total Orders</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-gray-900">{customerDetail.returnRequests?.length || 0}</p>
                                        <p className="text-sm text-gray-500">Returns</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-gray-900">{customerDetail.productAffinity?.length || 0}</p>
                                        <p className="text-sm text-gray-500">Products Ordered</p>
                                    </div>
                                </div>

                                {/* Product Affinity */}
                                {customerDetail.productAffinity?.length > 0 && (
                                    <div className="p-4 border-b">
                                        <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                            <Package size={16} /> Top Products
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {customerDetail.productAffinity.map((p: any, i: number) => (
                                                <span key={i} className="px-3 py-1 bg-gray-100 rounded-full text-sm">
                                                    {p.productName} <span className="text-gray-500">({p.qty})</span>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Color Affinity */}
                                {customerDetail.colorAffinity?.length > 0 && (
                                    <div className="p-4 border-b">
                                        <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                            <Palette size={16} /> Top Colors
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {customerDetail.colorAffinity.map((c: any, i: number) => (
                                                <span key={i} className="px-3 py-1 bg-purple-50 text-purple-800 rounded-full text-sm">
                                                    {c.color} <span className="text-purple-500">({c.qty})</span>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Fabric Affinity */}
                                {customerDetail.fabricAffinity?.length > 0 && (
                                    <div className="p-4 border-b">
                                        <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                            <Layers size={16} /> Top Fabrics
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {customerDetail.fabricAffinity.map((f: any, i: number) => (
                                                <span key={i} className="px-3 py-1 bg-amber-50 text-amber-800 rounded-full text-sm">
                                                    {f.fabricType} <span className="text-amber-500">({f.qty})</span>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Recent Orders */}
                                {customerDetail.orders?.length > 0 && (
                                    <div className="p-4">
                                        <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                            <ShoppingBag size={16} /> Recent Orders
                                        </h4>
                                        <div className="space-y-3">
                                            {customerDetail.orders.slice(0, 5).map((order: any) => (
                                                <div key={order.id} className="border rounded-lg p-3">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="flex items-center gap-3">
                                                            <span className="font-medium">#{order.orderNumber}</span>
                                                            <span className={`px-2 py-0.5 rounded text-xs ${
                                                                order.status === 'open' ? 'bg-blue-100 text-blue-800' :
                                                                order.status === 'shipped' ? 'bg-yellow-100 text-yellow-800' :
                                                                order.status === 'delivered' ? 'bg-green-100 text-green-800' :
                                                                'bg-gray-100 text-gray-800'
                                                            }`}>{order.status}</span>
                                                        </div>
                                                        <div className="text-right">
                                                            <span className="font-semibold">₹{Number(order.totalAmount).toLocaleString()}</span>
                                                            <p className="text-xs text-gray-500 flex items-center gap-1 justify-end">
                                                                <Calendar size={12} />
                                                                {new Date(order.orderDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="text-sm text-gray-600 space-y-1">
                                                        {order.orderLines?.slice(0, 3).map((line: any) => (
                                                            <div key={line.id} className="flex justify-between">
                                                                <span>{line.sku?.variation?.product?.name} - {line.sku?.variation?.colorName} ({line.sku?.size})</span>
                                                                <span className="text-gray-500">x{line.qty}</span>
                                                            </div>
                                                        ))}
                                                        {order.orderLines?.length > 3 && (
                                                            <p className="text-gray-400 text-xs">+{order.orderLines.length - 3} more items</p>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                            {customerDetail.orders.length > 5 && (
                                                <p className="text-center text-gray-500 text-sm">+{customerDetail.orders.length - 5} more orders</p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-center py-8 text-gray-500">Customer not found</p>
                        )}
                    </div>
                </div>
            )}

            {/* Edit Order Modal */}
            {editingOrder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-lg font-semibold">Edit Order</h2>
                                <p className="text-sm text-gray-500">{editingOrder.orderNumber}</p>
                            </div>
                            <button onClick={() => setEditingOrder(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Customer Details */}
                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Customer Name</label>
                                <input
                                    className="input text-sm"
                                    value={editForm.customerName}
                                    onChange={(e) => setEditForm(f => ({ ...f, customerName: e.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Phone</label>
                                <input
                                    className="input text-sm"
                                    value={editForm.customerPhone}
                                    onChange={(e) => setEditForm(f => ({ ...f, customerPhone: e.target.value }))}
                                />
                            </div>
                        </div>

                        {/* Order Lines */}
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold text-gray-700 mb-2">Order Items</h3>
                            <div className="border rounded-lg overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="text-left py-2 px-3 font-medium text-gray-600">Item</th>
                                            <th className="text-center py-2 px-3 font-medium text-gray-600 w-20">Qty</th>
                                            <th className="text-right py-2 px-3 font-medium text-gray-600 w-24">Price</th>
                                            <th className="text-center py-2 px-3 font-medium text-gray-600 w-20">Status</th>
                                            <th className="w-12"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {editingOrder.orderLines?.map((line: any) => (
                                            <tr key={line.id} className={`border-t ${line.lineStatus === 'cancelled' ? 'bg-gray-50 text-gray-400' : ''}`}>
                                                <td className={`py-2 px-3 ${line.lineStatus === 'cancelled' ? 'line-through' : ''}`}>
                                                    <p className="font-medium">{line.sku?.variation?.product?.name}</p>
                                                    <p className="text-xs text-gray-500">{line.sku?.variation?.colorName} - {line.sku?.size}</p>
                                                </td>
                                                <td className="py-2 px-3 text-center">
                                                    {line.lineStatus === 'pending' ? (
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            defaultValue={line.qty}
                                                            className="w-16 text-center border rounded px-1 py-0.5 text-sm"
                                                            onBlur={(e) => {
                                                                const newQty = parseInt(e.target.value);
                                                                if (newQty !== line.qty && newQty > 0) {
                                                                    updateLine.mutate({ lineId: line.id, data: { qty: newQty } });
                                                                }
                                                            }}
                                                        />
                                                    ) : (
                                                        line.qty
                                                    )}
                                                </td>
                                                <td className="py-2 px-3 text-right">₹{Number(line.unitPrice).toLocaleString()}</td>
                                                <td className="py-2 px-3 text-center">
                                                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                                                        line.lineStatus === 'cancelled' ? 'bg-red-100 text-red-700' :
                                                        line.lineStatus === 'pending' ? 'bg-gray-100 text-gray-600' :
                                                        'bg-blue-100 text-blue-700'
                                                    }`}>{line.lineStatus}</span>
                                                </td>
                                                <td className="py-2 px-3 text-center">
                                                    {line.lineStatus === 'cancelled' ? (
                                                        <button onClick={() => uncancelLine.mutate(line.id)} className="text-green-500 hover:text-green-700" title="Restore"><Undo2 size={14} /></button>
                                                    ) : line.lineStatus === 'pending' ? (
                                                        <button onClick={() => cancelLine.mutate(line.id)} className="text-gray-400 hover:text-red-500" title="Cancel"><X size={14} /></button>
                                                    ) : null}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Add New Item */}
                            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                                <p className="text-xs font-medium text-gray-600 mb-2">Add Item</p>
                                <div className="flex gap-2">
                                    <select className="flex-1 text-sm border rounded px-2 py-1" id="addLineSku" defaultValue="">
                                        <option value="">Select SKU...</option>
                                        {allSkus?.map((sku: any) => (
                                            <option key={sku.id} value={sku.id}>{sku.skuCode} - {sku.variation?.product?.name} ({sku.size}) - ₹{sku.mrp}</option>
                                        ))}
                                    </select>
                                    <input type="number" min="1" defaultValue="1" className="w-16 text-center border rounded px-2 py-1 text-sm" id="addLineQty" />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const skuSelect = document.getElementById('addLineSku') as HTMLSelectElement;
                                            const qtyInput = document.getElementById('addLineQty') as HTMLInputElement;
                                            if (skuSelect.value) {
                                                const sku = allSkus?.find((s: any) => s.id === skuSelect.value);
                                                addLine.mutate({ orderId: editingOrder.id, data: { skuId: skuSelect.value, qty: parseInt(qtyInput.value) || 1, unitPrice: sku?.mrp || 0 } });
                                                skuSelect.value = ''; qtyInput.value = '1';
                                            }
                                        }}
                                        className="btn-primary text-sm px-3 py-1"
                                        disabled={addLine.isPending}
                                    ><Plus size={14} /></button>
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3 pt-2 border-t">
                            <button type="button" onClick={() => setEditingOrder(null)} className="btn-secondary flex-1 text-sm">Close</button>
                            <button
                                type="button"
                                onClick={() => updateOrder.mutate({ id: editingOrder.id, data: { customerName: editForm.customerName, customerPhone: editForm.customerPhone, shippingAddress: editForm.shippingAddress } })}
                                className="btn-primary flex-1 text-sm"
                                disabled={updateOrder.isPending}
                            >{updateOrder.isPending ? 'Saving...' : 'Save Customer Details'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Notes Modal */}
            {notesOrder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-lg font-semibold flex items-center gap-2">
                                    <StickyNote size={18} className="text-yellow-500" />
                                    Order Notes
                                </h2>
                                <p className="text-sm text-gray-500">{notesOrder.orderNumber} • {notesOrder.customerName}</p>
                            </div>
                            <button onClick={() => { setNotesOrder(null); setNotesText(''); }} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                updateOrderNotes.mutate({ id: notesOrder.id, notes: notesText });
                            }}
                            className="space-y-4"
                        >
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block">Internal Notes</label>
                                <textarea
                                    className="input text-sm h-32 resize-none"
                                    value={notesText}
                                    onChange={(e) => setNotesText(e.target.value)}
                                    placeholder="Add internal notes about this order..."
                                    autoFocus
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => { setNotesOrder(null); setNotesText(''); }}
                                    className="btn-secondary flex-1 text-sm"
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="btn-primary flex-1 text-sm" disabled={updateOrderNotes.isPending}>
                                    {updateOrderNotes.isPending ? 'Saving...' : 'Save Notes'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
