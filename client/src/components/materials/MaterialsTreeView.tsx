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
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Search } from 'lucide-react';

import type { MaterialNode, MaterialNodeType } from './types';
import { MaterialsTreeTable } from './MaterialsTreeTable';
import { UnifiedMaterialModal } from './UnifiedMaterialModal';
import { QuickAddButtons } from './QuickAddButtons';
import { materialsApi } from '../../services/api';
import { materialsTreeKeys, useMaterialsTreeMutations } from './hooks/useMaterialsTree';

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
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');

    // Unified modal state
    const [modalState, setModalState] = useState<ModalState>(initialModalState);

    // Fetch tree data for quick add buttons
    const { data: treeData } = useQuery({
        queryKey: materialsTreeKeys.tree(),
        queryFn: async () => {
            const response = await materialsApi.getTree({ lazyLoad: false });
            return response.data;
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

    // Mutations for deactivation
    const { updateMaterial } = useMaterialsTreeMutations();

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

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Materials Hierarchy</h2>
                    <p className="text-sm text-gray-500">Expand nodes to see fabrics and colours</p>
                </div>
                <div className="flex flex-wrap gap-2 sm:gap-3">
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

            {/* Quick Add Buttons + Search */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <QuickAddButtons
                    onAddMaterial={handleAddMaterial}
                    onAddFabric={handleAddFabric}
                    onAddColour={handleAddColour}
                    materials={materials}
                    fabrics={fabrics}
                />

                <div className="flex-1" />

                <div className="relative w-full sm:w-72">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search materials, fabrics, colours..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200"
                    />
                </div>
            </div>

            {/* Tree Table */}
            <div className="border rounded-lg overflow-hidden bg-white">
                <MaterialsTreeTable
                    onEdit={handleEdit}
                    onAddChild={handleAddChild}
                    onViewDetails={onViewDetails}
                    onAddInward={onAddInward}
                    onDeactivate={handleDeactivate}
                    searchQuery={searchQuery}
                    height="calc(100vh - 340px)"
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
        </div>
    );
}
