/**
 * BOM Product List
 *
 * Left-side panel in the BOM tab showing all products with search,
 * thumbnails, variation count, and BOM cost badge.
 * Clicking a product updates the URL productId param.
 */

import { useState, useMemo } from 'react';
import { Search, Package, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProductsTree, filterProductTree } from '../products/hooks/useProductsTree';
import type { ProductTreeNode } from '../products/types';

interface BomProductListProps {
    selectedProductId?: string;
    onSelectProduct: (productId: string, productName: string) => void;
}

/** Format cost with ₹ and en-IN locale */
function fmtCost(n: number | null | undefined): string {
    if (n == null || n === 0) return '—';
    return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default function BomProductList({ selectedProductId, onSelectProduct }: BomProductListProps) {
    const [search, setSearch] = useState('');
    const { data: products, isLoading } = useProductsTree();

    // Only show product-level nodes (not variations/SKUs), filtered by search
    const filteredProducts = useMemo(() => {
        const productNodes = (products || []).filter(n => n.type === 'product');
        if (!search.trim()) return productNodes;
        return filterProductTree(productNodes, search);
    }, [products, search]);

    return (
        <div className="flex h-full flex-col border-r border-slate-200 bg-slate-50/50">
            {/* Search */}
            <div className="border-b border-slate-200 p-3">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search products..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-300"
                    />
                </div>
            </div>

            {/* Product list */}
            <div className="flex-1 overflow-y-auto">
                {isLoading && (
                    <div className="flex items-center justify-center py-12 text-sm text-slate-400">
                        Loading products...
                    </div>
                )}

                {!isLoading && filteredProducts.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-sm text-slate-400">
                        <Package className="mb-2 h-8 w-8" />
                        {search ? 'No matching products' : 'No products found'}
                    </div>
                )}

                {filteredProducts.map((product) => (
                    <ProductRow
                        key={product.id}
                        product={product}
                        isSelected={product.id === selectedProductId}
                        onSelect={() => onSelectProduct(product.id, product.name)}
                    />
                ))}
            </div>

            {/* Count footer */}
            {!isLoading && (
                <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-400">
                    {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''}
                </div>
            )}
        </div>
    );
}

function ProductRow({
    product,
    isSelected,
    onSelect,
}: {
    product: ProductTreeNode;
    isSelected: boolean;
    onSelect: () => void;
}) {
    const variationCount = product.variationCount ?? product.children?.length ?? 0;
    const hasBom = product.bomCost != null && product.bomCost > 0;

    return (
        <button
            onClick={onSelect}
            className={cn(
                'flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition-colors',
                isSelected
                    ? 'bg-primary-50 border-l-2 border-l-primary-500'
                    : 'hover:bg-slate-100'
            )}
        >
            {/* Thumbnail */}
            {product.imageUrl ? (
                <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="h-9 w-9 rounded-md object-cover ring-1 ring-slate-200"
                />
            ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-200 text-slate-400">
                    <Package className="h-4 w-4" />
                </div>
            )}

            {/* Details */}
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">
                    {product.name}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{variationCount} color{variationCount !== 1 ? 's' : ''}</span>
                    {hasBom && (
                        <>
                            <span className="text-slate-300">·</span>
                            <span className="font-medium text-emerald-600">
                                {fmtCost(product.bomCost)}
                            </span>
                        </>
                    )}
                </div>
            </div>

            <ChevronRight className={cn(
                'h-4 w-4 shrink-0',
                isSelected ? 'text-primary-500' : 'text-slate-300'
            )} />
        </button>
    );
}
