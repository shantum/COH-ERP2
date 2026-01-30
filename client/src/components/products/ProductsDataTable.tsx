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
import { getOptimizedImageUrl } from '../../utils/imageOptimization';

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
                p.materialName?.toLowerCase().includes(query) ||
                p.children?.some(v =>
                    v.colorName?.toLowerCase().includes(query) ||
                    v.fabricName?.toLowerCase().includes(query) ||
                    v.materialName?.toLowerCase().includes(query)
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
                size: 28,
                cell: ({ row }) => {
                    if (!row.original.children?.length) return null;
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                row.toggleExpanded();
                            }}
                            className="p-0.5 rounded hover:bg-gray-100"
                        >
                            {row.getIsExpanded() ? (
                                <ChevronDown size={14} className="text-gray-500" />
                            ) : (
                                <ChevronRight size={14} className="text-gray-500" />
                            )}
                        </button>
                    );
                },
            },
            {
                id: 'image',
                header: '',
                size: 40,
                cell: ({ row }) => (
                    <div className="w-7 h-7 rounded overflow-hidden bg-gray-100 flex items-center justify-center flex-shrink-0">
                        {row.original.imageUrl ? (
                            <img
                                src={getOptimizedImageUrl(row.original.imageUrl, 'xs') || row.original.imageUrl}
                                alt={row.original.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                        ) : (
                            <ImageIcon size={12} className="text-gray-300" />
                        )}
                    </div>
                ),
            },
            {
                accessorKey: 'name',
                header: 'Product',
                size: 220,
                cell: ({ row }) => (
                    <div className="min-w-0 overflow-hidden">
                        <div className="text-xs font-medium text-gray-900 truncate" title={row.original.name}>
                            {row.original.name}
                        </div>
                        {row.original.styleCode && (
                            <div className="text-[10px] text-gray-400 font-mono truncate">
                                {row.original.styleCode}
                            </div>
                        )}
                    </div>
                ),
            },
            {
                accessorKey: 'category',
                header: 'Category',
                size: 70,
                cell: ({ row }) => (
                    <span className="text-[11px] text-gray-600 capitalize truncate block">
                        {row.original.category || '-'}
                    </span>
                ),
            },
            {
                accessorKey: 'productType',
                header: 'Type',
                size: 50,
                cell: ({ row }) => (
                    <span className="capitalize text-[11px] text-gray-500 truncate block">
                        {row.original.productType || '-'}
                    </span>
                ),
            },
            {
                accessorKey: 'gender',
                header: 'Gender',
                size: 55,
                cell: ({ row }) => (
                    <span className="capitalize text-[11px] text-gray-500 truncate block">
                        {row.original.gender || '-'}
                    </span>
                ),
            },
            {
                id: 'colorSwatches',
                header: 'Colors',
                size: 100,
                cell: ({ row }) => {
                    const variations = row.original.children || [];
                    if (variations.length === 0) return <span className="text-gray-400 text-[10px]">-</span>;

                    // Show variation thumbnails (max 4)
                    const visibleVariations = variations.slice(0, 4);
                    const remaining = variations.length - 4;

                    return (
                        <div className="flex items-center gap-0.5">
                            {visibleVariations.map((v) => (
                                <div
                                    key={v.id}
                                    className="w-5 h-5 rounded border border-gray-200 flex-shrink-0 overflow-hidden bg-gray-100"
                                    title={v.colorName || v.name}
                                >
                                    {v.imageUrl ? (
                                        <img
                                            src={getOptimizedImageUrl(v.imageUrl, 'xs') || v.imageUrl}
                                            alt={v.colorName || ''}
                                            className="w-full h-full object-cover"
                                            loading="lazy"
                                        />
                                    ) : v.colorHex ? (
                                        <div
                                            className="w-full h-full"
                                            style={{ backgroundColor: v.colorHex }}
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-[7px] text-gray-400">
                                            {(v.colorName || '?')[0]}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {remaining > 0 && (
                                <span className="text-[10px] text-gray-500 ml-0.5">+{remaining}</span>
                            )}
                        </div>
                    );
                },
            },
            {
                accessorKey: 'materialName',
                header: 'Material',
                size: 70,
                cell: ({ row }) => (
                    <span className="text-[11px] truncate block">
                        {row.original.materialName || (
                            <span className="bg-amber-50 text-amber-600 text-[10px] px-1.5 py-0.5 rounded">
                                Not set
                            </span>
                        )}
                    </span>
                ),
            },
            {
                id: 'fabrics',
                header: 'Fabrics',
                size: 100,
                cell: ({ row }) => {
                    const variations = row.original.children || [];
                    if (variations.length === 0) return <span className="text-gray-400 text-[10px]">-</span>;

                    // Get unique fabric names
                    const fabrics = [...new Set(variations.map(v => v.fabricName).filter(Boolean))];
                    if (fabrics.length === 0) return <span className="text-amber-50 text-amber-600 text-[10px] px-1.5 py-0.5 rounded">Not set</span>;

                    return (
                        <div className="flex items-center gap-0.5 overflow-hidden">
                            <span className="text-[10px] text-gray-600 truncate bg-gray-100 px-1 py-0.5 rounded">
                                {fabrics[0]}
                            </span>
                            {fabrics.length > 1 && (
                                <span className="text-[10px] text-gray-500 shrink-0">+{fabrics.length - 1}</span>
                            )}
                        </div>
                    );
                },
            },
            {
                accessorKey: 'skuCount',
                header: 'SKUs',
                size: 50,
                cell: ({ row }) => (
                    <div className="flex items-center gap-1">
                        <Box size={11} className="text-blue-500" />
                        <span className="text-xs font-medium tabular-nums">
                            {row.original.skuCount || 0}
                        </span>
                    </div>
                ),
            },
            {
                accessorKey: 'avgMrp',
                header: 'Avg MRP',
                size: 70,
                cell: ({ row }) => (
                    <span className="tabular-nums text-xs">
                        {row.original.avgMrp ? `₹${Math.round(row.original.avgMrp).toLocaleString()}` : '-'}
                    </span>
                ),
            },
            {
                accessorKey: 'totalStock',
                header: 'Stock',
                size: 50,
                cell: ({ row }) => {
                    const stock = row.original.totalStock || 0;
                    return (
                        <span
                            className={`text-xs font-semibold tabular-nums ${
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
                size: 55,
                cell: ({ row }) => {
                    const stock = row.original.totalStock || 0;
                    const skuCount = row.original.skuCount || 0;

                    if (stock === 0) {
                        return (
                            <Badge variant="destructive" className="gap-0.5 text-[10px] px-1.5 py-0 h-5">
                                <XCircle size={9} />
                                Out
                            </Badge>
                        );
                    }
                    if (skuCount > 0 && stock < skuCount * 5) {
                        return (
                            <Badge variant="warning" className="gap-0.5 text-[10px] px-1.5 py-0 h-5">
                                <AlertTriangle size={9} />
                                Low
                            </Badge>
                        );
                    }
                    return (
                        <Badge variant="success" className="gap-0.5 text-[10px] px-1.5 py-0 h-5">
                            <CheckCircle size={9} />
                            OK
                        </Badge>
                    );
                },
            },
            {
                id: 'actions',
                header: '',
                size: 75,
                cell: ({ row }) => (
                    <div className="flex items-center gap-0.5">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onViewProduct?.(row.original);
                            }}
                            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                            title="View Details"
                        >
                            <Eye size={13} />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onEditProduct?.(row.original);
                            }}
                            className="p-1 rounded hover:bg-blue-100 text-blue-500 hover:text-blue-700"
                            title="Edit Product"
                        >
                            <Edit size={13} />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onEditBom?.(row.original);
                            }}
                            className="p-1 rounded hover:bg-purple-100 text-purple-500 hover:text-purple-700"
                            title="Edit BOM"
                        >
                            <GitBranch size={13} />
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
                <div className="flex items-center gap-3 px-1 flex-wrap mb-2 flex-shrink-0">
                    <div className="flex items-center gap-1.5 text-xs">
                        <Package size={13} className="text-gray-400" />
                        <span className="text-gray-600">{summary.products} Products</span>
                    </div>
                    <div className="w-px h-3 bg-gray-200" />
                    <div className="flex items-center gap-1.5 text-xs">
                        <Layers size={13} className="text-purple-400" />
                        <span className="text-gray-600">{summary.variations} Colors</span>
                    </div>
                    <div className="w-px h-3 bg-gray-200" />
                    <div className="flex items-center gap-1.5 text-xs">
                        <Box size={13} className="text-blue-400" />
                        <span className="text-gray-600">{summary.skus} SKUs</span>
                    </div>
                    <div className="w-px h-3 bg-gray-200" />
                    <div className="flex items-center gap-1.5 text-xs">
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
                                            className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap bg-gray-50 py-1.5 px-2 h-7"
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
                                    <TableCell colSpan={columns.length} className="h-16 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                            <span className="text-muted-foreground text-xs">Loading products...</span>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : table.getRowModel().rows?.length ? (
                                table.getRowModel().rows.map((row) => (
                                    <Fragment key={row.id}>
                                        {/* Product Row */}
                                        <TableRow
                                            className="cursor-pointer hover:bg-gray-50 h-9"
                                            onClick={() => row.toggleExpanded()}
                                        >
                                            {row.getVisibleCells().map((cell) => (
                                                <TableCell key={cell.id} className="py-1 px-2 overflow-hidden">
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </TableCell>
                                            ))}
                                        </TableRow>

                                        {/* Expanded Variations */}
                                        {row.getIsExpanded() && row.original.children && (
                                            <TableRow className="bg-gray-50/50">
                                                <TableCell colSpan={columns.length} className="p-0">
                                                    <div className="py-1.5 px-2 ml-8">
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
                <div className="flex items-center justify-between px-3 py-2 border rounded bg-gray-50/50 mt-2 flex-shrink-0">
                    <div className="text-xs text-muted-foreground">
                        Showing {Math.min(pagination.pageIndex * PAGE_SIZE + 1, products.length)} to{' '}
                        {Math.min((pagination.pageIndex + 1) * PAGE_SIZE, products.length)} of{' '}
                        {products.length} products
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => table.previousPage()}
                            disabled={!table.getCanPreviousPage()}
                            className="gap-0.5 h-7 px-2 text-xs"
                        >
                            <ChevronLeft size={14} />
                            Previous
                        </Button>
                        <div className="flex items-center gap-1 text-xs">
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
                            className="gap-0.5 h-7 px-2 text-xs"
                        >
                            Next
                            <ChevronRight size={14} />
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
        <div className="border rounded bg-white overflow-hidden shadow-sm">
            <table className="w-full text-xs">
                <thead className="bg-purple-50/70 border-b">
                    <tr>
                        <th className="w-6 px-1 py-1"></th>
                        <th className="w-7 px-1 py-1"></th>
                        <th className="text-left px-2 py-1 text-[10px] font-semibold text-purple-700 uppercase">Color</th>
                        <th className="text-left px-2 py-1 text-[10px] font-semibold text-purple-700 uppercase">Fabric</th>
                        <th className="text-center px-2 py-1 text-[10px] font-semibold text-purple-700 uppercase">Lining</th>
                        <th className="text-right px-2 py-1 text-[10px] font-semibold text-purple-700 uppercase">SKUs</th>
                        <th className="text-right px-2 py-1 text-[10px] font-semibold text-purple-700 uppercase">Avg MRP</th>
                        <th className="text-right px-2 py-1 text-[10px] font-semibold text-purple-700 uppercase">Stock</th>
                        <th className="text-center px-2 py-1 text-[10px] font-semibold text-purple-700 uppercase">Status</th>
                        <th className="w-14 px-1 py-1"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {variations.map((variation) => (
                        <Fragment key={variation.id}>
                            <tr
                                className="hover:bg-purple-50/30 cursor-pointer h-8"
                                onClick={() => toggleVariation(variation.id)}
                            >
                                <td className="px-1 py-1">
                                    {variation.children?.length ? (
                                        <button className="p-0.5 rounded hover:bg-purple-100">
                                            {expandedVariations[variation.id] ? (
                                                <ChevronDown size={12} className="text-purple-500" />
                                            ) : (
                                                <ChevronRight size={12} className="text-purple-500" />
                                            )}
                                        </button>
                                    ) : null}
                                </td>
                                <td className="px-1 py-1">
                                    <div className="w-6 h-6 rounded overflow-hidden bg-gray-100 flex items-center justify-center">
                                        {variation.imageUrl ? (
                                            <img
                                                src={getOptimizedImageUrl(variation.imageUrl, 'xs') || variation.imageUrl}
                                                alt={variation.colorName}
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                            />
                                        ) : variation.colorHex ? (
                                            <span
                                                className="w-full h-full"
                                                style={{ backgroundColor: variation.colorHex }}
                                            />
                                        ) : (
                                            <ImageIcon size={10} className="text-gray-300" />
                                        )}
                                    </div>
                                </td>
                                <td className="px-2 py-1 overflow-hidden">
                                    <div className="flex items-center gap-1.5">
                                        {variation.colorHex && (
                                            <span
                                                className="w-2.5 h-2.5 rounded-full border border-gray-200 flex-shrink-0"
                                                style={{ backgroundColor: variation.colorHex }}
                                            />
                                        )}
                                        <span className="font-medium text-gray-900 text-xs truncate">
                                            {variation.colorName || variation.name}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-2 py-1 text-gray-600 text-xs overflow-hidden">
                                    <span className="truncate block">{variation.fabricName || <span className="text-red-500 text-[10px]">Not set</span>}</span>
                                </td>
                                <td className="px-2 py-1 text-center">
                                    {variation.hasLining ? (
                                        <Badge variant="success" className="text-[10px] px-1 py-0 h-4">Yes</Badge>
                                    ) : (
                                        <span className="text-gray-400 text-[10px]">No</span>
                                    )}
                                </td>
                                <td className="px-2 py-1 text-right tabular-nums font-medium">
                                    {variation.children?.length || 0}
                                </td>
                                <td className="px-2 py-1 text-right tabular-nums">
                                    {variation.avgMrp ? `₹${Math.round(variation.avgMrp).toLocaleString()}` : '-'}
                                </td>
                                <td className="px-2 py-1 text-right">
                                    <span className={`tabular-nums font-semibold ${
                                        (variation.totalStock || 0) === 0 ? 'text-red-600' :
                                        (variation.totalStock || 0) < 5 ? 'text-amber-600' : 'text-green-600'
                                    }`}>
                                        {(variation.totalStock || 0).toLocaleString()}
                                    </span>
                                </td>
                                <td className="px-2 py-1 text-center">
                                    {(variation.totalStock || 0) === 0 ? (
                                        <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">Out</Badge>
                                    ) : (variation.totalStock || 0) < 5 ? (
                                        <Badge variant="warning" className="text-[10px] px-1 py-0 h-4">Low</Badge>
                                    ) : (
                                        <Badge variant="success" className="text-[10px] px-1 py-0 h-4">OK</Badge>
                                    )}
                                </td>
                                <td className="px-1 py-1">
                                    <div className="flex items-center gap-0.5">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onViewVariation?.(variation);
                                            }}
                                            className="p-0.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                                            title="View"
                                        >
                                            <Eye size={12} />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onEditVariation?.(variation);
                                            }}
                                            className="p-0.5 rounded hover:bg-blue-100 text-blue-500 hover:text-blue-700"
                                            title="Edit Variation"
                                        >
                                            <Edit size={12} />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onEditBom?.(variation);
                                            }}
                                            className="p-0.5 rounded hover:bg-purple-100 text-purple-500 hover:text-purple-700"
                                            title="Edit BOM"
                                        >
                                            <GitBranch size={12} />
                                        </button>
                                    </div>
                                </td>
                            </tr>

                            {/* Expanded SKUs */}
                            {expandedVariations[variation.id] && variation.children && (
                                <tr>
                                    <td colSpan={10} className="p-0 bg-blue-50/30">
                                        <div className="py-1 px-2 ml-6">
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
        <div className="border rounded bg-white overflow-hidden shadow-sm">
            <table className="w-full text-xs">
                <thead className="bg-blue-50/70 border-b">
                    <tr>
                        <th className="text-left px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase w-12">Size</th>
                        <th className="text-left px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase">SKU Code</th>
                        <th className="text-right px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase w-16">MRP</th>
                        <th className="text-right px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase w-14">Stock</th>
                        <th className="text-center px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase w-14">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {sortedSkus.map((sku) => (
                        <tr key={sku.id} className="hover:bg-blue-50/30">
                            <td className="px-2 py-0.5 font-semibold text-gray-900">
                                {sku.size}
                            </td>
                            <td className="px-2 py-0.5 font-mono text-[11px] text-gray-600">
                                {sku.skuCode}
                            </td>
                            <td className="px-2 py-0.5 text-right tabular-nums font-medium">
                                {sku.mrp ? `₹${sku.mrp.toLocaleString()}` : '-'}
                            </td>
                            <td className="px-2 py-0.5 text-right">
                                <span className={`tabular-nums font-semibold ${
                                    (sku.currentBalance || 0) === 0 ? 'text-red-600' :
                                    (sku.currentBalance || 0) < 3 ? 'text-amber-600' : 'text-green-600'
                                }`}>
                                    {(sku.currentBalance || 0).toLocaleString()}
                                </span>
                            </td>
                            <td className="px-2 py-0.5 text-center">
                                {(sku.currentBalance || 0) === 0 ? (
                                    <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">Out</Badge>
                                ) : (sku.currentBalance || 0) < 3 ? (
                                    <Badge variant="warning" className="text-[10px] px-1 py-0 h-4">Low</Badge>
                                ) : (
                                    <Badge variant="success" className="text-[10px] px-1 py-0 h-4">OK</Badge>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
