import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fabricsApi } from '../services/api';
import { useState } from 'react';
import { AlertTriangle, Plus, X, ChevronDown, ChevronRight, Package, Users, Eye, ArrowDownCircle, ArrowUpCircle, Trash2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function Fabrics() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const { data: fabricTypes, isLoading } = useQuery({ queryKey: ['fabricTypes'], queryFn: () => fabricsApi.getTypes().then(r => r.data) });
    const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: () => fabricsApi.getSuppliers().then(r => r.data) });
    const { data: stockAnalysis } = useQuery({ queryKey: ['fabricStock'], queryFn: () => fabricsApi.getStockAnalysis().then(r => r.data) });

    const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
    const [showAddType, setShowAddType] = useState(false);
    const [showAddColor, setShowAddColor] = useState<string | null>(null);
    const [showInward, setShowInward] = useState<any>(null);
    const [showAddSupplier, setShowAddSupplier] = useState(false);
    const [showDetail, setShowDetail] = useState<any>(null);

    // Fetch transactions when detail view is open
    const { data: transactions, isLoading: txnLoading } = useQuery({
        queryKey: ['fabricTransactions', showDetail?.id],
        queryFn: () => fabricsApi.getTransactions(showDetail.id).then(r => r.data),
        enabled: !!showDetail?.id
    });

    const [typeForm, setTypeForm] = useState({ name: '', composition: '', unit: 'meter', avgShrinkagePct: 0 });
    const [colorForm, setColorForm] = useState({ colorName: '', standardColor: '', colorHex: '#6B8E9F', costPerUnit: 400, supplierId: '', leadTimeDays: 14, minOrderQty: 20 });
    const [inwardForm, setInwardForm] = useState({ qty: 0, notes: '', costPerUnit: 0, supplierId: '' });
    const [supplierForm, setSupplierForm] = useState({ name: '', contactName: '', email: '', phone: '', address: '' });
    const standardColors = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Brown', 'Black', 'White', 'Grey', 'Beige', 'Navy', 'Teal'];

    const createType = useMutation({
        mutationFn: (data: any) => fabricsApi.createType(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricTypes'] });
            setShowAddType(false);
            setTypeForm({ name: '', composition: '', unit: 'meter', avgShrinkagePct: 0 });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create fabric type')
    });

    const createFabric = useMutation({
        mutationFn: (data: any) => fabricsApi.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricTypes'] });
            queryClient.invalidateQueries({ queryKey: ['fabrics'] });
            queryClient.invalidateQueries({ queryKey: ['fabricStock'] });
            setShowAddColor(null);
            setColorForm({ colorName: '', standardColor: '', colorHex: '#6B8E9F', costPerUnit: 400, supplierId: '', leadTimeDays: 14, minOrderQty: 20 });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create fabric')
    });

    const createInward = useMutation({
        mutationFn: ({ fabricId, data }: { fabricId: string, data: any }) => fabricsApi.createTransaction(fabricId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricTypes'] });
            queryClient.invalidateQueries({ queryKey: ['fabricStock'] });
            setShowInward(null);
            setInwardForm({ qty: 0, notes: '', costPerUnit: 0, supplierId: '' });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to record inward')
    });

    const createSupplier = useMutation({
        mutationFn: (data: any) => fabricsApi.createSupplier(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            setShowAddSupplier(false);
            setSupplierForm({ name: '', contactName: '', email: '', phone: '', address: '' });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create supplier')
    });

    const deleteTransaction = useMutation({
        mutationFn: (txnId: string) => fabricsApi.deleteTransaction(txnId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricTransactions', showDetail?.id] });
            queryClient.invalidateQueries({ queryKey: ['fabricTypes'] });
            queryClient.invalidateQueries({ queryKey: ['fabricStock'] });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to delete transaction')
    });

    const toggleExpand = (id: string) => {
        const newSet = new Set(expandedTypes);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExpandedTypes(newSet);
    };

    const handleSubmitType = (e: React.FormEvent) => {
        e.preventDefault();
        createType.mutate(typeForm);
    };

    const handleSubmitColor = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showAddColor) return;
        const type = fabricTypes?.find((t: any) => t.id === showAddColor);
        createFabric.mutate({
            fabricTypeId: showAddColor,
            name: `${type?.name} - ${colorForm.colorName}`,
            colorName: colorForm.colorName,
            standardColor: colorForm.standardColor || null,
            colorHex: colorForm.colorHex,
            costPerUnit: colorForm.costPerUnit,
            supplierId: colorForm.supplierId || null,
            leadTimeDays: colorForm.leadTimeDays,
            minOrderQty: colorForm.minOrderQty
        });
    };

    const handleSubmitInward = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showInward) return;
        createInward.mutate({
            fabricId: showInward.id,
            data: {
                txnType: 'inward',
                qty: inwardForm.qty,
                unit: showInward.unit || 'meter',
                reason: 'supplier_receipt',
                notes: inwardForm.notes,
                costPerUnit: inwardForm.costPerUnit || null,
                supplierId: inwardForm.supplierId || null
            }
        });
    };

    const handleSubmitSupplier = (e: React.FormEvent) => {
        e.preventDefault();
        createSupplier.mutate(supplierForm);
    };

    const getStockInfo = (fabricId: string) => stockAnalysis?.find((s: any) => s.fabricId === fabricId);

    if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Fabrics</h1>
                <div className="flex gap-3">
                    <button onClick={() => setShowAddSupplier(true)} className="btn-secondary flex items-center"><Users size={20} className="mr-2" />Add Supplier</button>
                    <button onClick={() => setShowAddType(true)} className="btn-primary flex items-center"><Plus size={20} className="mr-2" />Add Fabric Type</button>
                </div>
            </div>

            {/* Alerts */}
            {stockAnalysis?.filter((f: any) => f.status !== 'OK').length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-3">
                    <AlertTriangle className="text-yellow-600" />
                    <span className="text-yellow-800 font-medium">{stockAnalysis.filter((f: any) => f.status !== 'OK').length} fabrics need reordering</span>
                </div>
            )}

            {/* Fabric Types List */}
            <div className="space-y-4">
                {fabricTypes?.map((type: any) => (
                    <div key={type.id} className="card">
                        <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(type.id)}>
                            <div className="flex items-center">
                                {expandedTypes.has(type.id) ? <ChevronDown size={20} className="mr-2 text-gray-400" /> : <ChevronRight size={20} className="mr-2 text-gray-400" />}
                                <div>
                                    <h3 className="font-semibold text-gray-900">{type.name}</h3>
                                    <p className="text-sm text-gray-500">{type.composition || 'No composition'} • {type.unit} • {type.avgShrinkagePct}% shrinkage</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="text-sm text-gray-500">{type.fabrics?.length || 0} colors</span>
                            </div>
                        </div>

                        {expandedTypes.has(type.id) && (
                            <div className="mt-4 border-t pt-4 space-y-3">
                                {type.fabrics?.map((fabric: any) => {
                                    const stock = getStockInfo(fabric.id);
                                    return (
                                        <div key={fabric.id} className="ml-6 p-3 bg-gray-50 rounded-lg">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center">
                                                    <div className="w-6 h-6 rounded-full border-2 border-gray-300 mr-3" style={{ backgroundColor: fabric.colorHex || '#ccc' }} />
                                                    <div>
                                                        <p className="font-medium">{fabric.colorName}</p>
                                                        <p className="text-xs text-gray-500">₹{fabric.costPerUnit}/unit • {fabric.leadTimeDays}d lead</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    {stock && (
                                                        <div className="text-right">
                                                            <span className="text-sm font-medium">{stock.currentBalance} {type.unit === 'meter' ? 'm' : 'kg'}</span>
                                                            <span className={`ml-2 badge ${stock.status === 'OK' ? 'badge-success' : stock.status === 'ORDER SOON' ? 'badge-warning' : 'badge-danger'}`}>{stock.status}</span>
                                                        </div>
                                                    )}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setShowDetail({ ...fabric, unit: type.unit, stock }); }}
                                                        className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                                                    >
                                                        <Eye size={14} /> View
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setShowInward({ ...fabric, unit: type.unit }); }}
                                                        className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                                                    >
                                                        <Package size={14} /> Inward
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                <button onClick={(e) => { e.stopPropagation(); setShowAddColor(type.id); }} className="ml-6 text-sm text-primary-600 hover:underline flex items-center">
                                    <Plus size={16} className="mr-1" /> Add Color
                                </button>
                            </div>
                        )}
                    </div>
                ))}
                {(!fabricTypes || fabricTypes.length === 0) && (
                    <div className="card text-center text-gray-500 py-8">
                        No fabric types yet. Click "Add Fabric Type" to get started.
                    </div>
                )}
            </div>

            {/* Add Fabric Type Modal */}
            {showAddType && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Fabric Type</h2>
                            <button onClick={() => setShowAddType(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitType} className="space-y-4">
                            <div>
                                <label className="label">Type Name</label>
                                <input className="input" value={typeForm.name} onChange={(e) => setTypeForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., Linen 60 Lea" required />
                            </div>
                            <div>
                                <label className="label">Composition</label>
                                <input className="input" value={typeForm.composition} onChange={(e) => setTypeForm(f => ({ ...f, composition: e.target.value }))} placeholder="e.g., 100% Linen" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Unit</label>
                                    <select className="input" value={typeForm.unit} onChange={(e) => setTypeForm(f => ({ ...f, unit: e.target.value }))}>
                                        <option value="meter">Meter</option>
                                        <option value="kg">Kilogram</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Avg Shrinkage %</label>
                                    <input type="number" step="0.1" className="input" value={typeForm.avgShrinkagePct} onChange={(e) => setTypeForm(f => ({ ...f, avgShrinkagePct: Number(e.target.value) }))} min={0} max={100} />
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddType(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createType.isPending}>{createType.isPending ? 'Creating...' : 'Add Type'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Color Modal */}
            {showAddColor && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Color Variation</h2>
                            <button onClick={() => setShowAddColor(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitColor} className="space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="label">Color Name</label>
                                    <input className="input" value={colorForm.colorName} onChange={(e) => setColorForm(f => ({ ...f, colorName: e.target.value }))} placeholder="e.g., Wildflower Blue" required />
                                </div>
                                <div>
                                    <label className="label">Standard Color</label>
                                    <select className="input" value={colorForm.standardColor} onChange={(e) => setColorForm(f => ({ ...f, standardColor: e.target.value }))}>
                                        <option value="">Select...</option>
                                        {standardColors.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Color</label>
                                    <input type="color" className="input h-10" value={colorForm.colorHex} onChange={(e) => setColorForm(f => ({ ...f, colorHex: e.target.value }))} />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier (optional)</label>
                                <select className="input" value={colorForm.supplierId} onChange={(e) => setColorForm(f => ({ ...f, supplierId: e.target.value }))}>
                                    <option value="">No supplier</option>
                                    {suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="label">Cost/Unit (₹)</label>
                                    <input type="number" className="input" value={colorForm.costPerUnit} onChange={(e) => setColorForm(f => ({ ...f, costPerUnit: Number(e.target.value) }))} min={0} />
                                </div>
                                <div>
                                    <label className="label">Lead (days)</label>
                                    <input type="number" className="input" value={colorForm.leadTimeDays} onChange={(e) => setColorForm(f => ({ ...f, leadTimeDays: Number(e.target.value) }))} min={0} />
                                </div>
                                <div>
                                    <label className="label">Min Order</label>
                                    <input type="number" className="input" value={colorForm.minOrderQty} onChange={(e) => setColorForm(f => ({ ...f, minOrderQty: Number(e.target.value) }))} min={0} />
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddColor(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createFabric.isPending}>{createFabric.isPending ? 'Creating...' : 'Add Color'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Inward Modal */}
            {showInward && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Fabric Inward</h2>
                            <button onClick={() => setShowInward(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <div className="mb-4 p-3 bg-gray-50 rounded-lg flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full" style={{ backgroundColor: showInward.colorHex || '#ccc' }} />
                            <div>
                                <p className="font-medium">{showInward.colorName}</p>
                                <p className="text-xs text-gray-500">{showInward.name}</p>
                            </div>
                        </div>
                        <form onSubmit={handleSubmitInward} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Quantity ({showInward.unit === 'meter' ? 'meters' : 'kg'})</label>
                                    <input type="number" step="0.1" className="input" value={inwardForm.qty} onChange={(e) => setInwardForm(f => ({ ...f, qty: Number(e.target.value) }))} min={0.1} required />
                                </div>
                                <div>
                                    <label className="label">Price/Unit (₹)</label>
                                    <input type="number" step="0.01" className="input" value={inwardForm.costPerUnit} onChange={(e) => setInwardForm(f => ({ ...f, costPerUnit: Number(e.target.value) }))} min={0} placeholder={showInward.costPerUnit?.toString() || '0'} />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier</label>
                                <select className="input" value={inwardForm.supplierId} onChange={(e) => setInwardForm(f => ({ ...f, supplierId: e.target.value }))}>
                                    <option value="">Select supplier</option>
                                    {suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="label">Notes (optional)</label>
                                <input className="input" value={inwardForm.notes} onChange={(e) => setInwardForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g., PO #1234, Invoice ref" />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowInward(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createInward.isPending}>{createInward.isPending ? 'Saving...' : 'Add to Inventory'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Supplier Modal */}
            {showAddSupplier && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Supplier</h2>
                            <button onClick={() => setShowAddSupplier(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitSupplier} className="space-y-4">
                            <div>
                                <label className="label">Supplier Name</label>
                                <input className="input" value={supplierForm.name} onChange={(e) => setSupplierForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., ABC Textiles" required />
                            </div>
                            <div>
                                <label className="label">Contact Name</label>
                                <input className="input" value={supplierForm.contactName} onChange={(e) => setSupplierForm(f => ({ ...f, contactName: e.target.value }))} placeholder="e.g., John Doe" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Email</label>
                                    <input type="email" className="input" value={supplierForm.email} onChange={(e) => setSupplierForm(f => ({ ...f, email: e.target.value }))} placeholder="email@supplier.com" />
                                </div>
                                <div>
                                    <label className="label">Phone</label>
                                    <input className="input" value={supplierForm.phone} onChange={(e) => setSupplierForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 98765 43210" />
                                </div>
                            </div>
                            <div>
                                <label className="label">Address</label>
                                <textarea className="input" rows={2} value={supplierForm.address} onChange={(e) => setSupplierForm(f => ({ ...f, address: e.target.value }))} placeholder="Full address..." />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddSupplier(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createSupplier.isPending}>{createSupplier.isPending ? 'Creating...' : 'Add Supplier'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Fabric Detail Modal */}
            {showDetail && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full border-2 border-gray-300" style={{ backgroundColor: showDetail.colorHex || '#ccc' }} />
                                <div>
                                    <h2 className="text-lg font-semibold">{showDetail.colorName}</h2>
                                    <p className="text-sm text-gray-500">{showDetail.name}</p>
                                </div>
                            </div>
                            <button onClick={() => setShowDetail(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>

                        {/* Summary Stats */}
                        <div className="grid grid-cols-4 gap-4 mb-4">
                            <div className="bg-gray-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-gray-500">Current Balance</p>
                                <p className="text-lg font-semibold">{showDetail.stock?.currentBalance || 0} {showDetail.unit === 'meter' ? 'm' : 'kg'}</p>
                            </div>
                            <div className="bg-green-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-green-600">Total Inward</p>
                                <p className="text-lg font-semibold text-green-700">
                                    {transactions?.filter((t: any) => t.txnType === 'inward').reduce((sum: number, t: any) => sum + Number(t.qty), 0).toFixed(1) || 0}
                                </p>
                            </div>
                            <div className="bg-red-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-red-600">Total Outward</p>
                                <p className="text-lg font-semibold text-red-700">
                                    {transactions?.filter((t: any) => t.txnType === 'outward').reduce((sum: number, t: any) => sum + Number(t.qty), 0).toFixed(1) || 0}
                                </p>
                            </div>
                            <div className="bg-blue-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-blue-600">Status</p>
                                <p className={`text-sm font-semibold ${showDetail.stock?.status === 'OK' ? 'text-green-600' : showDetail.stock?.status === 'ORDER SOON' ? 'text-yellow-600' : 'text-red-600'}`}>
                                    {showDetail.stock?.status || 'N/A'}
                                </p>
                            </div>
                        </div>

                        {/* Transactions List */}
                        <div className="flex-1 overflow-y-auto">
                            <h3 className="font-medium text-gray-700 mb-3">Transaction History</h3>
                            {txnLoading ? (
                                <div className="flex justify-center py-8">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                                </div>
                            ) : transactions?.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">No transactions yet</div>
                            ) : (
                                <div className="space-y-2">
                                    {transactions?.map((txn: any) => (
                                        <div key={txn.id} className={`p-3 rounded-lg border ${txn.txnType === 'inward' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    {txn.txnType === 'inward' ? (
                                                        <ArrowDownCircle size={20} className="text-green-600" />
                                                    ) : (
                                                        <ArrowUpCircle size={20} className="text-red-600" />
                                                    )}
                                                    <div>
                                                        <p className="font-medium">
                                                            {txn.txnType === 'inward' ? '+' : '-'}{txn.qty} {txn.unit}
                                                            <span className="ml-2 text-xs text-gray-500 font-normal capitalize">
                                                                {txn.reason.replace(/_/g, ' ')}
                                                            </span>
                                                        </p>
                                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                                            <span>{new Date(txn.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                                            <span>•</span>
                                                            <span>{txn.createdBy?.name || 'System'}</span>
                                                            {txn.supplier && (
                                                                <>
                                                                    <span>•</span>
                                                                    <span>From: {txn.supplier.name}</span>
                                                                </>
                                                            )}
                                                            {txn.costPerUnit && (
                                                                <>
                                                                    <span>•</span>
                                                                    <span>₹{txn.costPerUnit}/unit</span>
                                                                </>
                                                            )}
                                                        </div>
                                                        {txn.notes && <p className="text-xs text-gray-600 mt-1">{txn.notes}</p>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className={`text-lg font-semibold ${txn.txnType === 'inward' ? 'text-green-600' : 'text-red-600'}`}>
                                                        {txn.txnType === 'inward' ? '+' : '-'}{txn.qty}
                                                    </div>
                                                    {isAdmin && (
                                                        <button
                                                            onClick={() => {
                                                                if (confirm(`Delete this ${txn.txnType} transaction of ${txn.qty} ${txn.unit}?`)) {
                                                                    deleteTransaction.mutate(txn.id);
                                                                }
                                                            }}
                                                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                            title="Delete transaction (admin only)"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex gap-3 pt-4 mt-4 border-t">
                            <button onClick={() => setShowDetail(null)} className="btn-secondary flex-1">Close</button>
                            <button
                                onClick={() => { setShowInward({ ...showDetail }); setShowDetail(null); }}
                                className="btn-primary flex-1 flex items-center justify-center gap-2"
                            >
                                <Package size={16} /> Add Inward
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
