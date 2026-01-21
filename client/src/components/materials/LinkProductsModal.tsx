/**
 * LinkProductsModal - Modal to bulk link product variations to a fabric colour
 *
 * Allows users to:
 * 1. Search for product variations
 * 2. Select multiple variations
 * 3. Link them to the current fabric colour
 *
 * NOTE: Uses Server Functions instead of Axios API calls.
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Search, X, Check, Package, Loader2, Link2, AlertCircle } from 'lucide-react';

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { searchVariations } from '../../server/functions/materials';
import { linkFabricToVariation } from '../../server/functions/bomMutations';
import { materialsTreeKeys } from './hooks/useMaterialsTree';
import type { MaterialNode } from './types';

interface LinkProductsModalProps {
    isOpen: boolean;
    onClose: () => void;
    colour: MaterialNode | null;
}

interface VariationSearchResult {
    id: string;
    colorName: string;
    imageUrl: string | null;
    product: {
        id: string;
        name: string;
        styleCode: string | null;
    };
    currentFabric: {
        id: string;
        name: string;
    } | null;
    currentFabricColour: {
        id: string;
        colourName: string;
    } | null;
    hasMainFabricAssignment: boolean;
}

export function LinkProductsModal({ isOpen, onClose, colour }: LinkProductsModalProps) {
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Server Functions
    const searchVariationsFn = useServerFn(searchVariations);
    const linkFabricFn = useServerFn(linkFabricToVariation);

    // Search variations using Server Function
    const { data: searchResults, isLoading: isSearching } = useQuery({
        queryKey: ['variations-search', searchQuery],
        queryFn: async () => {
            const response = await searchVariationsFn({ data: { q: searchQuery, limit: 50 } });
            if (!response.success) {
                throw new Error('Failed to search variations');
            }
            return response.items as VariationSearchResult[];
        },
        enabled: isOpen && searchQuery.length >= 2,
        staleTime: 30000,
    });

    // Link mutation using Server Function
    const linkMutation = useMutation({
        mutationFn: async (variationIds: string[]) => {
            if (!colour) throw new Error('No colour selected');
            const result = await linkFabricFn({
                data: {
                    colourId: colour.id,
                    variationIds,
                }
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to link variations');
            }
            return result.data!;
        },
        onSuccess: (data) => {
            // Invalidate materials tree to refresh product counts
            queryClient.invalidateQueries({ queryKey: materialsTreeKeys.all });
            // Show success and close
            alert(`Successfully linked ${data.linked.total} variation(s) to ${data.fabricColour.fabricName} - ${data.fabricColour.name}`);
            handleClose();
        },
        onError: (error: Error) => {
            alert(error.message || 'Failed to link variations');
        },
    });

    // Show all results - don't filter out already linked ones
    // User may want to re-link or update existing links
    const filteredResults = useMemo(() => {
        if (!searchResults || !colour) return [];
        return searchResults;
    }, [searchResults, colour]);

    // Toggle selection
    const toggleSelection = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    // Select all visible
    const selectAll = useCallback(() => {
        setSelectedIds(new Set(filteredResults.map(v => v.id)));
    }, [filteredResults]);

    // Clear selection
    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    // Handle close
    const handleClose = useCallback(() => {
        setSearchQuery('');
        setSelectedIds(new Set());
        onClose();
    }, [onClose]);

    // Handle link
    const handleLink = useCallback(() => {
        if (selectedIds.size === 0) return;
        linkMutation.mutate(Array.from(selectedIds));
    }, [selectedIds, linkMutation]);

    if (!colour) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Link2 size={20} />
                        Link Products to {colour.colourName}
                    </DialogTitle>
                    <DialogDescription>
                        Search and select product variations to use this fabric colour ({colour.fabricName} - {colour.colourName})
                    </DialogDescription>
                </DialogHeader>

                {/* Search Input */}
                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <Input
                        type="text"
                        placeholder="Search by product name, style code, or color..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                        autoFocus
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>

                {/* Selection Summary */}
                {selectedIds.size > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 bg-blue-50 rounded-lg">
                        <span className="text-sm text-blue-700">
                            {selectedIds.size} variation{selectedIds.size !== 1 ? 's' : ''} selected
                        </span>
                        <div className="flex items-center gap-2">
                            {filteredResults.length > 0 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={selectAll}
                                    className="text-xs h-7"
                                >
                                    Select All
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={clearSelection}
                                className="text-xs h-7 text-red-600 hover:text-red-700"
                            >
                                Clear
                            </Button>
                        </div>
                    </div>
                )}

                {/* Results List */}
                <div className="flex-1 min-h-0 overflow-auto border rounded-lg">
                    {searchQuery.length < 2 ? (
                        <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                            <Search size={32} className="mb-2 text-gray-300" />
                            <p className="text-sm">Type at least 2 characters to search</p>
                        </div>
                    ) : isSearching ? (
                        <div className="flex items-center justify-center h-48">
                            <Loader2 size={24} className="animate-spin text-gray-400" />
                        </div>
                    ) : filteredResults.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                            <Package size={32} className="mb-2 text-gray-300" />
                            <p className="text-sm">No variations found</p>
                            {searchResults && searchResults.length > 0 && (
                                <p className="text-xs text-gray-400 mt-1">
                                    All matching variations are already linked to this colour
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y">
                            {filteredResults.map((variation) => {
                                const isSelected = selectedIds.has(variation.id);
                                const isAlreadyLinkedToThis = variation.currentFabricColour?.id === colour?.id;
                                const hasOtherAssignment = variation.hasMainFabricAssignment && !isAlreadyLinkedToThis;

                                return (
                                    <div
                                        key={variation.id}
                                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                                            isSelected
                                                ? 'bg-blue-50'
                                                : isAlreadyLinkedToThis
                                                    ? 'bg-green-50/50'
                                                    : 'hover:bg-gray-50'
                                        }`}
                                        onClick={() => toggleSelection(variation.id)}
                                    >
                                        {/* Checkbox */}
                                        <div
                                            className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                                                isSelected
                                                    ? 'bg-blue-500 border-blue-500'
                                                    : 'border-gray-300'
                                            }`}
                                        >
                                            {isSelected && <Check size={14} className="text-white" />}
                                        </div>

                                        {/* Image */}
                                        <div className="w-10 h-10 rounded bg-gray-100 overflow-hidden flex-shrink-0">
                                            {variation.imageUrl ? (
                                                <img
                                                    src={variation.imageUrl}
                                                    alt={variation.colorName}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <Package size={16} className="text-gray-400" />
                                                </div>
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-sm truncate">
                                                    {variation.product.name}
                                                </span>
                                                {variation.product.styleCode && (
                                                    <span className="text-xs text-gray-500">
                                                        ({variation.product.styleCode})
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                                <span>{variation.colorName}</span>
                                                {variation.currentFabric && (
                                                    <>
                                                        <span>•</span>
                                                        <span>Current: {variation.currentFabric.name}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Status Badge */}
                                        {isAlreadyLinkedToThis ? (
                                            <Badge
                                                variant="outline"
                                                className="text-xs flex-shrink-0 text-green-600 border-green-300"
                                            >
                                                <Check size={12} className="mr-1" />
                                                Linked
                                            </Badge>
                                        ) : hasOtherAssignment ? (
                                            <Badge
                                                variant="outline"
                                                className="text-xs flex-shrink-0 text-amber-600 border-amber-300"
                                            >
                                                <AlertCircle size={12} className="mr-1" />
                                                Will Replace
                                            </Badge>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={handleClose}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleLink}
                        disabled={selectedIds.size === 0 || linkMutation.isPending}
                    >
                        {linkMutation.isPending ? (
                            <>
                                <Loader2 size={16} className="mr-2 animate-spin" />
                                Linking...
                            </>
                        ) : (
                            <>
                                <Link2 size={16} className="mr-2" />
                                Link {selectedIds.size} Variation{selectedIds.size !== 1 ? 's' : ''}
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
