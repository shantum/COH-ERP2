/**
 * MaterialEditModal - Unified modal for editing materials, fabrics, colours, trims, and services
 *
 * A single modal component that handles all material-related edit operations.
 * Uses `type` prop to determine which form fields to display.
 *
 * Uses Server Functions for data mutations (TanStack Start migration)
 */

import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
    updateMaterial as updateMaterialFn,
    updateFabric as updateFabricFn,
    updateColour as updateColourFn,
    updateTrim as updateTrimFn,
    updateService as updateServiceFn,
    getSuppliers,
    type Supplier,
} from '../../server/functions/materialsMutations';

// Types
export type MaterialEditType = 'material' | 'fabric' | 'colour' | 'trim' | 'service';

interface MaterialEditModalProps {
    type: MaterialEditType;
    item: any;
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

// Standard colors with hex values
const STANDARD_COLOR_HEX: Record<string, string> = {
    Red: '#DC2626', Orange: '#EA580C', Yellow: '#CA8A04', Green: '#16A34A',
    Blue: '#2563EB', Purple: '#9333EA', Pink: '#DB2777', Brown: '#92400E',
    Black: '#171717', White: '#FAFAFA', Grey: '#6B7280', Beige: '#D4B896',
    Navy: '#1E3A5F', Teal: '#0D9488', Indigo: '#4F46E5', Coral: '#F97316',
    Cream: '#FEF3C7', Natural: '#E7E5E4',
};
const STANDARD_COLORS = Object.keys(STANDARD_COLOR_HEX);

// Construction types & categories
const CONSTRUCTION_TYPES = ['knit', 'woven'];
const TRIM_CATEGORIES = ['button', 'zipper', 'label', 'thread', 'elastic', 'tape', 'hook', 'drawstring', 'other'];
const SERVICE_CATEGORIES = ['printing', 'embroidery', 'washing', 'dyeing', 'pleating', 'other'];

export function MaterialEditModal({ type, item, isOpen, onClose, onSuccess }: MaterialEditModalProps) {
    const queryClient = useQueryClient();

    // Fetch suppliers
    const { data: suppliers } = useQuery<Supplier[]>({
        queryKey: ['suppliers'],
        queryFn: async () => {
            const response = await getSuppliers();
            return response.suppliers;
        },
        enabled: isOpen && (type === 'colour' || type === 'trim'),
    });

    // Form states based on type
    const [materialForm, setMaterialForm] = useState({ name: '', description: '' });
    const [fabricForm, setFabricForm] = useState({
        name: '', constructionType: 'woven', pattern: '',
        weight: '' as string | number, weightUnit: 'gsm', composition: '',
        defaultCostPerUnit: '' as string | number, defaultLeadTimeDays: '' as string | number,
        defaultMinOrderQty: '' as string | number, avgShrinkagePct: 0
    });
    const [colourForm, setColourForm] = useState({
        colourName: '', standardColour: '', colourHex: '#6B8E9F',
        costPerUnit: '' as string | number, supplierId: '',
        leadTimeDays: '' as string | number, minOrderQty: '' as string | number
    });
    const [trimForm, setTrimForm] = useState({
        code: '', name: '', category: 'button', description: '',
        costPerUnit: '' as string | number, unit: 'piece',
        supplierId: '', leadTimeDays: '' as string | number, minOrderQty: '' as string | number
    });
    const [serviceForm, setServiceForm] = useState({
        code: '', name: '', category: 'printing', description: '',
        costPerJob: '' as string | number, costUnit: 'per_piece',
        vendorId: '', leadTimeDays: '' as string | number
    });

    // Initialize form data when item changes
    useEffect(() => {
        if (!item || !isOpen) return;

        switch (type) {
            case 'material':
                setMaterialForm({
                    name: item.name || '',
                    description: item.description || '',
                });
                break;
            case 'fabric':
                setFabricForm({
                    name: item.name || '',
                    constructionType: item.constructionType || 'woven',
                    pattern: item.pattern || '',
                    weight: item.weight ?? '',
                    weightUnit: item.weightUnit || 'gsm',
                    composition: item.composition || '',
                    defaultCostPerUnit: item.defaultCostPerUnit ?? '',
                    defaultLeadTimeDays: item.defaultLeadTimeDays ?? '',
                    defaultMinOrderQty: item.defaultMinOrderQty ?? '',
                    avgShrinkagePct: item.avgShrinkagePct || 0,
                });
                break;
            case 'colour':
                setColourForm({
                    colourName: item.colourName || '',
                    standardColour: item.standardColour || '',
                    colourHex: item.colourHex || '#6B8E9F',
                    costPerUnit: item.costPerUnit ?? '',
                    supplierId: item.supplierId || '',
                    leadTimeDays: item.leadTimeDays ?? '',
                    minOrderQty: item.minOrderQty ?? '',
                });
                break;
            case 'trim':
                setTrimForm({
                    code: item.code || '',
                    name: item.name || '',
                    category: item.category || 'button',
                    description: item.description || '',
                    costPerUnit: item.costPerUnit ?? '',
                    unit: item.unit || 'piece',
                    supplierId: item.supplierId || '',
                    leadTimeDays: item.leadTimeDays ?? '',
                    minOrderQty: item.minOrderQty ?? '',
                });
                break;
            case 'service':
                setServiceForm({
                    code: item.code || '',
                    name: item.name || '',
                    category: item.category || 'printing',
                    description: item.description || '',
                    costPerJob: item.costPerJob ?? '',
                    costUnit: item.costUnit || 'per_piece',
                    vendorId: item.vendorId || '',
                    leadTimeDays: item.leadTimeDays ?? '',
                });
                break;
        }
    }, [item, isOpen, type]);

    // Mutations
    const updateMaterial = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: { name: string; description: string } }) => {
            const response = await updateMaterialFn({
                data: { id, name: data.name, description: data.description },
            });
            if (!response.success) throw new Error('Failed to update material');
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsHierarchy'] });
            queryClient.invalidateQueries({ queryKey: ['materialsFilters'] });
            onSuccess?.();
            onClose();
        },
        onError: (err: Error) => alert(err.message || 'Failed to update material'),
    });

    const updateFabric = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
            const response = await updateFabricFn({
                data: { id, ...data },
            });
            if (!response.success) throw new Error('Failed to update fabric');
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsHierarchy'] });
            onSuccess?.();
            onClose();
        },
        onError: (err: Error) => alert(err.message || 'Failed to update fabric'),
    });

    const updateColour = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
            const response = await updateColourFn({
                data: { id, ...data },
            });
            if (!response.success) throw new Error('Failed to update colour');
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsHierarchy'] });
            onSuccess?.();
            onClose();
        },
        onError: (err: Error) => alert(err.message || 'Failed to update colour'),
    });

    const updateTrim = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
            const response = await updateTrimFn({
                data: { id, ...data },
            });
            if (!response.success) throw new Error('Failed to update trim');
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trimsCatalog'] });
            onSuccess?.();
            onClose();
        },
        onError: (err: Error) => alert(err.message || 'Failed to update trim'),
    });

    const updateService = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
            const response = await updateServiceFn({
                data: { id, ...data },
            });
            if (!response.success) throw new Error('Failed to update service');
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['servicesCatalog'] });
            onSuccess?.();
            onClose();
        },
        onError: (err: Error) => alert(err.message || 'Failed to update service'),
    });

    // Check if any mutation is pending
    const isLoading = useMemo(() =>
        updateMaterial.isPending || updateFabric.isPending || updateColour.isPending ||
        updateTrim.isPending || updateService.isPending
    , [updateMaterial.isPending, updateFabric.isPending, updateColour.isPending,
       updateTrim.isPending, updateService.isPending]);

    // Handle submit
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!item) return;

        switch (type) {
            case 'material':
                updateMaterial.mutate({ id: item.id, data: materialForm });
                break;
            case 'fabric':
                updateFabric.mutate({
                    id: item.fabricId || item.id,
                    data: {
                        name: fabricForm.name,
                        constructionType: fabricForm.constructionType,
                        pattern: fabricForm.pattern || null,
                        weight: fabricForm.weight !== '' ? Number(fabricForm.weight) : null,
                        weightUnit: fabricForm.weightUnit,
                        composition: fabricForm.composition || null,
                        defaultCostPerUnit: fabricForm.defaultCostPerUnit !== '' ? Number(fabricForm.defaultCostPerUnit) : null,
                        defaultLeadTimeDays: fabricForm.defaultLeadTimeDays !== '' ? Number(fabricForm.defaultLeadTimeDays) : null,
                        defaultMinOrderQty: fabricForm.defaultMinOrderQty !== '' ? Number(fabricForm.defaultMinOrderQty) : null,
                        avgShrinkagePct: fabricForm.avgShrinkagePct,
                    },
                });
                break;
            case 'colour':
                updateColour.mutate({
                    id: item.colourId || item.id,
                    data: {
                        colourName: colourForm.colourName,
                        standardColour: colourForm.standardColour || null,
                        colourHex: colourForm.colourHex,
                        costPerUnit: colourForm.costPerUnit === '' ? null : colourForm.costPerUnit,
                        supplierId: colourForm.supplierId || null,
                        leadTimeDays: colourForm.leadTimeDays === '' ? null : colourForm.leadTimeDays,
                        minOrderQty: colourForm.minOrderQty === '' ? null : colourForm.minOrderQty,
                    },
                });
                break;
            case 'trim':
                updateTrim.mutate({
                    id: item.id,
                    data: {
                        code: trimForm.code,
                        name: trimForm.name,
                        category: trimForm.category,
                        description: trimForm.description || null,
                        costPerUnit: trimForm.costPerUnit !== '' ? Number(trimForm.costPerUnit) : 0,
                        unit: trimForm.unit,
                        supplierId: trimForm.supplierId || null,
                        leadTimeDays: trimForm.leadTimeDays !== '' ? Number(trimForm.leadTimeDays) : null,
                        minOrderQty: trimForm.minOrderQty !== '' ? Number(trimForm.minOrderQty) : null,
                    },
                });
                break;
            case 'service':
                updateService.mutate({
                    id: item.id,
                    data: {
                        code: serviceForm.code,
                        name: serviceForm.name,
                        category: serviceForm.category,
                        description: serviceForm.description || null,
                        costPerJob: serviceForm.costPerJob !== '' ? Number(serviceForm.costPerJob) : 0,
                        costUnit: serviceForm.costUnit,
                        vendorId: serviceForm.vendorId || null,
                        leadTimeDays: serviceForm.leadTimeDays !== '' ? Number(serviceForm.leadTimeDays) : null,
                    },
                });
                break;
        }
    };

    // Get modal title
    const getTitle = () => {
        switch (type) {
            case 'material': return 'Edit Material';
            case 'fabric': return 'Edit Fabric';
            case 'colour': return 'Edit Colour';
            case 'trim': return 'Edit Trim';
            case 'service': return 'Edit Service';
        }
    };

    // Get subtitle
    const getSubtitle = () => {
        if (!item) return null;
        switch (type) {
            case 'colour':
                return item.fabricName;
            case 'fabric':
                return item.materialName;
            default:
                return null;
        }
    };

    if (!isOpen || !item) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-semibold">{getTitle()}</h2>
                        {getSubtitle() && (
                            <p className="text-sm text-gray-500">{getSubtitle()}</p>
                        )}
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Material Form */}
                    {type === 'material' && (
                        <>
                            <div>
                                <label className="label">Material Name</label>
                                <input
                                    className="input"
                                    value={materialForm.name}
                                    onChange={(e) => setMaterialForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g., Linen, Pima Cotton"
                                    required
                                />
                            </div>
                            <div>
                                <label className="label">Description (optional)</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    value={materialForm.description}
                                    onChange={(e) => setMaterialForm(f => ({ ...f, description: e.target.value }))}
                                    placeholder="Optional description..."
                                />
                            </div>
                        </>
                    )}

                    {/* Fabric Form */}
                    {type === 'fabric' && (
                        <>
                            <div>
                                <label className="label">Fabric Name</label>
                                <input
                                    className="input"
                                    value={fabricForm.name}
                                    onChange={(e) => setFabricForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g., 60 Lea Plain Weave"
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Construction Type</label>
                                    <div className="flex gap-2">
                                        {CONSTRUCTION_TYPES.map(t => (
                                            <button
                                                key={t}
                                                type="button"
                                                onClick={() => setFabricForm(f => ({ ...f, constructionType: t, pattern: '' }))}
                                                className={`flex-1 py-2 px-3 text-sm rounded-lg border transition-colors capitalize ${
                                                    fabricForm.constructionType === t
                                                        ? 'bg-primary-50 border-primary-300 text-primary-700'
                                                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                }`}
                                            >
                                                {t}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="label">Pattern</label>
                                    <select
                                        className="input"
                                        value={fabricForm.pattern}
                                        onChange={(e) => setFabricForm(f => ({ ...f, pattern: e.target.value }))}
                                    >
                                        <option value="">Select pattern...</option>
                                        {fabricForm.constructionType === 'knit' && (
                                            <>
                                                <option value="single_jersey">Single Jersey</option>
                                                <option value="french_terry">French Terry</option>
                                                <option value="rib">Rib</option>
                                                <option value="interlock">Interlock</option>
                                                <option value="fleece">Fleece</option>
                                                <option value="pique">Pique</option>
                                            </>
                                        )}
                                        {fabricForm.constructionType === 'woven' && (
                                            <>
                                                <option value="plain">Plain Weave</option>
                                                <option value="twill">Twill</option>
                                                <option value="satin">Satin</option>
                                                <option value="poplin">Poplin</option>
                                                <option value="chambray">Chambray</option>
                                                <option value="oxford">Oxford</option>
                                                <option value="linen_regular">Linen Regular</option>
                                            </>
                                        )}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="label">Weight</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        className="input"
                                        value={fabricForm.weight}
                                        onChange={(e) => setFabricForm(f => ({ ...f, weight: e.target.value }))}
                                        placeholder="180"
                                    />
                                </div>
                                <div>
                                    <label className="label">Weight Unit</label>
                                    <select
                                        className="input"
                                        value={fabricForm.weightUnit}
                                        onChange={(e) => setFabricForm(f => ({ ...f, weightUnit: e.target.value }))}
                                    >
                                        <option value="gsm">GSM</option>
                                        <option value="lea">Lea</option>
                                        <option value="oz">oz/yd²</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Shrinkage %</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        className="input"
                                        value={fabricForm.avgShrinkagePct}
                                        onChange={(e) => setFabricForm(f => ({ ...f, avgShrinkagePct: Number(e.target.value) }))}
                                        min={0}
                                        max={100}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="label">Composition</label>
                                <input
                                    className="input"
                                    value={fabricForm.composition}
                                    onChange={(e) => setFabricForm(f => ({ ...f, composition: e.target.value }))}
                                    placeholder="e.g., 100% Linen, 55% Linen 45% Cotton"
                                />
                            </div>
                            <div className="border-t pt-4">
                                <p className="text-sm text-gray-600 mb-3">Default values (inherited by colours unless overridden):</p>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="label">Cost/Unit (₹)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="input"
                                            value={fabricForm.defaultCostPerUnit}
                                            onChange={(e) => setFabricForm(f => ({ ...f, defaultCostPerUnit: e.target.value }))}
                                            placeholder="0"
                                        />
                                    </div>
                                    <div>
                                        <label className="label">Lead (days)</label>
                                        <input
                                            type="number"
                                            className="input"
                                            value={fabricForm.defaultLeadTimeDays}
                                            onChange={(e) => setFabricForm(f => ({ ...f, defaultLeadTimeDays: e.target.value }))}
                                            placeholder="14"
                                        />
                                    </div>
                                    <div>
                                        <label className="label">Min Order</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            className="input"
                                            value={fabricForm.defaultMinOrderQty}
                                            onChange={(e) => setFabricForm(f => ({ ...f, defaultMinOrderQty: e.target.value }))}
                                            placeholder="10"
                                        />
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Colour Form */}
                    {type === 'colour' && (
                        <>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="label">Colour Name</label>
                                    <input
                                        className="input"
                                        value={colourForm.colourName}
                                        onChange={(e) => setColourForm(f => ({ ...f, colourName: e.target.value }))}
                                        placeholder="e.g., Navy Blue"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Standard Colour</label>
                                    <select
                                        className="input"
                                        value={colourForm.standardColour}
                                        onChange={(e) => {
                                            const color = e.target.value;
                                            setColourForm(f => ({
                                                ...f,
                                                standardColour: color,
                                                colourHex: color ? STANDARD_COLOR_HEX[color] : f.colourHex,
                                            }));
                                        }}
                                    >
                                        <option value="">Select...</option>
                                        {STANDARD_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Colour</label>
                                    <input
                                        type="color"
                                        className="input h-10"
                                        value={colourForm.colourHex}
                                        onChange={(e) => setColourForm(f => ({ ...f, colourHex: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier (optional)</label>
                                <select
                                    className="input"
                                    value={colourForm.supplierId}
                                    onChange={(e) => setColourForm(f => ({ ...f, supplierId: e.target.value }))}
                                >
                                    <option value="">No supplier</option>
                                    {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="border-t pt-4">
                                <p className="text-sm text-gray-600 mb-3">Leave blank to inherit from fabric defaults:</p>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="label">Cost/Unit (₹)</label>
                                        <input
                                            type="number"
                                            className="input"
                                            value={colourForm.costPerUnit}
                                            onChange={(e) => setColourForm(f => ({ ...f, costPerUnit: e.target.value }))}
                                            placeholder={`Inherit (₹${item?.inheritedCostPerUnit ?? '?'})`}
                                        />
                                    </div>
                                    <div>
                                        <label className="label">Lead (days)</label>
                                        <input
                                            type="number"
                                            className="input"
                                            value={colourForm.leadTimeDays}
                                            onChange={(e) => setColourForm(f => ({ ...f, leadTimeDays: e.target.value }))}
                                            placeholder={`Inherit (${item?.inheritedLeadTimeDays ?? '?'})`}
                                        />
                                    </div>
                                    <div>
                                        <label className="label">Min Order</label>
                                        <input
                                            type="number"
                                            className="input"
                                            value={colourForm.minOrderQty}
                                            onChange={(e) => setColourForm(f => ({ ...f, minOrderQty: e.target.value }))}
                                            placeholder={`Inherit (${item?.inheritedMinOrderQty ?? '?'})`}
                                        />
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Trim Form */}
                    {type === 'trim' && (
                        <>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Code</label>
                                    <input
                                        className="input font-mono"
                                        value={trimForm.code}
                                        onChange={(e) => setTrimForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                                        placeholder="BTN-SHELL-18L"
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
                                        {TRIM_CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Name</label>
                                <input
                                    className="input"
                                    value={trimForm.name}
                                    onChange={(e) => setTrimForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g., Shell Button 18L"
                                    required
                                />
                            </div>
                            <div>
                                <label className="label">Description (optional)</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    value={trimForm.description}
                                    onChange={(e) => setTrimForm(f => ({ ...f, description: e.target.value }))}
                                />
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="label">Cost/Unit (₹)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="input"
                                        value={trimForm.costPerUnit}
                                        onChange={(e) => setTrimForm(f => ({ ...f, costPerUnit: e.target.value }))}
                                        required
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
                                        <option value="spool">Spool</option>
                                        <option value="set">Set</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Lead (days)</label>
                                    <input
                                        type="number"
                                        className="input"
                                        value={trimForm.leadTimeDays}
                                        onChange={(e) => setTrimForm(f => ({ ...f, leadTimeDays: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Supplier (optional)</label>
                                    <select
                                        className="input"
                                        value={trimForm.supplierId}
                                        onChange={(e) => setTrimForm(f => ({ ...f, supplierId: e.target.value }))}
                                    >
                                        <option value="">No supplier</option>
                                        {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Min Order Qty</label>
                                    <input
                                        type="number"
                                        className="input"
                                        value={trimForm.minOrderQty}
                                        onChange={(e) => setTrimForm(f => ({ ...f, minOrderQty: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {/* Service Form */}
                    {type === 'service' && (
                        <>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Code</label>
                                    <input
                                        className="input font-mono"
                                        value={serviceForm.code}
                                        onChange={(e) => setServiceForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                                        placeholder="PRINT-BLOCK-01"
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
                                        {SERVICE_CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Name</label>
                                <input
                                    className="input"
                                    value={serviceForm.name}
                                    onChange={(e) => setServiceForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g., Block Print - Indigo Floral"
                                    required
                                />
                            </div>
                            <div>
                                <label className="label">Description (optional)</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    value={serviceForm.description}
                                    onChange={(e) => setServiceForm(f => ({ ...f, description: e.target.value }))}
                                />
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="label">Cost/Job (₹)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="input"
                                        value={serviceForm.costPerJob}
                                        onChange={(e) => setServiceForm(f => ({ ...f, costPerJob: e.target.value }))}
                                        required
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
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Lead (days)</label>
                                    <input
                                        type="number"
                                        className="input"
                                        value={serviceForm.leadTimeDays}
                                        onChange={(e) => setServiceForm(f => ({ ...f, leadTimeDays: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {/* Footer buttons */}
                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn-secondary flex-1"
                            disabled={isLoading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn-primary flex-1"
                            disabled={isLoading}
                        >
                            {isLoading ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default MaterialEditModal;
