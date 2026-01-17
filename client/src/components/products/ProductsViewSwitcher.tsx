/**
 * ProductsViewSwitcher - Dual-view for Products
 *
 * Two viewing modes:
 * 1. By Product - Product → Variation → SKU hierarchy (default)
 * 2. By SKU - Flat table of all SKUs with sorting/filtering
 *
 * Features:
 * - Smooth view transitions
 * - Filter persistence (gender, category, fabric type)
 * - World-class UI with shadcn components
 */

import { useState, useMemo, useCallback } from 'react';
import { LayoutGrid, Grid2x2, Filter, X, Users, Shirt, Scissors } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ProductsDataTable } from './ProductsDataTable';
import { SkuFlatView } from './SkuFlatView';
import { useProductsTree } from './hooks/useProductsTree';
import type { ProductTreeNode } from './types';

type ViewMode = 'product' | 'sku';

interface ProductsViewSwitcherProps {
    searchQuery?: string;
    onViewProduct?: (product: ProductTreeNode) => void;
    onEditBom?: (product: ProductTreeNode) => void;
}

interface FilterState {
    gender: string | null;
    fabricType: string | null;
    category: string | null;
}

export function ProductsViewSwitcher({ searchQuery, onViewProduct, onEditBom }: ProductsViewSwitcherProps) {
    const [viewMode, setViewMode] = useState<ViewMode>('product');
    const [filters, setFilters] = useState<FilterState>({
        gender: null,
        fabricType: null,
        category: null,
    });
    const [showFilters, setShowFilters] = useState(false);

    const { data: treeData, summary } = useProductsTree();

    // Extract unique filter options from data
    const filterOptions = useMemo(() => {
        if (!treeData) return { genders: [], fabricTypes: [], categories: [] };

        const genders = new Set<string>();
        const fabricTypes = new Set<string>();
        const categories = new Set<string>();

        treeData.forEach(product => {
            if (product.gender) genders.add(product.gender);
            if (product.fabricTypeName) fabricTypes.add(product.fabricTypeName);
            if (product.category) categories.add(product.category);
        });

        return {
            genders: Array.from(genders).sort(),
            fabricTypes: Array.from(fabricTypes).sort(),
            categories: Array.from(categories).sort(),
        };
    }, [treeData]);

    // Filter products based on selected filters
    const filteredProducts = useMemo(() => {
        if (!treeData) return [];

        return treeData.filter(product => {
            if (filters.gender && product.gender !== filters.gender) return false;
            if (filters.fabricType && product.fabricTypeName !== filters.fabricType) return false;
            if (filters.category && product.category !== filters.category) return false;
            return true;
        });
    }, [treeData, filters]);

    // Count active filters
    const activeFilterCount = useMemo(() => {
        return Object.values(filters).filter(Boolean).length;
    }, [filters]);

    // Clear all filters
    const clearFilters = useCallback(() => {
        setFilters({ gender: null, fabricType: null, category: null });
    }, []);

    // Update a single filter
    const updateFilter = useCallback((key: keyof FilterState, value: string | null) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    }, []);

    return (
        <div className="flex flex-col h-full">
            {/* View Switcher Header */}
            <div className="flex items-center justify-between gap-4 pb-4 border-b mb-4">
                {/* View Mode Tabs */}
                <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                    <TabsList className="bg-gray-100/80">
                        <TabsTrigger value="product" className="gap-2 data-[state=active]:bg-white">
                            <LayoutGrid size={16} />
                            <span className="hidden sm:inline">By Product</span>
                        </TabsTrigger>
                        <TabsTrigger value="sku" className="gap-2 data-[state=active]:bg-white">
                            <Grid2x2 size={16} />
                            <span className="hidden sm:inline">By SKU</span>
                        </TabsTrigger>
                    </TabsList>
                </Tabs>

                {/* Filter Controls */}
                <div className="flex items-center gap-2">
                    {/* Quick Stats */}
                    {summary && (
                        <div className="hidden md:flex items-center gap-3 text-sm text-muted-foreground mr-2">
                            <span>{filteredProducts.length} of {summary.products} products</span>
                        </div>
                    )}

                    {/* Filter Toggle */}
                    <Button
                        variant={showFilters ? "default" : "outline"}
                        size="sm"
                        onClick={() => setShowFilters(!showFilters)}
                        className="gap-2"
                    >
                        <Filter size={16} />
                        Filters
                        {activeFilterCount > 0 && (
                            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                                {activeFilterCount}
                            </Badge>
                        )}
                    </Button>

                    {/* Clear Filters */}
                    {activeFilterCount > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearFilters}
                            className="gap-1 text-muted-foreground hover:text-foreground"
                        >
                            <X size={14} />
                            Clear
                        </Button>
                    )}
                </div>
            </div>

            {/* Filter Bar (Collapsible) */}
            {showFilters && (
                <div className="flex flex-wrap items-center gap-3 pb-4 mb-4 border-b animate-in slide-in-from-top-2 duration-200">
                    {/* Gender Filter */}
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Users size={14} />
                            <span className="hidden sm:inline">Gender</span>
                        </div>
                        <Select
                            value={filters.gender || "all"}
                            onValueChange={(v) => updateFilter('gender', v === 'all' ? null : v)}
                        >
                            <SelectTrigger className="w-32 h-8">
                                <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Genders</SelectItem>
                                {filterOptions.genders.map(gender => (
                                    <SelectItem key={gender} value={gender}>
                                        {gender}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="w-px h-6 bg-gray-200" />

                    {/* Category Filter */}
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Shirt size={14} />
                            <span className="hidden sm:inline">Category</span>
                        </div>
                        <Select
                            value={filters.category || "all"}
                            onValueChange={(v) => updateFilter('category', v === 'all' ? null : v)}
                        >
                            <SelectTrigger className="w-32 h-8">
                                <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Categories</SelectItem>
                                {filterOptions.categories.map(cat => (
                                    <SelectItem key={cat} value={cat}>
                                        {cat}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="w-px h-6 bg-gray-200" />

                    {/* Fabric Type Filter */}
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Scissors size={14} />
                            <span className="hidden sm:inline">Fabric</span>
                        </div>
                        <Select
                            value={filters.fabricType || "all"}
                            onValueChange={(v) => updateFilter('fabricType', v === 'all' ? null : v)}
                        >
                            <SelectTrigger className="w-36 h-8">
                                <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Fabric Types</SelectItem>
                                {filterOptions.fabricTypes.map(ft => (
                                    <SelectItem key={ft} value={ft}>
                                        {ft}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Active Filter Pills */}
                    {activeFilterCount > 0 && (
                        <>
                            <div className="w-px h-6 bg-gray-200" />
                            <div className="flex items-center gap-2">
                                {filters.gender && (
                                    <Badge variant="secondary" className="gap-1 pr-1">
                                        {filters.gender}
                                        <button
                                            onClick={() => updateFilter('gender', null)}
                                            className="ml-1 rounded-full hover:bg-gray-300 p-0.5"
                                        >
                                            <X size={12} />
                                        </button>
                                    </Badge>
                                )}
                                {filters.category && (
                                    <Badge variant="secondary" className="gap-1 pr-1">
                                        {filters.category}
                                        <button
                                            onClick={() => updateFilter('category', null)}
                                            className="ml-1 rounded-full hover:bg-gray-300 p-0.5"
                                        >
                                            <X size={12} />
                                        </button>
                                    </Badge>
                                )}
                                {filters.fabricType && (
                                    <Badge variant="secondary" className="gap-1 pr-1">
                                        {filters.fabricType}
                                        <button
                                            onClick={() => updateFilter('fabricType', null)}
                                            className="ml-1 rounded-full hover:bg-gray-300 p-0.5"
                                        >
                                            <X size={12} />
                                        </button>
                                    </Badge>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* View Content */}
            <div className="flex-1 min-h-0">
                {viewMode === 'product' ? (
                    <ProductsDataTable
                        searchQuery={searchQuery}
                        onViewProduct={onViewProduct}
                        onEditBom={onEditBom}
                        filteredData={filteredProducts}
                    />
                ) : (
                    <SkuFlatView
                        products={filteredProducts}
                        searchQuery={searchQuery}
                        onViewProduct={onViewProduct}
                        onEditBom={onEditBom}
                    />
                )}
            </div>
        </div>
    );
}
