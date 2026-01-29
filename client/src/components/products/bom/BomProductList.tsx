/**
 * BomProductList - Compact product list for BOM Editor
 *
 * Simplified view showing only products with:
 * - Thumbnails
 * - Compact rows
 * - Expandable variations
 */

import { useState, useMemo, useCallback } from 'react';
import { RefreshCw, ChevronRight, ChevronDown, Search, Loader2 } from 'lucide-react';
import { useProductsTree, filterProductTree } from '../hooks/useProductsTree';
import type { ProductTreeNode } from '../types';
import { getOptimizedImageUrl } from '../../../utils/imageOptimization';

interface BomProductListProps {
    onSelect: (node: ProductTreeNode | null) => void;
    selectedId?: string | null;
}

export function BomProductList({ onSelect, selectedId }: BomProductListProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

    const { data: treeData, summary, isLoading, isFetching, refetch } = useProductsTree();

    // Filter and flatten to products only (with variations as children)
    const products = useMemo(() => {
        const filtered = filterProductTree(treeData, searchQuery);
        return filtered.filter((node) => node.type === 'product');
    }, [treeData, searchQuery]);

    // Toggle product expansion
    const toggleExpand = useCallback((productId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedProducts((prev) => {
            const next = new Set(prev);
            if (next.has(productId)) {
                next.delete(productId);
            } else {
                next.add(productId);
            }
            return next;
        });
    }, []);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Loading...</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Search Header */}
            <div className="p-2 border-b bg-gray-50 space-y-2">
                {/* Search */}
                <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search products..."
                        className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                </div>

                {/* Summary & Refresh */}
                <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>
                        {products.length} products
                        {summary && ` · ${summary.variations} variations`}
                    </span>
                    <button
                        onClick={() => refetch()}
                        disabled={isFetching}
                        className="p-1 hover:bg-gray-200 rounded disabled:opacity-50"
                        title="Refresh"
                    >
                        <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Product List */}
            <div className="flex-1 overflow-auto">
                {products.length === 0 ? (
                    <div className="p-4 text-center text-sm text-gray-500">
                        {searchQuery ? 'No products match your search' : 'No products found'}
                    </div>
                ) : (
                    <div className="divide-y">
                        {products.map((product) => (
                            <ProductRow
                                key={product.id}
                                product={product}
                                isSelected={selectedId === product.id}
                                isExpanded={expandedProducts.has(product.id)}
                                onToggleExpand={(e) => toggleExpand(product.id, e)}
                                onSelect={onSelect}
                                selectedId={selectedId}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

interface ProductRowProps {
    product: ProductTreeNode;
    isSelected: boolean;
    isExpanded: boolean;
    onToggleExpand: (e: React.MouseEvent) => void;
    onSelect: (node: ProductTreeNode | null) => void;
    selectedId?: string | null;
}

function ProductRow({
    product,
    isSelected,
    isExpanded,
    onToggleExpand,
    onSelect,
    selectedId,
}: ProductRowProps) {
    const hasVariations = product.children && product.children.length > 0;

    return (
        <>
            {/* Product Row */}
            <div
                onClick={() => onSelect(product)}
                className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-blue-50 transition-colors ${
                    isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : ''
                }`}
            >
                {/* Expand Toggle */}
                <button
                    onClick={onToggleExpand}
                    className={`p-0.5 rounded hover:bg-gray-200 ${
                        hasVariations ? 'visible' : 'invisible'
                    }`}
                >
                    {isExpanded ? (
                        <ChevronDown size={14} className="text-gray-500" />
                    ) : (
                        <ChevronRight size={14} className="text-gray-500" />
                    )}
                </button>

                {/* Thumbnail */}
                <div className="w-8 h-8 flex-shrink-0 rounded bg-gray-100 overflow-hidden">
                    {product.imageUrl ? (
                        <img
                            src={getOptimizedImageUrl(product.imageUrl, 'sm') || product.imageUrl}
                            alt={product.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">
                            N/A
                        </div>
                    )}
                </div>

                {/* Name & Meta */}
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                        {product.name}
                    </div>
                    <div className="text-[10px] text-gray-500 truncate">
                        {product.variationCount} colors · {product.skuCount} SKUs
                    </div>
                </div>
            </div>

            {/* Expanded Variations */}
            {isExpanded && hasVariations && (
                <div className="bg-gray-50 border-l-2 border-purple-200 ml-4">
                    {product.children!.map((variation) => (
                        <VariationRow
                            key={variation.id}
                            variation={variation}
                            isSelected={selectedId === variation.id}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            )}
        </>
    );
}

interface VariationRowProps {
    variation: ProductTreeNode;
    isSelected: boolean;
    onSelect: (node: ProductTreeNode | null) => void;
}

function VariationRow({ variation, isSelected, onSelect }: VariationRowProps) {
    return (
        <div
            onClick={() => onSelect(variation)}
            className={`flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-purple-50 transition-colors ${
                isSelected ? 'bg-purple-50 ring-1 ring-inset ring-purple-300' : ''
            }`}
        >
            {/* Spacer for alignment */}
            <div className="w-5" />

            {/* Color Swatch or Thumbnail */}
            <div className="w-6 h-6 flex-shrink-0 rounded overflow-hidden">
                {variation.colorHex ? (
                    <div
                        className="w-full h-full border border-gray-200"
                        style={{ backgroundColor: variation.colorHex }}
                    />
                ) : variation.imageUrl ? (
                    <img
                        src={getOptimizedImageUrl(variation.imageUrl, 'xs') || variation.imageUrl}
                        alt={variation.colorName || variation.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full bg-gray-200" />
                )}
            </div>

            {/* Name */}
            <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-700 truncate">
                    {variation.colorName || variation.name}
                </div>
            </div>

            {/* SKU count */}
            <div className="text-[10px] text-gray-400">
                {variation.children?.length || 0} SKUs
            </div>
        </div>
    );
}
