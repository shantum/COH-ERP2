import React, { useState } from 'react';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { TrimsTable } from '../../components/materials/TrimsTable';
import { createTrim, updateTrim, getParties } from '@/server/functions/materialsMutations';
import type { Party } from '@/server/functions/materialsMutations';
import { TRIM_CATEGORIES, type TrimEditState } from './shared';

export default function TrimsTab() {
    const queryClient = useQueryClient();

    // Modal state
    const [showAddTrim, setShowAddTrim] = useState(false);
    const [showEditTrim, setShowEditTrim] = useState<TrimEditState | null>(null);

    // Form state
    const [trimForm, setTrimForm] = useState({
        code: '', name: '', category: 'button', description: '',
        costPerUnit: '', unit: 'piece', partyId: '', leadTimeDays: '', minOrderQty: ''
    });

    // Server function hooks
    const getPartiesFn = useServerFn(getParties);
    const createTrimFn = useServerFn(createTrim);
    const updateTrimFn = useServerFn(updateTrim);

    // Fetch parties for supplier dropdown
    const { data: partiesData } = useQuery({
        queryKey: ['parties'],
        queryFn: () => getPartiesFn(),
    });
    const parties: Party[] | undefined = partiesData?.parties;

    // Mutation types
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
        onError: (err: Error) => toast.error(err.message || 'Failed to create trim'),
    });

    const updateTrimMutation = useMutation({
        mutationFn: (data: UpdateTrimInput) => updateTrimFn({ data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trimsCatalog'] });
            setShowEditTrim(null);
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to update trim'),
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

    return (
        <div className="p-4 h-full overflow-auto">
            <TrimsTable
                onEdit={(trim) => setShowEditTrim({
                    ...trim,
                    costPerUnit: trim.costPerUnit?.toString() ?? '',
                    leadTimeDays: trim.leadTimeDays?.toString() ?? '',
                    minOrderQty: trim.minOrderQty?.toString() ?? '',
                })}
                onViewDetails={() => {}}
                onAdd={() => setShowAddTrim(true)}
            />

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
        </div>
    );
}
