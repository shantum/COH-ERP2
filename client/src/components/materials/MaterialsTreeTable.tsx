/**
 * MaterialsTreeTable - TanStack Table based tree table for Materials hierarchy
 *
 * Features:
 * - 3-tier hierarchical display (Material → Fabric → Colour)
 * - Native expand/collapse with getSubRows
 * - Inline editing for cost, lead time, min order
 * - Inheritance indicators (↑) for values inherited from fabric
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

import type { MaterialNode } from './types';
import { useMaterialsTree, useMaterialsTreeMutations } from './hooks/useMaterialsTree';
import {
    ExpanderCell,
    NameCell,
    TypeBadgeCell,
    ConstructionBadge,
    CostCell,
    LeadTimeCell,
    MinOrderCell,
    ActionsMenu,
    PatternCell,
    CompositionCell,
    WeightCell,
    StockCell,
    ColoursCell,
    ConnectedProductsCell,
    OutOfStockCell,
} from './cells';

type ViewMode = 'fabric' | 'material';

interface MaterialsTreeTableProps {
    /** Callback when edit action is clicked */
    onEdit: (node: MaterialNode) => void;
    /** Callback when add child action is clicked */
    onAddChild: (node: MaterialNode) => void;
    /** Callback when view details is clicked */
    onViewDetails?: (node: MaterialNode) => void;
    /** Callback when add inward is clicked (colours only) */
    onAddInward?: (node: MaterialNode) => void;
    /** Callback when deactivate is clicked */
    onDeactivate?: (node: MaterialNode) => void;
    /** Callback when delete is clicked */
    onDelete?: (node: MaterialNode) => void;
    /** Callback when link products is clicked (colours only) */
    onLinkProducts?: (node: MaterialNode) => void;
    /** Search query for filtering */
    searchQuery?: string;
    /** Height of the table container */
    height?: string | number;
    /** View mode - fabric (default) shows fabrics at top level, material shows full hierarchy */
    viewMode?: ViewMode;
    /** Pre-transformed fabric-first data (fabrics at top level with colours as children) */
    fabricFirstData?: MaterialNode[];
}

export function MaterialsTreeTable({
    onEdit,
    onAddChild,
    onViewDetails,
    onAddInward,
    onDeactivate,
    onDelete,
    onLinkProducts,
    searchQuery = '',
    height = 'calc(100vh - 200px)',
    viewMode = 'fabric',
    fabricFirstData = [],
}: MaterialsTreeTableProps) {
    // Fetch tree data (for material view and summary)
    const {
        data: treeData,
        summary,
        isLoading,
        isFetching,
        refetch,
        // loadChildren, // Reserved for lazy loading mode
    } = useMaterialsTree({ lazyLoad: false }); // Full tree for now

    // Use fabric-first data when in fabric view mode
    const isFabricView = viewMode === 'fabric';

    // Mutations for inline editing
    const { updateColour, updateFabric } = useMaterialsTreeMutations();

    // Track loading states for lazy loading (reserved for future use)
    const [loadingNodes] = useState<Set<string>>(new Set());

    // Expansion state - TanStack Table manages this
    const [expanded, setExpanded] = useState<ExpandedState>({});

    // Select base data based on view mode
    const baseData = isFabricView ? fabricFirstData : treeData;

    // Filter data by search query
    const filteredData = useMemo(() => {
        if (!searchQuery.trim()) return baseData;

        const query = searchQuery.toLowerCase();

        // Filter function that searches through tree
        function filterTree(nodes: MaterialNode[]): MaterialNode[] {
            const result: MaterialNode[] = [];

            for (const node of nodes) {
                const nameMatch = node.name.toLowerCase().includes(query);
                const fabricMatch = node.fabricName?.toLowerCase().includes(query);
                const materialMatch = node.materialName?.toLowerCase().includes(query);
                const colourMatch = node.colourName?.toLowerCase().includes(query);

                // Check if this node or any children match
                const filteredChildren = node.children ? filterTree(node.children) : undefined;
                const hasMatchingChildren = filteredChildren && filteredChildren.length > 0;

                if (nameMatch || fabricMatch || materialMatch || colourMatch || hasMatchingChildren) {
                    result.push({
                        ...node,
                        children: filteredChildren,
                    });
                }
            }

            return result;
        }

        return filterTree(baseData);
    }, [baseData, searchQuery]);

    // Handle cost save
    const handleCostSave = useCallback((node: MaterialNode, value: number | null) => {
        if (node.type === 'colour') {
            updateColour.mutate({ id: node.id, data: { costPerUnit: value } });
        } else if (node.type === 'fabric') {
            updateFabric.mutate({ id: node.id, data: { costPerUnit: value } });
        }
    }, [updateColour, updateFabric]);

    // Handle lead time save
    const handleLeadTimeSave = useCallback((node: MaterialNode, value: number | null) => {
        if (node.type === 'colour') {
            updateColour.mutate({ id: node.id, data: { leadTimeDays: value } });
        } else if (node.type === 'fabric') {
            updateFabric.mutate({ id: node.id, data: { leadTimeDays: value } });
        }
    }, [updateColour, updateFabric]);

    // Handle min order save
    const handleMinOrderSave = useCallback((node: MaterialNode, value: number | null) => {
        if (node.type === 'colour') {
            updateColour.mutate({ id: node.id, data: { minOrderQty: value } });
        } else if (node.type === 'fabric') {
            updateFabric.mutate({ id: node.id, data: { minOrderQty: value } });
        }
    }, [updateColour, updateFabric]);

    // Handle out of stock toggle
    const handleOutOfStockToggle = useCallback((id: string, isOutOfStock: boolean) => {
        updateColour.mutate({ id, data: { isOutOfStock } });
    }, [updateColour]);

    // Column definitions with enhanced columns
    const columns = useMemo<ColumnDef<MaterialNode>[]>(() => [
        // Expander column
        {
            id: 'expander',
            header: '',
            size: 32,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => (
                <ExpanderCell
                    row={row}
                    isLoading={loadingNodes.has(row.original.id)}
                />
            ),
        },
        // Name with indentation and colour swatch
        {
            id: 'name',
            header: 'Name',
            size: 200,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => <NameCell row={row} />,
        },
        // Material category (fabric view only - shows parent material)
        ...(isFabricView ? [{
            id: 'material',
            header: 'Material',
            size: 100,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => {
                const node = row.original;
                // Only show for fabrics (top-level in fabric view)
                if (node.type !== 'fabric') return null;
                return (
                    <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                        {node.materialName || '-'}
                    </span>
                );
            },
        }] : []),
        // Type badge
        {
            id: 'type',
            header: 'Type',
            size: 70,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => <TypeBadgeCell type={row.original.type} />,
        },
        // Construction type (fabrics only)
        {
            id: 'constructionType',
            header: 'Construction',
            size: 80,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => {
                if (row.original.type !== 'fabric') return null;
                return <ConstructionBadge type={row.original.constructionType} />;
            },
        },
        // Pattern (fabrics only)
        {
            id: 'pattern',
            header: 'Pattern',
            size: 100,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => (
                <PatternCell node={row.original} />
            ),
        },
        // Composition (fabrics only)
        {
            id: 'composition',
            header: 'Composition',
            size: 120,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => (
                <CompositionCell node={row.original} />
            ),
        },
        // Weight (fabrics only)
        {
            id: 'weight',
            header: 'Weight',
            size: 70,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => (
                <WeightCell node={row.original} />
            ),
        },
        // Fabric/Colour counts
        {
            id: 'counts',
            header: 'Items',
            size: 80,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => {
                const node = row.original;
                if (node.type === 'material') {
                    return (
                        <span className="text-xs text-gray-600">
                            {node.fabricCount} fabrics
                        </span>
                    );
                }
                if (node.type === 'fabric') {
                    return <span className="text-xs text-gray-600">{node.colourCount} colours</span>;
                }
                return null;
            },
        },
        // Colour swatches (fabrics only)
        {
            id: 'colours',
            header: 'Colours',
            size: 160,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => (
                <ColoursCell node={row.original} />
            ),
        },
        // Cost per unit
        {
            id: 'costPerUnit',
            header: 'Cost',
            size: 90,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => {
                const node = row.original;
                if (node.type === 'material') return null;
                return (
                    <CostCell
                        node={node}
                        onSave={(value) => handleCostSave(node, value)}
                    />
                );
            },
        },
        // Lead time
        {
            id: 'leadTimeDays',
            header: 'Lead',
            size: 70,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => {
                const node = row.original;
                if (node.type === 'material') return null;
                return (
                    <LeadTimeCell
                        node={node}
                        onSave={(value) => handleLeadTimeSave(node, value)}
                    />
                );
            },
        },
        // Min order
        {
            id: 'minOrderQty',
            header: 'Min',
            size: 70,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => {
                const node = row.original;
                if (node.type === 'material') return null;
                return (
                    <MinOrderCell
                        node={node}
                        onSave={(value) => handleMinOrderSave(node, value)}
                    />
                );
            },
        },
        // Supplier
        {
            id: 'supplierName',
            header: 'Supplier',
            size: 100,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => (
                <span className="text-xs text-gray-600 truncate">
                    {row.original.supplierName || '-'}
                </span>
            ),
        },
        // Stock (colours only)
        {
            id: 'stock',
            header: 'Stock',
            size: 80,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => (
                <StockCell node={row.original} />
            ),
        },
        // Out of Stock toggle (colours only)
        {
            id: 'outOfStock',
            header: 'OOS',
            size: 70,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => (
                <OutOfStockCell
                    node={row.original}
                    onToggle={handleOutOfStockToggle}
                />
            ),
        },
        // Connected Products (fabrics and colours)
        {
            id: 'products',
            header: 'Products',
            size: 100,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => (
                <ConnectedProductsCell node={row.original} />
            ),
        },
        // Actions dropdown menu
        {
            id: 'actions',
            header: '',
            size: 50,
            cell: ({ row }: CellContext<MaterialNode, unknown>) => (
                <ActionsMenu
                    node={row.original}
                    onEdit={onEdit}
                    onAddChild={onAddChild}
                    onViewDetails={onViewDetails}
                    onAddInward={onAddInward}
                    onDeactivate={onDeactivate}
                    onDelete={onDelete}
                    onLinkProducts={onLinkProducts}
                />
            ),
        },
    ], [loadingNodes, handleCostSave, handleLeadTimeSave, handleMinOrderSave, handleOutOfStockToggle, onEdit, onAddChild, onViewDetails, onAddInward, onDeactivate, onDelete, onLinkProducts, isFabricView]);

    // TanStack Table instance
    const table = useReactTable({
        data: filteredData,
        columns,
        state: { expanded },
        onExpandedChange: setExpanded,
        getSubRows: (row: MaterialNode) => row.children ?? [],
        getCoreRowModel: getCoreRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        getRowCanExpand: (row: Row<MaterialNode>) => {
            // Can only expand if there are actual children loaded
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

    // Get row styling based on node type and view mode
    const getRowStyle = (node: MaterialNode) => {
        if (isFabricView) {
            // In fabric view: fabrics are top-level (white), colours are children (gray)
            switch (node.type) {
                case 'fabric':
                    return 'bg-white border-l-4 border-l-purple-500';
                case 'colour':
                    return 'bg-gray-50 border-l-4 border-l-teal-400';
                default:
                    return 'bg-white';
            }
        }
        // In material view: full hierarchy styling
        switch (node.type) {
            case 'material':
                return 'bg-white border-l-4 border-l-blue-500';
            case 'fabric':
                return 'bg-gray-50 border-l-4 border-l-purple-400';
            case 'colour':
                return 'bg-gray-100/50 border-l-4 border-l-teal-400';
            default:
                return 'bg-white';
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Loading materials...</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
                <div className="flex items-center gap-4">
                    {/* Summary */}
                    {summary && (
                        <div className="text-xs text-gray-500">
                            {isFabricView ? (
                                <>{filteredData.length} fabrics, {summary.colours} colours</>
                            ) : (
                                <>{summary.materials} materials, {summary.fabrics} fabrics, {summary.colours} colours</>
                            )}
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
                        <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Table */}
            <div
                className="overflow-auto flex-1"
                style={{ height }}
            >
                <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 bg-white border-b z-10">
                        {table.getHeaderGroups().map((headerGroup: HeaderGroup<MaterialNode>) => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map((header: Header<MaterialNode, unknown>) => (
                                    <th
                                        key={header.id}
                                        className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
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
                                        ? 'No materials match your search'
                                        : 'No materials found'}
                                </td>
                            </tr>
                        ) : (
                            table.getRowModel().rows.map((row: Row<MaterialNode>) => (
                                <tr
                                    key={row.id}
                                    className={`border-b hover:bg-blue-50/30 transition-colors ${getRowStyle(row.original)}`}
                                >
                                    {row.getVisibleCells().map((cell: Cell<MaterialNode, unknown>) => (
                                        <td
                                            key={cell.id}
                                            className="px-3 py-2"
                                            style={{ width: cell.column.getSize() }}
                                        >
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
