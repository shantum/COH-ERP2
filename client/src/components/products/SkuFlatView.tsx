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
 * - Resizable columns
 * - Persisted column order and sizes
 */

import { useMemo, useState, useCallback } from 'react';
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
    type ColumnSizingState,
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
import { ArrowUpDown, Package, Eye, GitBranch, ImageIcon, GripVertical, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Edit, RotateCcw } from 'lucide-react';

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

// localStorage keys for persisting table state
const STORAGE_KEY_COLUMN_ORDER = 'sku-flat-view-column-order';
const STORAGE_KEY_COLUMN_SIZING = 'sku-flat-view-column-sizing';

/**
 * Draggable and resizable table header cell
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
            className={`whitespace-nowrap select-none h-7 py-1 px-1.5 text-xs group ${isDragging ? 'bg-gray-100 shadow-lg' : ''}`}
        >
            <div className="flex items-center gap-0.5">
                {/* Drag handle */}
                <button
                    {...attributes}
                    {...listeners}
                    className="cursor-grab active:cursor-grabbing p-0.5 -ml-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 touch-none"
                    title="Drag to reorder"
                >
                    <GripVertical size={12} />
                </button>
                {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
            </div>
            {/* Column resize handle */}
            {header.column.getCanResize() && (
                <div
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    onDoubleClick={() => header.column.resetSize()}
                    className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none
                        ${header.column.getIsResizing()
                            ? 'bg-blue-500'
                            : 'bg-transparent hover:bg-gray-300 group-hover:bg-gray-200'
                        }`}
                    title="Drag to resize, double-click to reset"
                />
            )}
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
        pageSize: 500,
    });

    // Define default column order and sizes
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

    const defaultColumnSizing: ColumnSizingState = {
        image: 36,
        skuCode: 140,
        size: 56,
        productName: 180,
        variationName: 120,
        gender: 60,
        category: 80,
        fabricTypeName: 70,
        mrp: 70,
        currentBalance: 55,
        actions: 80,
    };

    // Load saved preferences from localStorage
    const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_COLUMN_ORDER);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Validate that all columns exist
                if (Array.isArray(parsed) && parsed.length === defaultColumnOrder.length) {
                    return parsed;
                }
            }
        } catch {
            // Ignore parsing errors
        }
        return defaultColumnOrder;
    });

    const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_COLUMN_SIZING);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch {
            // Ignore parsing errors
        }
        return defaultColumnSizing;
    });

    // Save column order to localStorage when it changes
    const handleColumnOrderChange = useCallback((updater: ColumnOrderState | ((old: ColumnOrderState) => ColumnOrderState)) => {
        setColumnOrder(prev => {
            const newOrder = typeof updater === 'function' ? updater(prev) : updater;
            localStorage.setItem(STORAGE_KEY_COLUMN_ORDER, JSON.stringify(newOrder));
            return newOrder;
        });
    }, []);

    // Save column sizing to localStorage when it changes
    const handleColumnSizingChange = useCallback((updater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => {
        setColumnSizing(prev => {
            const newSizing = typeof updater === 'function' ? updater(prev) : updater;
            localStorage.setItem(STORAGE_KEY_COLUMN_SIZING, JSON.stringify(newSizing));
            return newSizing;
        });
    }, []);

    // Reset column order and sizes to defaults
    const handleResetColumns = useCallback(() => {
        setColumnOrder(defaultColumnOrder);
        setColumnSizing(defaultColumnSizing);
        localStorage.removeItem(STORAGE_KEY_COLUMN_ORDER);
        localStorage.removeItem(STORAGE_KEY_COLUMN_SIZING);
    }, []);

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
                        imageUrl: variation.imageUrl || product.imageUrl,
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
            size: 36,
            minSize: 30,
            maxSize: 60,
            enableSorting: false,
            enableResizing: false, // Fixed width for image
            cell: ({ row }) => (
                <div className="w-7 h-7 rounded bg-gray-100 overflow-hidden flex-shrink-0">
                    {row.original.imageUrl ? (
                        <img
                            src={row.original.imageUrl}
                            alt=""
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon size={12} className="text-gray-300" />
                        </div>
                    )}
                </div>
            ),
        },
        {
            id: 'skuCode',
            accessorKey: 'skuCode',
            size: 140,
            minSize: 80,
            maxSize: 250,
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1 text-xs"
                    onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                >
                    SKU Code
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
            ),
            cell: ({ row }) => (
                <div className="leading-tight overflow-hidden">
                    <span className="font-mono text-xs font-medium truncate block">{row.original.skuCode}</span>
                    {row.original.barcode && (
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{row.original.barcode}</p>
                    )}
                </div>
            ),
        },
        {
            id: 'size',
            accessorKey: 'size',
            header: 'Size',
            size: 56,
            minSize: 40,
            maxSize: 100,
            cell: ({ row }) => (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-medium">
                    {row.original.size}
                </Badge>
            ),
        },
        {
            id: 'productName',
            accessorKey: 'productName',
            size: 180,
            minSize: 100,
            maxSize: 400,
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1 text-xs"
                    onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                >
                    Product
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
            ),
            cell: ({ row }) => (
                <div className="leading-tight overflow-hidden">
                    <span className="text-xs font-medium line-clamp-2">{row.original.productName}</span>
                    {row.original.productStyleCode && (
                        <p className="text-[10px] text-muted-foreground truncate">{row.original.productStyleCode}</p>
                    )}
                </div>
            ),
        },
        {
            id: 'variationName',
            accessorKey: 'variationName',
            header: 'Variation',
            size: 120,
            minSize: 80,
            maxSize: 250,
            cell: ({ row }) => (
                <div className="flex items-center gap-1.5 overflow-hidden">
                    {row.original.colorHex && (
                        <div
                            className="w-3 h-3 rounded-full border border-gray-200 flex-shrink-0"
                            style={{ backgroundColor: row.original.colorHex }}
                        />
                    )}
                    <div className="leading-tight min-w-0 overflow-hidden">
                        <span className="text-xs truncate block">{row.original.colorName || row.original.variationName}</span>
                        {row.original.fabricName && (
                            <p className="text-[10px] text-muted-foreground truncate">{row.original.fabricName}</p>
                        )}
                    </div>
                </div>
            ),
        },
        {
            id: 'gender',
            accessorKey: 'gender',
            header: 'Gender',
            size: 60,
            minSize: 50,
            maxSize: 100,
            cell: ({ row }) => (
                <span className="text-xs text-muted-foreground truncate block">
                    {row.original.gender || '-'}
                </span>
            ),
        },
        {
            id: 'category',
            accessorKey: 'category',
            header: 'Category',
            size: 80,
            minSize: 60,
            maxSize: 150,
            cell: ({ row }) => (
                <span className="text-xs text-muted-foreground truncate block">
                    {row.original.category || '-'}
                </span>
            ),
        },
        {
            id: 'fabricTypeName',
            accessorKey: 'fabricTypeName',
            header: 'Fabric',
            size: 70,
            minSize: 50,
            maxSize: 150,
            cell: ({ row }) => (
                <span className="text-xs text-muted-foreground truncate block">
                    {row.original.fabricTypeName || '-'}
                </span>
            ),
        },
        {
            id: 'mrp',
            accessorKey: 'mrp',
            size: 70,
            minSize: 50,
            maxSize: 120,
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1 text-xs"
                    onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                >
                    MRP
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
            ),
            cell: ({ row }) => (
                <span className="text-xs font-medium tabular-nums">
                    {row.original.mrp ? `₹${row.original.mrp.toLocaleString()}` : '-'}
                </span>
            ),
        },
        {
            id: 'currentBalance',
            accessorKey: 'currentBalance',
            size: 55,
            minSize: 45,
            maxSize: 100,
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1 text-xs"
                    onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                >
                    Stock
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
            ),
            cell: ({ row }) => {
                const stock = row.original.currentBalance ?? 0;
                return (
                    <span className={`text-xs font-semibold tabular-nums ${
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
            minSize: 70,
            maxSize: 100,
            enableSorting: false,
            enableResizing: false, // Fixed width for actions
            header: '',
            cell: ({ row }) => (
                <div className="flex items-center gap-0.5">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => row.original.productNode && onViewProduct?.(row.original.productNode)}
                        title="View Product"
                    >
                        <Eye size={13} />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-blue-600"
                        onClick={() => row.original.skuNode && onEditProduct?.(row.original.skuNode)}
                        title="Edit SKU"
                    >
                        <Edit size={13} />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-purple-600"
                        onClick={() => row.original.variationNode && onEditBom?.(row.original.variationNode)}
                        title="Edit BOM"
                    >
                        <GitBranch size={13} />
                    </Button>
                </div>
            ),
        },
    ], [onViewProduct, onEditBom, onEditProduct]);

    const table = useReactTable({
        data: filteredSkus,
        columns,
        state: { sorting, columnOrder, pagination, columnSizing },
        onSortingChange: setSorting,
        onColumnOrderChange: handleColumnOrderChange,
        onPaginationChange: setPagination,
        onColumnSizingChange: handleColumnSizingChange,
        columnResizeMode: 'onChange',
        enableColumnResizing: true,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
    });

    // Handle drag end for column reordering
    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            handleColumnOrderChange(currentOrder => {
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
            {/* Summary - more compact */}
            <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
                <span>{filteredSkus.length.toLocaleString()} SKUs</span>
                <div className="flex items-center gap-3">
                    <span className="text-[10px] text-gray-400">
                        Drag columns to reorder, drag edges to resize
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[10px] text-gray-400 hover:text-gray-600"
                        onClick={handleResetColumns}
                        title="Reset column order and sizes"
                    >
                        <RotateCcw size={10} className="mr-1" />
                        Reset
                    </Button>
                    <span>
                        Stock: {filteredSkus.reduce((sum, s) => sum + (s.currentBalance || 0), 0).toLocaleString()}
                    </span>
                </div>
            </div>

            {/* Table with DnD - compact styling */}
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                modifiers={[restrictToHorizontalAxis]}
            >
                <ScrollArea className="flex-1 border rounded-md">
                    <Table className="text-xs">
                        <TableHeader className="sticky top-0 bg-gray-50/95 backdrop-blur z-10">
                            {table.getHeaderGroups().map(headerGroup => (
                                <TableRow key={headerGroup.id} className="hover:bg-transparent border-b">
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
                                    className="hover:bg-gray-50/50 h-9"
                                >
                                    {row.getVisibleCells().map(cell => (
                                        <TableCell
                                            key={cell.id}
                                            style={{ width: cell.column.getSize() }}
                                            className="py-1 px-1.5"
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

            {/* Pagination Controls - compact */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2 border-t mt-2">
                    <div className="text-xs text-muted-foreground">
                        {startRow.toLocaleString()} - {endRow.toLocaleString()} of {filteredSkus.length.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => table.setPageIndex(0)}
                            disabled={!table.getCanPreviousPage()}
                            title="First page"
                        >
                            <ChevronsLeft size={14} />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => table.previousPage()}
                            disabled={!table.getCanPreviousPage()}
                            title="Previous page"
                        >
                            <ChevronLeft size={14} />
                        </Button>
                        <span className="text-xs font-medium px-1.5 tabular-nums">
                            {currentPage}/{totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => table.nextPage()}
                            disabled={!table.getCanNextPage()}
                            title="Next page"
                        >
                            <ChevronRight size={14} />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => table.setPageIndex(totalPages - 1)}
                            disabled={!table.getCanNextPage()}
                            title="Last page"
                        >
                            <ChevronsRight size={14} />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
