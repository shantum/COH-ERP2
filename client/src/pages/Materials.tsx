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
import { useServerFn } from '@tanstack/react-start';
import { Layers, Scissors, Package, X } from 'lucide-react';

import {
    getParties,
    createTrim,
    updateTrim,
    createService,
    updateService,
    createColourTransaction,
} from '@/server/functions/materialsMutations';
import { DetailPanel } from '../components/materials/DetailPanel';
import { MaterialsTreeView } from '../components/materials/MaterialsTreeView';
import { TrimsTable } from '../components/materials/TrimsTable';
import { ServicesTable } from '../components/materials/ServicesTable';
import type { MaterialNode } from '../components/materials/types';

// Tab types
type TabType = 'materials' | 'trims' | 'services';

// Party type from getParties response
interface Party {
    id: string;
    name: string;
    category: string;
    email: string | null;
    phone: string | null;
    isActive: boolean;
}

// Trim item type (matches TrimsTable Trim interface)
interface TrimItem {
    id: string;
    code: string;
    name: string;
    category: string;
    description?: string | null;
    costPerUnit?: number | null;
    unit: string;
    partyId?: string | null;
    partyName?: string | null;
    leadTimeDays?: number | null;
    minOrderQty?: number | null;
    usageCount?: number;
    isActive: boolean;
}

// Service item type (matches ServicesTable Service interface)
interface ServiceItem {
    id: string;
    code: string;
    name: string;
    category: string;
    description?: string | null;
    costPerJob?: number | null;
    costUnit: string;
    partyId?: string | null;
    partyName?: string | null;
    leadTimeDays?: number | null;
    usageCount?: number;
    isActive: boolean;
}

// Form state for Trim edit modal (string values for form inputs)
interface TrimEditState extends Omit<TrimItem, 'costPerUnit' | 'leadTimeDays' | 'minOrderQty'> {
    costPerUnit: string;
    leadTimeDays: string;
    minOrderQty: string;
}

// Form state for Service edit modal (string values for form inputs)
interface ServiceEditState extends Omit<ServiceItem, 'costPerJob' | 'leadTimeDays'> {
    costPerJob: string;
    leadTimeDays: string;
}

// Colour node for inward modal (subset of MaterialNode with required fields)
interface ColourInwardNode {
    id: string;
    colourName?: string;
    name?: string;
    fabricName?: string;
    unit?: string;
}

// Detail panel item type - union of all viewable item types
type DetailPanelItem = MaterialNode | TrimItem | ServiceItem;

// Type guard helpers for DetailPanelItem
function isTrimItem(item: DetailPanelItem): item is TrimItem {
    return 'unit' in item && 'category' in item && !('type' in item);
}

function isServiceItem(item: DetailPanelItem): item is ServiceItem {
    return 'costUnit' in item && 'category' in item && !('type' in item);
}

function isMaterialNode(item: DetailPanelItem): item is MaterialNode {
    return 'type' in item && (item.type === 'material' || item.type === 'fabric' || item.type === 'colour');
}

// Get the detail panel type from the item
function getDetailPanelType(item: DetailPanelItem): 'colour' | 'fabric' | 'material' | 'trim' | 'service' {
    if (isMaterialNode(item)) {
        return item.type;
    }
    if (isServiceItem(item)) {
        return 'service';
    }
    if (isTrimItem(item)) {
        return 'trim';
    }
    return 'material'; // fallback
}

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
    const [showDetail, setShowDetail] = useState<DetailPanelItem | null>(null);
    const [showEditTrim, setShowEditTrim] = useState<TrimEditState | null>(null);
    const [showEditService, setShowEditService] = useState<ServiceEditState | null>(null);
    const [showInward, setShowInward] = useState<ColourInwardNode | null>(null);

    // Form states
    const [trimForm, setTrimForm] = useState({
        code: '', name: '', category: 'button', description: '',
        costPerUnit: '', unit: 'piece', partyId: '', leadTimeDays: '', minOrderQty: ''
    });
    const [serviceForm, setServiceForm] = useState({
        code: '', name: '', category: 'printing', description: '',
        costPerJob: '', costUnit: 'per_piece', partyId: '', leadTimeDays: ''
    });
    const [inwardForm, setInwardForm] = useState({
        qty: '', notes: '', costPerUnit: '', partyId: ''
    });

    // Server function hooks
    const getPartiesFn = useServerFn(getParties);
    const createTrimFn = useServerFn(createTrim);
    const updateTrimFn = useServerFn(updateTrim);
    const createServiceFn = useServerFn(createService);
    const updateServiceFn = useServerFn(updateService);
    const createColourTxnFn = useServerFn(createColourTransaction);

    // Fetch parties
    const { data: partiesData } = useQuery({
        queryKey: ['parties'],
        queryFn: () => getPartiesFn(),
    });
    const parties: Party[] | undefined = partiesData?.parties;

    // Mutation types - defined inline based on Zod schema shapes
    type CreateTrimInput = {
        code: string;
        name: string;
        category: string;
        description?: string | null;
        costPerUnit?: number | null;
        unit?: string;
        partyId?: string | null;
        leadTimeDays?: number | null;
        minOrderQty?: number | null;
    };

    type UpdateTrimInput = CreateTrimInput & {
        id: string;
        isActive?: boolean;
    };

    type CreateServiceInput = {
        code: string;
        name: string;
        category: string;
        description?: string | null;
        costPerJob?: number | null;
        costUnit?: string;
        partyId?: string | null;
        leadTimeDays?: number | null;
    };

    type UpdateServiceInput = CreateServiceInput & {
        id: string;
        isActive?: boolean;
    };

    type CreateColourTransactionInput = {
        colourId: string;
        qty: number;
        reason: string;
        notes?: string | null;
        costPerUnit?: number | null;
        partyId?: string | null;
    };

    // Mutations
    const createTrimMutation = useMutation({
        mutationFn: (data: CreateTrimInput) => createTrimFn({ data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trimsCatalog'] });
            setShowAddTrim(false);
            setTrimForm({
                code: '', name: '', category: 'button', description: '',
                costPerUnit: '', unit: 'piece', partyId: '', leadTimeDays: '', minOrderQty: ''
            });
        },
        onError: (err: Error) => alert(err.message || 'Failed to create trim'),
    });

    const updateTrimMutation = useMutation({
        mutationFn: (data: UpdateTrimInput) => updateTrimFn({ data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trimsCatalog'] });
            setShowEditTrim(null);
        },
        onError: (err: Error) => alert(err.message || 'Failed to update trim'),
    });

    const createServiceMutation = useMutation({
        mutationFn: (data: CreateServiceInput) => createServiceFn({ data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['servicesCatalog'] });
            setShowAddService(false);
            setServiceForm({
                code: '', name: '', category: 'printing', description: '',
                costPerJob: '', costUnit: 'per_piece', partyId: '', leadTimeDays: ''
            });
        },
        onError: (err: Error) => alert(err.message || 'Failed to create service'),
    });

    const updateServiceMutation = useMutation({
        mutationFn: (data: UpdateServiceInput) => updateServiceFn({ data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['servicesCatalog'] });
            setShowEditService(null);
        },
        onError: (err: Error) => alert(err.message || 'Failed to update service'),
    });

    const createInwardMutation = useMutation({
        mutationFn: (data: CreateColourTransactionInput) => createColourTxnFn({ data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsTree'] });
            setShowInward(null);
            setInwardForm({ qty: '', notes: '', costPerUnit: '', partyId: '' });
        },
        onError: (err: Error) => alert(err.message || 'Failed to create inward'),
    });

    // Form handlers
    const handleSubmitTrim = (e: React.FormEvent) => {
        e.preventDefault();
        createTrimMutation.mutate({
            code: trimForm.code,
            name: trimForm.name,
            category: trimForm.category,
            description: trimForm.description || null,
            costPerUnit: trimForm.costPerUnit ? parseFloat(trimForm.costPerUnit) : null,
            unit: trimForm.unit,
            partyId: trimForm.partyId || null,
            leadTimeDays: trimForm.leadTimeDays ? parseInt(trimForm.leadTimeDays) : null,
            minOrderQty: trimForm.minOrderQty ? parseFloat(trimForm.minOrderQty) : null,
        });
    };

    const handleUpdateTrim = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showEditTrim) return;
        updateTrimMutation.mutate({
            id: showEditTrim.id,
            code: showEditTrim.code,
            name: showEditTrim.name,
            category: showEditTrim.category,
            description: showEditTrim.description || null,
            costPerUnit: showEditTrim.costPerUnit ? parseFloat(showEditTrim.costPerUnit) : null,
            unit: showEditTrim.unit,
            partyId: showEditTrim.partyId || null,
            leadTimeDays: showEditTrim.leadTimeDays ? parseInt(showEditTrim.leadTimeDays) : null,
            minOrderQty: showEditTrim.minOrderQty ? parseFloat(showEditTrim.minOrderQty) : null,
            isActive: showEditTrim.isActive,
        });
    };

    const handleSubmitService = (e: React.FormEvent) => {
        e.preventDefault();
        createServiceMutation.mutate({
            code: serviceForm.code,
            name: serviceForm.name,
            category: serviceForm.category,
            description: serviceForm.description || null,
            costPerJob: serviceForm.costPerJob ? parseFloat(serviceForm.costPerJob) : null,
            costUnit: serviceForm.costUnit,
            partyId: serviceForm.partyId || null,
            leadTimeDays: serviceForm.leadTimeDays ? parseInt(serviceForm.leadTimeDays) : null,
        });
    };

    const handleUpdateService = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showEditService) return;
        updateServiceMutation.mutate({
            id: showEditService.id,
            code: showEditService.code,
            name: showEditService.name,
            category: showEditService.category,
            description: showEditService.description || null,
            costPerJob: showEditService.costPerJob ? parseFloat(showEditService.costPerJob) : null,
            costUnit: showEditService.costUnit,
            partyId: showEditService.partyId || null,
            leadTimeDays: showEditService.leadTimeDays ? parseInt(showEditService.leadTimeDays) : null,
            isActive: showEditService.isActive,
        });
    };

    const handleSubmitInward = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showInward) return;
        createInwardMutation.mutate({
            colourId: showInward.id,
            qty: parseFloat(inwardForm.qty),
            reason: 'supplier_receipt',
            notes: inwardForm.notes,
            costPerUnit: inwardForm.costPerUnit ? parseFloat(inwardForm.costPerUnit) : null,
            partyId: inwardForm.partyId || null,
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
                        onAddInward={(node) => setShowInward({
                            id: node.id,
                            colourName: node.colourName,
                            name: node.name,
                            fabricName: node.fabricName,
                            unit: node.unit,
                        })}
                        onAddSupplier={() => setShowAddSupplier(true)}
                    />
                )}

                {/* Trims Tab */}
                {activeTab === 'trims' && (
                    <div className="p-4 h-full overflow-auto">
                        <TrimsTable
                            onEdit={(trim) => setShowEditTrim({
                                ...trim,
                                costPerUnit: trim.costPerUnit?.toString() ?? '',
                                leadTimeDays: trim.leadTimeDays?.toString() ?? '',
                                minOrderQty: trim.minOrderQty?.toString() ?? '',
                            })}
                            onViewDetails={setShowDetail}
                            onAdd={() => setShowAddTrim(true)}
                        />
                    </div>
                )}

                {/* Services Tab */}
                {activeTab === 'services' && (
                    <div className="p-4 h-full overflow-auto">
                        <ServicesTable
                            onEdit={(service) => setShowEditService({
                                ...service,
                                costPerJob: service.costPerJob?.toString() ?? '',
                                leadTimeDays: service.leadTimeDays?.toString() ?? '',
                            })}
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
                    type={getDetailPanelType(showDetail)}
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
                                    value={trimForm.partyId}
                                    onChange={(e) => setTrimForm(f => ({ ...f, partyId: e.target.value }))}
                                >
                                    <option value="">Select supplier...</option>
                                    {parties?.map((s) => (
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
                                <button type="submit" className="btn-primary flex-1" disabled={createTrimMutation.isPending}>
                                    {createTrimMutation.isPending ? 'Creating...' : 'Add Trim'}
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
                                        onChange={(e) => setShowEditTrim((t) => t ? ({ ...t, code: e.target.value }) : null)}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Category</label>
                                    <select
                                        className="input"
                                        value={showEditTrim.category || 'button'}
                                        onChange={(e) => setShowEditTrim((t) => t ? ({ ...t, category: e.target.value }) : null)}
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
                                    onChange={(e) => setShowEditTrim((t) => t ? ({ ...t, name: e.target.value }) : null)}
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
                                        onChange={(e) => setShowEditTrim((t) => t ? ({ ...t, costPerUnit: e.target.value }) : null)}
                                    />
                                </div>
                                <div>
                                    <label className="label">Unit</label>
                                    <select
                                        className="input"
                                        value={showEditTrim.unit || 'piece'}
                                        onChange={(e) => setShowEditTrim((t) => t ? ({ ...t, unit: e.target.value }) : null)}
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
                                        onChange={(e) => setShowEditTrim((t) => t ? ({ ...t, leadTimeDays: e.target.value }) : null)}
                                    />
                                </div>
                                <div>
                                    <label className="label">Min Order Qty</label>
                                    <input
                                        className="input"
                                        type="number"
                                        step="0.01"
                                        value={showEditTrim.minOrderQty || ''}
                                        onChange={(e) => setShowEditTrim((t) => t ? ({ ...t, minOrderQty: e.target.value }) : null)}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier</label>
                                <select
                                    className="input"
                                    value={showEditTrim.partyId || ''}
                                    onChange={(e) => setShowEditTrim((t) => t ? ({ ...t, partyId: e.target.value }) : null)}
                                >
                                    <option value="">Select supplier...</option>
                                    {parties?.map((s) => (
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
                                    onChange={(e) => setShowEditTrim((t) => t ? ({ ...t, description: e.target.value }) : null)}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="trimActive"
                                    checked={showEditTrim.isActive ?? true}
                                    onChange={(e) => setShowEditTrim((t) => t ? ({ ...t, isActive: e.target.checked }) : null)}
                                    className="rounded border-gray-300"
                                />
                                <label htmlFor="trimActive" className="text-sm text-gray-700">Active</label>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowEditTrim(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={updateTrimMutation.isPending}>
                                    {updateTrimMutation.isPending ? 'Saving...' : 'Save Changes'}
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
                                    value={serviceForm.partyId}
                                    onChange={(e) => setServiceForm(f => ({ ...f, partyId: e.target.value }))}
                                >
                                    <option value="">Select vendor...</option>
                                    {parties?.map((s) => (
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
                                <button type="submit" className="btn-primary flex-1" disabled={createServiceMutation.isPending}>
                                    {createServiceMutation.isPending ? 'Creating...' : 'Add Service'}
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
                                        onChange={(e) => setShowEditService((s) => s ? ({ ...s, code: e.target.value }) : null)}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Category</label>
                                    <select
                                        className="input"
                                        value={showEditService.category || 'printing'}
                                        onChange={(e) => setShowEditService((s) => s ? ({ ...s, category: e.target.value }) : null)}
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
                                    onChange={(e) => setShowEditService((s) => s ? ({ ...s, name: e.target.value }) : null)}
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
                                        onChange={(e) => setShowEditService((s) => s ? ({ ...s, costPerJob: e.target.value }) : null)}
                                    />
                                </div>
                                <div>
                                    <label className="label">Cost Unit</label>
                                    <select
                                        className="input"
                                        value={showEditService.costUnit || 'per_piece'}
                                        onChange={(e) => setShowEditService((s) => s ? ({ ...s, costUnit: e.target.value }) : null)}
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
                                    onChange={(e) => setShowEditService((s) => s ? ({ ...s, leadTimeDays: e.target.value }) : null)}
                                />
                            </div>
                            <div>
                                <label className="label">Vendor</label>
                                <select
                                    className="input"
                                    value={showEditService.partyId || ''}
                                    onChange={(e) => setShowEditService((s) => s ? ({ ...s, partyId: e.target.value }) : null)}
                                >
                                    <option value="">Select vendor...</option>
                                    {parties?.map((s) => (
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
                                    onChange={(e) => setShowEditService((s) => s ? ({ ...s, description: e.target.value }) : null)}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="serviceActive"
                                    checked={showEditService.isActive ?? true}
                                    onChange={(e) => setShowEditService((s) => s ? ({ ...s, isActive: e.target.checked }) : null)}
                                    className="rounded border-gray-300"
                                />
                                <label htmlFor="serviceActive" className="text-sm text-gray-700">Active</label>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowEditService(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={updateServiceMutation.isPending}>
                                    {updateServiceMutation.isPending ? 'Saving...' : 'Save Changes'}
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
                                    value={inwardForm.partyId}
                                    onChange={(e) => setInwardForm(f => ({ ...f, partyId: e.target.value }))}
                                >
                                    <option value="">Select supplier...</option>
                                    {parties?.map((s) => (
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
                                <button type="submit" className="btn-primary flex-1" disabled={createInwardMutation.isPending}>
                                    {createInwardMutation.isPending ? 'Adding...' : 'Add Inward'}
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
