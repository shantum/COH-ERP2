/**
 * CategoryGroupedView - Products grouped by Gender → Fabric Type → Category
 *
 * A alternative view that organizes products by attributes rather than hierarchy.
 * Features:
 * - Collapsible groups with summary stats
 * - Compact product cards within groups
 * - Quick actions for each product
 */

import { useState, useMemo, Fragment } from 'react';
import { ChevronDown, ChevronRight, Package, Layers, Box, Users, Scissors, ImageIcon, Eye, GitBranch } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ProductTreeNode } from './types';

type GroupByOption = 'gender' | 'fabricType' | 'category';

interface CategoryGroupedViewProps {
    products: ProductTreeNode[];
    searchQuery?: string;
    onViewProduct?: (product: ProductTreeNode) => void;
    onEditBom?: (product: ProductTreeNode) => void;
    groupBy?: GroupByOption;
}

interface GroupData {
    key: string;
    label: string;
    products: ProductTreeNode[];
    totalVariations: number;
    totalSkus: number;
    totalStock: number;
    subGroups?: GroupData[];
}

export function CategoryGroupedView({
    products,
    searchQuery,
    onViewProduct,
    onEditBom,
    groupBy = 'gender',
}: CategoryGroupedViewProps) {
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    // Group products hierarchically: Gender → Fabric Type → Category
    const groupedData = useMemo(() => {
        const groups: Map<string, GroupData> = new Map();

        products.forEach(product => {
            const gender = product.gender || 'Unspecified';
            const fabricType = product.fabricTypeName || 'No Fabric Type';
            const category = product.category || 'Uncategorized';

            // Create gender group
            if (!groups.has(gender)) {
                groups.set(gender, {
                    key: gender,
                    label: gender,
                    products: [],
                    totalVariations: 0,
                    totalSkus: 0,
                    totalStock: 0,
                    subGroups: [],
                });
            }
            const genderGroup = groups.get(gender)!;

            // Find or create fabric type subgroup
            let fabricGroup = genderGroup.subGroups?.find(g => g.key === fabricType);
            if (!fabricGroup) {
                fabricGroup = {
                    key: fabricType,
                    label: fabricType,
                    products: [],
                    totalVariations: 0,
                    totalSkus: 0,
                    totalStock: 0,
                    subGroups: [],
                };
                genderGroup.subGroups?.push(fabricGroup);
            }

            // Find or create category subgroup
            let categoryGroup = fabricGroup.subGroups?.find(g => g.key === category);
            if (!categoryGroup) {
                categoryGroup = {
                    key: category,
                    label: category,
                    products: [],
                    totalVariations: 0,
                    totalSkus: 0,
                    totalStock: 0,
                };
                fabricGroup.subGroups?.push(categoryGroup);
            }

            // Add product to category group
            categoryGroup.products.push(product);
            categoryGroup.totalVariations += product.variationCount || 0;
            categoryGroup.totalSkus += product.skuCount || 0;
            categoryGroup.totalStock += product.totalStock || 0;

            // Roll up to fabric group
            fabricGroup.totalVariations += product.variationCount || 0;
            fabricGroup.totalSkus += product.skuCount || 0;
            fabricGroup.totalStock += product.totalStock || 0;

            // Roll up to gender group
            genderGroup.products.push(product);
            genderGroup.totalVariations += product.variationCount || 0;
            genderGroup.totalSkus += product.skuCount || 0;
            genderGroup.totalStock += product.totalStock || 0;
        });

        return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
    }, [products]);

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    const isExpanded = (key: string) => expandedGroups.has(key);

    // Expand all groups by default on first render
    useMemo(() => {
        if (expandedGroups.size === 0 && groupedData.length > 0) {
            const allKeys = new Set<string>();
            groupedData.forEach(g => {
                allKeys.add(g.key);
                g.subGroups?.forEach(sg => {
                    allKeys.add(`${g.key}:${sg.key}`);
                });
            });
            setExpandedGroups(allKeys);
        }
    }, [groupedData]);

    if (products.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Package size={48} className="mb-4 opacity-20" />
                <p>No products match the current filters</p>
            </div>
        );
    }

    return (
        <ScrollArea className="h-[calc(100vh-320px)]">
            <div className="space-y-3 pr-4">
                {groupedData.map(genderGroup => (
                    <div key={genderGroup.key} className="border rounded-lg overflow-hidden bg-white shadow-sm">
                        {/* Gender Header */}
                        <button
                            onClick={() => toggleGroup(genderGroup.key)}
                            className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 hover:from-indigo-100 hover:to-purple-100 transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-indigo-100">
                                    <Users size={18} className="text-indigo-600" />
                                </div>
                                <div className="text-left">
                                    <h3 className="font-semibold text-gray-900">{genderGroup.label}</h3>
                                    <p className="text-xs text-gray-500">
                                        {genderGroup.products.length} products
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="hidden sm:flex items-center gap-3 text-sm">
                                    <span className="flex items-center gap-1 text-purple-600">
                                        <Layers size={14} />
                                        {genderGroup.totalVariations}
                                    </span>
                                    <span className="flex items-center gap-1 text-blue-600">
                                        <Box size={14} />
                                        {genderGroup.totalSkus}
                                    </span>
                                    <span className="font-semibold text-green-600">
                                        {genderGroup.totalStock.toLocaleString()} units
                                    </span>
                                </div>
                                {isExpanded(genderGroup.key) ? (
                                    <ChevronDown size={20} className="text-gray-400" />
                                ) : (
                                    <ChevronRight size={20} className="text-gray-400" />
                                )}
                            </div>
                        </button>

                        {/* Fabric Type Subgroups */}
                        {isExpanded(genderGroup.key) && (
                            <div className="divide-y">
                                {genderGroup.subGroups?.map(fabricGroup => (
                                    <div key={fabricGroup.key}>
                                        {/* Fabric Type Header */}
                                        <button
                                            onClick={() => toggleGroup(`${genderGroup.key}:${fabricGroup.key}`)}
                                            className="w-full flex items-center justify-between px-4 py-2.5 pl-8 bg-gray-50/50 hover:bg-gray-100/50 transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="p-1.5 rounded-md bg-amber-100">
                                                    <Scissors size={14} className="text-amber-600" />
                                                </div>
                                                <div className="text-left">
                                                    <h4 className="font-medium text-gray-800 text-sm">{fabricGroup.label}</h4>
                                                    <p className="text-xs text-gray-500">
                                                        {fabricGroup.subGroups?.length || 0} categories
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="hidden sm:flex items-center gap-2 text-xs">
                                                    <Badge variant="secondary" className="font-normal">
                                                        {fabricGroup.totalSkus} SKUs
                                                    </Badge>
                                                    <span className="font-medium text-green-600">
                                                        {fabricGroup.totalStock.toLocaleString()}
                                                    </span>
                                                </div>
                                                {isExpanded(`${genderGroup.key}:${fabricGroup.key}`) ? (
                                                    <ChevronDown size={16} className="text-gray-400" />
                                                ) : (
                                                    <ChevronRight size={16} className="text-gray-400" />
                                                )}
                                            </div>
                                        </button>

                                        {/* Category Groups with Products */}
                                        {isExpanded(`${genderGroup.key}:${fabricGroup.key}`) && (
                                            <div className="bg-white">
                                                {fabricGroup.subGroups?.map(categoryGroup => (
                                                    <div key={categoryGroup.key} className="border-l-2 border-gray-200 ml-8">
                                                        {/* Category Label */}
                                                        <div className="px-4 py-2 bg-gray-50/30 border-b">
                                                            <span className="text-xs font-medium text-gray-600 uppercase tracking-wider">
                                                                {categoryGroup.label}
                                                            </span>
                                                            <span className="ml-2 text-xs text-gray-400">
                                                                ({categoryGroup.products.length})
                                                            </span>
                                                        </div>

                                                        {/* Product Cards Grid */}
                                                        <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                                            {categoryGroup.products.map(product => (
                                                                <ProductCard
                                                                    key={product.id}
                                                                    product={product}
                                                                    onView={onViewProduct}
                                                                    onEditBom={onEditBom}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </ScrollArea>
    );
}

/**
 * Compact Product Card
 */
interface ProductCardProps {
    product: ProductTreeNode;
    onView?: (product: ProductTreeNode) => void;
    onEditBom?: (product: ProductTreeNode) => void;
}

function ProductCard({ product, onView, onEditBom }: ProductCardProps) {
    return (
        <div className="group relative bg-white border rounded-lg overflow-hidden hover:shadow-md hover:border-gray-300 transition-all">
            {/* Image / Placeholder */}
            <div className="aspect-square bg-gray-100 relative">
                {product.imageUrl ? (
                    <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <ImageIcon size={32} className="text-gray-300" />
                    </div>
                )}

                {/* Hover Actions */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    <button
                        onClick={() => onView?.(product)}
                        className="p-2 rounded-full bg-white/90 hover:bg-white text-gray-700 hover:text-gray-900 shadow-lg transition-colors"
                        title="View Details"
                    >
                        <Eye size={18} />
                    </button>
                    <button
                        onClick={() => onEditBom?.(product)}
                        className="p-2 rounded-full bg-white/90 hover:bg-white text-purple-600 hover:text-purple-700 shadow-lg transition-colors"
                        title="Edit BOM"
                    >
                        <GitBranch size={18} />
                    </button>
                </div>

                {/* Stock Badge */}
                <div className="absolute top-2 right-2">
                    {(product.totalStock || 0) === 0 ? (
                        <Badge variant="destructive" className="text-xs shadow">Out</Badge>
                    ) : (product.totalStock || 0) < 10 ? (
                        <Badge variant="warning" className="text-xs shadow">Low</Badge>
                    ) : null}
                </div>
            </div>

            {/* Info */}
            <div className="p-3">
                <h5 className="font-medium text-gray-900 text-sm truncate" title={product.name}>
                    {product.name}
                </h5>
                {product.styleCode && (
                    <p className="text-xs text-gray-500 font-mono mt-0.5">{product.styleCode}</p>
                )}

                {/* Stats Row */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t">
                    <div className="flex items-center gap-2 text-xs">
                        <span className="flex items-center gap-1 text-purple-600">
                            <Layers size={12} />
                            {product.variationCount || 0}
                        </span>
                        <span className="flex items-center gap-1 text-blue-600">
                            <Box size={12} />
                            {product.skuCount || 0}
                        </span>
                    </div>
                    <span className={`text-xs font-semibold tabular-nums ${
                        (product.totalStock || 0) === 0 ? 'text-red-600' :
                        (product.totalStock || 0) < 10 ? 'text-amber-600' : 'text-green-600'
                    }`}>
                        {(product.totalStock || 0).toLocaleString()}
                    </span>
                </div>

                {/* MRP */}
                {product.avgMrp && (
                    <div className="mt-1.5 text-xs text-gray-500">
                        Avg. ₹{Math.round(product.avgMrp).toLocaleString()}
                    </div>
                )}
            </div>
        </div>
    );
}
