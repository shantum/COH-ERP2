/**
 * SkuFlatView - Flat table of all SKUs with filtering
 *
 * Shows all SKUs in a single flat table with columns for:
 * - SKU code, barcode, size
 * - Parent product and variation info
 * - Stock levels, MRP
 * - Quick actions
 *
 * Features:
 * - Filtering by gender, material type, fabric
 * - Column sorting
 * - Drag-and-drop column reordering
 */

import { useMemo, useState } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    flexRender,
    type ColumnDef,
    type SortingState,
    type ColumnOrderState,
    type PaginationState,
    type Header,
} from '@tanstack/react-table';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    horizontalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { ArrowUpDown, Package, Eye, GitBranch, ImageIcon, GripVertical, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Edit } from 'lucide-react';

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
    productNode?: ProductTreeNode;
    variationNode?: ProductTreeNode;
    skuNode: ProductTreeNode;
}

interface SkuFlatViewProps {
    products: ProductTreeNode[];
    searchQuery?: string;
    onViewProduct?: (product: ProductTreeNode) => void;
    onEditBom?: (product: ProductTreeNode) => void;
    onEditProduct?: (product: ProductTreeNode) => void;
}

/**
 * Draggable table header cell
 */
function DraggableHeader<TData>({
    header,
}: {
    header: Header<TData, unknown>;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: header.id,
    });

    const style: React.CSSProperties = {
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.8 : 1,
        position: 'relative',
        width: header.getSize(),
        zIndex: isDragging ? 1 : 0,
    };

    return (
        <TableHead
            ref={setNodeRef}
            style={style}
            className={`whitespace-nowrap select-none ${isDragging ? 'bg-gray-100 shadow-lg' : ''}`}
        >
            <div className="flex items-center gap-1">
                {/* Drag handle */}
                <button
                    {...attributes}
                    {...listeners}
                    className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 touch-none"
                    title="Drag to reorder"
                >
                    <GripVertical size={14} />
                </button>
                {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
            </div>
        </TableHead>
    );
}

export function SkuFlatView({
    products,
    searchQuery,
    onViewProduct,
    onEditBom,
    onEditProduct,
}: SkuFlatViewProps) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: 250,
    });

    // Define default column order
    const defaultColumnOrder = [
        'image',
        'skuCode',
        'size',
        'productName',
        'variationName',
        'gender',
        'category',
        'fabricTypeName',
        'mrp',
        'currentBalance',
        'actions',
    ];

    const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(defaultColumnOrder);

    // DnD sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5,
            },
        }),
        useSensor(KeyboardSensor)
    );

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
            enableSorting: false,
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
            id: 'skuCode',
            accessorKey: 'skuCode',
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-1"
                    onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                >
                    SKU Code
                    <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
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
            id: 'size',
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
            id: 'productName',
            accessorKey: 'productName',
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-1"
                    onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                >
                    Product
                    <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
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
            id: 'variationName',
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
            id: 'gender',
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
            id: 'category',
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
            id: 'fabricTypeName',
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
            id: 'mrp',
            accessorKey: 'mrp',
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-1"
                    onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                >
                    MRP
                    <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
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
            id: 'currentBalance',
            accessorKey: 'currentBalance',
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-1"
                    onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                >
                    Stock
                    <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
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
            size: 110,
            enableSorting: false,
            header: '',
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
                        className="h-8 w-8 text-blue-600"
                        onClick={() => row.original.skuNode && onEditProduct?.(row.original.skuNode)}
                        title="Edit SKU"
                    >
                        <Edit size={16} />
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
    ], [onViewProduct, onEditBom, onEditProduct]);

    const table = useReactTable({
        data: filteredSkus,
        columns,
        state: { sorting, columnOrder, pagination },
        onSortingChange: setSorting,
        onColumnOrderChange: setColumnOrder,
        onPaginationChange: setPagination,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
    });

    // Handle drag end for column reordering
    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setColumnOrder(currentOrder => {
                const oldIndex = currentOrder.indexOf(active.id as string);
                const newIndex = currentOrder.indexOf(over.id as string);
                return arrayMove(currentOrder, oldIndex, newIndex);
            });
        }
    };

    if (filteredSkus.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Package size={48} className="mb-4 opacity-20" />
                <p>No SKUs match the current filters</p>
            </div>
        );
    }

    const totalPages = table.getPageCount();
    const currentPage = table.getState().pagination.pageIndex + 1;
    const startRow = pagination.pageIndex * pagination.pageSize + 1;
    const endRow = Math.min((pagination.pageIndex + 1) * pagination.pageSize, filteredSkus.length);

    return (
        <div className="flex flex-col h-full">
            {/* Summary */}
            <div className="flex items-center justify-between mb-3 text-sm text-muted-foreground">
                <span>{filteredSkus.length.toLocaleString()} SKUs</span>
                <div className="flex items-center gap-4">
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                        <GripVertical size={12} />
                        Drag columns to reorder
                    </span>
                    <span>
                        Total Stock: {filteredSkus.reduce((sum, s) => sum + (s.currentBalance || 0), 0).toLocaleString()}
                    </span>
                </div>
            </div>

            {/* Table with DnD */}
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                modifiers={[restrictToHorizontalAxis]}
            >
                <ScrollArea className="flex-1 border rounded-lg">
                    <Table>
                        <TableHeader className="sticky top-0 bg-gray-50/95 backdrop-blur z-10">
                            {table.getHeaderGroups().map(headerGroup => (
                                <TableRow key={headerGroup.id}>
                                    <SortableContext
                                        items={columnOrder}
                                        strategy={horizontalListSortingStrategy}
                                    >
                                        {headerGroup.headers.map(header => (
                                            <DraggableHeader key={header.id} header={header} />
                                        ))}
                                    </SortableContext>
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
            </DndContext>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t mt-4">
                    <div className="text-sm text-muted-foreground">
                        Showing {startRow.toLocaleString()} - {endRow.toLocaleString()} of {filteredSkus.length.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => table.setPageIndex(0)}
                            disabled={!table.getCanPreviousPage()}
                            title="First page"
                        >
                            <ChevronsLeft size={16} />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => table.previousPage()}
                            disabled={!table.getCanPreviousPage()}
                            title="Previous page"
                        >
                            <ChevronLeft size={16} />
                        </Button>
                        <span className="text-sm font-medium px-2">
                            Page {currentPage} of {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => table.nextPage()}
                            disabled={!table.getCanNextPage()}
                            title="Next page"
                        >
                            <ChevronRight size={16} />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => table.setPageIndex(totalPages - 1)}
                            disabled={!table.getCanNextPage()}
                            title="Last page"
                        >
                            <ChevronsRight size={16} />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
