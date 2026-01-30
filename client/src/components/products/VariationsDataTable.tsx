/**
 * VariationsDataTable - By Variation view for Products
 *
 * Features:
 * - Flat table of variation rows with product info
 * - Variation rows expandable to show SKU sub-table
 * - Resizable columns with persistence
 * - Admin can save column widths as default for all users
 */

import { useState, useMemo, useEffect, Fragment, memo, useCallback, useRef } from 'react';
import {
    ChevronRight,
    ChevronDown,
    ChevronLeft,
    ImageIcon,
    Eye,
    Edit,
    GitBranch,
    Layers,
    Box,
    AlertTriangle,
    CheckCircle,
    XCircle,
    Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getOptimizedImageUrl } from '../../utils/imageOptimization';
import type { ProductTreeNode, VariationViewRow, ShopifyStatus } from './types';
import { sortBySizeOrder } from './types';
import { flattenToVariationRows, filterVariationRows } from './utils/flattenToVariationRows';
import { useVariationsTableState } from './hooks/useVariationsTableState';

interface VariationsDataTableProps {
    filteredData: ProductTreeNode[];
    searchQuery?: string;
    onViewProduct?: (node: ProductTreeNode) => void;
    onEditBom?: (node: ProductTreeNode) => void;
    onEditProduct?: (node: ProductTreeNode) => void;
}

const PAGE_SIZE = 100;

/**
 * Shopify status badge styles
 */
const shopifyStatusConfig: Record<ShopifyStatus, { label: string; className: string }> = {
    active: {
        label: 'Active',
        className: 'bg-green-100 text-green-700 border-green-200',
    },
    archived: {
        label: 'Archived',
        className: 'bg-gray-100 text-gray-600 border-gray-200',
    },
    draft: {
        label: 'Draft',
        className: 'bg-amber-100 text-amber-700 border-amber-200',
    },
    not_linked: {
        label: '-',
        className: 'text-gray-300',
    },
    not_cached: {
        label: '?',
        className: 'text-gray-400',
    },
    unknown: {
        label: '?',
        className: 'text-gray-400',
    },
};

/**
 * Shopify status badge component
 */
const ShopifyStatusBadge = memo(function ShopifyStatusBadge({ status }: { status?: ShopifyStatus }) {
    const config = shopifyStatusConfig[status ?? 'not_linked'];

    if (status === 'not_linked' || status === 'not_cached' || status === 'unknown' || !status) {
        return <span className={`text-xs ${config.className}`}>{config.label}</span>;
    }

    return (
        <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${config.className}`}
        >
            {config.label}
        </span>
    );
});

export function VariationsDataTable({
    filteredData,
    searchQuery,
    onViewProduct,
    onEditBom,
    onEditProduct,
}: VariationsDataTableProps) {
    // Column width state with persistence
    const { columnWidths, handleColumnResize, isManager, saveAsAdminDefault, isSaving } = useVariationsTableState();

    // Track expanded variations (for showing SKUs)
    const [expandedVariations, setExpandedVariations] = useState<Set<string>>(new Set());
    const [pageIndex, setPageIndex] = useState(0);

    // Resize state - store all info needed for resize in a single ref
    const [resizing, setResizing] = useState<string | null>(null);
    const resizeInfo = useRef<{ colId: string; startX: number; startWidth: number } | null>(null);

    // Handle resize start
    const handleResizeStart = useCallback((e: React.MouseEvent, colId: string) => {
        e.preventDefault();
        e.stopPropagation();

        const startWidth = columnWidths[colId] || 100;
        console.log('[Resize] Start:', colId, 'width:', startWidth, 'clientX:', e.clientX);

        resizeInfo.current = {
            colId,
            startX: e.clientX,
            startWidth,
        };
        setResizing(colId);
    }, [columnWidths]);

    // Handle resize move - use document-level listeners
    useEffect(() => {
        if (!resizing || !resizeInfo.current) return;

        const info = resizeInfo.current;

        // Set cursor on body during resize
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const handleMouseMove = (e: MouseEvent) => {
            if (!info) return;
            const diff = e.clientX - info.startX;
            const newWidth = Math.max(80, info.startWidth + diff);
            console.log('[Resize] Move:', info.colId, 'diff:', diff, 'newWidth:', newWidth, 'currentWidths:', columnWidths);
            handleColumnResize(info.colId, newWidth);
        };

        const handleMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            resizeInfo.current = null;
            setResizing(null);
        };

        // Use capture phase to ensure we get the events
        document.addEventListener('mousemove', handleMouseMove, true);
        document.addEventListener('mouseup', handleMouseUp, true);

        return () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMouseMove, true);
            document.removeEventListener('mouseup', handleMouseUp, true);
        };
    }, [resizing, handleColumnResize]);

    // Transform to flat rows
    const allRows = useMemo(() => flattenToVariationRows(filteredData), [filteredData]);

    // Apply search filter
    const filteredRows = useMemo(
        () => (searchQuery ? filterVariationRows(allRows, searchQuery) : allRows),
        [allRows, searchQuery]
    );

    // Calculate summary stats
    const summary = useMemo(() => {
        const productIds = new Set<string>();
        let variations = 0;
        let skus = 0;
        let totalStock = 0;

        for (const row of filteredRows) {
            if (row.parentProductId) {
                productIds.add(row.parentProductId);
            }
            variations++;
            skus += row.skuCount || 0;
            totalStock += row.totalStock || 0;
        }

        return { products: productIds.size, variations, skus, totalStock };
    }, [filteredRows]);

    // Paginate rows
    const paginatedRows = useMemo(() => {
        const start = pageIndex * PAGE_SIZE;
        return filteredRows.slice(start, start + PAGE_SIZE);
    }, [filteredRows, pageIndex]);

    const pageCount = Math.ceil(filteredRows.length / PAGE_SIZE);

    // Reset pagination when data changes
    useEffect(() => {
        setPageIndex(0);
    }, [searchQuery, filteredData]);

    // Toggle variation expansion
    const toggleVariation = (variationId: string) => {
        setExpandedVariations((prev) => {
            const next = new Set(prev);
            if (next.has(variationId)) {
                next.delete(variationId);
            } else {
                next.add(variationId);
            }
            return next;
        });
    };

    return (
        <div className="flex flex-col h-full">
            {/* Summary Stats */}
            <div className="flex items-center justify-between gap-3 px-1 mb-2 flex-shrink-0">
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs">
                        <Layers size={13} className="text-purple-400" />
                        <span className="text-gray-600">{summary.variations} Variations</span>
                        <span className="text-gray-400">({summary.products} products)</span>
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
                {isManager && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={saveAsAdminDefault}
                        disabled={isSaving}
                        className="gap-1.5 text-xs h-7"
                        title="Save column widths as default for all users"
                    >
                        <Save size={12} />
                        {isSaving ? 'Saving...' : 'Save as Default'}
                    </Button>
                )}
            </div>

            {/* Table */}
            <div className={`rounded-md border overflow-hidden flex-1 min-h-0 flex flex-col ${resizing ? 'select-none' : ''}`}>
                <div className="overflow-auto flex-1">
                    <table className="text-sm border-collapse table-fixed">
                        <colgroup>
                            <col style={{ width: columnWidths.expander }} />
                            <col style={{ width: columnWidths.image }} />
                            <col style={{ width: columnWidths.product }} />
                            <col style={{ width: columnWidths.fabric }} />
                            <col style={{ width: columnWidths.skus }} />
                            <col style={{ width: columnWidths.avgMrp }} />
                            <col style={{ width: columnWidths.consumption }} />
                            <col style={{ width: columnWidths.bomCost }} />
                            <col style={{ width: columnWidths.stock }} />
                            <col style={{ width: columnWidths.shopifyStatus }} />
                            <col style={{ width: columnWidths.shopifyStock }} />
                            <col style={{ width: columnWidths.fabricStock }} />
                            <col style={{ width: columnWidths.sales30Day }} />
                            <col style={{ width: columnWidths.status }} />
                            <col style={{ width: columnWidths.actions }} />
                        </colgroup>
                        <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
                            <tr className="border-b border-gray-200">
                                <th className="px-1 py-1.5"></th>
                                <th className="px-1 py-1.5"></th>
                                <ResizableHeader
                                    colId="product"
                                    onResizeStart={handleResizeStart}
                                    isResizing={resizing === 'product'}
                                    className="text-left"
                                >
                                    Product
                                </ResizableHeader>
                                <ResizableHeader
                                    colId="fabric"
                                    onResizeStart={handleResizeStart}
                                    isResizing={resizing === 'fabric'}
                                    className="text-left"
                                >
                                    Fabric
                                </ResizableHeader>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    SKUs
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Avg MRP
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Consump
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    BOM
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Stock
                                </th>
                                <th className="text-center px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Shopify
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Shop Stk
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Fab Stk
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    30d
                                </th>
                                <th className="text-center px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Status
                                </th>
                                <th className="px-1 py-1.5"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedRows.length === 0 ? (
                                <tr>
                                    <td colSpan={15} className="h-24 text-center text-muted-foreground">
                                        No variations found.
                                    </td>
                                </tr>
                            ) : (
                                paginatedRows.map((row) => {
                                    const isExpanded = row.variationId
                                        ? expandedVariations.has(row.variationId)
                                        : false;

                                    return (
                                        <Fragment key={row.id}>
                                            <VariationRow
                                                row={row}
                                                isExpanded={isExpanded}
                                                onToggle={() =>
                                                    row.variationId && toggleVariation(row.variationId)
                                                }
                                                onViewProduct={onViewProduct}
                                                onEditProduct={onEditProduct}
                                                onEditBom={onEditBom}
                                            />
                                            {isExpanded && row.skus && row.skus.length > 0 && (
                                                <tr>
                                                    <td colSpan={15} className="p-0 bg-blue-50/30">
                                                        <div className="py-1.5 px-3 ml-8">
                                                            <SkusTable skus={row.skus} />
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Pagination Controls */}
            {filteredRows.length > 0 && (
                <div className="flex items-center justify-between px-3 py-2 border rounded bg-gray-50/50 mt-2 flex-shrink-0">
                    <div className="text-xs text-muted-foreground">
                        Showing {Math.min(pageIndex * PAGE_SIZE + 1, filteredRows.length)} to{' '}
                        {Math.min((pageIndex + 1) * PAGE_SIZE, filteredRows.length)} of{' '}
                        {filteredRows.length} rows
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                            disabled={pageIndex === 0}
                            className="gap-0.5 h-7 px-2 text-xs"
                        >
                            <ChevronLeft size={14} />
                            Previous
                        </Button>
                        <div className="flex items-center gap-1 text-xs">
                            <span className="text-muted-foreground">Page</span>
                            <span className="font-medium">{pageIndex + 1}</span>
                            <span className="text-muted-foreground">of</span>
                            <span className="font-medium">{Math.max(1, pageCount)}</span>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
                            disabled={pageIndex >= pageCount - 1}
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
 * Variation Row - Primary data row with product info
 */
interface VariationRowProps {
    row: VariationViewRow;
    isExpanded: boolean;
    onToggle: () => void;
    onViewProduct?: (node: ProductTreeNode) => void;
    onEditProduct?: (node: ProductTreeNode) => void;
    onEditBom?: (node: ProductTreeNode) => void;
}

const VariationRow = memo(function VariationRow({
    row,
    isExpanded,
    onToggle,
    onViewProduct,
    onEditProduct,
    onEditBom,
}: VariationRowProps) {
    const stock = row.totalStock || 0;
    const skuCount = row.skuCount || 0;

    return (
        <tr className="hover:bg-gray-50/50 cursor-pointer h-9" onClick={onToggle}>
            {/* Expander */}
            <td className="px-1 py-1">
                {skuCount > 0 && (
                    <button className="p-0.5 rounded hover:bg-gray-100">
                        {isExpanded ? (
                            <ChevronDown size={14} className="text-gray-500" />
                        ) : (
                            <ChevronRight size={14} className="text-gray-500" />
                        )}
                    </button>
                )}
            </td>

            {/* Image */}
            <td className="px-1 py-1">
                <div className="w-7 h-7 rounded overflow-hidden bg-gray-100 flex items-center justify-center">
                    {row.imageUrl ? (
                        <img
                            src={getOptimizedImageUrl(row.imageUrl, 'xs') || row.imageUrl}
                            alt={row.colorName}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    ) : row.colorHex ? (
                        <span
                            className="w-full h-full"
                            style={{ backgroundColor: row.colorHex }}
                        />
                    ) : (
                        <ImageIcon size={12} className="text-gray-300" />
                    )}
                </div>
            </td>

            {/* Product | Color */}
            <td className="px-2 py-1 whitespace-nowrap">
                <div className="flex items-center gap-1.5">
                    {row.colorHex && (
                        <span
                            className="w-3 h-3 rounded-full border border-gray-200 flex-shrink-0"
                            style={{ backgroundColor: row.colorHex }}
                        />
                    )}
                    <div>
                        <div className="text-xs font-medium text-gray-900">
                            {row.parentProductName} <span className="text-gray-400">|</span> {row.colorName}
                        </div>
                        {row.parentStyleCode && (
                            <div className="text-[10px] text-gray-400 font-mono">
                                {row.parentStyleCode}
                            </div>
                        )}
                    </div>
                </div>
            </td>

            {/* Fabric | Colour */}
            <td className="px-2 py-1 text-xs text-gray-600 whitespace-nowrap">
                {row.fabricName ? (
                    row.fabricColourName ? (
                        <>{row.fabricName} <span className="text-gray-400">|</span> {row.fabricColourName}</>
                    ) : (
                        row.fabricName
                    )
                ) : (
                    <span className="text-red-500 text-[10px]">Not set</span>
                )}
            </td>

            {/* SKUs */}
            <td className="px-2 py-1 text-right tabular-nums font-medium text-xs">
                {skuCount}
            </td>

            {/* Avg MRP */}
            <td className="px-2 py-1 text-right tabular-nums text-xs">
                {row.avgMrp ? `₹${Math.round(row.avgMrp).toLocaleString()}` : '-'}
            </td>

            {/* Consumption (avg) */}
            <td className="px-2 py-1 text-right tabular-nums text-xs text-gray-600">
                {row.avgConsumption != null ? `${row.avgConsumption.toFixed(2)}m` : '-'}
            </td>

            {/* BOM Cost */}
            <td className="px-2 py-1 text-right tabular-nums text-xs text-gray-600">
                {row.bomCost != null ? `₹${Math.round(row.bomCost).toLocaleString()}` : '-'}
            </td>

            {/* Stock */}
            <td className="px-2 py-1 text-right">
                <span
                    className={`tabular-nums font-semibold text-xs ${
                        stock === 0
                            ? 'text-red-600'
                            : stock < 5
                            ? 'text-amber-600'
                            : 'text-green-600'
                    }`}
                >
                    {stock.toLocaleString()}
                </span>
            </td>

            {/* Shopify Status */}
            <td className="px-2 py-1 text-center">
                <ShopifyStatusBadge status={row.shopifyStatus} />
            </td>

            {/* Shopify Stock */}
            <td className="px-2 py-1 text-right">
                <span className="tabular-nums text-xs text-gray-600">
                    {row.shopifyStock != null ? row.shopifyStock.toLocaleString() : '-'}
                </span>
            </td>

            {/* Fabric Stock */}
            <td className="px-2 py-1 text-right">
                {row.fabricStock != null ? (
                    <span
                        className={`tabular-nums text-xs font-medium ${
                            row.fabricStock === 0
                                ? 'text-red-500'
                                : row.fabricStock < 10
                                ? 'text-amber-500'
                                : 'text-gray-600'
                        }`}
                    >
                        {row.fabricStock.toLocaleString()}
                    </span>
                ) : (
                    <span className="text-xs text-gray-300">-</span>
                )}
            </td>

            {/* 30-Day Sales */}
            <td className="px-2 py-1 text-right">
                <span className="tabular-nums text-xs text-gray-600">
                    {row.sales30DayUnits != null && row.sales30DayUnits > 0
                        ? row.sales30DayUnits.toLocaleString()
                        : '-'}
                </span>
            </td>

            {/* Status */}
            <td className="px-2 py-1 text-center">
                {stock === 0 ? (
                    <Badge variant="destructive" className="gap-0.5 text-[10px] px-1 py-0 h-4">
                        <XCircle size={9} />
                        Out
                    </Badge>
                ) : stock < 5 ? (
                    <Badge variant="warning" className="gap-0.5 text-[10px] px-1 py-0 h-4">
                        <AlertTriangle size={9} />
                        Low
                    </Badge>
                ) : (
                    <Badge variant="success" className="gap-0.5 text-[10px] px-1 py-0 h-4">
                        <CheckCircle size={9} />
                        OK
                    </Badge>
                )}
            </td>

            {/* Actions */}
            <td className="px-1 py-1" onClick={(e) => e.stopPropagation()}>
                {row.variationNode && (
                    <div className="flex items-center gap-0.5">
                        <button
                            onClick={() => onViewProduct?.(row.variationNode!)}
                            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                            title="View Details"
                        >
                            <Eye size={13} />
                        </button>
                        <button
                            onClick={() => onEditProduct?.(row.variationNode!)}
                            className="p-1 rounded hover:bg-blue-100 text-blue-500 hover:text-blue-700"
                            title="Edit Variation"
                        >
                            <Edit size={13} />
                        </button>
                        <button
                            onClick={() => onEditBom?.(row.variationNode!)}
                            className="p-1 rounded hover:bg-purple-100 text-purple-500 hover:text-purple-700"
                            title="Edit BOM"
                        >
                            <GitBranch size={13} />
                        </button>
                    </div>
                )}
            </td>
        </tr>
    );
});

/**
 * SKUs Table - Expanded view for variation SKUs
 */
interface SkusTableProps {
    skus: ProductTreeNode[];
}

const SkusTable = memo(function SkusTable({ skus }: SkusTableProps) {
    // Sort SKUs by size order
    const sortedSkus = useMemo(() => {
        return [...skus].sort((a, b) => sortBySizeOrder(a.size || '', b.size || ''));
    }, [skus]);

    return (
        <div className="border rounded bg-white overflow-hidden shadow-sm">
            <table className="w-full text-xs">
                <thead className="bg-blue-50/70 border-b">
                    <tr>
                        <th className="text-left px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase w-12">
                            Size
                        </th>
                        <th className="text-left px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase">
                            SKU Code
                        </th>
                        <th className="text-right px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase w-16">
                            MRP
                        </th>
                        <th className="text-right px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase w-14">
                            Cons
                        </th>
                        <th className="text-right px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase w-14">
                            BOM
                        </th>
                        <th className="text-right px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase w-14">
                            Stock
                        </th>
                        <th className="text-right px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase w-14">
                            Shop Stk
                        </th>
                        <th className="text-right px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase w-14">
                            30d
                        </th>
                        <th className="text-center px-2 py-1 text-[10px] font-semibold text-blue-700 uppercase w-14">
                            Status
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {sortedSkus.map((sku) => (
                        <tr key={sku.id} className="hover:bg-blue-50/30">
                            <td className="px-2 py-0.5 font-semibold text-gray-900">{sku.size}</td>
                            <td className="px-2 py-0.5 font-mono text-[11px] text-gray-600">
                                {sku.skuCode}
                            </td>
                            <td className="px-2 py-0.5 text-right tabular-nums font-medium">
                                {sku.mrp ? `₹${sku.mrp.toLocaleString()}` : '-'}
                            </td>
                            <td className="px-2 py-0.5 text-right tabular-nums text-gray-600">
                                {sku.fabricConsumption != null ? `${sku.fabricConsumption.toFixed(2)}m` : '-'}
                            </td>
                            <td className="px-2 py-0.5 text-right tabular-nums text-gray-600">
                                {sku.bomCost != null ? `₹${Math.round(sku.bomCost).toLocaleString()}` : '-'}
                            </td>
                            <td className="px-2 py-0.5 text-right">
                                <span
                                    className={`tabular-nums font-semibold ${
                                        (sku.currentBalance || 0) === 0
                                            ? 'text-red-600'
                                            : (sku.currentBalance || 0) < 3
                                            ? 'text-amber-600'
                                            : 'text-green-600'
                                    }`}
                                >
                                    {(sku.currentBalance || 0).toLocaleString()}
                                </span>
                            </td>
                            <td className="px-2 py-0.5 text-right">
                                <span className="tabular-nums text-gray-600">
                                    {sku.shopifyStock != null ? sku.shopifyStock.toLocaleString() : '-'}
                                </span>
                            </td>
                            <td className="px-2 py-0.5 text-right">
                                <span className="tabular-nums text-gray-600">
                                    {sku.sales30DayUnits != null && sku.sales30DayUnits > 0
                                        ? sku.sales30DayUnits.toLocaleString()
                                        : '-'}
                                </span>
                            </td>
                            <td className="px-2 py-0.5 text-center">
                                {(sku.currentBalance || 0) === 0 ? (
                                    <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">
                                        Out
                                    </Badge>
                                ) : (sku.currentBalance || 0) < 3 ? (
                                    <Badge variant="warning" className="text-[10px] px-1 py-0 h-4">
                                        Low
                                    </Badge>
                                ) : (
                                    <Badge variant="success" className="text-[10px] px-1 py-0 h-4">
                                        OK
                                    </Badge>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
});

/**
 * ResizableHeader - Table header with drag-to-resize handle
 */
interface ResizableHeaderProps {
    colId: string;
    onResizeStart: (e: React.MouseEvent, colId: string) => void;
    isResizing: boolean;
    className?: string;
    children: React.ReactNode;
}

const ResizableHeader = memo(function ResizableHeader({
    colId,
    onResizeStart,
    isResizing,
    className = '',
    children,
}: ResizableHeaderProps) {
    return (
        <th className={`relative px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider ${className}`}>
            <span className="whitespace-nowrap">{children}</span>
            {/* Resize handle - wider hit area with visible indicator */}
            <div
                className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-20 group"
                onMouseDown={(e) => onResizeStart(e, colId)}
            >
                <div
                    className={`absolute right-0 top-1 bottom-1 w-0.5 rounded transition-colors ${
                        isResizing ? 'bg-blue-500' : 'bg-gray-300 group-hover:bg-blue-400'
                    }`}
                />
            </div>
        </th>
    );
});
