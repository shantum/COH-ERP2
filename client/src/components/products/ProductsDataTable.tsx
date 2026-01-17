/**
 * ProductsDataTable - Hierarchical DataTable for viewing product catalog
 *
 * Features:
 * - Expandable Product → Variation → SKU hierarchy
 * - Sticky header for scrolling
 * - Image thumbnails
 * - Inline editing for fabric type
 * - Rich data columns: MRP, Type, Fabric, Stock, Status
 */

import { useState, useMemo, useEffect, Fragment } from 'react';
import { type ColumnDef, type ExpandedState, type PaginationState, flexRender, getCoreRowModel, getExpandedRowModel, getPaginationRowModel, useReactTable } from '@tanstack/react-table';
import { Eye, Package, Layers, Box, AlertTriangle, CheckCircle, XCircle, GitBranch, ChevronRight, ChevronDown, ChevronLeft, ImageIcon, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useProductsTree } from './hooks/useProductsTree';
import type { ProductTreeNode } from './types';
import { sortBySizeOrder } from './types';

interface ProductsDataTableProps {
    onViewProduct?: (product: ProductTreeNode) => void;
    onEditBom?: (product: ProductTreeNode) => void;
    onEditProduct?: (product: ProductTreeNode) => void;
    searchQuery?: string;
    /** Pre-filtered data from parent component */
    filteredData?: ProductTreeNode[];
}

const PAGE_SIZE = 100;

export function ProductsDataTable({ onViewProduct, onEditBom, onEditProduct, searchQuery, filteredData }: ProductsDataTableProps) {
    const { data: treeData, summary, isLoading } = useProductsTree({ enabled: !filteredData });
    const [expanded, setExpanded] = useState<ExpandedState>({});
    const [pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: PAGE_SIZE,
    });

    // Use filtered data if provided, otherwise apply search filter
    const products = useMemo(() => {
        const sourceData = filteredData || treeData || [];
        if (!searchQuery) return sourceData;

        const query = searchQuery.toLowerCase();
        return sourceData.filter(
            (p) =>
                p.name.toLowerCase().includes(query) ||
                p.styleCode?.toLowerCase().includes(query) ||
                p.category?.toLowerCase().includes(query) ||
                p.fabricTypeName?.toLowerCase().includes(query) ||
                p.children?.some(v =>
                    v.colorName?.toLowerCase().includes(query) ||
                    v.fabricName?.toLowerCase().includes(query)
                )
        );
    }, [treeData, filteredData, searchQuery]);

    // Reset to first page when data changes
    useEffect(() => {
        setPagination(prev => ({ ...prev, pageIndex: 0 }));
    }, [searchQuery, filteredData]);

    // Column definitions for products
    const columns = useMemo<ColumnDef<ProductTreeNode>[]>(
        () => [
            {
                id: 'expander',
                header: '',
                size: 40,
                cell: ({ row }) => {
                    if (!row.original.children?.length) return null;
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                row.toggleExpanded();
                            }}
                            className="p-1 rounded hover:bg-gray-100"
                        >
                            {row.getIsExpanded() ? (
                                <ChevronDown size={16} className="text-gray-500" />
                            ) : (
                                <ChevronRight size={16} className="text-gray-500" />
                            )}
                        </button>
                    );
                },
            },
            {
                id: 'image',
                header: '',
                size: 50,
                cell: ({ row }) => (
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center flex-shrink-0">
                        {row.original.imageUrl ? (
                            <img
                                src={row.original.imageUrl}
                                alt={row.original.name}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <ImageIcon size={16} className="text-gray-300" />
                        )}
                    </div>
                ),
            },
            {
                accessorKey: 'name',
                header: 'Product',
                size: 200,
                cell: ({ row }) => (
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
                ),
            },
            {
                accessorKey: 'category',
                header: 'Category',
                size: 100,
                cell: ({ row }) => (
                    <Badge variant="secondary" className="capitalize text-xs">
                        {row.original.category || '-'}
                    </Badge>
                ),
            },
            {
                accessorKey: 'productType',
                header: 'Type',
                size: 80,
                cell: ({ row }) => (
                    <span className="capitalize text-sm text-muted-foreground">
                        {row.original.productType || '-'}
                    </span>
                ),
            },
            {
                accessorKey: 'gender',
                header: 'Gender',
                size: 70,
                cell: ({ row }) => (
                    <span className="capitalize text-sm text-muted-foreground">
                        {row.original.gender || '-'}
                    </span>
                ),
            },
            {
                accessorKey: 'fabricTypeName',
                header: 'Fabric Type',
                size: 100,
                cell: ({ row }) => (
                    <span className="text-sm">
                        {row.original.fabricTypeName || (
                            <span className="text-red-500 text-xs">Not set</span>
                        )}
                    </span>
                ),
            },
            {
                id: 'colorSwatches',
                header: 'Colors',
                size: 140,
                cell: ({ row }) => {
                    const variations = row.original.children || [];
                    if (variations.length === 0) return <span className="text-gray-400 text-xs">-</span>;

                    // Show variation thumbnails (max 5)
                    const visibleVariations = variations.slice(0, 5);
                    const remaining = variations.length - 5;

                    return (
                        <div className="flex items-center gap-1">
                            {visibleVariations.map((v) => (
                                <div
                                    key={v.id}
                                    className="w-6 h-6 rounded-md border border-gray-200 flex-shrink-0 overflow-hidden bg-gray-100"
                                    title={v.colorName || v.name}
                                >
                                    {v.imageUrl ? (
                                        <img
                                            src={v.imageUrl}
                                            alt={v.colorName || ''}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : v.colorHex ? (
                                        <div
                                            className="w-full h-full"
                                            style={{ backgroundColor: v.colorHex }}
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-[8px] text-gray-400">
                                            {(v.colorName || '?')[0]}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {remaining > 0 && (
                                <span className="text-xs text-gray-500 ml-0.5">+{remaining}</span>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'fabrics',
                header: 'Fabrics',
                size: 150,
                cell: ({ row }) => {
                    const variations = row.original.children || [];
                    if (variations.length === 0) return <span className="text-gray-400 text-xs">-</span>;

                    // Get unique fabric names
                    const fabrics = [...new Set(variations.map(v => v.fabricName).filter(Boolean))];
                    if (fabrics.length === 0) return <span className="text-red-500 text-xs">Not set</span>;

                    return (
                        <div className="flex flex-wrap gap-1">
                            {fabrics.slice(0, 2).map((fabric, i) => (
                                <Badge key={i} variant="outline" className="text-xs truncate max-w-[70px]">
                                    {fabric}
                                </Badge>
                            ))}
                            {fabrics.length > 2 && (
                                <span className="text-xs text-gray-500">+{fabrics.length - 2}</span>
                            )}
                        </div>
                    );
                },
            },
            {
                accessorKey: 'skuCount',
                header: 'SKUs',
                size: 70,
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
                accessorKey: 'avgMrp',
                header: 'Avg MRP',
                size: 90,
                cell: ({ row }) => (
                    <span className="tabular-nums text-sm">
                        {row.original.avgMrp ? `₹${Math.round(row.original.avgMrp).toLocaleString()}` : '-'}
                    </span>
                ),
            },
            {
                accessorKey: 'totalStock',
                header: 'Stock',
                size: 80,
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
                size: 110,
                cell: ({ row }) => {
                    const stock = row.original.totalStock || 0;
                    const skuCount = row.original.skuCount || 0;

                    if (stock === 0) {
                        return (
                            <Badge variant="destructive" className="gap-1 text-xs">
                                <XCircle size={10} />
                                Out
                            </Badge>
                        );
                    }
                    if (skuCount > 0 && stock < skuCount * 5) {
                        return (
                            <Badge variant="warning" className="gap-1 text-xs">
                                <AlertTriangle size={10} />
                                Low
                            </Badge>
                        );
                    }
                    return (
                        <Badge variant="success" className="gap-1 text-xs">
                            <CheckCircle size={10} />
                            OK
                        </Badge>
                    );
                },
            },
            {
                id: 'actions',
                header: '',
                size: 100,
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
                            <Eye size={14} />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onEditProduct?.(row.original);
                            }}
                            className="p-1.5 rounded hover:bg-blue-100 text-blue-500 hover:text-blue-700"
                            title="Edit Product"
                        >
                            <Edit size={14} />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onEditBom?.(row.original);
                            }}
                            className="p-1.5 rounded hover:bg-purple-100 text-purple-500 hover:text-purple-700"
                            title="Edit BOM"
                        >
                            <GitBranch size={14} />
                        </button>
                    </div>
                ),
            },
        ],
        [onViewProduct, onEditBom, onEditProduct]
    );

    const table = useReactTable({
        data: products,
        columns,
        state: { expanded, pagination },
        onExpandedChange: setExpanded,
        onPaginationChange: setPagination,
        getCoreRowModel: getCoreRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getRowCanExpand: (row) => !!row.original.children?.length,
    });

    return (
        <div className="flex flex-col h-full">
            {/* Summary Stats */}
            {summary && (
                <div className="flex items-center gap-4 px-1 flex-wrap mb-4 flex-shrink-0">
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

            {/* Table with sticky header */}
            <div className="rounded-md border overflow-hidden flex-1 min-h-0 flex flex-col">
                <div className="overflow-auto flex-1">
                    <Table className="relative">
                        <TableHeader className="sticky top-0 z-20 bg-gray-50 shadow-sm">
                            {table.getHeaderGroups().map((headerGroup) => (
                                <TableRow key={headerGroup.id} className="border-b hover:bg-gray-50">
                                    {headerGroup.headers.map((header) => (
                                        <TableHead
                                            key={header.id}
                                            style={{ width: header.column.getSize() }}
                                            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap bg-gray-50"
                                        >
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(header.column.columnDef.header, header.getContext())}
                                        </TableHead>
                                    ))}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={columns.length} className="h-24 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                            <span className="text-muted-foreground">Loading products...</span>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : table.getRowModel().rows?.length ? (
                                table.getRowModel().rows.map((row) => (
                                    <Fragment key={row.id}>
                                        {/* Product Row */}
                                        <TableRow
                                            className="cursor-pointer hover:bg-gray-50"
                                            onClick={() => row.toggleExpanded()}
                                        >
                                            {row.getVisibleCells().map((cell) => (
                                                <TableCell key={cell.id} className="py-2">
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </TableCell>
                                            ))}
                                        </TableRow>

                                        {/* Expanded Variations */}
                                        {row.getIsExpanded() && row.original.children && (
                                            <TableRow className="bg-gray-50/50">
                                                <TableCell colSpan={columns.length} className="p-0">
                                                    <div className="py-3 px-4 ml-10">
                                                        <VariationsTable
                                                            variations={row.original.children}
                                                            onViewVariation={onViewProduct}
                                                            onEditBom={onEditBom}
                                                            onEditVariation={onEditProduct}
                                                        />
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </Fragment>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                                        No products found.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {/* Pagination Controls - Always visible at bottom */}
            {products.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border rounded-md bg-gray-50/50 mt-4 flex-shrink-0">
                    <div className="text-sm text-muted-foreground">
                        Showing {Math.min(pagination.pageIndex * PAGE_SIZE + 1, products.length)} to{' '}
                        {Math.min((pagination.pageIndex + 1) * PAGE_SIZE, products.length)} of{' '}
                        {products.length} products
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => table.previousPage()}
                            disabled={!table.getCanPreviousPage()}
                            className="gap-1"
                        >
                            <ChevronLeft size={16} />
                            Previous
                        </Button>
                        <div className="flex items-center gap-1 text-sm">
                            <span className="text-muted-foreground">Page</span>
                            <span className="font-medium">{pagination.pageIndex + 1}</span>
                            <span className="text-muted-foreground">of</span>
                            <span className="font-medium">{Math.max(1, table.getPageCount())}</span>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => table.nextPage()}
                            disabled={!table.getCanNextPage()}
                            className="gap-1"
                        >
                            Next
                            <ChevronRight size={16} />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Nested Variations Table
 */
interface VariationsTableProps {
    variations: ProductTreeNode[];
    onViewVariation?: (variation: ProductTreeNode) => void;
    onEditBom?: (variation: ProductTreeNode) => void;
    onEditVariation?: (variation: ProductTreeNode) => void;
}

function VariationsTable({ variations, onViewVariation, onEditBom, onEditVariation }: VariationsTableProps) {
    const [expandedVariations, setExpandedVariations] = useState<Record<string, boolean>>({});

    const toggleVariation = (id: string) => {
        setExpandedVariations(prev => ({ ...prev, [id]: !prev[id] }));
    };

    return (
        <div className="border rounded-lg bg-white overflow-hidden shadow-sm">
            <table className="w-full text-sm">
                <thead className="bg-purple-50/70 border-b">
                    <tr>
                        <th className="w-8 px-2 py-2"></th>
                        <th className="w-10 px-2 py-2"></th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-purple-700 uppercase">Color</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-purple-700 uppercase">Fabric</th>
                        <th className="text-center px-3 py-2 text-xs font-semibold text-purple-700 uppercase">Lining</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-purple-700 uppercase">SKUs</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-purple-700 uppercase">Avg MRP</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-purple-700 uppercase">Stock</th>
                        <th className="text-center px-3 py-2 text-xs font-semibold text-purple-700 uppercase">Status</th>
                        <th className="w-16 px-2 py-2"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {variations.map((variation) => (
                        <Fragment key={variation.id}>
                            <tr
                                className="hover:bg-purple-50/30 cursor-pointer"
                                onClick={() => toggleVariation(variation.id)}
                            >
                                <td className="px-2 py-2">
                                    {variation.children?.length ? (
                                        <button className="p-0.5 rounded hover:bg-purple-100">
                                            {expandedVariations[variation.id] ? (
                                                <ChevronDown size={14} className="text-purple-500" />
                                            ) : (
                                                <ChevronRight size={14} className="text-purple-500" />
                                            )}
                                        </button>
                                    ) : null}
                                </td>
                                <td className="px-2 py-2">
                                    <div className="w-8 h-8 rounded overflow-hidden bg-gray-100 flex items-center justify-center">
                                        {variation.imageUrl ? (
                                            <img
                                                src={variation.imageUrl}
                                                alt={variation.colorName}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : variation.colorHex ? (
                                            <span
                                                className="w-full h-full"
                                                style={{ backgroundColor: variation.colorHex }}
                                            />
                                        ) : (
                                            <ImageIcon size={12} className="text-gray-300" />
                                        )}
                                    </div>
                                </td>
                                <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        {variation.colorHex && (
                                            <span
                                                className="w-3 h-3 rounded-full border border-gray-200 flex-shrink-0"
                                                style={{ backgroundColor: variation.colorHex }}
                                            />
                                        )}
                                        <span className="font-medium text-gray-900">
                                            {variation.colorName || variation.name}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-3 py-2 text-gray-600">
                                    {variation.fabricName || <span className="text-red-500 text-xs">Not set</span>}
                                </td>
                                <td className="px-3 py-2 text-center">
                                    {variation.hasLining ? (
                                        <Badge variant="success" className="text-xs">Yes</Badge>
                                    ) : (
                                        <span className="text-gray-400 text-xs">No</span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums font-medium">
                                    {variation.children?.length || 0}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                    {variation.avgMrp ? `₹${Math.round(variation.avgMrp).toLocaleString()}` : '-'}
                                </td>
                                <td className="px-3 py-2 text-right">
                                    <span className={`tabular-nums font-semibold ${
                                        (variation.totalStock || 0) === 0 ? 'text-red-600' :
                                        (variation.totalStock || 0) < 5 ? 'text-amber-600' : 'text-green-600'
                                    }`}>
                                        {(variation.totalStock || 0).toLocaleString()}
                                    </span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                    {(variation.totalStock || 0) === 0 ? (
                                        <Badge variant="destructive" className="text-xs">Out</Badge>
                                    ) : (variation.totalStock || 0) < 5 ? (
                                        <Badge variant="warning" className="text-xs">Low</Badge>
                                    ) : (
                                        <Badge variant="success" className="text-xs">OK</Badge>
                                    )}
                                </td>
                                <td className="px-2 py-2">
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onViewVariation?.(variation);
                                            }}
                                            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                                            title="View"
                                        >
                                            <Eye size={14} />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onEditVariation?.(variation);
                                            }}
                                            className="p-1 rounded hover:bg-blue-100 text-blue-500 hover:text-blue-700"
                                            title="Edit Variation"
                                        >
                                            <Edit size={14} />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onEditBom?.(variation);
                                            }}
                                            className="p-1 rounded hover:bg-purple-100 text-purple-500 hover:text-purple-700"
                                            title="Edit BOM"
                                        >
                                            <GitBranch size={14} />
                                        </button>
                                    </div>
                                </td>
                            </tr>

                            {/* Expanded SKUs */}
                            {expandedVariations[variation.id] && variation.children && (
                                <tr>
                                    <td colSpan={10} className="p-0 bg-blue-50/30">
                                        <div className="py-2 px-4 ml-8">
                                            <SkusTable skus={variation.children} />
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/**
 * Nested SKUs Table
 */
interface SkusTableProps {
    skus: ProductTreeNode[];
}

function SkusTable({ skus }: SkusTableProps) {
    // Sort SKUs by size order
    const sortedSkus = useMemo(() => {
        return [...skus].sort((a, b) => sortBySizeOrder(a.size || '', b.size || ''));
    }, [skus]);

    return (
        <div className="border rounded-lg bg-white overflow-hidden shadow-sm">
            <table className="w-full text-sm">
                <thead className="bg-blue-50/70 border-b">
                    <tr>
                        <th className="text-left px-3 py-1.5 text-xs font-semibold text-blue-700 uppercase w-16">Size</th>
                        <th className="text-left px-3 py-1.5 text-xs font-semibold text-blue-700 uppercase">SKU Code</th>
                        <th className="text-right px-3 py-1.5 text-xs font-semibold text-blue-700 uppercase w-24">MRP</th>
                        <th className="text-right px-3 py-1.5 text-xs font-semibold text-blue-700 uppercase w-20">Stock</th>
                        <th className="text-center px-3 py-1.5 text-xs font-semibold text-blue-700 uppercase w-20">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {sortedSkus.map((sku) => (
                        <tr key={sku.id} className="hover:bg-blue-50/30">
                            <td className="px-3 py-1.5 font-semibold text-gray-900">
                                {sku.size}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-xs text-gray-600">
                                {sku.skuCode}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                                {sku.mrp ? `₹${sku.mrp.toLocaleString()}` : '-'}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                                <span className={`tabular-nums font-semibold ${
                                    (sku.currentBalance || 0) === 0 ? 'text-red-600' :
                                    (sku.currentBalance || 0) < 3 ? 'text-amber-600' : 'text-green-600'
                                }`}>
                                    {(sku.currentBalance || 0).toLocaleString()}
                                </span>
                            </td>
                            <td className="px-3 py-1.5 text-center">
                                {(sku.currentBalance || 0) === 0 ? (
                                    <Badge variant="destructive" className="text-xs">Out</Badge>
                                ) : (sku.currentBalance || 0) < 3 ? (
                                    <Badge variant="warning" className="text-xs">Low</Badge>
                                ) : (
                                    <Badge variant="success" className="text-xs">OK</Badge>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
