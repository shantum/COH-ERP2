/**
 * SkuFlatView - Flat table of all SKUs with filtering
 *
 * Shows all SKUs in a single flat table with columns for:
 * - SKU code, barcode, size
 * - Parent product and variation info
 * - Stock levels, MRP
 * - Quick actions
 *
 * Supports filtering by gender, material type, fabric, etc.
 */

import { useMemo } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    flexRender,
    type ColumnDef,
    type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { ArrowUpDown, Package, Eye, GitBranch, ImageIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ProductTreeNode } from './types';

interface FlatSku {
    id: string;
    skuCode: string;
    barcode?: string;
    size: string;
    productId: string;
    productName: string;
    productStyleCode?: string;
    variationId: string;
    variationName: string;
    colorName?: string;
    colorHex?: string;
    fabricName?: string;
    gender?: string;
    category?: string;
    fabricTypeName?: string;
    imageUrl?: string;
    mrp?: number;
    currentBalance?: number;
    availableBalance?: number;
    // Keep original nodes for actions
    productNode?: ProductTreeNode;
    variationNode?: ProductTreeNode;
    skuNode: ProductTreeNode;
}

interface SkuFlatViewProps {
    products: ProductTreeNode[];
    searchQuery?: string;
    onViewProduct?: (product: ProductTreeNode) => void;
    onEditBom?: (product: ProductTreeNode) => void;
}

export function SkuFlatView({
    products,
    searchQuery,
    onViewProduct,
    onEditBom,
}: SkuFlatViewProps) {
    const [sorting, setSorting] = useState<SortingState>([]);

    // Flatten tree to get all SKUs with parent context
    const flatSkus = useMemo(() => {
        const skus: FlatSku[] = [];

        products.forEach(product => {
            product.children?.forEach(variation => {
                variation.children?.forEach(sku => {
                    skus.push({
                        id: sku.id,
                        skuCode: sku.skuCode || sku.name,
                        barcode: sku.barcode,
                        size: sku.size || '-',
                        productId: product.id,
                        productName: product.name,
                        productStyleCode: product.styleCode,
                        variationId: variation.id,
                        variationName: variation.name,
                        colorName: variation.colorName,
                        colorHex: variation.colorHex,
                        fabricName: variation.fabricName,
                        gender: product.gender,
                        category: product.category,
                        fabricTypeName: product.fabricTypeName,
                        imageUrl: product.imageUrl,
                        mrp: sku.mrp,
                        currentBalance: sku.currentBalance,
                        availableBalance: sku.availableBalance,
                        productNode: product,
                        variationNode: variation,
                        skuNode: sku,
                    });
                });
            });
        });

        return skus;
    }, [products]);

    // Filter by search query
    const filteredSkus = useMemo(() => {
        if (!searchQuery) return flatSkus;

        const query = searchQuery.toLowerCase();
        return flatSkus.filter(sku =>
            sku.skuCode.toLowerCase().includes(query) ||
            sku.productName.toLowerCase().includes(query) ||
            sku.variationName.toLowerCase().includes(query) ||
            sku.barcode?.toLowerCase().includes(query) ||
            sku.colorName?.toLowerCase().includes(query) ||
            sku.fabricName?.toLowerCase().includes(query)
        );
    }, [flatSkus, searchQuery]);

    const columns: ColumnDef<FlatSku>[] = useMemo(() => [
        {
            id: 'image',
            header: '',
            size: 48,
            cell: ({ row }) => (
                <div className="w-10 h-10 rounded bg-gray-100 overflow-hidden flex-shrink-0">
                    {row.original.imageUrl ? (
                        <img
                            src={row.original.imageUrl}
                            alt=""
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon size={16} className="text-gray-300" />
                        </div>
                    )}
                </div>
            ),
        },
        {
            accessorKey: 'skuCode',
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8"
                    onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                >
                    SKU Code
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => (
                <div>
                    <span className="font-mono text-sm font-medium">{row.original.skuCode}</span>
                    {row.original.barcode && (
                        <p className="text-xs text-muted-foreground font-mono">{row.original.barcode}</p>
                    )}
                </div>
            ),
        },
        {
            accessorKey: 'size',
            header: 'Size',
            size: 70,
            cell: ({ row }) => (
                <Badge variant="outline" className="font-medium">
                    {row.original.size}
                </Badge>
            ),
        },
        {
            accessorKey: 'productName',
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8"
                    onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                >
                    Product
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => (
                <div>
                    <span className="font-medium">{row.original.productName}</span>
                    {row.original.productStyleCode && (
                        <p className="text-xs text-muted-foreground">{row.original.productStyleCode}</p>
                    )}
                </div>
            ),
        },
        {
            accessorKey: 'variationName',
            header: 'Variation',
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    {row.original.colorHex && (
                        <div
                            className="w-4 h-4 rounded-full border border-gray-200"
                            style={{ backgroundColor: row.original.colorHex }}
                        />
                    )}
                    <div>
                        <span className="text-sm">{row.original.colorName || row.original.variationName}</span>
                        {row.original.fabricName && (
                            <p className="text-xs text-muted-foreground">{row.original.fabricName}</p>
                        )}
                    </div>
                </div>
            ),
        },
        {
            accessorKey: 'gender',
            header: 'Gender',
            size: 80,
            cell: ({ row }) => (
                <span className="text-sm text-muted-foreground">
                    {row.original.gender || '-'}
                </span>
            ),
        },
        {
            accessorKey: 'category',
            header: 'Category',
            size: 100,
            cell: ({ row }) => (
                <span className="text-sm text-muted-foreground">
                    {row.original.category || '-'}
                </span>
            ),
        },
        {
            accessorKey: 'fabricTypeName',
            header: 'Fabric Type',
            size: 120,
            cell: ({ row }) => (
                <span className="text-sm text-muted-foreground">
                    {row.original.fabricTypeName || '-'}
                </span>
            ),
        },
        {
            accessorKey: 'mrp',
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8"
                    onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                >
                    MRP
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            size: 100,
            cell: ({ row }) => (
                <span className="font-medium tabular-nums">
                    {row.original.mrp ? `₹${row.original.mrp.toLocaleString()}` : '-'}
                </span>
            ),
        },
        {
            accessorKey: 'currentBalance',
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8"
                    onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                >
                    Stock
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            size: 90,
            cell: ({ row }) => {
                const stock = row.original.currentBalance ?? 0;
                return (
                    <span className={`font-semibold tabular-nums ${
                        stock === 0 ? 'text-red-600' :
                        stock < 10 ? 'text-amber-600' : 'text-green-600'
                    }`}>
                        {stock}
                    </span>
                );
            },
        },
        {
            id: 'actions',
            size: 80,
            cell: ({ row }) => (
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => row.original.productNode && onViewProduct?.(row.original.productNode)}
                        title="View Product"
                    >
                        <Eye size={16} />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-purple-600"
                        onClick={() => row.original.variationNode && onEditBom?.(row.original.variationNode)}
                        title="Edit BOM"
                    >
                        <GitBranch size={16} />
                    </Button>
                </div>
            ),
        },
    ], [onViewProduct, onEditBom]);

    const table = useReactTable({
        data: filteredSkus,
        columns,
        state: { sorting },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
    });

    if (filteredSkus.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Package size={48} className="mb-4 opacity-20" />
                <p>No SKUs match the current filters</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Summary */}
            <div className="flex items-center justify-between mb-3 text-sm text-muted-foreground">
                <span>{filteredSkus.length.toLocaleString()} SKUs</span>
                <span>
                    Total Stock: {filteredSkus.reduce((sum, s) => sum + (s.currentBalance || 0), 0).toLocaleString()}
                </span>
            </div>

            {/* Table */}
            <ScrollArea className="flex-1 border rounded-lg">
                <Table>
                    <TableHeader className="sticky top-0 bg-gray-50/95 backdrop-blur z-10">
                        {table.getHeaderGroups().map(headerGroup => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map(header => (
                                    <TableHead
                                        key={header.id}
                                        style={{ width: header.getSize() }}
                                        className="whitespace-nowrap"
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
                        {table.getRowModel().rows.map(row => (
                            <TableRow
                                key={row.id}
                                className="hover:bg-gray-50/50"
                            >
                                {row.getVisibleCells().map(cell => (
                                    <TableCell
                                        key={cell.id}
                                        style={{ width: cell.column.getSize() }}
                                    >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ScrollArea>
        </div>
    );
}
