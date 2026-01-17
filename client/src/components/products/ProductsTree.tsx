/**
 * ProductsTree - TanStack Table based tree table for Products hierarchy
 *
 * Features:
 * - 3-tier hierarchical display (Product → Variation → SKU)
 * - Native expand/collapse with getSubRows
 * - Row selection for detail panel
 * - Action buttons per row type
 */

import { useMemo, useCallback, useState } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getExpandedRowModel,
    flexRender,
    type ColumnDef,
    type ExpandedState,
    type Row,
    type CellContext,
    type HeaderGroup,
    type Header,
    type Cell,
} from '@tanstack/react-table';
import { RefreshCw, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

import type { ProductTreeNode } from './types';
import { useProductsTree, filterProductTree } from './hooks/useProductsTree';
import {
    ExpanderCell,
    NameCell,
    TypeBadgeCell,
    StockCell,
    ActionsMenu,
} from './cells';

interface ProductsTreeProps {
    /** Callback when a row is selected */
    onSelect: (node: ProductTreeNode | null) => void;
    /** Currently selected node ID */
    selectedId?: string | null;
    /** Callback when edit action is clicked */
    onEdit?: (node: ProductTreeNode) => void;
    /** Callback when add child action is clicked */
    onAddChild?: (node: ProductTreeNode) => void;
    /** Search query for filtering */
    searchQuery?: string;
}

export function ProductsTree({
    onSelect,
    selectedId,
    onEdit,
    onAddChild,
    searchQuery = '',
}: ProductsTreeProps) {
    // Fetch tree data
    const {
        data: treeData,
        summary,
        isLoading,
        isFetching,
        refetch,
    } = useProductsTree();

    // Expansion state
    const [expanded, setExpanded] = useState<ExpandedState>({});

    // Filter data by search query
    const filteredData = useMemo(() => {
        return filterProductTree(treeData, searchQuery);
    }, [treeData, searchQuery]);

    // Column definitions
    const columns = useMemo<ColumnDef<ProductTreeNode>[]>(() => [
        // Expander column
        {
            id: 'expander',
            header: '',
            size: 32,
            cell: ({ row }: CellContext<ProductTreeNode, unknown>) => (
                <ExpanderCell row={row} />
            ),
        },
        // Name with indentation
        {
            id: 'name',
            header: 'Name',
            size: 200,
            cell: ({ row }: CellContext<ProductTreeNode, unknown>) => <NameCell row={row} />,
        },
        // Type badge
        {
            id: 'type',
            header: 'Type',
            size: 70,
            cell: ({ row }: CellContext<ProductTreeNode, unknown>) => <TypeBadgeCell type={row.original.type} />,
        },
        // Category (products only)
        {
            id: 'category',
            header: 'Category',
            size: 80,
            cell: ({ row }: CellContext<ProductTreeNode, unknown>) => {
                if (row.original.type !== 'product') return null;
                return (
                    <span className="text-xs text-gray-600">
                        {row.original.category || '-'}
                    </span>
                );
            },
        },
        // Size (SKUs only)
        {
            id: 'size',
            header: 'Size',
            size: 50,
            cell: ({ row }: CellContext<ProductTreeNode, unknown>) => {
                if (row.original.type !== 'sku') return null;
                return (
                    <span className="text-xs font-medium text-gray-700">
                        {row.original.size || '-'}
                    </span>
                );
            },
        },
        // Counts (products/variations)
        {
            id: 'counts',
            header: 'Items',
            size: 70,
            cell: ({ row }: CellContext<ProductTreeNode, unknown>) => {
                const node = row.original;
                if (node.type === 'product') {
                    return (
                        <span className="text-[10px] text-gray-500">
                            {node.variationCount} var / {node.skuCount} SKUs
                        </span>
                    );
                }
                if (node.type === 'variation') {
                    const childCount = node.children?.length || 0;
                    return (
                        <span className="text-[10px] text-gray-500">
                            {childCount} SKUs
                        </span>
                    );
                }
                return null;
            },
        },
        // MRP (SKUs only)
        {
            id: 'mrp',
            header: 'MRP',
            size: 60,
            cell: ({ row }: CellContext<ProductTreeNode, unknown>) => {
                if (row.original.type !== 'sku') return null;
                const mrp = row.original.mrp;
                if (!mrp) return <span className="text-xs text-gray-400">-</span>;
                return (
                    <span className="text-xs tabular-nums text-gray-600">
                        ₹{mrp.toLocaleString()}
                    </span>
                );
            },
        },
        // Stock
        {
            id: 'stock',
            header: 'Stock',
            size: 60,
            cell: ({ row }: CellContext<ProductTreeNode, unknown>) => (
                <StockCell node={row.original} />
            ),
        },
        // Actions dropdown menu
        {
            id: 'actions',
            header: '',
            size: 40,
            cell: ({ row }: CellContext<ProductTreeNode, unknown>) => (
                <ActionsMenu
                    node={row.original}
                    onEdit={onEdit}
                    onAddChild={onAddChild}
                    onViewDetails={(node) => onSelect(node)}
                />
            ),
        },
    ], [onEdit, onAddChild, onSelect]);

    // TanStack Table instance
    const table = useReactTable({
        data: filteredData,
        columns,
        state: { expanded },
        onExpandedChange: setExpanded,
        getSubRows: (row: ProductTreeNode) => row.children ?? [],
        getCoreRowModel: getCoreRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        getRowCanExpand: (row: Row<ProductTreeNode>) => {
            const node = row.original;
            return !!(node.children && node.children.length > 0);
        },
    });

    // Expand/collapse all
    const handleExpandAll = useCallback(() => {
        table.toggleAllRowsExpanded(true);
    }, [table]);

    const handleCollapseAll = useCallback(() => {
        table.toggleAllRowsExpanded(false);
    }, [table]);

    // Get row styling based on node type and selection
    const getRowStyle = (node: ProductTreeNode, isSelected: boolean) => {
        let baseStyle = '';
        switch (node.type) {
            case 'product':
                baseStyle = 'bg-white border-l-4 border-l-blue-500';
                break;
            case 'variation':
                baseStyle = 'bg-gray-50 border-l-4 border-l-purple-400';
                break;
            case 'sku':
                baseStyle = 'bg-gray-100/50 border-l-4 border-l-teal-400';
                break;
            default:
                baseStyle = 'bg-white';
        }

        if (isSelected) {
            baseStyle += ' ring-2 ring-inset ring-primary-500 bg-primary-50';
        }

        return baseStyle;
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Loading products...</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                <div className="flex items-center gap-4">
                    {/* Summary */}
                    {summary && (
                        <div className="text-xs text-gray-500">
                            {summary.products} products, {summary.variations} variations, {summary.skus} SKUs
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Expand/Collapse all */}
                    <button
                        type="button"
                        onClick={handleExpandAll}
                        className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded flex items-center gap-1"
                        title="Expand all"
                    >
                        <ChevronDown size={14} />
                        Expand
                    </button>
                    <button
                        type="button"
                        onClick={handleCollapseAll}
                        className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded flex items-center gap-1"
                        title="Collapse all"
                    >
                        <ChevronUp size={14} />
                        Collapse
                    </button>

                    {/* Refresh */}
                    <button
                        type="button"
                        onClick={() => refetch()}
                        disabled={isFetching}
                        className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
                        title="Refresh"
                    >
                        <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-auto flex-1">
                <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 bg-white border-b z-10">
                        {table.getHeaderGroups().map((headerGroup: HeaderGroup<ProductTreeNode>) => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map((header: Header<ProductTreeNode, unknown>) => (
                                    <th
                                        key={header.id}
                                        className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                        style={{ width: header.getSize() }}
                                    >
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                header.column.columnDef.header,
                                                header.getContext()
                                            )}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {table.getRowModel().rows.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={columns.length}
                                    className="px-3 py-8 text-center text-gray-500"
                                >
                                    {searchQuery
                                        ? 'No products match your search'
                                        : 'No products found'}
                                </td>
                            </tr>
                        ) : (
                            table.getRowModel().rows.map((row: Row<ProductTreeNode>) => {
                                const isSelected = row.original.id === selectedId;
                                return (
                                    <tr
                                        key={row.id}
                                        onClick={() => onSelect(row.original)}
                                        className={`border-b hover:bg-blue-50/30 transition-colors cursor-pointer ${getRowStyle(row.original, isSelected)}`}
                                    >
                                        {row.getVisibleCells().map((cell: Cell<ProductTreeNode, unknown>) => (
                                            <td
                                                key={cell.id}
                                                className="px-2 py-1.5"
                                                style={{ width: cell.column.getSize() }}
                                            >
                                                {flexRender(
                                                    cell.column.columnDef.cell,
                                                    cell.getContext()
                                                )}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
