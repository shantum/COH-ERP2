/**
 * MaterialsTreeView - Container component for the materials tree table
 *
 * Integrates:
 * - MaterialsTreeTable for display
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
import { Users, Search, LayoutGrid, Layers } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { MaterialNode, MaterialNodeType, MaterialTreeResponse } from './types';
import { MaterialsTreeTable } from './MaterialsTreeTable';
import { UnifiedMaterialModal } from './UnifiedMaterialModal';
import { LinkProductsModal } from './LinkProductsModal';
import { QuickAddButtons } from './QuickAddButtons';
import { getMaterialsTree } from '../../server/functions/materials';
import { materialsTreeKeys, useMaterialsTreeMutations } from './hooks/useMaterialsTree';

type ViewMode = 'fabric' | 'material';

interface MaterialsTreeViewProps {
    /** Callback to show detail panel */
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
    onViewDetails,
    onAddInward,
    onAddSupplier,
}: MaterialsTreeViewProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<ViewMode>('fabric'); // Default to fabric view

    // Unified modal state
    const [modalState, setModalState] = useState<ModalState>(initialModalState);

    // Link products modal state
    const [linkProductsColour, setLinkProductsColour] = useState<MaterialNode | null>(null);

    // Server Function for tree data
    const getTreeFn = useServerFn(getMaterialsTree);

    // Fetch tree data for quick add buttons using Server Function
    const { data: treeData } = useQuery({
        queryKey: materialsTreeKeys.tree(),
        queryFn: async (): Promise<MaterialTreeResponse> => {
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
            return {
                items: [],
                summary: { total: 0, materials: 0, fabrics: 0, colours: 0, orderNow: 0, orderSoon: 0, ok: 0 },
            };
        },
    });

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

    // Transform data for fabric-first view
    // Flatten fabrics to top level with materialName attached, colours as children
    const fabricFirstData = useMemo(() => {
        const items = treeData?.items || [];
        const flatFabrics: MaterialNode[] = [];

        for (const material of items) {
            if (material.children) {
                for (const fabric of material.children) {
                    if (fabric.type === 'fabric') {
                        // Attach material info to fabric for display
                        flatFabrics.push({
                            ...fabric,
                            materialName: material.name,
                            materialId: material.id,
                        });
                    }
                }
            }
        }

        return flatFabrics;
    }, [treeData?.items]);

    // Mutations for deactivation and deletion
    const { updateMaterial, deleteMaterial, deleteFabric, deleteColour } = useMaterialsTreeMutations();

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

    // Handle edit action based on node type
    const handleEdit = useCallback((node: MaterialNode) => {
        // For colours, find the parent fabric for inheritance display
        let parentNode: MaterialNode | undefined;
        if (node.type === 'colour' && node.fabricId) {
            for (const material of (treeData?.items || [])) {
                if (material.children) {
                    parentNode = material.children.find((f: MaterialNode) => f.id === node.fabricId);
                    if (parentNode) break;
                }
            }
        }

        setModalState({
            isOpen: true,
            mode: 'edit',
            type: node.type,
            item: node,
            parentNode,
        });
    }, [treeData?.items]);

    // Handle add child action based on node type
    const handleAddChild = useCallback((node: MaterialNode) => {
        if (node.type === 'material') {
            setModalState({
                isOpen: true,
                mode: 'add',
                type: 'fabric',
                parentId: node.id,
                parentNode: node,
            });
        } else if (node.type === 'fabric') {
            setModalState({
                isOpen: true,
                mode: 'add',
                type: 'colour',
                parentId: node.id,
                parentNode: node,
            });
        }
    }, []);

    // Handle deactivation
    const handleDeactivate = useCallback((node: MaterialNode) => {
        const newStatus = node.isActive === false ? true : false;
        const action = newStatus ? 'activate' : 'deactivate';

        if (window.confirm(`Are you sure you want to ${action} "${node.name}"?`)) {
            if (node.type === 'material') {
                updateMaterial.mutate({
                    id: node.id,
                    data: { isActive: newStatus },
                });
            }
            // Note: For fabrics and colours, we'd need to add isActive field to the schema
            // and add mutations. For now, only materials support deactivation.
        }
    }, [updateMaterial]);

    // Handle link products (colours only)
    const handleLinkProducts = useCallback((node: MaterialNode) => {
        if (node.type === 'colour') {
            setLinkProductsColour(node);
        }
    }, []);

    // Handle deletion
    const handleDelete = useCallback((node: MaterialNode) => {
        const hasChildren = node.type === 'material'
            ? (node.fabricCount || 0) > 0
            : node.type === 'fabric'
                ? (node.colourCount || 0) > 0
                : false;

        if (hasChildren) {
            const childType = node.type === 'material' ? 'fabrics' : 'colours';
            alert(`Cannot delete "${node.name}": It has ${node.type === 'material' ? node.fabricCount : node.colourCount} ${childType} linked to it. Please delete them first.`);
            return;
        }

        const confirmMessage = `Are you sure you want to permanently delete "${node.name}"?\n\nThis action cannot be undone.`;

        if (window.confirm(confirmMessage)) {
            if (node.type === 'material') {
                deleteMaterial.mutate(node.id, {
                    onError: (error: any) => {
                        alert(error?.response?.data?.error || 'Failed to delete material');
                    },
                });
            } else if (node.type === 'fabric') {
                deleteFabric.mutate(node.id, {
                    onError: (error: any) => {
                        alert(error?.response?.data?.error || 'Failed to delete fabric');
                    },
                });
            } else if (node.type === 'colour') {
                deleteColour.mutate(node.id, {
                    onError: (error: any) => {
                        alert(error?.response?.data?.error || 'Failed to delete colour');
                    },
                });
            }
        }
    }, [deleteMaterial, deleteFabric, deleteColour]);

    return (
        <div className="flex flex-col h-full">
            {/* Header with View Switcher */}
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-b bg-gray-50 flex-shrink-0">
                {/* Left: View Mode Tabs */}
                <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                    <TabsList className="bg-gray-100/80">
                        <TabsTrigger value="fabric" className="gap-2 data-[state=active]:bg-white">
                            <LayoutGrid size={16} />
                            <span className="hidden sm:inline">By Fabric</span>
                        </TabsTrigger>
                        <TabsTrigger value="material" className="gap-2 data-[state=active]:bg-white">
                            <Layers size={16} />
                            <span className="hidden sm:inline">By Material</span>
                        </TabsTrigger>
                    </TabsList>
                </Tabs>

                {/* Center: Search */}
                <div className="flex-1 max-w-md">
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search fabrics, colours..."
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

            {/* Tree Table */}
            <div className="flex-1 border-x border-b bg-white overflow-hidden">
                <MaterialsTreeTable
                    onEdit={handleEdit}
                    onAddChild={handleAddChild}
                    onViewDetails={onViewDetails}
                    onAddInward={onAddInward}
                    onDeactivate={handleDeactivate}
                    onDelete={handleDelete}
                    onLinkProducts={handleLinkProducts}
                    searchQuery={searchQuery}
                    viewMode={viewMode}
                    fabricFirstData={fabricFirstData}
                    height="100%"
                />
            </div>

            {/* Footer Note */}
            <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-500 flex-shrink-0">
                {viewMode === 'fabric' ? (
                    <span>
                        <strong>By Fabric view:</strong> Fabrics shown at top level, grouped by Material category.
                        Click arrow to see colour variants. Switch to "By Material" for full hierarchy.
                    </span>
                ) : (
                    <span>
                        <strong>By Material view:</strong> Full hierarchy - Material → Fabric → Colour.
                        Click arrows to expand. Switch to "By Fabric" for a flatter view.
                    </span>
                )}
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
