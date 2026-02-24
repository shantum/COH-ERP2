import React, { useState } from 'react';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { X } from 'lucide-react';
import { ServicesTable } from '../../components/materials/ServicesTable';
import { createService, updateService, getParties } from '@/server/functions/materialsMutations';
import type { Party } from '@/server/functions/materialsMutations';
import { SERVICE_CATEGORIES, type ServiceEditState } from './shared';

export default function ServicesTab() {
    const queryClient = useQueryClient();

    // Modal state
    const [showAddService, setShowAddService] = useState(false);
    const [showEditService, setShowEditService] = useState<ServiceEditState | null>(null);

    // Form state
    const [serviceForm, setServiceForm] = useState({
        code: '', name: '', category: 'printing', description: '',
        costPerJob: '', costUnit: 'per_piece', partyId: '', leadTimeDays: ''
    });

    // Server function hooks
    const getPartiesFn = useServerFn(getParties);
    const createServiceFn = useServerFn(createService);
    const updateServiceFn = useServerFn(updateService);

    // Fetch parties for vendor dropdown
    const { data: partiesData } = useQuery({
        queryKey: ['parties'],
        queryFn: () => getPartiesFn(),
    });
    const parties: Party[] | undefined = partiesData?.parties;

    // Mutation types
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

    // Mutations
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

    // Form handlers
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

    return (
        <div className="p-4 h-full overflow-auto">
            <ServicesTable
                onEdit={(service) => setShowEditService({
                    ...service,
                    costPerJob: service.costPerJob?.toString() ?? '',
                    leadTimeDays: service.leadTimeDays?.toString() ?? '',
                })}
                onViewDetails={() => {}}
                onAdd={() => setShowAddService(true)}
            />

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
        </div>
    );
}
