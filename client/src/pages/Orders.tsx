import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi, productsApi, inventoryApi, fabricsApi, productionApi } from '../services/api';
import { useState } from 'react';
import { Truck, CheckCircle, Clock, Package, Plus, X, Trash2, AlertTriangle, Factory, Pencil } from 'lucide-react';

export default function Orders() {
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<'open' | 'shipped'>('open');
    const { data: openOrders, isLoading: loadingOpen } = useQuery({ queryKey: ['openOrders'], queryFn: () => ordersApi.getOpen().then(r => r.data) });
    const { data: shippedOrders, isLoading: loadingShipped } = useQuery({ queryKey: ['shippedOrders'], queryFn: () => ordersApi.getShipped().then(r => r.data) });
    const { data: allSkus } = useQuery({ queryKey: ['allSkus'], queryFn: () => productsApi.getAllSkus().then(r => r.data) });
    const { data: inventoryBalance } = useQuery({ queryKey: ['inventoryBalance'], queryFn: () => inventoryApi.getBalance().then(r => r.data) });
    const { data: fabricStock } = useQuery({ queryKey: ['fabricStock'], queryFn: () => fabricsApi.getStockAnalysis().then(r => r.data) });
    const [selectedOrder, setSelectedOrder] = useState<any>(null);
    const [editOrder, setEditOrder] = useState<any>(null);
    const [editLines, setEditLines] = useState<any[]>([]);
    const [shipForm, setShipForm] = useState({ awbNumber: '', courier: '' });
    const [showCreateOrder, setShowCreateOrder] = useState(false);
    const [showProductionPlan, setShowProductionPlan] = useState<any>(null);
    const [productionDate, setProductionDate] = useState(new Date().toISOString().split('T')[0]);
    const [orderForm, setOrderForm] = useState({ customerName: '', customerEmail: '', customerPhone: '', channel: 'offline' });
    const [orderLines, setOrderLines] = useState<{ skuId: string; qty: number; unitPrice: number }[]>([]);
    const [allocatingLines, setAllocatingLines] = useState<Set<string>>(new Set());

    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: ['openOrders'] });
        queryClient.invalidateQueries({ queryKey: ['inventoryBalance'] });
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

    const pick = useMutation({ mutationFn: (lineId: string) => ordersApi.pickLine(lineId), onSuccess: invalidateAll });
    const unpick = useMutation({ mutationFn: (lineId: string) => ordersApi.unpickLine(lineId), onSuccess: invalidateAll });
    const pack = useMutation({ mutationFn: (lineId: string) => ordersApi.packLine(lineId), onSuccess: invalidateAll });
    const unpack = useMutation({ mutationFn: (lineId: string) => ordersApi.unpackLine(lineId), onSuccess: invalidateAll });
    const ship = useMutation({ mutationFn: ({ id, data }: any) => ordersApi.ship(id, data), onSuccess: () => { invalidateAll(); queryClient.invalidateQueries({ queryKey: ['shippedOrders'] }); setSelectedOrder(null); } });

    const createBatch = useMutation({
        mutationFn: (data: any) => productionApi.createBatch(data),
        onSuccess: () => { invalidateAll(); setShowProductionPlan(null); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create production batch')
    });

    const updateBatch = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => productionApi.updateBatch(id, data),
        onSuccess: () => invalidateAll()
    });

    const deleteBatch = useMutation({
        mutationFn: (id: string) => productionApi.deleteBatch(id),
        onSuccess: () => invalidateAll()
    });

    const createOrder = useMutation({
        mutationFn: (data: any) => ordersApi.create(data),
        onSuccess: () => { invalidateAll(); setShowCreateOrder(false); setOrderForm({ customerName: '', customerEmail: '', customerPhone: '', channel: 'offline' }); setOrderLines([]); },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create order')
    });

    const getStageIcon = (stage: string) => {
        if (stage === 'ready_to_ship') return <Truck size={16} className="text-green-600" />;
        if (stage === 'in_progress') return <Package size={16} className="text-yellow-600" />;
        return <Clock size={16} className="text-gray-400" />;
    };

    const getSkuBalance = (skuId: string) => {
        const inv = inventoryBalance?.find((i: any) => i.skuId === skuId);
        return inv?.availableBalance ?? inv?.currentBalance ?? 0;
    };

    const getFabricBalance = (fabricId: string) => {
        const fab = fabricStock?.find((f: any) => f.fabricId === fabricId);
        return fab ? { balance: parseFloat(fab.currentBalance), status: fab.status } : null;
    };

    const canProduceWithFabric = (line: any) => {
        const fabricId = line.sku?.variation?.fabric?.id;
        if (!fabricId) return false;
        const fabricInfo = getFabricBalance(fabricId);
        if (!fabricInfo) return false;
        const fabricNeeded = (line.sku?.fabricConsumption || 1.5) * line.qty;
        return fabricInfo.balance >= fabricNeeded;
    };

    const handleAllocationToggle = (line: any) => {
        if (allocatingLines.has(line.id)) return;
        if (line.lineStatus === 'allocated') {
            unallocate.mutate(line.id);
        } else if (line.lineStatus === 'pending') {
            allocate.mutate(line.id);
        }
    };

    const handleAddToProduction = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showProductionPlan) return;
        createBatch.mutate({
            skuId: showProductionPlan.skuId,
            qtyPlanned: showProductionPlan.qty,
            priority: 'order_fulfillment',
            sourceOrderLineId: showProductionPlan.lineId,
            batchDate: new Date(productionDate),
            notes: `For order ${showProductionPlan.orderNumber}`
        });
    };

    const openEditOrder = (order: any) => {
        setEditOrder({ id: order.id, orderNumber: order.orderNumber, customerName: order.customerName, customerEmail: order.customerEmail, customerPhone: order.customerPhone, channel: order.channel });
        setEditLines(order.orderLines?.map((l: any) => ({ id: l.id, skuId: l.skuId, qty: l.qty, unitPrice: l.unitPrice, lineStatus: l.lineStatus })) || []);
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

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
                <button onClick={() => setShowCreateOrder(true)} className="btn-primary flex items-center"><Plus size={20} className="mr-2" />Create Order</button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b">
                <button className={`px-4 py-2 font-medium ${tab === 'open' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('open')}>Open ({openOrders?.length || 0})</button>
                <button className={`px-4 py-2 font-medium ${tab === 'shipped' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('shipped')}>Shipped</button>
            </div>

            {isLoading && <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>}

            {/* Open Orders */}
            {tab === 'open' && (
                <div className="space-y-4">
                    {openOrders?.map((order: any) => (
                        <div key={order.id} className="card">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    {getStageIcon(order.fulfillmentStage)}
                                    <div>
                                        <h3 className="font-semibold">{order.orderNumber}</h3>
                                        <p className="text-sm text-gray-500">{order.customerName} • {new Date(order.orderDate).toLocaleDateString()}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => openEditOrder(order)} className="btn-secondary text-sm flex items-center gap-1"><Pencil size={14} /> Edit</button>
                                    {order.fulfillmentStage === 'ready_to_ship' && (
                                        <button onClick={() => setSelectedOrder(order)} className="btn-primary text-sm">Ship Order</button>
                                    )}
                                </div>
                            </div>

                            {/* Order Lines with Checkboxes */}
                            <div className="border rounded-lg overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="table-header w-12">Alloc</th>
                                            <th className="table-header">SKU</th>
                                            <th className="table-header">Product</th>
                                            <th className="table-header text-center">Qty</th>
                                            <th className="table-header text-center">Avail</th>
                                            <th className="table-header">Fabric</th>
                                            <th className="table-header">Status</th>
                                            <th className="table-header">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {order.orderLines?.map((line: any) => {
                                            const skuStock = getSkuBalance(line.skuId);
                                            const fabricId = line.sku?.variation?.fabric?.id;
                                            const fabricInfo = fabricId ? getFabricBalance(fabricId) : null;
                                            const hasStock = skuStock >= line.qty;
                                            const canProduce = !hasStock && canProduceWithFabric(line);
                                            const isAllocated = line.lineStatus === 'allocated';
                                            const isPending = line.lineStatus === 'pending';
                                            const canAllocate = isPending && hasStock;
                                            const canUnallocate = isAllocated;
                                            const showCheckbox = canAllocate || canUnallocate;
                                            const isToggling = allocatingLines.has(line.id);

                                            return (
                                                <tr key={line.id} className="border-t">
                                                    <td className="table-cell text-center">
                                                        {showCheckbox ? (
                                                            <input
                                                                type="checkbox"
                                                                checked={isAllocated}
                                                                onChange={() => handleAllocationToggle(line)}
                                                                disabled={isToggling}
                                                                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                                                            />
                                                        ) : line.lineStatus === 'picked' || line.lineStatus === 'packed' ? (
                                                            <CheckCircle size={16} className="text-green-600 mx-auto" />
                                                        ) : (
                                                            <span className="text-gray-300">—</span>
                                                        )}
                                                    </td>
                                                    <td className="table-cell font-medium">{line.sku?.skuCode}</td>
                                                    <td className="table-cell">{line.sku?.variation?.product?.name} - {line.sku?.variation?.colorName} - {line.sku?.size}</td>
                                                    <td className="table-cell text-center">{line.qty}</td>
                                                    <td className="table-cell text-center">
                                                        <span className={`font-medium ${hasStock || isAllocated ? 'text-green-600' : 'text-red-600'}`}>{skuStock}</span>
                                                        {!hasStock && !isAllocated && <AlertTriangle size={14} className="inline ml-1 text-red-500" />}
                                                    </td>
                                                    <td className="table-cell">
                                                        {fabricInfo ? (
                                                            <span className={`text-xs ${fabricInfo.status === 'OK' ? 'text-green-600' : fabricInfo.status === 'ORDER SOON' ? 'text-yellow-600' : 'text-red-600'}`}>
                                                                {fabricInfo.balance}m
                                                            </span>
                                                        ) : '-'}
                                                    </td>
                                                    <td className="table-cell">
                                                        <span className={`badge ${line.lineStatus === 'packed' ? 'badge-success' : line.lineStatus === 'picked' ? 'badge-warning' : line.lineStatus === 'allocated' ? 'badge-info' : 'badge-secondary'}`}>
                                                            {line.lineStatus}
                                                        </span>
                                                    </td>
                                                    <td className="table-cell">
                                                        {/* No stock - show production planning */}
                                                        {line.lineStatus === 'pending' && !hasStock && canProduce && !line.productionBatchId && (
                                                            <div className="flex items-center gap-1">
                                                                <input
                                                                    type="date"
                                                                    className="input text-xs py-0.5 px-1 w-28"
                                                                    defaultValue={new Date().toISOString().split('T')[0]}
                                                                    min={new Date().toISOString().split('T')[0]}
                                                                    id={`prod-date-${line.id}`}
                                                                />
                                                                <button
                                                                    onClick={() => {
                                                                        const dateInput = document.getElementById(`prod-date-${line.id}`) as HTMLInputElement;
                                                                        createBatch.mutate({
                                                                            skuId: line.skuId,
                                                                            qtyPlanned: line.qty,
                                                                            priority: 'order_fulfillment',
                                                                            sourceOrderLineId: line.id,
                                                                            batchDate: new Date(dateInput.value),
                                                                            notes: `For order ${order.orderNumber}`
                                                                        });
                                                                    }}
                                                                    className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded hover:bg-orange-200 flex items-center gap-0.5"
                                                                    disabled={createBatch.isPending}
                                                                >
                                                                    <Factory size={12} /> Plan
                                                                </button>
                                                            </div>
                                                        )}
                                                        {/* Has production batch - show current date with edit */}
                                                        {line.productionBatch && line.productionBatch.status !== 'completed' && (
                                                            <div className="flex items-center gap-1">
                                                                <span className="text-xs text-orange-600"><Factory size={12} className="inline mr-1" /></span>
                                                                <input
                                                                    type="date"
                                                                    className="input text-xs py-0.5 px-1 w-28 bg-orange-50 border-orange-200"
                                                                    defaultValue={line.productionBatch.batchDate?.split('T')[0]}
                                                                    min={new Date().toISOString().split('T')[0]}
                                                                    onChange={(e) => {
                                                                        updateBatch.mutate({ id: line.productionBatch.id, data: { batchDate: e.target.value } });
                                                                    }}
                                                                />
                                                                <button
                                                                    onClick={() => deleteBatch.mutate(line.productionBatch.id)}
                                                                    className="text-xs text-gray-400 hover:text-red-500"
                                                                    title="Cancel production"
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                            </div>
                                                        )}
                                                        {line.lineStatus === 'allocated' && <button onClick={() => pick.mutate(line.id)} className="text-xs text-primary-600 hover:underline">Pick</button>}
                                                        {line.lineStatus === 'picked' && (
                                                            <div className="flex items-center gap-2">
                                                                <button onClick={() => pack.mutate(line.id)} className="text-xs text-primary-600 hover:underline">Pack</button>
                                                                <button onClick={() => unpick.mutate(line.id)} className="text-xs text-gray-400 hover:text-red-500">↩ Undo</button>
                                                            </div>
                                                        )}
                                                        {line.lineStatus === 'packed' && (
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs text-green-600">Ready</span>
                                                                <button onClick={() => unpack.mutate(line.id)} className="text-xs text-gray-400 hover:text-red-500">↩ Undo</button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ))}
                    {(!openOrders || openOrders.length === 0) && !loadingOpen && (
                        <div className="card text-center text-gray-500 py-8">No open orders</div>
                    )}
                </div>
            )
            }

            {/* Shipped Orders */}
            {
                tab === 'shipped' && (
                    <div className="card overflow-x-auto">
                        <table className="w-full">
                            <thead><tr className="border-b"><th className="table-header">Order</th><th className="table-header">Customer</th><th className="table-header">AWB</th><th className="table-header">Courier</th><th className="table-header">Shipped</th><th className="table-header">Status</th></tr></thead>
                            <tbody>
                                {shippedOrders?.map((order: any) => (
                                    <tr key={order.id} className="border-b last:border-0">
                                        <td className="table-cell font-medium">{order.orderNumber}</td>
                                        <td className="table-cell">{order.customerName}</td>
                                        <td className="table-cell">{order.awbNumber || '-'}</td>
                                        <td className="table-cell">{order.courier || '-'}</td>
                                        <td className="table-cell">{order.shippedAt ? new Date(order.shippedAt).toLocaleDateString() : '-'}</td>
                                        <td className="table-cell"><span className={`badge ${order.trackingStatus === 'completed' ? 'badge-success' : order.trackingStatus === 'delivery_delayed' ? 'badge-danger' : 'badge-warning'}`}>{order.trackingStatus}</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )
            }

            {/* Ship Modal */}
            {
                selectedOrder && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-xl p-6 w-full max-w-md">
                            <h2 className="text-lg font-semibold mb-4">Ship Order {selectedOrder.orderNumber}</h2>
                            <form onSubmit={(e) => { e.preventDefault(); ship.mutate({ id: selectedOrder.id, data: shipForm }); }} className="space-y-4">
                                <div><label className="label">AWB Number</label><input className="input" value={shipForm.awbNumber} onChange={(e) => setShipForm(f => ({ ...f, awbNumber: e.target.value }))} required /></div>
                                <div><label className="label">Courier</label><input className="input" value={shipForm.courier} onChange={(e) => setShipForm(f => ({ ...f, courier: e.target.value }))} required /></div>
                                <div className="flex gap-3">
                                    <button type="button" onClick={() => setSelectedOrder(null)} className="btn-secondary flex-1">Cancel</button>
                                    <button type="submit" className="btn-primary flex-1" disabled={ship.isPending}>{ship.isPending ? 'Shipping...' : 'Mark Shipped'}</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }

            {/* Edit Order Modal */}
            {
                editOrder && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto py-8">
                        <div className="bg-white rounded-xl p-6 w-full max-w-2xl">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-semibold">Edit Order {editOrder.orderNumber}</h2>
                                <button onClick={() => setEditOrder(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                            </div>
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="label">Customer Name</label>
                                        <input className="input" value={editOrder.customerName || ''} onChange={(e) => setEditOrder((o: any) => ({ ...o, customerName: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="label">Channel</label>
                                        <select className="input" value={editOrder.channel || 'offline'} onChange={(e) => setEditOrder((o: any) => ({ ...o, channel: e.target.value }))}>
                                            <option value="offline">Offline</option>
                                            <option value="shopify">Shopify</option>
                                            <option value="amazon">Amazon</option>
                                            <option value="custom">Custom</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="label">Email</label>
                                        <input type="email" className="input" value={editOrder.customerEmail || ''} onChange={(e) => setEditOrder((o: any) => ({ ...o, customerEmail: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="label">Phone</label>
                                        <input className="input" value={editOrder.customerPhone || ''} onChange={(e) => setEditOrder((o: any) => ({ ...o, customerPhone: e.target.value }))} />
                                    </div>
                                </div>
                                <div>
                                    <label className="label">Order Items</label>
                                    <div className="border rounded-lg overflow-hidden">
                                        <table className="w-full text-sm">
                                            <thead className="bg-gray-50"><tr><th className="table-header">SKU</th><th className="table-header text-center">Qty</th><th className="table-header text-right">Price</th><th className="table-header">Status</th></tr></thead>
                                            <tbody>
                                                {editLines.map((line: any, idx: number) => (
                                                    <tr key={line.id || idx} className="border-t">
                                                        <td className="table-cell">
                                                            <select className="input text-sm py-1" value={line.skuId} onChange={(e) => { const nl = [...editLines]; nl[idx].skuId = e.target.value; setEditLines(nl); }} disabled={line.lineStatus !== 'pending'}>
                                                                {allSkus?.map((s: any) => <option key={s.id} value={s.id}>{s.skuCode}</option>)}
                                                            </select>
                                                        </td>
                                                        <td className="table-cell text-center">
                                                            <input type="number" className="input text-sm py-1 w-16 text-center" value={line.qty} onChange={(e) => { const nl = [...editLines]; nl[idx].qty = Number(e.target.value); setEditLines(nl); }} disabled={line.lineStatus !== 'pending'} min={1} />
                                                        </td>
                                                        <td className="table-cell text-right">
                                                            <input type="number" className="input text-sm py-1 w-20 text-right" value={line.unitPrice} onChange={(e) => { const nl = [...editLines]; nl[idx].unitPrice = Number(e.target.value); setEditLines(nl); }} min={0} />
                                                        </td>
                                                        <td className="table-cell"><span className="badge badge-info text-xs">{line.lineStatus}</span></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <p className="text-right text-sm font-medium mt-2">Total: ₹{editLines.reduce((sum: number, l: any) => sum + (l.qty * l.unitPrice), 0).toLocaleString()}</p>
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button type="button" onClick={() => setEditOrder(null)} className="btn-secondary flex-1">Cancel</button>
                                    <button type="button" onClick={() => { alert('Order update API not yet implemented'); setEditOrder(null); }} className="btn-primary flex-1">Save Changes</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Production Plan Modal */}
            {
                showProductionPlan && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-xl p-6 w-full max-w-md">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-semibold">Add to Production Plan</h2>
                                <button onClick={() => setShowProductionPlan(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                            </div>
                            <div className="mb-4 p-3 bg-orange-50 rounded-lg border border-orange-200">
                                <p className="font-medium text-orange-800">{showProductionPlan.skuCode}</p>
                                <p className="text-sm text-orange-600">Quantity: {showProductionPlan.qty} pcs • Order: {showProductionPlan.orderNumber}</p>
                            </div>
                            <form onSubmit={handleAddToProduction} className="space-y-4">
                                <div>
                                    <label className="label">Production Date</label>
                                    <input type="date" className="input" value={productionDate} onChange={(e) => setProductionDate(e.target.value)} min={new Date().toISOString().split('T')[0]} required />
                                </div>
                                <div className="flex gap-3">
                                    <button type="button" onClick={() => setShowProductionPlan(null)} className="btn-secondary flex-1">Cancel</button>
                                    <button type="submit" className="btn-primary flex-1" disabled={createBatch.isPending}>{createBatch.isPending ? 'Creating...' : 'Add to Plan'}</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }

            {/* Create Order Modal */}
            {
                showCreateOrder && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto py-8">
                        <div className="bg-white rounded-xl p-6 w-full max-w-2xl">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-semibold">Create Order</h2>
                                <button onClick={() => setShowCreateOrder(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                            </div>
                            <form onSubmit={handleCreateOrder} className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div><label className="label">Customer Name</label><input className="input" value={orderForm.customerName} onChange={(e) => setOrderForm(f => ({ ...f, customerName: e.target.value }))} required /></div>
                                    <div><label className="label">Channel</label><select className="input" value={orderForm.channel} onChange={(e) => setOrderForm(f => ({ ...f, channel: e.target.value }))}><option value="offline">Offline</option><option value="shopify">Shopify</option><option value="amazon">Amazon</option><option value="custom">Custom</option></select></div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div><label className="label">Email (optional)</label><input type="email" className="input" value={orderForm.customerEmail} onChange={(e) => setOrderForm(f => ({ ...f, customerEmail: e.target.value }))} /></div>
                                    <div><label className="label">Phone (optional)</label><input className="input" value={orderForm.customerPhone} onChange={(e) => setOrderForm(f => ({ ...f, customerPhone: e.target.value }))} /></div>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-2"><label className="label mb-0">Order Items</label><button type="button" onClick={addLine} className="text-sm text-primary-600 hover:underline flex items-center"><Plus size={16} className="mr-1" />Add Item</button></div>
                                    {orderLines.length === 0 && <p className="text-sm text-gray-500">No items added yet</p>}
                                    <div className="space-y-2">
                                        {orderLines.map((line, idx) => (
                                            <div key={idx} className="flex gap-2 items-center">
                                                <select className="input flex-1" value={line.skuId} onChange={(e) => updateLine(idx, 'skuId', e.target.value)} required>
                                                    <option value="">Select SKU...</option>
                                                    {allSkus?.map((sku: any) => (<option key={sku.id} value={sku.id}>{sku.skuCode} - {sku.variation?.product?.name} {sku.size} (Avail: {getSkuBalance(sku.id)})</option>))}
                                                </select>
                                                <input type="number" className="input w-20" value={line.qty} onChange={(e) => updateLine(idx, 'qty', Number(e.target.value))} min={1} placeholder="Qty" />
                                                <input type="number" className="input w-24" value={line.unitPrice} onChange={(e) => updateLine(idx, 'unitPrice', Number(e.target.value))} min={0} placeholder="Price" />
                                                <button type="button" onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-700"><Trash2 size={18} /></button>
                                            </div>
                                        ))}
                                    </div>
                                    {orderLines.length > 0 && <p className="text-right text-sm font-medium mt-2">Total: ₹{orderLines.reduce((sum, l) => sum + (l.qty * l.unitPrice), 0).toLocaleString()}</p>}
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button type="button" onClick={() => setShowCreateOrder(false)} className="btn-secondary flex-1">Cancel</button>
                                    <button type="submit" className="btn-primary flex-1" disabled={createOrder.isPending}>{createOrder.isPending ? 'Creating...' : 'Create Order'}</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
