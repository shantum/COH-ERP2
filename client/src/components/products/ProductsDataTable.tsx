/**
 * ProductsDataTable - shadcn DataTable for viewing product catalog
 *
 * Shows product-level aggregated data with columns:
 * - Image, Name, Style, Category, Gender, Fabric Type
 * - Variation Count, SKU Count, Total Stock
 * - Status badge based on inventory levels
 * - Actions (View, Edit BOM)
 */

import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Eye, Package, Layers, Box, AlertTriangle, CheckCircle, XCircle, GitBranch } from 'lucide-react';

import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { useProductsTree } from './hooks/useProductsTree';
import type { ProductTreeNode } from './types';

interface ProductsDataTableProps {
    onViewProduct?: (product: ProductTreeNode) => void;
    onEditBom?: (product: ProductTreeNode) => void;
    searchQuery?: string;
}

export function ProductsDataTable({ onViewProduct, onEditBom, searchQuery }: ProductsDataTableProps) {
    const { data: treeData, summary, isLoading, refetch, isFetching } = useProductsTree();

    // Extract just product-level nodes (top level of tree)
    const products = useMemo(() => {
        if (!treeData) return [];
        // Filter by search if provided
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            return treeData.filter(
                (p) =>
                    p.name.toLowerCase().includes(query) ||
                    p.styleCode?.toLowerCase().includes(query) ||
                    p.category?.toLowerCase().includes(query) ||
                    p.fabricTypeName?.toLowerCase().includes(query)
            );
        }
        return treeData;
    }, [treeData, searchQuery]);

    // Column definitions
    const columns = useMemo<ColumnDef<ProductTreeNode>[]>(
        () => [
            {
                accessorKey: 'name',
                header: 'Product',
                cell: ({ row }) => (
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 flex-shrink-0">
                            <Package size={18} />
                        </div>
                        <div className="min-w-0">
                            <div className="font-medium text-gray-900 truncate">
                                {row.original.name}
                            </div>
                            {row.original.styleCode && (
                                <div className="text-xs text-gray-500 font-mono">
                                    {row.original.styleCode}
                                </div>
                            )}
                        </div>
                    </div>
                ),
            },
            {
                accessorKey: 'category',
                header: 'Category',
                cell: ({ row }) => (
                    <Badge variant="secondary" className="capitalize">
                        {row.original.category || '-'}
                    </Badge>
                ),
            },
            {
                accessorKey: 'gender',
                header: 'Gender',
                cell: ({ row }) => (
                    <span className="capitalize text-sm">
                        {row.original.gender || '-'}
                    </span>
                ),
            },
            {
                accessorKey: 'fabricTypeName',
                header: 'Fabric Type',
                cell: ({ row }) => (
                    <span className="text-sm text-muted-foreground">
                        {row.original.fabricTypeName || '-'}
                    </span>
                ),
            },
            {
                accessorKey: 'variationCount',
                header: 'Colors',
                cell: ({ row }) => (
                    <div className="flex items-center gap-1.5">
                        <Layers size={14} className="text-purple-500" />
                        <span className="font-medium tabular-nums">
                            {row.original.variationCount || 0}
                        </span>
                    </div>
                ),
            },
            {
                accessorKey: 'skuCount',
                header: 'SKUs',
                cell: ({ row }) => (
                    <div className="flex items-center gap-1.5">
                        <Box size={14} className="text-blue-500" />
                        <span className="font-medium tabular-nums">
                            {row.original.skuCount || 0}
                        </span>
                    </div>
                ),
            },
            {
                accessorKey: 'totalStock',
                header: 'Stock',
                cell: ({ row }) => {
                    const stock = row.original.totalStock || 0;
                    return (
                        <span
                            className={`font-semibold tabular-nums ${
                                stock === 0
                                    ? 'text-red-600'
                                    : stock < 10
                                    ? 'text-amber-600'
                                    : 'text-green-600'
                            }`}
                        >
                            {stock.toLocaleString()}
                        </span>
                    );
                },
            },
            {
                id: 'status',
                header: 'Status',
                cell: ({ row }) => {
                    const stock = row.original.totalStock || 0;
                    const skuCount = row.original.skuCount || 0;

                    if (stock === 0) {
                        return (
                            <Badge variant="destructive" className="gap-1">
                                <XCircle size={12} />
                                Out of Stock
                            </Badge>
                        );
                    }
                    if (skuCount > 0 && stock < skuCount * 5) {
                        return (
                            <Badge variant="warning" className="gap-1">
                                <AlertTriangle size={12} />
                                Low Stock
                            </Badge>
                        );
                    }
                    return (
                        <Badge variant="success" className="gap-1">
                            <CheckCircle size={12} />
                            In Stock
                        </Badge>
                    );
                },
            },
            {
                id: 'actions',
                header: '',
                cell: ({ row }) => (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onViewProduct?.(row.original);
                            }}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                            title="View Details"
                        >
                            <Eye size={16} />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onEditBom?.(row.original);
                            }}
                            className="p-1.5 rounded hover:bg-purple-100 text-purple-500 hover:text-purple-700"
                            title="Edit BOM"
                        >
                            <GitBranch size={16} />
                        </button>
                    </div>
                ),
            },
        ],
        [onViewProduct, onEditBom]
    );

    return (
        <div className="space-y-4">
            {/* Summary Stats */}
            {summary && (
                <div className="flex items-center gap-4 px-1">
                    <div className="flex items-center gap-2 text-sm">
                        <Package size={16} className="text-gray-400" />
                        <span className="text-gray-600">{summary.products} Products</span>
                    </div>
                    <div className="w-px h-4 bg-gray-200" />
                    <div className="flex items-center gap-2 text-sm">
                        <Layers size={16} className="text-purple-400" />
                        <span className="text-gray-600">{summary.variations} Colors</span>
                    </div>
                    <div className="w-px h-4 bg-gray-200" />
                    <div className="flex items-center gap-2 text-sm">
                        <Box size={16} className="text-blue-400" />
                        <span className="text-gray-600">{summary.skus} SKUs</span>
                    </div>
                    <div className="w-px h-4 bg-gray-200" />
                    <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-green-600">
                            {summary.totalStock.toLocaleString()}
                        </span>
                        <span className="text-gray-600">Units in Stock</span>
                    </div>
                </div>
            )}

            {/* DataTable */}
            <DataTable
                columns={columns}
                data={products}
                isLoading={isLoading}
                pageSize={25}
                emptyMessage="No products found"
                onRowClick={onViewProduct}
                getRowClassName={(row) =>
                    row.totalStock === 0 ? 'bg-red-50/50' : undefined
                }
            />
        </div>
    );
}
