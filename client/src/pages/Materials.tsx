/**
 * Materials Page - 3-tier Material hierarchy management
 *
 * VIEW LEVELS:
 * - Material: Base fiber/material types (Linen, Pima Cotton, Cotton)
 * - Fabric: Textile construction variants (Linen 60 Lea Plain Weave, Pima Single Jersey 180gsm)
 * - Colour: Specific color variants with inventory tracking (the actual inventory unit)
 *
 * TAB STRUCTURE:
 * - Materials (default): 3-tier fabric hierarchy using tree view
 * - Trims: Trim items catalog (buttons, zippers, labels, etc.)
 * - Services: Service items catalog (printing, embroidery, etc.)
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { Layers, Scissors, Package, X } from 'lucide-react';

import { materialsApi, fabricsApi } from '../services/api';
import { DetailPanel } from '../components/materials/DetailPanel';
import { MaterialsTreeView } from '../components/materials/MaterialsTreeView';
import { TrimsTable } from '../components/materials/TrimsTable';
import { ServicesTable } from '../components/materials/ServicesTable';

// Tab types
type TabType = 'materials' | 'trims' | 'services';

// Trim categories
const TRIM_CATEGORIES = ['button', 'zipper', 'label', 'thread', 'elastic', 'tape', 'hook', 'drawstring', 'other'];

// Service categories
const SERVICE_CATEGORIES = ['printing', 'embroidery', 'washing', 'dyeing', 'pleating', 'other'];

export default function Materials() {
    const queryClient = useQueryClient();
    const search = useSearch({ strict: false }) as { tab?: TabType };
    const navigate = useNavigate();

    // State from URL params (with defaults)
    const activeTab = (search.tab || 'materials') as TabType;

    // Handle tab change
    const setActiveTab = useCallback((tab: TabType) => {
        if (tab === 'materials') {
            navigate({ to: '/materials', search: {} as Record<string, unknown>, replace: true });
        } else {
            navigate({ to: '/materials', search: { tab } as Record<string, unknown>, replace: true });
        }
    }, [navigate]);

    // Modal states
    const [showAddTrim, setShowAddTrim] = useState(false);
    const [showAddService, setShowAddService] = useState(false);
    const [showAddSupplier, setShowAddSupplier] = useState(false);
    const [showDetail, setShowDetail] = useState<any>(null);
    const [showEditTrim, setShowEditTrim] = useState<any>(null);
    const [showEditService, setShowEditService] = useState<any>(null);
    const [showInward, setShowInward] = useState<any>(null);

    // Form states
    const [trimForm, setTrimForm] = useState({
        code: '', name: '', category: 'button', description: '',
        costPerUnit: '', unit: 'piece', supplierId: '', leadTimeDays: '', minOrderQty: ''
    });
    const [serviceForm, setServiceForm] = useState({
        code: '', name: '', category: 'printing', description: '',
        costPerJob: '', costUnit: 'per_piece', vendorId: '', leadTimeDays: ''
    });
    const [inwardForm, setInwardForm] = useState({
        qty: '', notes: '', costPerUnit: '', supplierId: ''
    });

    // Fetch suppliers
    const { data: suppliers } = useQuery({
        queryKey: ['suppliers'],
        queryFn: () => fabricsApi.getSuppliers().then(r => r.data),
    });

    // Mutations
    const createTrim = useMutation({
        mutationFn: (data: any) => materialsApi.createTrim(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trimsCatalog'] });
            setShowAddTrim(false);
            setTrimForm({
                code: '', name: '', category: 'button', description: '',
                costPerUnit: '', unit: 'piece', supplierId: '', leadTimeDays: '', minOrderQty: ''
            });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create trim'),
    });

    const updateTrim = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => materialsApi.updateTrim(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trimsCatalog'] });
            setShowEditTrim(null);
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update trim'),
    });

    const createService = useMutation({
        mutationFn: (data: any) => materialsApi.createService(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['servicesCatalog'] });
            setShowAddService(false);
            setServiceForm({
                code: '', name: '', category: 'printing', description: '',
                costPerJob: '', costUnit: 'per_piece', vendorId: '', leadTimeDays: ''
            });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create service'),
    });

    const updateService = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => materialsApi.updateService(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['servicesCatalog'] });
            setShowEditService(null);
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update service'),
    });

    const createInward = useMutation({
        mutationFn: (data: { colourId: string; [key: string]: any }) =>
            materialsApi.createColourTransaction(data.colourId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsTree'] });
            setShowInward(null);
            setInwardForm({ qty: '', notes: '', costPerUnit: '', supplierId: '' });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create inward'),
    });

    // Form handlers
    const handleSubmitTrim = (e: React.FormEvent) => {
        e.preventDefault();
        createTrim.mutate({
            code: trimForm.code,
            name: trimForm.name,
            category: trimForm.category,
            description: trimForm.description || null,
            costPerUnit: trimForm.costPerUnit ? parseFloat(trimForm.costPerUnit) : null,
            unit: trimForm.unit,
            supplierId: trimForm.supplierId || null,
            leadTimeDays: trimForm.leadTimeDays ? parseInt(trimForm.leadTimeDays) : null,
            minOrderQty: trimForm.minOrderQty ? parseFloat(trimForm.minOrderQty) : null,
        });
    };

    const handleUpdateTrim = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showEditTrim) return;
        updateTrim.mutate({
            id: showEditTrim.id,
            data: {
                code: showEditTrim.code,
                name: showEditTrim.name,
                category: showEditTrim.category,
                description: showEditTrim.description || null,
                costPerUnit: showEditTrim.costPerUnit ? parseFloat(showEditTrim.costPerUnit) : null,
                unit: showEditTrim.unit,
                supplierId: showEditTrim.supplierId || null,
                leadTimeDays: showEditTrim.leadTimeDays ? parseInt(showEditTrim.leadTimeDays) : null,
                minOrderQty: showEditTrim.minOrderQty ? parseFloat(showEditTrim.minOrderQty) : null,
                isActive: showEditTrim.isActive,
            },
        });
    };

    const handleSubmitService = (e: React.FormEvent) => {
        e.preventDefault();
        createService.mutate({
            code: serviceForm.code,
            name: serviceForm.name,
            category: serviceForm.category,
            description: serviceForm.description || null,
            costPerJob: serviceForm.costPerJob ? parseFloat(serviceForm.costPerJob) : null,
            costUnit: serviceForm.costUnit,
            vendorId: serviceForm.vendorId || null,
            leadTimeDays: serviceForm.leadTimeDays ? parseInt(serviceForm.leadTimeDays) : null,
        });
    };

    const handleUpdateService = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showEditService) return;
        updateService.mutate({
            id: showEditService.id,
            data: {
                code: showEditService.code,
                name: showEditService.name,
                category: showEditService.category,
                description: showEditService.description || null,
                costPerJob: showEditService.costPerJob ? parseFloat(showEditService.costPerJob) : null,
                costUnit: showEditService.costUnit,
                vendorId: showEditService.vendorId || null,
                leadTimeDays: showEditService.leadTimeDays ? parseInt(showEditService.leadTimeDays) : null,
                isActive: showEditService.isActive,
            },
        });
    };

    const handleSubmitInward = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showInward) return;
        createInward.mutate({
            colourId: showInward.id,
            qty: parseFloat(inwardForm.qty),
            reason: 'supplier_receipt',
            notes: inwardForm.notes,
            costPerUnit: inwardForm.costPerUnit ? parseFloat(inwardForm.costPerUnit) : null,
            supplierId: inwardForm.supplierId || null,
        });
    };

    return (
        <div className="flex flex-col h-full">
            {/* Page Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
                <div>
                    <h1 className="text-xl font-semibold text-gray-900">Materials</h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        Manage fabrics, trims, and services for production
                    </p>
                </div>

                {/* Tab Navigation */}
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                    <button
                        onClick={() => setActiveTab('materials')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            activeTab === 'materials'
                                ? 'bg-white shadow text-gray-900'
                                : 'text-gray-600 hover:text-gray-900'
                        }`}
                    >
                        <Layers size={16} />
                        Materials
                    </button>
                    <button
                        onClick={() => setActiveTab('trims')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            activeTab === 'trims'
                                ? 'bg-white shadow text-gray-900'
                                : 'text-gray-600 hover:text-gray-900'
                        }`}
                    >
                        <Scissors size={16} />
                        Trims
                    </button>
                    <button
                        onClick={() => setActiveTab('services')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            activeTab === 'services'
                                ? 'bg-white shadow text-gray-900'
                                : 'text-gray-600 hover:text-gray-900'
                        }`}
                    >
                        <Package size={16} />
                        Services
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden">
                {/* Materials Tab - Tree View */}
                {activeTab === 'materials' && (
                    <MaterialsTreeView
                        onViewDetails={setShowDetail}
                        onAddInward={setShowInward}
                        onAddSupplier={() => setShowAddSupplier(true)}
                    />
                )}

                {/* Trims Tab */}
                {activeTab === 'trims' && (
                    <div className="p-4 h-full overflow-auto">
                        <TrimsTable
                            onEdit={setShowEditTrim}
                            onViewDetails={setShowDetail}
                            onAdd={() => setShowAddTrim(true)}
                        />
                    </div>
                )}

                {/* Services Tab */}
                {activeTab === 'services' && (
                    <div className="p-4 h-full overflow-auto">
                        <ServicesTable
                            onEdit={setShowEditService}
                            onViewDetails={setShowDetail}
                            onAdd={() => setShowAddService(true)}
                        />
                    </div>
                )}
            </div>

            {/* Detail Panel (Slide-over) */}
            {showDetail && (
                <DetailPanel
                    item={showDetail}
                    type={showDetail.nodeType || 'material'}
                    isOpen={!!showDetail}
                    onClose={() => setShowDetail(null)}
                    onEdit={() => {}}
                />
            )}

            {/* Add Trim Modal */}
            {showAddTrim && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Trim</h2>
                            <button onClick={() => setShowAddTrim(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmitTrim} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Code</label>
                                    <input
                                        className="input"
                                        value={trimForm.code}
                                        onChange={(e) => setTrimForm(f => ({ ...f, code: e.target.value }))}
                                        placeholder="e.g., BTN-001"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Category</label>
                                    <select
                                        className="input"
                                        value={trimForm.category}
                                        onChange={(e) => setTrimForm(f => ({ ...f, category: e.target.value }))}
                                    >
                                        {TRIM_CATEGORIES.map(c => (
                                            <option key={c} value={c} className="capitalize">{c}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Name</label>
                                <input
                                    className="input"
                                    value={trimForm.name}
                                    onChange={(e) => setTrimForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g., Shell Button 20mm"
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Cost/Unit (₹)</label>
                                    <input
                                        className="input"
                                        type="number"
                                        step="0.01"
                                        value={trimForm.costPerUnit}
                                        onChange={(e) => setTrimForm(f => ({ ...f, costPerUnit: e.target.value }))}
                                        placeholder="0.00"
                                    />
                                </div>
                                <div>
                                    <label className="label">Unit</label>
                                    <select
                                        className="input"
                                        value={trimForm.unit}
                                        onChange={(e) => setTrimForm(f => ({ ...f, unit: e.target.value }))}
                                    >
                                        <option value="piece">Piece</option>
                                        <option value="meter">Meter</option>
                                        <option value="roll">Roll</option>
                                        <option value="kg">Kilogram</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Lead Time (days)</label>
                                    <input
                                        className="input"
                                        type="number"
                                        value={trimForm.leadTimeDays}
                                        onChange={(e) => setTrimForm(f => ({ ...f, leadTimeDays: e.target.value }))}
                                        placeholder="0"
                                    />
                                </div>
                                <div>
                                    <label className="label">Min Order Qty</label>
                                    <input
                                        className="input"
                                        type="number"
                                        step="0.01"
                                        value={trimForm.minOrderQty}
                                        onChange={(e) => setTrimForm(f => ({ ...f, minOrderQty: e.target.value }))}
                                        placeholder="0"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier</label>
                                <select
                                    className="input"
                                    value={trimForm.supplierId}
                                    onChange={(e) => setTrimForm(f => ({ ...f, supplierId: e.target.value }))}
                                >
                                    <option value="">Select supplier...</option>
                                    {suppliers?.map((s: any) => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="label">Description (optional)</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    value={trimForm.description}
                                    onChange={(e) => setTrimForm(f => ({ ...f, description: e.target.value }))}
                                    placeholder="Additional details..."
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddTrim(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createTrim.isPending}>
                                    {createTrim.isPending ? 'Creating...' : 'Add Trim'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Trim Modal */}
            {showEditTrim && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Edit Trim</h2>
                            <button onClick={() => setShowEditTrim(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleUpdateTrim} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Code</label>
                                    <input
                                        className="input"
                                        value={showEditTrim.code || ''}
                                        onChange={(e) => setShowEditTrim((t: any) => ({ ...t, code: e.target.value }))}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Category</label>
                                    <select
                                        className="input"
                                        value={showEditTrim.category || 'button'}
                                        onChange={(e) => setShowEditTrim((t: any) => ({ ...t, category: e.target.value }))}
                                    >
                                        {TRIM_CATEGORIES.map(c => (
                                            <option key={c} value={c} className="capitalize">{c}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Name</label>
                                <input
                                    className="input"
                                    value={showEditTrim.name || ''}
                                    onChange={(e) => setShowEditTrim((t: any) => ({ ...t, name: e.target.value }))}
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Cost/Unit (₹)</label>
                                    <input
                                        className="input"
                                        type="number"
                                        step="0.01"
                                        value={showEditTrim.costPerUnit || ''}
                                        onChange={(e) => setShowEditTrim((t: any) => ({ ...t, costPerUnit: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="label">Unit</label>
                                    <select
                                        className="input"
                                        value={showEditTrim.unit || 'piece'}
                                        onChange={(e) => setShowEditTrim((t: any) => ({ ...t, unit: e.target.value }))}
                                    >
                                        <option value="piece">Piece</option>
                                        <option value="meter">Meter</option>
                                        <option value="roll">Roll</option>
                                        <option value="kg">Kilogram</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Lead Time (days)</label>
                                    <input
                                        className="input"
                                        type="number"
                                        value={showEditTrim.leadTimeDays || ''}
                                        onChange={(e) => setShowEditTrim((t: any) => ({ ...t, leadTimeDays: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="label">Min Order Qty</label>
                                    <input
                                        className="input"
                                        type="number"
                                        step="0.01"
                                        value={showEditTrim.minOrderQty || ''}
                                        onChange={(e) => setShowEditTrim((t: any) => ({ ...t, minOrderQty: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier</label>
                                <select
                                    className="input"
                                    value={showEditTrim.supplierId || ''}
                                    onChange={(e) => setShowEditTrim((t: any) => ({ ...t, supplierId: e.target.value }))}
                                >
                                    <option value="">Select supplier...</option>
                                    {suppliers?.map((s: any) => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="label">Description</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    value={showEditTrim.description || ''}
                                    onChange={(e) => setShowEditTrim((t: any) => ({ ...t, description: e.target.value }))}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="trimActive"
                                    checked={showEditTrim.isActive ?? true}
                                    onChange={(e) => setShowEditTrim((t: any) => ({ ...t, isActive: e.target.checked }))}
                                    className="rounded border-gray-300"
                                />
                                <label htmlFor="trimActive" className="text-sm text-gray-700">Active</label>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowEditTrim(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={updateTrim.isPending}>
                                    {updateTrim.isPending ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Service Modal */}
            {showAddService && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Service</h2>
                            <button onClick={() => setShowAddService(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmitService} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Code</label>
                                    <input
                                        className="input"
                                        value={serviceForm.code}
                                        onChange={(e) => setServiceForm(f => ({ ...f, code: e.target.value }))}
                                        placeholder="e.g., SVC-PRINT-001"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Category</label>
                                    <select
                                        className="input"
                                        value={serviceForm.category}
                                        onChange={(e) => setServiceForm(f => ({ ...f, category: e.target.value }))}
                                    >
                                        {SERVICE_CATEGORIES.map(c => (
                                            <option key={c} value={c} className="capitalize">{c}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Name</label>
                                <input
                                    className="input"
                                    value={serviceForm.name}
                                    onChange={(e) => setServiceForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g., Screen Printing - Single Color"
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Cost/Job (₹)</label>
                                    <input
                                        className="input"
                                        type="number"
                                        step="0.01"
                                        value={serviceForm.costPerJob}
                                        onChange={(e) => setServiceForm(f => ({ ...f, costPerJob: e.target.value }))}
                                        placeholder="0.00"
                                    />
                                </div>
                                <div>
                                    <label className="label">Cost Unit</label>
                                    <select
                                        className="input"
                                        value={serviceForm.costUnit}
                                        onChange={(e) => setServiceForm(f => ({ ...f, costUnit: e.target.value }))}
                                    >
                                        <option value="per_piece">Per Piece</option>
                                        <option value="per_meter">Per Meter</option>
                                        <option value="per_kg">Per Kg</option>
                                        <option value="per_job">Per Job</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Lead Time (days)</label>
                                <input
                                    className="input"
                                    type="number"
                                    value={serviceForm.leadTimeDays}
                                    onChange={(e) => setServiceForm(f => ({ ...f, leadTimeDays: e.target.value }))}
                                    placeholder="0"
                                />
                            </div>
                            <div>
                                <label className="label">Vendor</label>
                                <select
                                    className="input"
                                    value={serviceForm.vendorId}
                                    onChange={(e) => setServiceForm(f => ({ ...f, vendorId: e.target.value }))}
                                >
                                    <option value="">Select vendor...</option>
                                    {suppliers?.map((s: any) => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="label">Description (optional)</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    value={serviceForm.description}
                                    onChange={(e) => setServiceForm(f => ({ ...f, description: e.target.value }))}
                                    placeholder="Additional details..."
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddService(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createService.isPending}>
                                    {createService.isPending ? 'Creating...' : 'Add Service'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Service Modal */}
            {showEditService && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Edit Service</h2>
                            <button onClick={() => setShowEditService(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleUpdateService} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Code</label>
                                    <input
                                        className="input"
                                        value={showEditService.code || ''}
                                        onChange={(e) => setShowEditService((s: any) => ({ ...s, code: e.target.value }))}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Category</label>
                                    <select
                                        className="input"
                                        value={showEditService.category || 'printing'}
                                        onChange={(e) => setShowEditService((s: any) => ({ ...s, category: e.target.value }))}
                                    >
                                        {SERVICE_CATEGORIES.map(c => (
                                            <option key={c} value={c} className="capitalize">{c}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Name</label>
                                <input
                                    className="input"
                                    value={showEditService.name || ''}
                                    onChange={(e) => setShowEditService((s: any) => ({ ...s, name: e.target.value }))}
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Cost/Job (₹)</label>
                                    <input
                                        className="input"
                                        type="number"
                                        step="0.01"
                                        value={showEditService.costPerJob || ''}
                                        onChange={(e) => setShowEditService((s: any) => ({ ...s, costPerJob: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="label">Cost Unit</label>
                                    <select
                                        className="input"
                                        value={showEditService.costUnit || 'per_piece'}
                                        onChange={(e) => setShowEditService((s: any) => ({ ...s, costUnit: e.target.value }))}
                                    >
                                        <option value="per_piece">Per Piece</option>
                                        <option value="per_meter">Per Meter</option>
                                        <option value="per_kg">Per Kg</option>
                                        <option value="per_job">Per Job</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Lead Time (days)</label>
                                <input
                                    className="input"
                                    type="number"
                                    value={showEditService.leadTimeDays || ''}
                                    onChange={(e) => setShowEditService((s: any) => ({ ...s, leadTimeDays: e.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="label">Vendor</label>
                                <select
                                    className="input"
                                    value={showEditService.vendorId || ''}
                                    onChange={(e) => setShowEditService((s: any) => ({ ...s, vendorId: e.target.value }))}
                                >
                                    <option value="">Select vendor...</option>
                                    {suppliers?.map((s: any) => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="label">Description</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    value={showEditService.description || ''}
                                    onChange={(e) => setShowEditService((s: any) => ({ ...s, description: e.target.value }))}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="serviceActive"
                                    checked={showEditService.isActive ?? true}
                                    onChange={(e) => setShowEditService((s: any) => ({ ...s, isActive: e.target.checked }))}
                                    className="rounded border-gray-300"
                                />
                                <label htmlFor="serviceActive" className="text-sm text-gray-700">Active</label>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowEditService(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={updateService.isPending}>
                                    {updateService.isPending ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Inward Modal */}
            {showInward && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Stock Inward</h2>
                            <button onClick={() => setShowInward(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-500">
                                Colour: <span className="font-medium text-gray-900">{showInward.colourName || showInward.name}</span>
                            </p>
                            {showInward.fabricName && (
                                <p className="text-sm text-gray-500">
                                    Fabric: <span className="font-medium text-gray-900">{showInward.fabricName}</span>
                                </p>
                            )}
                        </div>
                        <form onSubmit={handleSubmitInward} className="space-y-4">
                            <div>
                                <label className="label">Quantity ({showInward.unit || 'm'})</label>
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
                                <label className="label">Cost/Unit (₹, optional)</label>
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
                                    value={inwardForm.supplierId}
                                    onChange={(e) => setInwardForm(f => ({ ...f, supplierId: e.target.value }))}
                                >
                                    <option value="">Select supplier...</option>
                                    {suppliers?.map((s: any) => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
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
                                <button type="button" onClick={() => setShowInward(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createInward.isPending}>
                                    {createInward.isPending ? 'Adding...' : 'Add Inward'}
                                </button>
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
                            <button onClick={() => setShowAddSupplier(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <p className="text-sm text-gray-500 mb-4">
                            Supplier management is available in the Settings page.
                        </p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowAddSupplier(false)} className="btn-secondary flex-1">Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
