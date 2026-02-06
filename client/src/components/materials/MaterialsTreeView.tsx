/**
 * MaterialsTreeView - Container component for the flat fabric colours table
 *
 * Integrates:
 * - FabricColoursTable for display
 * - UnifiedMaterialModal for add/edit operations
 * - QuickAddButtons for toolbar quick-add actions
 * - Search functionality
 *
 * Self-contained modal management - handles all add/edit operations internally
 *
 * NOTE: Uses Server Functions instead of Axios API calls.
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Users, Search } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';

import type { MaterialNode, MaterialNodeType, MaterialTreeResponse } from './types';
import { FabricColoursTable } from './FabricColoursTable';
import { UnifiedMaterialModal } from './UnifiedMaterialModal';
import { LinkProductsModal } from './LinkProductsModal';
import { QuickAddButtons } from './QuickAddButtons';
import { getMaterialsTree } from '../../server/functions/materials';
import {
    materialsTreeKeys,
    useMaterialsTreeMutations,
    useFabricColoursFlat,
    type FabricColourFlatRow,
} from './hooks/useMaterialsTree';

interface MaterialsTreeViewProps {
    /** Callback to show detail panel (not used in flat view) */
    onViewDetails?: (node: MaterialNode) => void;
    /** Callback to show add inward modal */
    onAddInward?: (node: MaterialNode) => void;
    /** Callback to show add supplier modal */
    onAddSupplier?: () => void;
}

// Modal state type
interface ModalState {
    isOpen: boolean;
    mode: 'add' | 'edit';
    type: MaterialNodeType;
    item?: MaterialNode;
    parentId?: string;
    parentNode?: MaterialNode;
}

const initialModalState: ModalState = {
    isOpen: false,
    mode: 'add',
    type: 'material',
};

export function MaterialsTreeView({
    onViewDetails: _onViewDetails,
    onAddInward,
    onAddSupplier,
}: MaterialsTreeViewProps) {
    // onViewDetails not used in flat view, but kept for API compatibility
    void _onViewDetails;
    const [searchQuery, setSearchQuery] = useState('');
    // Debounce search to prevent expensive queries on every keystroke
    const debouncedSearchQuery = useDebounce(searchQuery, 300);

    // Unified modal state
    const [modalState, setModalState] = useState<ModalState>(initialModalState);

    // Link products modal state
    const [linkProductsColour, setLinkProductsColour] = useState<MaterialNode | null>(null);

    // Server Function for tree data (for quick add buttons)
    const getTreeFn = useServerFn(getMaterialsTree);

    // Fetch flat colours data
    const {
        data: flatData,
        isLoading: flatLoading,
        isFetching: flatFetching,
        refetch: flatRefetch,
        total: flatTotal,
    } = useFabricColoursFlat({
        search: debouncedSearchQuery || undefined,
        activeOnly: true,
    });

    // Fetch tree data for quick add buttons using Server Function
    const { data: treeData, error: queryError } = useQuery({
        queryKey: materialsTreeKeys.tree(),
        queryFn: async (): Promise<MaterialTreeResponse> => {
            try {
                const response = await getTreeFn({ data: { lazyLoad: false } });
                // Transform Server Function response to expected MaterialTreeResponse format
                if ('success' in response && response.success && 'items' in response) {
                    const summary = 'summary' in response ? response.summary : null;
                    return {
                        items: response.items as MaterialNode[],
                        summary: {
                            total: (summary?.totalMaterials ?? 0) + (summary?.totalFabrics ?? 0) + (summary?.totalColours ?? 0),
                            materials: summary?.totalMaterials ?? 0,
                            fabrics: summary?.totalFabrics ?? 0,
                            colours: summary?.totalColours ?? 0,
                            orderNow: 0,
                            orderSoon: 0,
                            ok: 0,
                        },
                    };
                }
                console.error('[MaterialsTreeView] Invalid response format:', response);
                return {
                    items: [],
                    summary: { total: 0, materials: 0, fabrics: 0, colours: 0, orderNow: 0, orderSoon: 0, ok: 0 },
                };
            } catch (error) {
                console.error('[MaterialsTreeView] Query error:', error);
                throw error;
            }
        },
    });

    // Log any query errors
    if (queryError) {
        console.error('[MaterialsTreeView] TanStack Query error:', queryError);
    }

    // Extract materials and fabrics lists for quick add buttons
    const { materials, fabrics } = useMemo(() => {
        const items = treeData?.items || [];

        // Materials are top-level nodes
        const materialsList = items.map((m: MaterialNode) => ({
            id: m.id,
            name: m.name,
        }));

        // Fabrics are second-level nodes
        const fabricsList: Array<{ id: string; name: string; materialName?: string }> = [];
        for (const material of items) {
            if (material.children) {
                for (const fabric of material.children) {
                    if (fabric.type === 'fabric') {
                        fabricsList.push({
                            id: fabric.id,
                            name: fabric.name,
                            materialName: material.name,
                        });
                    }
                }
            }
        }

        return { materials: materialsList, fabrics: fabricsList };
    }, [treeData?.items]);

    // Mutations for deactivation and deletion
    // deleteMaterial and deleteFabric are not used in flat view but kept for potential future use
    const { deleteColour } = useMaterialsTreeMutations();

    // Close modal
    const closeModal = useCallback(() => {
        setModalState(initialModalState);
    }, []);

    // Open modal for adding a new material
    const handleAddMaterial = useCallback(() => {
        setModalState({
            isOpen: true,
            mode: 'add',
            type: 'material',
        });
    }, []);

    // Open modal for adding a new fabric under a material
    const handleAddFabric = useCallback((materialId: string) => {
        // Find the parent material node for context
        const parentMaterial = treeData?.items?.find((m: MaterialNode) => m.id === materialId);
        setModalState({
            isOpen: true,
            mode: 'add',
            type: 'fabric',
            parentId: materialId,
            parentNode: parentMaterial,
        });
    }, [treeData?.items]);

    // Open modal for adding a new colour under a fabric
    const handleAddColour = useCallback((fabricId: string) => {
        // Find the parent fabric node for context
        let parentFabric: MaterialNode | undefined;
        for (const material of (treeData?.items || [])) {
            if (material.children) {
                parentFabric = material.children.find((f: MaterialNode) => f.id === fabricId);
                if (parentFabric) break;
            }
        }
        setModalState({
            isOpen: true,
            mode: 'add',
            type: 'colour',
            parentId: fabricId,
            parentNode: parentFabric,
        });
    }, [treeData?.items]);

    // Handle edit action for a flat colour row
    const handleEditRow = useCallback((row: FabricColourFlatRow) => {
        // Find the parent fabric for inheritance display
        let parentFabric: MaterialNode | undefined;
        for (const material of (treeData?.items || [])) {
            if (material.children) {
                parentFabric = material.children.find((f: MaterialNode) => f.id === row.fabricId);
                if (parentFabric) break;
            }
        }

        // Convert flat row to MaterialNode for the modal
        const node: MaterialNode = {
            id: row.id,
            type: 'colour',
            name: row.colourName,
            colourName: row.colourName,
            colourHex: row.colourHex ?? undefined,
            standardColour: row.standardColour ?? undefined,
            fabricId: row.fabricId,
            fabricName: row.fabricName,
            materialId: row.materialId,
            materialName: row.materialName,
            unit: row.unit ?? undefined,
            costPerUnit: row.costPerUnit,
            effectiveCostPerUnit: row.effectiveCostPerUnit,
            costInherited: row.costInherited,
            leadTimeDays: row.leadTimeDays,
            effectiveLeadTimeDays: row.effectiveLeadTimeDays,
            leadTimeInherited: row.leadTimeInherited,
            minOrderQty: row.minOrderQty,
            effectiveMinOrderQty: row.effectiveMinOrderQty,
            minOrderInherited: row.minOrderInherited,
            supplierId: row.supplierId,
            supplierName: row.supplierName,
            isOutOfStock: row.isOutOfStock,
            isActive: row.isActive,
        };

        setModalState({
            isOpen: true,
            mode: 'edit',
            type: 'colour',
            item: node,
            parentNode: parentFabric,
        });
    }, [treeData?.items]);

    // Handle link products (colours only)
    const handleLinkProducts = useCallback((row: FabricColourFlatRow) => {
        // Convert to MaterialNode for the modal
        const node: MaterialNode = {
            id: row.id,
            type: 'colour',
            name: row.colourName,
            colourName: row.colourName,
            fabricId: row.fabricId,
            fabricName: row.fabricName,
            materialId: row.materialId,
            materialName: row.materialName,
        };
        setLinkProductsColour(node);
    }, []);

    // Handle deletion
    const handleDeleteRow = useCallback((row: FabricColourFlatRow) => {
        const confirmMessage = `Are you sure you want to permanently delete "${row.colourName}"?\n\nThis action cannot be undone.`;

        if (window.confirm(confirmMessage)) {
            deleteColour.mutate(row.id, {
                onError: (error: unknown) => {
                    const message = error instanceof Error ? error.message : 'Failed to delete colour';
                    alert(message);
                },
            });
        }
    }, [deleteColour]);

    // Handle add inward
    const handleAddInward = useCallback((row: FabricColourFlatRow) => {
        if (onAddInward) {
            const node: MaterialNode = {
                id: row.id,
                type: 'colour',
                name: row.colourName,
                colourName: row.colourName,
                fabricId: row.fabricId,
                fabricName: row.fabricName,
                materialId: row.materialId,
                materialName: row.materialName,
                unit: row.unit ?? undefined,
            };
            onAddInward(node);
        }
    }, [onAddInward]);

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-b bg-gray-50 flex-shrink-0">
                {/* Left: Title */}
                <div className="text-sm font-medium text-gray-700">
                    Fabric Colours
                </div>

                {/* Center: Search */}
                <div className="flex-1 max-w-md">
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search colours, fabrics, materials..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
                        />
                    </div>
                </div>

                {/* Right: Quick Add + Supplier */}
                <div className="flex items-center gap-2">
                    <QuickAddButtons
                        onAddMaterial={handleAddMaterial}
                        onAddFabric={handleAddFabric}
                        onAddColour={handleAddColour}
                        materials={materials}
                        fabrics={fabrics}
                    />
                    {onAddSupplier && (
                        <button
                            onClick={onAddSupplier}
                            className="btn-secondary flex items-center text-sm"
                        >
                            <Users size={18} className="mr-1.5" />
                            Add Supplier
                        </button>
                    )}
                </div>
            </div>

            {/* Flat Table */}
            <div className="flex-1 border-x border-b bg-white overflow-hidden">
                <FabricColoursTable
                    data={flatData}
                    isLoading={flatLoading}
                    isFetching={flatFetching}
                    refetch={flatRefetch}
                    total={flatTotal}
                    onEdit={handleEditRow}
                    onAddInward={onAddInward ? handleAddInward : undefined}
                    onLinkProducts={handleLinkProducts}
                    onDelete={handleDeleteRow}
                    height="100%"
                />
            </div>

            {/* Unified Modal */}
            <UnifiedMaterialModal
                isOpen={modalState.isOpen}
                onClose={closeModal}
                mode={modalState.mode}
                type={modalState.type}
                item={modalState.item}
                parentId={modalState.parentId}
                parentNode={modalState.parentNode}
            />

            {/* Link Products Modal */}
            <LinkProductsModal
                isOpen={!!linkProductsColour}
                onClose={() => setLinkProductsColour(null)}
                colour={linkProductsColour}
            />
        </div>
    );
}
