/**
 * FabricColoursTable - Flat table showing all fabric colours
 *
 * Features:
 * - Simple flat table (no tree hierarchy)
 * - Virtual scrolling for performance
 * - Simplified display: "Fabric Name | Colour Name" format
 * - Linked products shown as thumbnails
 * - Inline editing for cost
 */

import { useMemo, useCallback, useRef } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    flexRender,
    type ColumnDef,
    type Row,
    type CellContext,
    type HeaderGroup,
    type Header,
    type Cell,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { RefreshCw, Loader2 } from 'lucide-react';

import type { FabricColourFlatRow } from './hooks/useMaterialsTree';
import { useMaterialsTreeMutations } from './hooks/useMaterialsTree';
import {
    ConstructionBadge,
    LinkedProductsCell,
} from './cells';
import type { MaterialNode } from './types';

// Editable cell imports from CostCell.tsx
import { CostCell } from './cells/CostCell';

interface FabricColoursTableProps {
    /** Flat data array */
    data: FabricColourFlatRow[];
    /** Loading state */
    isLoading: boolean;
    /** Fetching state (background refresh) */
    isFetching: boolean;
    /** Refetch function */
    refetch: () => void;
    /** Total count */
    total: number;
    /** Callback when edit action is clicked */
    onEdit: (row: FabricColourFlatRow) => void;
    /** Callback when add inward is clicked (not used in flat view yet) */
    onAddInward?: (row: FabricColourFlatRow) => void;
    /** Callback when link products is clicked */
    onLinkProducts?: (row: FabricColourFlatRow) => void;
    /** Callback when delete is clicked (not used in flat view yet) */
    onDelete?: (row: FabricColourFlatRow) => void;
    /** Height of the table container */
    height?: string | number;
}

/**
 * Convert FabricColourFlatRow to MaterialNode for cell component compatibility
 */
function toMaterialNode(row: FabricColourFlatRow): MaterialNode {
    return {
        id: row.id,
        type: 'colour',
        name: row.colourName,
        code: row.code ?? undefined,
        colourName: row.colourName,
        colourHex: row.colourHex ?? undefined,
        fabricId: row.fabricId,
        fabricName: row.fabricName,
        materialId: row.materialId,
        materialName: row.materialName,
        unit: row.unit ?? undefined,
        constructionType: row.constructionType ?? undefined,
        costPerUnit: row.costPerUnit,
        effectiveCostPerUnit: row.effectiveCostPerUnit,
        costInherited: row.costInherited,
        leadTimeDays: row.leadTimeDays,
        effectiveLeadTimeDays: row.effectiveLeadTimeDays,
        leadTimeInherited: row.leadTimeInherited,
        minOrderQty: row.minOrderQty,
        effectiveMinOrderQty: row.effectiveMinOrderQty,
        minOrderInherited: row.minOrderInherited,
        partyId: row.partyId,
        partyName: row.partyName,
        isOutOfStock: row.isOutOfStock,
        currentBalance: row.currentBalance,
        sales30DayValue: row.sales30DayValue,
        consumption30Day: row.consumption30Day,
        productCount: row.productCount,
        isActive: row.isActive,
    };
}

/**
 * Format unit for display
 */
function formatUnit(unit?: string | null): string {
    if (!unit) return '';
    if (unit === 'm') return 'mtr';
    return unit;
}

import { formatCurrencyOrDash as formatCurrency } from '../../utils/formatting';

/**
 * Format consumption value
 */
function formatConsumption(value: number, unit?: string | null): string {
    if (value === 0) return '-';
    const formatted = value.toLocaleString('en-IN', { maximumFractionDigits: 1 });
    const unitDisplay = formatUnit(unit);
    return unitDisplay ? `${formatted} ${unitDisplay}` : formatted;
}

const ROW_HEIGHT = 44;

export function FabricColoursTable({
    data,
    isLoading,
    isFetching,
    refetch,
    total,
    onEdit,
    onAddInward: _onAddInward,
    onLinkProducts,
    onDelete: _onDelete,
    height = 'calc(100vh - 200px)',
}: FabricColoursTableProps) {
    // These callbacks are received but not used in the current flat view
    // They're kept for API compatibility with MaterialsTreeView
    void _onAddInward;
    void _onDelete;
    const parentRef = useRef<HTMLDivElement>(null);

    // Mutations for inline editing
    const { updateColour } = useMaterialsTreeMutations();

    // Handle cost save
    const handleCostSave = useCallback((row: FabricColourFlatRow, value: number | null) => {
        updateColour.mutate({ id: row.id, data: { costPerUnit: value } });
    }, [updateColour]);

    // Handle out of stock toggle
    const handleOutOfStockToggle = useCallback((row: FabricColourFlatRow) => {
        updateColour.mutate({ id: row.id, data: { isOutOfStock: !row.isOutOfStock } });
    }, [updateColour]);

    // Column definitions - simplified layout
    const columns = useMemo<ColumnDef<FabricColourFlatRow>[]>(() => [
        // Code badge
        {
            id: 'code',
            header: 'Code',
            size: 130,
            cell: ({ row }: CellContext<FabricColourFlatRow, unknown>) => {
                const code = row.original.code;
                if (!code) return <span className="text-xs text-gray-400">-</span>;
                return (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-medium bg-gray-100 text-gray-700">
                        {code}
                    </span>
                );
            },
        },
        // Combined Fabric | Colour name with swatch
        {
            id: 'name',
            header: 'Colour',
            size: 280,
            cell: ({ row }: CellContext<FabricColourFlatRow, unknown>) => {
                const r = row.original;
                return (
                    <div className="flex items-center gap-2">
                        <div
                            className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0"
                            style={{ backgroundColor: r.colourHex || '#ccc' }}
                        />
                        <span className="truncate">
                            <span className="font-medium text-gray-700">{r.fabricName}</span>
                            <span className="text-gray-400 mx-1.5">|</span>
                            <span className="text-gray-600">{r.colourName}</span>
                        </span>
                    </div>
                );
            },
        },
        // Weight
        {
            id: 'weight',
            header: 'Weight',
            size: 90,
            cell: ({ row }: CellContext<FabricColourFlatRow, unknown>) => {
                const r = row.original;
                if (!r.weight) return <span className="text-xs text-gray-400">-</span>;
                return (
                    <span className="text-xs text-gray-600">
                        {r.weight} {r.weightUnit || 'gsm'}
                    </span>
                );
            },
        },
        // Construction Type
        {
            id: 'type',
            header: 'Type',
            size: 80,
            cell: ({ row }: CellContext<FabricColourFlatRow, unknown>) => (
                <ConstructionBadge type={row.original.constructionType} />
            ),
        },
        // Linked Products with thumbnails
        {
            id: 'products',
            header: 'Products',
            size: 140,
            cell: ({ row }: CellContext<FabricColourFlatRow, unknown>) => (
                <LinkedProductsCell products={row.original.linkedProducts || []} />
            ),
        },
        // Cost (editable)
        {
            id: 'cost',
            header: 'Cost',
            size: 90,
            cell: ({ row }: CellContext<FabricColourFlatRow, unknown>) => (
                <CostCell
                    node={toMaterialNode(row.original)}
                    onSave={(value) => handleCostSave(row.original, value)}
                />
            ),
        },
        // Stock
        {
            id: 'stock',
            header: 'Stock',
            size: 90,
            cell: ({ row }: CellContext<FabricColourFlatRow, unknown>) => {
                const r = row.original;
                const balance = r.currentBalance;
                const unit = formatUnit(r.unit);
                const formatted = balance.toLocaleString('en-IN', { maximumFractionDigits: 2 });
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                        <span>{formatted}</span>
                        {unit && <span className="text-gray-500">{unit}</span>}
                    </span>
                );
            },
        },
        // 30D Sales
        {
            id: 'sales30Day',
            header: '30D Sales',
            size: 90,
            cell: ({ row }: CellContext<FabricColourFlatRow, unknown>) => {
                const value = row.original.sales30DayValue;
                if (value === 0) return <span className="text-xs text-gray-400">-</span>;
                return (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50/50 text-emerald-600">
                        {formatCurrency(value)}
                    </span>
                );
            },
        },
        // 30D Usage
        {
            id: 'consumption30Day',
            header: '30D Usage',
            size: 90,
            cell: ({ row }: CellContext<FabricColourFlatRow, unknown>) => {
                const value = row.original.consumption30Day;
                if (value === 0) return <span className="text-xs text-gray-400">-</span>;
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50/50 text-blue-600">
                        {formatConsumption(value, row.original.unit)}
                    </span>
                );
            },
        },
        // Out of Stock toggle
        {
            id: 'oos',
            header: 'OOS',
            size: 70,
            cell: ({ row }: CellContext<FabricColourFlatRow, unknown>) => {
                const r = row.original;
                const isOOS = r.isOutOfStock;

                return (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleOutOfStockToggle(r);
                        }}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                            isOOS
                                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        title={isOOS ? 'Click to mark as in stock' : 'Click to mark as out of stock'}
                    >
                        {isOOS ? 'OOS' : 'In Stock'}
                    </button>
                );
            },
        },
        // Actions
        {
            id: 'actions',
            header: '',
            size: 100,
            cell: ({ row }: CellContext<FabricColourFlatRow, unknown>) => {
                const r = row.original;
                return (
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => onEdit(r)}
                            className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
                            title="Edit colour"
                        >
                            Edit
                        </button>
                        {onLinkProducts && (
                            <button
                                type="button"
                                onClick={() => onLinkProducts(r)}
                                className="px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                                title="Link to products"
                            >
                                Link
                            </button>
                        )}
                    </div>
                );
            },
        },
    ], [handleCostSave, handleOutOfStockToggle, onEdit, onLinkProducts]);

    // TanStack Table instance
    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    // Virtual rows for performance
    const { rows } = table.getRowModel();

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 10,
    });

    const virtualRows = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();

    // Padding for virtual scrolling
    const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
    const paddingBottom = virtualRows.length > 0
        ? totalSize - virtualRows[virtualRows.length - 1].end
        : 0;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Loading fabric colours...</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 flex-shrink-0">
                <div className="text-xs text-gray-500">
                    {total} fabric colours
                </div>
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

            {/* Table with virtual scrolling */}
            <div
                ref={parentRef}
                className="overflow-auto flex-1"
                style={{ height }}
            >
                <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 bg-white border-b z-10">
                        {table.getHeaderGroups().map((headerGroup: HeaderGroup<FabricColourFlatRow>) => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map((header: Header<FabricColourFlatRow, unknown>) => (
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
                        {rows.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={columns.length}
                                    className="px-3 py-8 text-center text-gray-500"
                                >
                                    No fabric colours found
                                </td>
                            </tr>
                        ) : (
                            <>
                                {paddingTop > 0 && (
                                    <tr>
                                        <td style={{ height: paddingTop }} />
                                    </tr>
                                )}
                                {virtualRows.map((virtualRow) => {
                                    const row = rows[virtualRow.index] as Row<FabricColourFlatRow>;
                                    return (
                                        <tr
                                            key={row.id}
                                            className="border-b hover:bg-blue-50/30 transition-colors bg-white"
                                            style={{ height: ROW_HEIGHT }}
                                        >
                                            {row.getVisibleCells().map((cell: Cell<FabricColourFlatRow, unknown>) => (
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
                                    );
                                })}
                                {paddingBottom > 0 && (
                                    <tr>
                                        <td style={{ height: paddingBottom }} />
                                    </tr>
                                )}
                            </>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
