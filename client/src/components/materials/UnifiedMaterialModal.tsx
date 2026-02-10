/**
 * UnifiedMaterialModal - Comprehensive add/edit modal for all hierarchy levels
 *
 * Handles:
 * - Material: name, description, active
 * - Fabric: name, construction, pattern, composition, weight, cost, lead time, min order, supplier
 * - Colour: name, standard colour, hex, cost (w/ inheritance), lead time, min order, supplier
 *
 * Features:
 * - Tabbed interface for organized fields
 * - Inheritance display for colour fields (from fabric defaults)
 * - Form validation with react-hook-form
 * - Duplicate checking via Server Function
 *
 * NOTE: Uses Server Functions instead of Axios API calls.
 */

import { useState, useEffect } from 'react';
import { useForm, Controller, type Control, type FieldErrors, type UseFormSetValue } from 'react-hook-form';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { X, Box, Layers, Palette, Loader2, AlertCircle } from 'lucide-react';
import { getMaterialsFilters } from '../../server/functions/materials';
import {
    createMaterial as createMaterialFn,
    updateMaterial as updateMaterialFn,
    createFabric as createFabricFn,
    updateFabric as updateFabricFn,
    createColour as createColourFn,
    updateColour as updateColourFn,
} from '../../server/functions/materialsMutations';
import type { MaterialNode, MaterialNodeType } from './types';
import { materialsTreeKeys } from './hooks/useMaterialsTree';
import { STANDARD_COLORS, STANDARD_COLOR_HEX, CONSTRUCTION_TYPES } from './types';

// Tab types based on node type
type TabId = 'basic' | 'properties' | 'cost' | 'status';

interface UnifiedMaterialModalProps {
    isOpen: boolean;
    onClose: () => void;
    mode: 'add' | 'edit';
    type: MaterialNodeType;
    item?: MaterialNode;          // For edit mode
    parentId?: string;            // For add mode (materialId or fabricId)
    parentNode?: MaterialNode;    // For context display
    onSuccess?: () => void;
}

// Form data interfaces
interface MaterialFormData {
    name: string;
    description: string;
    isActive: boolean;
}

interface FabricFormData {
    name: string;
    constructionType: 'knit' | 'woven';
    pattern: string;
    composition: string;
    weight: string;
    weightUnit: string;
    avgShrinkagePct: string;
    costPerUnit: string;
    leadTimeDays: string;
    minOrderQty: string;
    supplierId: string;
    isActive: boolean;
}

interface ColourFormData {
    colourName: string;
    code: string;
    standardColour: string;
    colourHex: string;
    costPerUnit: string;
    leadTimeDays: string;
    minOrderQty: string;
    supplierId: string;
    useInheritedCost: boolean;
    useInheritedLeadTime: boolean;
    useInheritedMinOrder: boolean;
    isActive: boolean;
}

type FormData = MaterialFormData | FabricFormData | ColourFormData;

// Pattern options for fabrics
const PATTERN_OPTIONS = [
    'Plain Weave',
    'Twill Weave',
    'Satin Weave',
    'Single Jersey',
    'Double Jersey',
    'French Terry',
    'Fleece',
    'Rib Knit',
    'Interlock',
    'Pique',
    'Jacquard',
    'Other',
];

// Weight unit options
const WEIGHT_UNITS = [
    { value: 'gsm', label: 'GSM (g/m²)' },
    { value: 'oz', label: 'oz/yd²' },
    { value: 'lea', label: 'Lea' },
];

export function UnifiedMaterialModal({
    isOpen,
    onClose,
    mode,
    type,
    item,
    parentId,
    parentNode,
    onSuccess,
}: UnifiedMaterialModalProps) {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<TabId>('basic');
    const [error, setError] = useState<string | null>(null);

    // Server Functions
    const getFiltersFn = useServerFn(getMaterialsFilters);
    const createMaterialServerFn = useServerFn(createMaterialFn);
    const updateMaterialServerFn = useServerFn(updateMaterialFn);
    const createFabricServerFn = useServerFn(createFabricFn);
    const updateFabricServerFn = useServerFn(updateFabricFn);
    const createColourServerFn = useServerFn(createColourFn);
    const updateColourServerFn = useServerFn(updateColourFn);

    // Fetch suppliers for dropdowns using Server Function
    const { data: filtersData } = useQuery({
        queryKey: ['materialsFilters'],
        queryFn: async () => {
            const result = await getFiltersFn({ data: undefined });
            return result;
        },
        enabled: isOpen && (type === 'fabric' || type === 'colour'),
    });

    const suppliers = (filtersData?.success && 'filters' in filtersData ? filtersData.filters?.suppliers : []) || [];

    // Form setup with defaults
    const {
        control,
        handleSubmit,
        reset,
        watch,
        setValue,
        formState: { errors, isDirty },
    } = useForm<FormData>({
        defaultValues: getDefaultValues(type, item, parentNode),
    });

    // Watch inheritance toggles for colour
    const useInheritedCost = watch('useInheritedCost' as keyof FormData);
    const useInheritedLeadTime = watch('useInheritedLeadTime' as keyof FormData);
    const useInheritedMinOrder = watch('useInheritedMinOrder' as keyof FormData);

    // Reset form when modal opens/closes or item changes
    useEffect(() => {
        if (isOpen) {
            reset(getDefaultValues(type, item, parentNode));
            setActiveTab('basic');
            setError(null);
        }
    }, [isOpen, type, item, parentNode, reset]);

    // Helper to extract error message from Server Function response
    const getErrorMessage = (result: { success: boolean; error?: { message?: string } }, defaultMsg: string) => {
        if ('error' in result && result.error?.message) {
            return result.error.message;
        }
        return defaultMsg;
    };

    // Mutations using Server Functions
    const createMaterial = useMutation({
        mutationFn: async (data: MaterialFormData) => {
            const result = await createMaterialServerFn({
                data: { name: data.name, description: data.description || undefined }
            });
            if (!result.success) {
                throw new Error(getErrorMessage(result, 'Failed to create material'));
            }
            return result;
        },
        onSuccess: handleMutationSuccess,
        onError: handleMutationError,
    });

    const updateMaterial = useMutation({
        mutationFn: async (data: MaterialFormData) => {
            const result = await updateMaterialServerFn({
                data: {
                    id: item!.id,
                    name: data.name,
                    description: data.description || undefined,
                    isActive: data.isActive,
                }
            });
            if (!result.success) {
                throw new Error(getErrorMessage(result, 'Failed to update material'));
            }
            return result;
        },
        onSuccess: handleMutationSuccess,
        onError: handleMutationError,
    });

    const createFabric = useMutation({
        mutationFn: async (data: FabricFormData) => {
            const result = await createFabricServerFn({
                data: {
                    materialId: parentId!,
                    name: data.name,
                    constructionType: data.constructionType,
                    pattern: data.pattern || undefined,
                    weight: data.weight ? parseFloat(data.weight) : undefined,
                    weightUnit: data.weightUnit || 'gsm',
                    composition: data.composition || undefined,
                    costPerUnit: data.costPerUnit ? parseFloat(data.costPerUnit) : undefined,
                    defaultLeadTimeDays: data.leadTimeDays ? parseInt(data.leadTimeDays) : undefined,
                    defaultMinOrderQty: data.minOrderQty ? parseFloat(data.minOrderQty) : undefined,
                    avgShrinkagePct: data.avgShrinkagePct ? parseFloat(data.avgShrinkagePct) : undefined,
                }
            });
            if (!result.success) {
                throw new Error(getErrorMessage(result, 'Failed to create fabric'));
            }
            return result;
        },
        onSuccess: handleMutationSuccess,
        onError: handleMutationError,
    });

    const updateFabric = useMutation({
        mutationFn: async (data: FabricFormData) => {
            const result = await updateFabricServerFn({
                data: {
                    id: item!.id,
                    name: data.name,
                    constructionType: data.constructionType,
                    pattern: data.pattern || undefined,
                    weight: data.weight ? parseFloat(data.weight) : undefined,
                    weightUnit: data.weightUnit || 'gsm',
                    composition: data.composition || undefined,
                    costPerUnit: data.costPerUnit ? parseFloat(data.costPerUnit) : undefined,
                    defaultLeadTimeDays: data.leadTimeDays ? parseInt(data.leadTimeDays) : undefined,
                    defaultMinOrderQty: data.minOrderQty ? parseFloat(data.minOrderQty) : undefined,
                    avgShrinkagePct: data.avgShrinkagePct ? parseFloat(data.avgShrinkagePct) : undefined,
                    supplierId: data.supplierId || undefined,
                }
            });
            if (!result.success) {
                throw new Error(getErrorMessage(result, 'Failed to update fabric'));
            }
            return result;
        },
        onSuccess: handleMutationSuccess,
        onError: handleMutationError,
    });

    const createColour = useMutation({
        mutationFn: async (data: ColourFormData) => {
            const result = await createColourServerFn({
                data: {
                    fabricId: parentId!,
                    colourName: data.colourName,
                    code: data.code || null,
                    standardColour: data.standardColour || undefined,
                    colourHex: data.colourHex || undefined,
                    costPerUnit: data.useInheritedCost ? undefined : (data.costPerUnit ? parseFloat(data.costPerUnit) : undefined),
                    leadTimeDays: data.useInheritedLeadTime ? undefined : (data.leadTimeDays ? parseInt(data.leadTimeDays) : undefined),
                    minOrderQty: data.useInheritedMinOrder ? undefined : (data.minOrderQty ? parseFloat(data.minOrderQty) : undefined),
                    supplierId: data.supplierId || undefined,
                }
            });
            if (!result.success) {
                throw new Error(getErrorMessage(result, 'Failed to create colour'));
            }
            return result;
        },
        onSuccess: handleMutationSuccess,
        onError: handleMutationError,
    });

    const updateColour = useMutation({
        mutationFn: async (data: ColourFormData) => {
            const result = await updateColourServerFn({
                data: {
                    id: item!.id,
                    colourName: data.colourName,
                    code: data.code || null,
                    standardColour: data.standardColour || undefined,
                    colourHex: data.colourHex || undefined,
                    costPerUnit: data.useInheritedCost ? undefined : (data.costPerUnit ? parseFloat(data.costPerUnit) : undefined),
                    leadTimeDays: data.useInheritedLeadTime ? undefined : (data.leadTimeDays ? parseInt(data.leadTimeDays) : undefined),
                    minOrderQty: data.useInheritedMinOrder ? undefined : (data.minOrderQty ? parseFloat(data.minOrderQty) : undefined),
                    supplierId: data.supplierId || undefined,
                }
            });
            if (!result.success) {
                throw new Error(getErrorMessage(result, 'Failed to update colour'));
            }
            return result;
        },
        onSuccess: handleMutationSuccess,
        onError: handleMutationError,
    });

    function handleMutationSuccess() {
        queryClient.invalidateQueries({ queryKey: materialsTreeKeys.all });
        queryClient.invalidateQueries({ queryKey: ['materialsHierarchy'] });
        onSuccess?.();
        onClose();
    }

    function handleMutationError(err: Error & { response?: { data?: { error?: string } } }) {
        const message = err.response?.data?.error || err.message || 'An error occurred';
        setError(message);
    }

    const isSubmitting =
        createMaterial.isPending ||
        updateMaterial.isPending ||
        createFabric.isPending ||
        updateFabric.isPending ||
        createColour.isPending ||
        updateColour.isPending;

    function onSubmit(data: FormData) {
        setError(null);

        if (type === 'material') {
            if (mode === 'add') {
                createMaterial.mutate(data as MaterialFormData);
            } else {
                updateMaterial.mutate(data as MaterialFormData);
            }
        } else if (type === 'fabric') {
            if (mode === 'add') {
                createFabric.mutate(data as FabricFormData);
            } else {
                updateFabric.mutate(data as FabricFormData);
            }
        } else if (type === 'colour') {
            if (mode === 'add') {
                createColour.mutate(data as ColourFormData);
            } else {
                updateColour.mutate(data as ColourFormData);
            }
        }
    }

    if (!isOpen) return null;

    const tabs = getTabsForType(type);
    const TypeIcon = type === 'material' ? Box : type === 'fabric' ? Layers : Palette;
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
                {/* Backdrop */}
                <div
                    className="fixed inset-0 bg-black/50 transition-opacity"
                    onClick={onClose}
                />

                {/* Modal */}
                <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl transform transition-all">
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${
                                type === 'material' ? 'bg-blue-100 text-blue-600' :
                                type === 'fabric' ? 'bg-purple-100 text-purple-600' :
                                'bg-teal-100 text-teal-600'
                            }`}>
                                <TypeIcon size={20} />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">
                                    {mode === 'add' ? 'Add' : 'Edit'} {typeLabel}
                                </h2>
                                {parentNode && (
                                    <p className="text-sm text-gray-500">
                                        Under {parentNode.type}: {parentNode.name}
                                    </p>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Tab Navigation */}
                    {tabs.length > 1 && (
                        <div className="flex border-b px-6">
                            {tabs.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                                        activeTab === tab.id
                                            ? 'border-blue-500 text-blue-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                            <AlertCircle size={18} />
                            <span className="text-sm">{error}</span>
                        </div>
                    )}

                    {/* Form Content */}
                    <form onSubmit={handleSubmit(onSubmit)}>
                        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
                            {type === 'material' && (
                                <MaterialForm
                                    control={control as unknown as Control<MaterialFormData>}
                                    errors={errors as unknown as FieldErrors<MaterialFormData>}
                                    activeTab={activeTab}
                                    mode={mode}
                                />
                            )}
                            {type === 'fabric' && (
                                <FabricForm
                                    control={control as unknown as Control<FabricFormData>}
                                    errors={errors as unknown as FieldErrors<FabricFormData>}
                                    activeTab={activeTab}
                                    mode={mode}
                                    suppliers={suppliers}
                                    constructionType={watch('constructionType') as string || 'woven'}
                                />
                            )}
                            {type === 'colour' && (
                                <ColourForm
                                    control={control as unknown as Control<ColourFormData>}
                                    errors={errors as unknown as FieldErrors<ColourFormData>}
                                    activeTab={activeTab}
                                    mode={mode}
                                    suppliers={suppliers}
                                    parentNode={parentNode}
                                    useInheritedCost={useInheritedCost as boolean}
                                    useInheritedLeadTime={useInheritedLeadTime as boolean}
                                    useInheritedMinOrder={useInheritedMinOrder as boolean}
                                    setValue={setValue as unknown as UseFormSetValue<ColourFormData>}
                                />
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                                disabled={isSubmitting}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                                disabled={isSubmitting || (!isDirty && mode === 'edit')}
                            >
                                {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                                {mode === 'add' ? 'Create' : 'Save Changes'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

// Get default form values based on type and existing item
function getDefaultValues(
    type: MaterialNodeType,
    item?: MaterialNode,
    parentNode?: MaterialNode
): FormData {
    if (type === 'material') {
        return {
            name: item?.name || '',
            description: '',
            isActive: item?.isActive ?? true,
        };
    }

    if (type === 'fabric') {
        return {
            name: item?.name || '',
            constructionType: (item?.constructionType as 'knit' | 'woven') || 'woven',
            pattern: item?.pattern || '',
            composition: item?.composition || '',
            weight: item?.weight?.toString() || '',
            weightUnit: item?.weightUnit || 'gsm',
            avgShrinkagePct: item?.avgShrinkagePct?.toString() || '',
            costPerUnit: item?.costPerUnit?.toString() || '',
            leadTimeDays: item?.leadTimeDays?.toString() || '',
            minOrderQty: item?.minOrderQty?.toString() || '',
            supplierId: item?.supplierId || '',
            isActive: item?.isActive ?? true,
        };
    }

    // Colour
    const hasOwnCost = item?.costPerUnit != null;
    const hasOwnLeadTime = item?.leadTimeDays != null;
    const hasOwnMinOrder = item?.minOrderQty != null;

    return {
        colourName: item?.colourName || item?.name || '',
        code: item?.code || '',
        standardColour: item?.standardColour || '',
        colourHex: item?.colourHex || '#6B8E9F',
        costPerUnit: item?.costPerUnit?.toString() || '',
        leadTimeDays: item?.leadTimeDays?.toString() || '',
        minOrderQty: item?.minOrderQty?.toString() || '',
        supplierId: item?.supplierId || '',
        useInheritedCost: !hasOwnCost && parentNode?.costPerUnit != null,
        useInheritedLeadTime: !hasOwnLeadTime && parentNode?.leadTimeDays != null,
        useInheritedMinOrder: !hasOwnMinOrder && parentNode?.minOrderQty != null,
        isActive: item?.isActive ?? true,
    };
}

// Get tabs for each type
function getTabsForType(type: MaterialNodeType): Array<{ id: TabId; label: string }> {
    if (type === 'material') {
        return [
            { id: 'basic', label: 'Basic Info' },
        ];
    }
    if (type === 'fabric') {
        return [
            { id: 'basic', label: 'Basic Info' },
            { id: 'properties', label: 'Properties' },
            { id: 'cost', label: 'Cost & Supply' },
        ];
    }
    // Colour
    return [
        { id: 'basic', label: 'Basic Info' },
        { id: 'cost', label: 'Cost & Supply' },
    ];
}

// Material form fields
function MaterialForm({
    control,
    errors,
    activeTab,
    mode,
}: {
    control: Control<MaterialFormData>;
    errors: FieldErrors<MaterialFormData>;
    activeTab: TabId;
    mode: 'add' | 'edit';
}) {
    if (activeTab !== 'basic') return null;

    return (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Material Name <span className="text-red-500">*</span>
                </label>
                <Controller
                    name="name"
                    control={control}
                    rules={{ required: 'Name is required' }}
                    render={({ field }) => (
                        <input
                            {...field}
                            type="text"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g., Linen, Pima Cotton, Silk"
                        />
                    )}
                />
                {errors.name && (
                    <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
                )}
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                </label>
                <Controller
                    name="description"
                    control={control}
                    render={({ field }) => (
                        <textarea
                            {...field}
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Optional description of this material type"
                        />
                    )}
                />
            </div>

            {mode === 'edit' && (
                <div className="flex items-center gap-2">
                    <Controller
                        name="isActive"
                        control={control}
                        render={({ field }) => (
                            <input
                                type="checkbox"
                                checked={field.value}
                                onChange={field.onChange}
                                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                        )}
                    />
                    <label className="text-sm text-gray-700">Active</label>
                </div>
            )}
        </div>
    );
}

// Fabric form fields
function FabricForm({
    control,
    errors,
    activeTab,
    mode,
    suppliers,
    constructionType,
}: {
    control: Control<FabricFormData>;
    errors: FieldErrors<FabricFormData>;
    activeTab: TabId;
    mode: 'add' | 'edit';
    suppliers: Array<{ id: string; name: string }>;
    constructionType: string;
}) {
    // Get the quantity unit based on construction type: knit=kg, woven=m
    const qtyUnit = constructionType === 'knit' ? 'kg' : 'm';
    return (
        <div className="space-y-4">
            {/* Basic Info Tab */}
            {activeTab === 'basic' && (
                <>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Fabric Name <span className="text-red-500">*</span>
                        </label>
                        <Controller
                            name="name"
                            control={control}
                            rules={{ required: 'Name is required' }}
                            render={({ field }) => (
                                <input
                                    {...field}
                                    type="text"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="e.g., 60 Lea Plain Weave, Single Jersey 180gsm"
                                />
                            )}
                        />
                        {errors.name && (
                            <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Construction Type
                            </label>
                            <Controller
                                name="constructionType"
                                control={control}
                                render={({ field }) => (
                                    <select
                                        {...field}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        {CONSTRUCTION_TYPES.map(type => (
                                            <option key={type} value={type}>
                                                {type.charAt(0).toUpperCase() + type.slice(1)}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Pattern
                            </label>
                            <Controller
                                name="pattern"
                                control={control}
                                render={({ field }) => (
                                    <select
                                        {...field}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">Select pattern...</option>
                                        {PATTERN_OPTIONS.map(pattern => (
                                            <option key={pattern} value={pattern}>
                                                {pattern}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            />
                        </div>
                    </div>
                </>
            )}

            {/* Properties Tab */}
            {activeTab === 'properties' && (
                <>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Composition
                        </label>
                        <Controller
                            name="composition"
                            control={control}
                            render={({ field }) => (
                                <input
                                    {...field}
                                    type="text"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="e.g., 100% Cotton, 60% Cotton 40% Polyester"
                                />
                            )}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Weight
                            </label>
                            <Controller
                                name="weight"
                                control={control}
                                render={({ field }) => (
                                    <input
                                        {...field}
                                        type="number"
                                        step="0.01"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="e.g., 180"
                                    />
                                )}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Weight Unit
                            </label>
                            <Controller
                                name="weightUnit"
                                control={control}
                                render={({ field }) => (
                                    <select
                                        {...field}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        {WEIGHT_UNITS.map(unit => (
                                            <option key={unit.value} value={unit.value}>
                                                {unit.label}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Average Shrinkage %
                        </label>
                        <Controller
                            name="avgShrinkagePct"
                            control={control}
                            render={({ field }) => (
                                <input
                                    {...field}
                                    type="number"
                                    step="0.1"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="e.g., 5"
                                />
                            )}
                        />
                    </div>
                </>
            )}

            {/* Cost & Supply Tab */}
            {activeTab === 'cost' && (
                <>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Default Cost/Unit (INR)
                            </label>
                            <Controller
                                name="costPerUnit"
                                control={control}
                                render={({ field }) => (
                                    <input
                                        {...field}
                                        type="number"
                                        step="0.01"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="e.g., 250.00"
                                    />
                                )}
                            />
                            <p className="mt-1 text-xs text-gray-500">
                                Colours will inherit this if not overridden
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Supplier
                            </label>
                            <Controller
                                name="supplierId"
                                control={control}
                                render={({ field }) => (
                                    <select
                                        {...field}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">Select supplier...</option>
                                        {suppliers.map(s => (
                                            <option key={s.id} value={s.id}>
                                                {s.name}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Default Lead Time (days)
                            </label>
                            <Controller
                                name="leadTimeDays"
                                control={control}
                                render={({ field }) => (
                                    <input
                                        {...field}
                                        type="number"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="e.g., 14"
                                    />
                                )}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Default Min Order Qty ({qtyUnit})
                            </label>
                            <Controller
                                name="minOrderQty"
                                control={control}
                                render={({ field }) => (
                                    <input
                                        {...field}
                                        type="number"
                                        step="0.01"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder={qtyUnit === 'kg' ? 'e.g., 10' : 'e.g., 50'}
                                    />
                                )}
                            />
                            <p className="mt-1 text-xs text-gray-500">
                                {qtyUnit === 'kg' ? 'Knit fabrics measured in kilograms' : 'Woven fabrics measured in meters'}
                            </p>
                        </div>
                    </div>

                    {mode === 'edit' && (
                        <div className="flex items-center gap-2 pt-2">
                            <Controller
                                name="isActive"
                                control={control}
                                render={({ field }) => (
                                    <input
                                        type="checkbox"
                                        checked={field.value}
                                        onChange={field.onChange}
                                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    />
                                )}
                            />
                            <label className="text-sm text-gray-700">Active</label>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// Colour form fields
function ColourForm({
    control,
    errors,
    activeTab,
    mode,
    suppliers,
    parentNode,
    useInheritedCost,
    useInheritedLeadTime,
    useInheritedMinOrder,
    setValue,
}: {
    control: Control<ColourFormData>;
    errors: FieldErrors<ColourFormData>;
    activeTab: TabId;
    mode: 'add' | 'edit';
    suppliers: Array<{ id: string; name: string }>;
    parentNode?: MaterialNode;
    useInheritedCost: boolean;
    useInheritedLeadTime: boolean;
    useInheritedMinOrder: boolean;
    setValue: UseFormSetValue<ColourFormData>;
}) {
    // Get the quantity unit from parent fabric: knit=kg, woven=m
    const qtyUnit = parentNode?.unit || (parentNode?.constructionType === 'knit' ? 'kg' : 'm');

    // Handle standard colour selection to auto-fill hex
    const handleStandardColourChange = (standardColour: string) => {
        const hex = STANDARD_COLOR_HEX[standardColour];
        if (hex) {
            setValue('colourHex', hex);
        }
    };

    return (
        <div className="space-y-4">
            {/* Basic Info Tab */}
            {activeTab === 'basic' && (
                <>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Colour Name <span className="text-red-500">*</span>
                        </label>
                        <Controller
                            name="colourName"
                            control={control}
                            rules={{ required: 'Colour name is required' }}
                            render={({ field }) => (
                                <input
                                    {...field}
                                    type="text"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="e.g., Carbon Black, Deep Sea Blue"
                                />
                            )}
                        />
                        {errors.colourName && (
                            <p className="mt-1 text-sm text-red-600">{errors.colourName.message}</p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Code
                        </label>
                        <Controller
                            name="code"
                            control={control}
                            render={({ field }) => (
                                <input
                                    {...field}
                                    type="text"
                                    onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                                    placeholder="Auto-generated"
                                />
                            )}
                        />
                        <p className="text-xs text-gray-500 mt-1">Leave empty to auto-generate</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Standard Colour
                            </label>
                            <Controller
                                name="standardColour"
                                control={control}
                                render={({ field }) => (
                                    <select
                                        {...field}
                                        onChange={(e) => {
                                            field.onChange(e);
                                            handleStandardColourChange(e.target.value);
                                        }}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">Select standard colour...</option>
                                        {STANDARD_COLORS.map(color => (
                                            <option key={color} value={color}>
                                                {color}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Colour Hex
                            </label>
                            <div className="flex gap-2">
                                <Controller
                                    name="colourHex"
                                    control={control}
                                    render={({ field }) => (
                                        <>
                                            <input
                                                type="color"
                                                value={field.value || '#6B8E9F'}
                                                onChange={field.onChange}
                                                className="h-10 w-12 p-1 border border-gray-300 rounded cursor-pointer"
                                            />
                                            <input
                                                {...field}
                                                type="text"
                                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                placeholder="#6B8E9F"
                                            />
                                        </>
                                    )}
                                />
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Cost & Supply Tab */}
            {activeTab === 'cost' && (
                <>
                    {/* Cost per unit with inheritance */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Cost/Unit (INR)
                        </label>
                        <div className="space-y-2">
                            {parentNode?.costPerUnit != null && (
                                <label className="flex items-center gap-2 text-sm">
                                    <Controller
                                        name="useInheritedCost"
                                        control={control}
                                        render={({ field }) => (
                                            <input
                                                type="checkbox"
                                                checked={field.value}
                                                onChange={field.onChange}
                                                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                            />
                                        )}
                                    />
                                    <span className="text-gray-600">
                                        Use fabric default: <span className="font-medium text-gray-900">INR {parentNode.costPerUnit}</span>
                                    </span>
                                </label>
                            )}
                            {!useInheritedCost && (
                                <Controller
                                    name="costPerUnit"
                                    control={control}
                                    render={({ field }) => (
                                        <input
                                            {...field}
                                            type="number"
                                            step="0.01"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            placeholder="e.g., 250.00"
                                        />
                                    )}
                                />
                            )}
                        </div>
                    </div>

                    {/* Lead time with inheritance */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Lead Time (days)
                        </label>
                        <div className="space-y-2">
                            {parentNode?.leadTimeDays != null && (
                                <label className="flex items-center gap-2 text-sm">
                                    <Controller
                                        name="useInheritedLeadTime"
                                        control={control}
                                        render={({ field }) => (
                                            <input
                                                type="checkbox"
                                                checked={field.value}
                                                onChange={field.onChange}
                                                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                            />
                                        )}
                                    />
                                    <span className="text-gray-600">
                                        Use fabric default: <span className="font-medium text-gray-900">{parentNode.leadTimeDays} days</span>
                                    </span>
                                </label>
                            )}
                            {!useInheritedLeadTime && (
                                <Controller
                                    name="leadTimeDays"
                                    control={control}
                                    render={({ field }) => (
                                        <input
                                            {...field}
                                            type="number"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            placeholder="e.g., 14"
                                        />
                                    )}
                                />
                            )}
                        </div>
                    </div>

                    {/* Min order with inheritance */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Min Order Qty ({qtyUnit})
                        </label>
                        <div className="space-y-2">
                            {parentNode?.minOrderQty != null && (
                                <label className="flex items-center gap-2 text-sm">
                                    <Controller
                                        name="useInheritedMinOrder"
                                        control={control}
                                        render={({ field }) => (
                                            <input
                                                type="checkbox"
                                                checked={field.value}
                                                onChange={field.onChange}
                                                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                            />
                                        )}
                                    />
                                    <span className="text-gray-600">
                                        Use fabric default: <span className="font-medium text-gray-900">{parentNode.minOrderQty} {qtyUnit}</span>
                                    </span>
                                </label>
                            )}
                            {!useInheritedMinOrder && (
                                <Controller
                                    name="minOrderQty"
                                    control={control}
                                    render={({ field }) => (
                                        <input
                                            {...field}
                                            type="number"
                                            step="0.01"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            placeholder={qtyUnit === 'kg' ? 'e.g., 10' : 'e.g., 50'}
                                        />
                                    )}
                                />
                            )}
                        </div>
                    </div>

                    {/* Supplier */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Supplier
                        </label>
                        <Controller
                            name="supplierId"
                            control={control}
                            render={({ field }) => (
                                <select
                                    {...field}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="">Select supplier...</option>
                                    {suppliers.map(s => (
                                        <option key={s.id} value={s.id}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                        />
                    </div>

                    {mode === 'edit' && (
                        <div className="flex items-center gap-2 pt-2">
                            <Controller
                                name="isActive"
                                control={control}
                                render={({ field }) => (
                                    <input
                                        type="checkbox"
                                        checked={field.value}
                                        onChange={field.onChange}
                                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    />
                                )}
                            />
                            <label className="text-sm text-gray-700">Active</label>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
