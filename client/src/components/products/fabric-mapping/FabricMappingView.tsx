/**
 * FabricMappingView - Main container for Fabric Mapping tab
 *
 * Orchestrates:
 * - Header with search, filter, and save button
 * - FabricMappingTable with cascading dropdowns
 * - Footer with summary stats and pending changes indicator
 */

import { useState, useCallback, useDeferredValue } from 'react';
import { Loader2, Save, Search, X, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FabricMappingTable } from './FabricMappingTable';
import { useFabricMappingData } from './hooks/useFabricMappingData';
import { useFabricMappingMutations } from './hooks/useFabricMappingMutations';
import type { PendingFabricChange, FabricMappingFilter } from './types';

export function FabricMappingView() {
    // State - separate input value from deferred search query
    const [searchInput, setSearchInput] = useState('');
    const [filter, setFilter] = useState<FabricMappingFilter>('all');
    const [pendingChanges, setPendingChanges] = useState<Map<string, PendingFabricChange>>(
        new Map()
    );

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
    });

    // Show loading indicator when search is pending
    const isSearchPending = searchInput !== deferredSearchQuery;

    // Mutations
    const { saveAssignments, isSaving } = useFabricMappingMutations();

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
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50 flex-shrink-0">
                <div>
                    <h3 className="text-sm font-medium text-gray-900">Fabric Mapping</h3>
                    <p className="text-xs text-gray-500">
                        Assign main fabrics to product variations
                    </p>
                </div>
                <div className="flex items-center gap-3">
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
                            className="pl-8 pr-8 py-1.5 text-sm border rounded-md w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        {searchInput && (
                            <button
                                onClick={() => setSearchInput('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Filter */}
                    <div className="relative">
                        <Filter
                            size={14}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                        <select
                            value={filter}
                            onChange={(e) => setFilter(e.target.value as FabricMappingFilter)}
                            className="pl-8 pr-8 py-1.5 text-sm border rounded-md appearance-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                            {filterOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="w-px h-6 bg-gray-300" />

                    {/* Save Button */}
                    <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={!hasChanges || isSaving}
                        className="gap-1"
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
                // TODO: Add modal handlers for inline creation
                // onAddMaterial={() => {}}
                // onAddFabric={(materialId) => {}}
                // onAddColour={(fabricId) => {}}
            />

            {/* Footer */}
            <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-500 flex items-center justify-between flex-shrink-0">
                <span>
                    {summary.mappedVariations} mapped · {summary.unmappedVariations} unmapped ·{' '}
                    {summary.totalProducts} products
                </span>
                <span className="text-gray-400">
                    Material/Fabric selections auto-saved · Select Colour to finalize
                </span>
            </div>

            {/* Pending changes footer */}
            {hasChanges && (
                <div className="px-4 py-2 border-t bg-amber-50 text-xs text-amber-700 flex items-center justify-between flex-shrink-0">
                    <span>{pendingChanges.size} unsaved changes</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleDiscard}
                            className="text-amber-600 hover:text-amber-800 underline"
                        >
                            Discard
                        </button>
                        <Button size="sm" onClick={handleSave} disabled={isSaving}>
                            Save Changes
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
