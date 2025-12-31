import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fabricsApi } from '../services/api';
import { useState } from 'react';
import { AlertTriangle, Plus, X, ChevronDown, ChevronRight, Package } from 'lucide-react';

export default function Fabrics() {
    const queryClient = useQueryClient();
    const { data: fabricTypes, isLoading } = useQuery({ queryKey: ['fabricTypes'], queryFn: () => fabricsApi.getTypes().then(r => r.data) });
    const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: () => fabricsApi.getSuppliers().then(r => r.data) });
    const { data: stockAnalysis } = useQuery({ queryKey: ['fabricStock'], queryFn: () => fabricsApi.getStockAnalysis().then(r => r.data) });

    const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
    const [showAddType, setShowAddType] = useState(false);
    const [showAddColor, setShowAddColor] = useState<string | null>(null);
    const [showInward, setShowInward] = useState<any>(null);

    const [typeForm, setTypeForm] = useState({ name: '', composition: '', unit: 'meter', avgShrinkagePct: 0 });
    const [colorForm, setColorForm] = useState({ colorName: '', colorHex: '#6B8E9F', costPerUnit: 400, supplierId: '', leadTimeDays: 14, minOrderQty: 20 });
    const [inwardForm, setInwardForm] = useState({ qty: 0, notes: '' });

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
            setColorForm({ colorName: '', colorHex: '#6B8E9F', costPerUnit: 400, supplierId: '', leadTimeDays: 14, minOrderQty: 20 });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create fabric')
    });

    const createInward = useMutation({
        mutationFn: ({ fabricId, data }: { fabricId: string, data: any }) => fabricsApi.createTransaction(fabricId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricTypes'] });
            queryClient.invalidateQueries({ queryKey: ['fabricStock'] });
            setShowInward(null);
            setInwardForm({ qty: 0, notes: '' });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to record inward')
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
                notes: inwardForm.notes
            }
        });
    };

    const getStockInfo = (fabricId: string) => stockAnalysis?.find((s: any) => s.fabricId === fabricId);

    if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Fabrics</h1>
                <button onClick={() => setShowAddType(true)} className="btn-primary flex items-center"><Plus size={20} className="mr-2" />Add Fabric Type</button>
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
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Color Name</label>
                                    <input className="input" value={colorForm.colorName} onChange={(e) => setColorForm(f => ({ ...f, colorName: e.target.value }))} placeholder="e.g., Wildflower Blue" required />
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
                    <div className="bg-white rounded-xl p-6 w-full max-w-sm">
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
                            <div>
                                <label className="label">Quantity ({showInward.unit === 'meter' ? 'meters' : 'kg'})</label>
                                <input type="number" step="0.1" className="input" value={inwardForm.qty} onChange={(e) => setInwardForm(f => ({ ...f, qty: Number(e.target.value) }))} min={0.1} required />
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
        </div>
    );
}
