/**
 * ProductsViewSwitcher - By Variation view for Products
 *
 * Single view showing variations grouped by product with expandable SKUs.
 *
 * Features:
 * - Product headers as visual separators
 * - Variation rows with expandable SKU sub-tables
 * - Filter persistence (gender, category, fabric type)
 * - World-class UI with shadcn components
 */

import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Filter, X, Users, Shirt, Scissors, Search, Plus } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { GENDER_LABELS, type Gender } from '@coh/shared/config/product';

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { SkuWiseDataTable } from './SkuWiseDataTable';
import { BomDataTable } from './BomDataTable';
import { useProductsTree } from './hooks/useProductsTree';
import { buildProductSlug } from '../../pages/EditProduct';
import type { ProductTreeNode } from './types';

type ProductsView = 'catalog' | 'bom';

interface ProductsViewSwitcherProps {
    searchQuery?: string;
    onSearchChange?: (query: string) => void;
    onViewProduct?: (product: ProductTreeNode) => void;
    onEditBom?: (product: ProductTreeNode) => void;
    onAddProduct?: () => void;
    /** Initial data from route loader for instant hydration (prevents refetch) */
    initialData?: { items: ProductTreeNode[]; summary: { products: number; variations: number; skus: number; totalStock: number } } | null;
}

// Discriminated union for fabric filter state
type FabricFilterValue =
    | { type: 'all' }
    | { type: 'no-fabric' }      // Variations with fabricColourId = null
    | { type: 'no-bom' }         // Variations without BOM fabric line
    | { type: 'colour'; colourId: string };  // Specific fabric colour

interface FilterState {
    gender: string | null;
    fabricFilter: FabricFilterValue;
    category: string | null;
    shopifyStatus: 'all' | 'active' | 'draft' | 'archived' | 'not_on_shopify';
}

// Types for fabric filter hierarchy
interface FabricColourOption {
    id: string;
    name: string;
    hex: string | null;
}

interface FabricGroup {
    id: string;
    name: string;
    colours: FabricColourOption[];
}

interface MaterialGroup {
    id: string;
    name: string;
    fabrics: FabricGroup[];
}

interface FabricFilterOptions {
    hierarchy: MaterialGroup[];
    noFabricCount: number;
    noBomCount: number;
}

// Helper functions for fabric filter serialization
function serializeFabricFilter(filter: FabricFilterValue): string {
    if (filter.type === 'colour') return `colour:${filter.colourId}`;
    return filter.type;
}

function parseFabricFilter(value: string): FabricFilterValue {
    if (value === 'all') return { type: 'all' };
    if (value === 'no-fabric') return { type: 'no-fabric' };
    if (value === 'no-bom') return { type: 'no-bom' };
    if (value.startsWith('colour:')) return { type: 'colour', colourId: value.slice(7) };
    return { type: 'all' };
}

export function ProductsViewSwitcher({ searchQuery, onSearchChange, onViewProduct, onEditBom, onAddProduct, initialData }: ProductsViewSwitcherProps) {
    const [activeView, setActiveView] = useState<ProductsView>('catalog');
    const [filters, setFilters] = useState<FilterState>({
        gender: null,
        fabricFilter: { type: 'all' },
        category: null,
        shopifyStatus: 'all',
    });
    const [showFilters, setShowFilters] = useState(false);

    // Debounce search to prevent expensive tree filtering on every keystroke
    const debouncedSearchQuery = useDebounce(searchQuery || '', 300);

    const navigate = useNavigate();

    // Use initialData from route loader to prevent refetch after SSR hydration
    const { data: treeData, summary } = useProductsTree({
        initialData: initialData ? { items: initialData.items, summary: initialData.summary } : undefined,
    });

    // Extract unique filter options from data
    const filterOptions = useMemo(() => {
        if (!treeData) return { genders: [], categories: [] };

        const genders = new Set<string>();
        const categories = new Set<string>();

        treeData.forEach(product => {
            if (product.gender) genders.add(product.gender);
            if (product.category) categories.add(product.category);
        });

        return {
            genders: Array.from(genders).sort(),
            categories: Array.from(categories).sort(),
        };
    }, [treeData]);

    // Build fabric filter options with Material > Fabric > Colour hierarchy
    const fabricFilterOptions = useMemo((): FabricFilterOptions => {
        if (!treeData) return { hierarchy: [], noFabricCount: 0, noBomCount: 0 };

        const materialsMap = new Map<string, {
            id: string;
            name: string;
            fabrics: Map<string, { id: string; name: string; colours: Map<string, FabricColourOption> }>;
        }>();

        let noFabricCount = 0;
        let noBomCount = 0;
        const productsWithNoFabric = new Set<string>();
        const productsWithNoBom = new Set<string>();

        treeData.forEach(product => {
            const variations = (product.children || []) as ProductTreeNode[];

            // Count products for special filters
            if (variations.some(v => !v.fabricColourId)) {
                productsWithNoFabric.add(product.id);
            }
            if (variations.some(v => !v.hasBomFabricLine)) {
                productsWithNoBom.add(product.id);
            }

            // Build hierarchy from variations
            variations.forEach(variation => {
                if (!variation.fabricColourId || !variation.materialId) return;

                // Get or create material
                let material = materialsMap.get(variation.materialId);
                if (!material) {
                    material = {
                        id: variation.materialId,
                        name: variation.materialName || 'Unknown Material',
                        fabrics: new Map(),
                    };
                    materialsMap.set(variation.materialId, material);
                }

                // Get or create fabric under material
                const fabricId = variation.fabricId || '';
                let fabric = material.fabrics.get(fabricId);
                if (!fabric) {
                    fabric = {
                        id: fabricId,
                        name: variation.fabricName || 'Unknown Fabric',
                        colours: new Map(),
                    };
                    material.fabrics.set(fabricId, fabric);
                }

                // Add colour
                fabric.colours.set(variation.fabricColourId, {
                    id: variation.fabricColourId,
                    name: variation.fabricColourName || 'Unknown Colour',
                    hex: variation.fabricColourHex || null,
                });
            });
        });

        noFabricCount = productsWithNoFabric.size;
        noBomCount = productsWithNoBom.size;

        // Convert to sorted arrays
        const hierarchy = Array.from(materialsMap.values())
            .map(m => ({
                id: m.id,
                name: m.name,
                fabrics: Array.from(m.fabrics.values())
                    .map(f => ({
                        id: f.id,
                        name: f.name,
                        colours: Array.from(f.colours.values()).sort((a, b) => a.name.localeCompare(b.name)),
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name)),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return { hierarchy, noFabricCount, noBomCount };
    }, [treeData]);

    // Pure filter function for fabric filter matching
    const matchesFabricFilter = useCallback((
        variations: ProductTreeNode[],
        filter: FabricFilterValue
    ): boolean => {
        switch (filter.type) {
            case 'all':
                return true;
            case 'no-fabric':
                // Show products with ANY variation missing fabricColourId
                return variations.some(v => !v.fabricColourId);
            case 'no-bom':
                // Show products with ANY variation missing BOM fabric line
                return variations.some(v => !v.hasBomFabricLine);
            case 'colour':
                // Show products with ANY variation using this fabric colour
                return variations.some(v => v.fabricColourId === filter.colourId);
            default:
                // Exhaustive check - TypeScript will error if we miss a case
                filter satisfies never;
                return true;
        }
    }, []);

    // Determine a product's effective Shopify status (best among its variations).
    // Priority: active > draft > archived > not_on_shopify
    const getProductShopifyStatus = useCallback((variations: ProductTreeNode[]): 'active' | 'draft' | 'archived' | 'not_on_shopify' => {
        const hasActive = variations.some(v => v.shopifyStatus === 'active');
        if (hasActive) return 'active';
        const hasDraft = variations.some(v => v.shopifyStatus === 'draft');
        if (hasDraft) return 'draft';
        const hasArchived = variations.some(v => v.shopifyStatus === 'archived');
        if (hasArchived) return 'archived';
        return 'not_on_shopify';
    }, []);

    // Filter products based on selected filters
    const filteredProducts = useMemo(() => {
        if (!treeData) return [];

        return treeData.filter(product => {
            if (filters.gender && product.gender !== filters.gender) return false;
            if (filters.category && product.category !== filters.category) return false;

            // Fabric filter operates on variations
            const variations = (product.children || []) as ProductTreeNode[];
            if (!matchesFabricFilter(variations, filters.fabricFilter)) return false;

            // Shopify status filter — uses best status so a product only appears in one tab
            if (filters.shopifyStatus !== 'all') {
                const effectiveStatus = getProductShopifyStatus(variations);
                if (effectiveStatus !== filters.shopifyStatus) return false;
            }

            return true;
        });
    }, [treeData, filters, matchesFabricFilter, getProductShopifyStatus]);

    // Compute Shopify tab counts from full (non-shopify-filtered) data
    const shopifyTabCounts = useMemo(() => {
        if (!treeData) return { all: 0, active: 0, draft: 0, archived: 0, not_on_shopify: 0 };

        let active = 0, draft = 0, archived = 0, notOnShopify = 0;

        // Apply non-shopify filters first
        const baseFiltered = treeData.filter(product => {
            if (filters.gender && product.gender !== filters.gender) return false;
            if (filters.category && product.category !== filters.category) return false;
            const variations = (product.children || []) as ProductTreeNode[];
            if (!matchesFabricFilter(variations, filters.fabricFilter)) return false;
            return true;
        });

        for (const product of baseFiltered) {
            const variations = (product.children || []) as ProductTreeNode[];
            const status = getProductShopifyStatus(variations);
            if (status === 'active') active++;
            else if (status === 'draft') draft++;
            else if (status === 'archived') archived++;
            else notOnShopify++;
        }

        return { all: baseFiltered.length, active, draft, archived, not_on_shopify: notOnShopify };
    }, [treeData, filters.gender, filters.category, filters.fabricFilter, matchesFabricFilter]);

    // Count active filters
    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (filters.gender) count++;
        if (filters.category) count++;
        if (filters.fabricFilter.type !== 'all') count++;
        return count;
    }, [filters]);

    // Clear all filters
    const clearFilters = useCallback(() => {
        setFilters({ gender: null, fabricFilter: { type: 'all' }, category: null, shopifyStatus: 'all' });
    }, []);

    // Update a single filter (for simple string filters)
    const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    }, []);

    // Navigate to full-page edit for a product/variation/SKU
    const handleEditProduct = useCallback((node: ProductTreeNode) => {
        let productId = node.id;
        let productName = node.name;
        if (node.type === 'variation') {
            productId = node.productId || '';
            productName = node.productName || node.name;
        } else if (node.type === 'sku') {
            const productNode = treeData?.find(p =>
                p.children?.some(v => v.children?.some(s => s.id === node.id))
            );
            productId = productNode?.id || '';
            productName = productNode?.name || node.name;
        }
        const productSlug = buildProductSlug(productName, productId);
        navigate({ to: '/products/$productSlug/edit', params: { productSlug } });
    }, [treeData, navigate]);

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 pb-4 border-b mb-4 flex-shrink-0">
                {/* Left: Search */}
                <div className="flex-1 max-w-md">
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <Input
                            type="text"
                            placeholder="Search products, SKUs, colors..."
                            value={searchQuery || ''}
                            onChange={(e) => onSearchChange?.(e.target.value)}
                            className="pl-9 h-9"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => onSearchChange?.('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Right: Stats, Filters, Add */}
                <div className="flex items-center gap-2">
                    {/* Quick Stats */}
                    {summary && (
                        <div className="hidden lg:flex items-center text-sm text-muted-foreground mr-2">
                            <span>{filteredProducts.length} of {summary.products} products</span>
                        </div>
                    )}

                    {/* View Toggle */}
                    <div className="flex items-center rounded-md border bg-muted p-0.5">
                        {([
                            { key: 'catalog' as const, label: 'Catalog' },
                            { key: 'bom' as const, label: 'BOM' },
                        ]).map(view => (
                            <button
                                key={view.key}
                                onClick={() => setActiveView(view.key)}
                                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                                    activeView === view.key
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {view.label}
                            </button>
                        ))}
                    </div>

                    {/* Filter Toggle */}
                    <Button
                        variant={showFilters ? "default" : "outline"}
                        size="sm"
                        onClick={() => setShowFilters(!showFilters)}
                        className="gap-2"
                    >
                        <Filter size={16} />
                        <span className="hidden sm:inline">Filters</span>
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

                    {/* Add Product Button */}
                    <Button
                        size="sm"
                        onClick={onAddProduct}
                        className="gap-1.5"
                    >
                        <Plus size={16} />
                        <span className="hidden sm:inline">Add Product</span>
                    </Button>
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
                                        {GENDER_LABELS[gender as Gender] ?? gender}
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

                    {/* Fabric Colour Filter (3-tier hierarchy) */}
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Scissors size={14} />
                            <span className="hidden sm:inline">Fabric</span>
                        </div>
                        <Select
                            value={serializeFabricFilter(filters.fabricFilter)}
                            onValueChange={(v) => updateFilter('fabricFilter', parseFabricFilter(v))}
                        >
                            <SelectTrigger className="w-52 h-8">
                                <SelectValue placeholder="All Fabrics" />
                            </SelectTrigger>
                            <SelectContent className="max-h-80">
                                <SelectItem value="all">All Fabrics</SelectItem>
                                <SelectSeparator />

                                {/* Special filters with counts */}
                                <SelectItem value="no-fabric">
                                    <span className="flex items-center gap-2">
                                        No Fabric Assigned
                                        {fabricFilterOptions.noFabricCount > 0 && (
                                            <Badge variant="secondary" className="text-xs h-5 px-1.5">
                                                {fabricFilterOptions.noFabricCount}
                                            </Badge>
                                        )}
                                    </span>
                                </SelectItem>
                                <SelectItem value="no-bom">
                                    <span className="flex items-center gap-2">
                                        No BOM Fabric Line
                                        {fabricFilterOptions.noBomCount > 0 && (
                                            <Badge variant="secondary" className="text-xs h-5 px-1.5">
                                                {fabricFilterOptions.noBomCount}
                                            </Badge>
                                        )}
                                    </span>
                                </SelectItem>

                                {fabricFilterOptions.hierarchy.length > 0 && <SelectSeparator />}

                                {/* Grouped by Material > Fabric > Colour */}
                                {fabricFilterOptions.hierarchy.map(material => (
                                    <SelectGroup key={material.id}>
                                        <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                            {material.name}
                                        </SelectLabel>
                                        {material.fabrics.flatMap(fabric =>
                                            fabric.colours.map(colour => (
                                                <SelectItem key={colour.id} value={`colour:${colour.id}`}>
                                                    <span className="flex items-center gap-2">
                                                        {colour.hex && (
                                                            <span
                                                                className="w-3 h-3 rounded-full border border-gray-200 flex-shrink-0"
                                                                style={{ backgroundColor: colour.hex }}
                                                            />
                                                        )}
                                                        <span>{colour.name}</span>
                                                        <span className="text-muted-foreground text-xs">({fabric.name})</span>
                                                    </span>
                                                </SelectItem>
                                            ))
                                        )}
                                    </SelectGroup>
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
                                {filters.fabricFilter.type !== 'all' && (
                                    <Badge variant="secondary" className="gap-1 pr-1">
                                        {filters.fabricFilter.type === 'no-fabric' && 'No Fabric Assigned'}
                                        {filters.fabricFilter.type === 'no-bom' && 'No BOM Fabric'}
                                        {filters.fabricFilter.type === 'colour' && (() => {
                                            // Find the colour name from hierarchy
                                            const colourId = filters.fabricFilter.colourId;
                                            for (const mat of fabricFilterOptions.hierarchy) {
                                                for (const fab of mat.fabrics) {
                                                    const colour = fab.colours.find(c => c.id === colourId);
                                                    if (colour) return colour.name;
                                                }
                                            }
                                            return 'Selected Fabric';
                                        })()}
                                        <button
                                            onClick={() => updateFilter('fabricFilter', { type: 'all' })}
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

            {/* Shopify Status Tabs */}
            <div className="flex items-center gap-0 border-b mb-3 flex-shrink-0">
                {([
                    { key: 'active', label: 'Active', count: shopifyTabCounts.active },
                    { key: 'draft', label: 'Draft', count: shopifyTabCounts.draft },
                    { key: 'archived', label: 'Archived', count: shopifyTabCounts.archived },
                    { key: 'not_on_shopify', label: 'Not on Shopify', count: shopifyTabCounts.not_on_shopify },
                    { key: 'all', label: 'All', count: shopifyTabCounts.all },
                ] as const).map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => updateFilter('shopifyStatus', tab.key)}
                        className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                            filters.shopifyStatus === tab.key
                                ? 'border-gray-900 text-gray-900'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        {tab.label}
                        <span className={`ml-1.5 ${filters.shopifyStatus === tab.key ? 'text-gray-600' : 'text-gray-400'}`}>
                            {tab.count}
                        </span>
                    </button>
                ))}
            </div>

            {/* View Content */}
            <div className="flex-1 min-h-0">
                {activeView === 'catalog' ? (
                    <SkuWiseDataTable
                        filteredData={filteredProducts}
                        searchQuery={debouncedSearchQuery}
                        onViewProduct={onViewProduct}
                        onEditBom={onEditBom}
                        onEditProduct={handleEditProduct}
                    />
                ) : (
                    <BomDataTable
                        filteredData={filteredProducts}
                        searchQuery={debouncedSearchQuery}
                        onEditProduct={handleEditProduct}
                    />
                )}
            </div>

        </div>
    );
}
