/**
 * FabricMappingView - Main container for Fabric Mapping tab
 *
 * Orchestrates:
 * - Header with search, filter, and save button
 * - FabricMappingTable with cascading dropdowns
 * - Footer with summary stats and pending changes indicator
 * - UnifiedMaterialModal for inline colour creation
 */

import { useState, useCallback, useDeferredValue, useMemo } from 'react';
import { Loader2, Save, Search, X, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FabricMappingTable } from './FabricMappingTable';
import { useFabricMappingData } from './hooks/useFabricMappingData';
import { useFabricMappingMutations } from './hooks/useFabricMappingMutations';
import { UnifiedMaterialModal } from '../../materials/UnifiedMaterialModal';
import type { MaterialNode } from '../../materials/types';
import type { PendingFabricChange, FabricMappingFilter } from './types';

export function FabricMappingView() {
    // State - separate input value from deferred search query
    const [searchInput, setSearchInput] = useState('');
    const [filter, setFilter] = useState<FabricMappingFilter>('all');
    const [shopifyStatusFilter, setShopifyStatusFilter] = useState<'all' | 'active' | 'archived'>('all');
    const [pendingChanges, setPendingChanges] = useState<Map<string, PendingFabricChange>>(
        new Map()
    );

    // Modal state for adding new colours
    const [addColourModal, setAddColourModal] = useState<{
        isOpen: boolean;
        fabricId: string | null;
    }>({ isOpen: false, fabricId: null });

    // Defer the search query to prevent blocking input
    const deferredSearchQuery = useDeferredValue(searchInput);

    // Data - use deferred search query for filtering
    const {
        rows,
        materialsLookup,
        summary,
        isLoading,
        error,
        refetch,
        mainFabricRoleId,
    } = useFabricMappingData({
        filter,
        searchQuery: deferredSearchQuery,
        shopifyStatusFilter,
    });

    // Show loading indicator when search is pending
    const isSearchPending = searchInput !== deferredSearchQuery;

    // Mutations
    const { saveAssignments, isSaving } = useFabricMappingMutations();

    // Build parent node for the modal (fabric info)
    const addColourParentNode = useMemo((): MaterialNode | undefined => {
        if (!addColourModal.fabricId) return undefined;
        const fabric = materialsLookup.fabrics.find(f => f.id === addColourModal.fabricId);
        if (!fabric) return undefined;
        const material = materialsLookup.materials.find(m => m.id === fabric.materialId);
        return {
            id: fabric.id,
            name: fabric.name,
            type: 'fabric',
            materialId: fabric.materialId,
            constructionType: fabric.constructionType,
            materialName: material?.name,
        } as MaterialNode;
    }, [addColourModal.fabricId, materialsLookup]);

    // Handle add colour button
    const handleAddColour = useCallback((fabricId: string) => {
        setAddColourModal({ isOpen: true, fabricId });
    }, []);

    // Handle modal close
    const handleCloseAddColourModal = useCallback(() => {
        setAddColourModal({ isOpen: false, fabricId: null });
    }, []);

    // Handle modal success - refetch data to get new colour
    const handleAddColourSuccess = useCallback(() => {
        refetch();
    }, [refetch]);

    // Handle pending change
    const handlePendingChange = useCallback(
        (variationId: string, change: PendingFabricChange | null) => {
            setPendingChanges((prev) => {
                const next = new Map(prev);
                if (change) {
                    next.set(variationId, change);
                } else {
                    next.delete(variationId);
                }
                return next;
            });
        },
        []
    );

    // Handle save
    const handleSave = useCallback(async () => {
        if (!mainFabricRoleId || pendingChanges.size === 0) return;

        const changes = Array.from(pendingChanges.values());
        const result = await saveAssignments.mutateAsync({
            changes,
            roleId: mainFabricRoleId,
        });

        if (result.success) {
            setPendingChanges(new Map());
            refetch();
        } else {
            // Show error toast or alert
            console.error('Failed to save some assignments:', result.errors);
            // Still clear successful changes and refetch
            setPendingChanges(new Map());
            refetch();
        }
    }, [mainFabricRoleId, pendingChanges, saveAssignments, refetch]);

    // Handle discard
    const handleDiscard = useCallback(() => {
        setPendingChanges(new Map());
    }, []);

    // Filter options
    const filterOptions: { value: FabricMappingFilter; label: string }[] = [
        { value: 'all', label: 'All' },
        { value: 'unmapped', label: 'Unmapped' },
        { value: 'mapped', label: 'Mapped' },
    ];

    // Shopify status filter options
    const shopifyStatusOptions: { value: 'all' | 'active' | 'archived'; label: string }[] = [
        { value: 'all', label: 'All Statuses' },
        { value: 'active', label: 'Active on Shopify' },
        { value: 'archived', label: 'Archived on Shopify' },
    ];

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 size={24} className="animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Loading fabric mapping data...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-64 text-red-500">
                Failed to load data: {error.message}
            </div>
        );
    }

    const hasChanges = pendingChanges.size > 0;

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white flex-shrink-0">
                <div className="flex items-center gap-4">
                    {/* Search */}
                    <div className="relative">
                        <Search
                            size={14}
                            className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${
                                isSearchPending ? 'text-blue-400 animate-pulse' : 'text-gray-400'
                            }`}
                        />
                        <input
                            type="text"
                            placeholder="Search products..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="pl-8 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg w-52 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                        />
                        {searchInput && (
                            <button
                                onClick={() => setSearchInput('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Mapping Filter */}
                    <div className="relative">
                        <Filter
                            size={14}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                        <select
                            value={filter}
                            onChange={(e) => setFilter(e.target.value as FabricMappingFilter)}
                            className="pl-8 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white transition-all cursor-pointer"
                        >
                            {filterOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Shopify Status Filter */}
                    <select
                        value={shopifyStatusFilter}
                        onChange={(e) => setShopifyStatusFilter(e.target.value as 'all' | 'active' | 'archived')}
                        className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white transition-all cursor-pointer"
                    >
                        {shopifyStatusOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center gap-3">
                    {/* Stats */}
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                        <span className="px-2 py-1 bg-green-50 text-green-700 rounded">
                            {summary.mappedVariations} mapped
                        </span>
                        <span className="px-2 py-1 bg-gray-50 text-gray-600 rounded">
                            {summary.unmappedVariations} unmapped
                        </span>
                    </div>

                    <div className="w-px h-6 bg-gray-200" />

                    {/* Save Button */}
                    <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={!hasChanges || isSaving}
                        className="gap-1.5"
                    >
                        {isSaving ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Save size={14} />
                        )}
                        Save {hasChanges && `(${pendingChanges.size})`}
                    </Button>
                </div>
            </div>

            {/* Table */}
            <FabricMappingTable
                rows={rows}
                materialsLookup={materialsLookup}
                pendingChanges={pendingChanges}
                onPendingChange={handlePendingChange}
                onAddColour={handleAddColour}
            />

            {/* Footer - only show when there are pending changes */}
            {hasChanges && (
                <div className="px-4 py-2 border-t border-amber-200 bg-amber-50 text-xs flex items-center justify-between flex-shrink-0">
                    <span className="text-amber-700 font-medium">
                        {pendingChanges.size} unsaved {pendingChanges.size === 1 ? 'change' : 'changes'}
                    </span>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleDiscard}
                            className="text-amber-600 hover:text-amber-800 transition-colors"
                        >
                            Discard
                        </button>
                        <Button size="sm" onClick={handleSave} disabled={isSaving}>
                            Save Changes
                        </Button>
                    </div>
                </div>
            )}

            {/* Help text footer - only show when no pending changes */}
            {!hasChanges && (
                <div className="px-4 py-1.5 border-t border-gray-100 bg-gray-50/50 text-[11px] text-gray-400 flex items-center justify-between flex-shrink-0">
                    <span>
                        Set Material/Fabric at product level · Select Colour per variation · Save to apply
                    </span>
                    <span>
                        {summary.totalProducts} products
                    </span>
                </div>
            )}

            {/* Add Colour Modal */}
            <UnifiedMaterialModal
                isOpen={addColourModal.isOpen}
                onClose={handleCloseAddColourModal}
                mode="add"
                type="colour"
                parentId={addColourModal.fabricId || undefined}
                parentNode={addColourParentNode}
                onSuccess={handleAddColourSuccess}
            />
        </div>
    );
}
