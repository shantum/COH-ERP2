/**
 * BomLinesTable - Unified BOM lines display
 *
 * Shows all component types (fabric, trim, service) in a single table
 * with type-specific badges and visual differentiation.
 */

import { Plus, Trash2, Loader2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TypeBadge } from './cells';
import type { BomLinesTableProps, UnifiedBomLine } from './types';

function formatCurrency(value: number | null): string {
    if (value === null || value === undefined) return '-';
    return value.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function formatQuantity(qty: number | null, unit: string): string {
    if (qty === null || qty === undefined) return '-';
    return `${qty} ${unit}`;
}

export function BomLinesTable({
    lines,
    isLoading,
    onAddLine,
    onDeleteLine,
    onRowClick,
    emptyMessage = 'No components in BOM',
    context,
}: BomLinesTableProps) {
    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-32">
                <Loader2 size={24} className="animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Loading BOM...</span>
            </div>
        );
    }

    const isEmpty = lines.length === 0;

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-gray-700">
                    BOM Lines
                    {!isEmpty && (
                        <span className="ml-2 text-gray-400 font-normal">
                            ({lines.length})
                        </span>
                    )}
                </h4>
                {onAddLine && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onAddLine}
                        className="gap-1"
                    >
                        <Plus size={14} />
                        Add Line
                    </Button>
                )}
            </div>

            {/* Empty State */}
            {isEmpty ? (
                <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg">
                    <Package size={40} className="mx-auto mb-3 text-gray-300" />
                    <p className="text-sm text-gray-500">{emptyMessage}</p>
                    <p className="text-xs text-gray-400 mt-1">
                        {context === 'product'
                            ? 'Add fabric roles, trims, and services to define the bill of materials'
                            : 'This variation inherits BOM from the product template'}
                    </p>
                    {onAddLine && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onAddLine}
                            className="mt-4 gap-1"
                        >
                            <Plus size={14} />
                            Add Component
                        </Button>
                    )}
                </div>
            ) : (
                /* Table */
                <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-20">
                                    Type
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                                    Role
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                                    Component
                                </th>
                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-24">
                                    Qty
                                </th>
                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-24">
                                    Cost
                                </th>
                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-24">
                                    Total
                                </th>
                                {onDeleteLine && (
                                    <th className="px-3 py-2 w-10"></th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {lines.map((line) => (
                                <BomLineRow
                                    key={line.id}
                                    line={line}
                                    onDelete={onDeleteLine}
                                    onClick={onRowClick}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

interface BomLineRowProps {
    line: UnifiedBomLine;
    onDelete?: (line: UnifiedBomLine) => void;
    onClick?: (line: UnifiedBomLine) => void;
}

function BomLineRow({ line, onDelete, onClick }: BomLineRowProps) {
    const isUnassigned = !line.componentName || line.componentName === 'Per variation';
    const isPerVariation = line.componentName === 'Per variation';
    const isClickable = !!onClick;

    return (
        <tr
            className={`hover:bg-gray-50 group ${isClickable ? 'cursor-pointer hover:bg-blue-50' : ''}`}
            onClick={() => onClick?.(line)}
        >
            {/* Type Badge */}
            <td className="px-3 py-2">
                <TypeBadge type={line.type} />
            </td>

            {/* Role */}
            <td className="px-3 py-2">
                <span className="text-gray-700 font-medium">{line.roleName}</span>
                {line.isInherited && (
                    <span className="ml-1 text-[10px] text-gray-400">↑</span>
                )}
            </td>

            {/* Component */}
            <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                    {/* Colour swatch for fabrics */}
                    {line.type === 'FABRIC' && line.colourHex && (
                        <span
                            className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0"
                            style={{ backgroundColor: line.colourHex }}
                        />
                    )}
                    <span
                        className={
                            isUnassigned
                                ? isPerVariation
                                    ? 'text-purple-600 italic text-xs'
                                    : 'text-gray-400 italic'
                                : 'text-gray-900'
                        }
                    >
                        {line.componentName || 'Not assigned'}
                    </span>
                </div>
            </td>

            {/* Quantity */}
            <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                {formatQuantity(line.quantity, line.quantityUnit)}
            </td>

            {/* Cost Per Unit */}
            <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                {line.costPerUnit !== null ? `₹${formatCurrency(line.costPerUnit)}` : '-'}
            </td>

            {/* Total */}
            <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                {line.totalCost > 0 ? `₹${formatCurrency(line.totalCost)}` : '-'}
            </td>

            {/* Delete Action */}
            {onDelete && (
                <td className="px-2 py-2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(line);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 rounded transition-opacity"
                        title="Remove from BOM"
                    >
                        <Trash2 size={14} />
                    </button>
                </td>
            )}
        </tr>
    );
}
