/**
 * SkuWiseDataTable - Flat SKU spreadsheet view
 *
 * Every row is a single SKU with all data filled in.
 * Product boundaries marked with a heavier border.
 * Repeated product/colour values are dimmed for visual grouping.
 */

import { useState, useMemo, useEffect, memo, useCallback } from 'react';
import {
    ChevronRight,
    ChevronLeft,
    Layers,
    Box,
    Package,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProductTreeNode, ShopifyStatus } from './types';
import { flattenToSkuRows, filterSkuRows } from './utils/flattenToSkuRows';
import type { SkuViewRow } from './utils/flattenToSkuRows';

interface SkuWiseDataTableProps {
    filteredData: ProductTreeNode[];
    searchQuery?: string;
    onViewProduct?: (node: ProductTreeNode) => void;
    onEditBom?: (node: ProductTreeNode) => void;
    onEditProduct?: (node: ProductTreeNode) => void;
}

const PAGE_SIZE = 500;

/** Format currency as Indian Rupees */
function formatCurrency(value: number | undefined | null): string {
    if (value == null) return '-';
    return `\u20B9${Math.round(value).toLocaleString('en-IN')}`;
}

/**
 * Shopify status dot — compact inline indicator
 */
const ShopifyDot = memo(function ShopifyDot({ status }: { status?: ShopifyStatus }) {
    if (!status || status === 'not_linked' || status === 'not_cached' || status === 'unknown') {
        return <span className="text-gray-300">-</span>;
    }
    const config =
        status === 'active'
            ? { dot: 'bg-green-500', text: 'text-green-700', label: 'Live' }
            : status === 'draft'
            ? { dot: 'bg-amber-400', text: 'text-amber-600', label: 'Draft' }
            : { dot: 'bg-gray-400', text: 'text-gray-500', label: 'Arch' };
    return (
        <span className={`inline-flex items-center gap-1 ${config.text}`}>
            <span className={`w-2 h-2 rounded-full ${config.dot}`} />
            <span>{config.label}</span>
        </span>
    );
});

export function SkuWiseDataTable({
    filteredData,
    searchQuery,
    onEditProduct,
}: SkuWiseDataTableProps) {
    const [pageIndex, setPageIndex] = useState(0);

    // Transform to flat SKU rows
    const allRows = useMemo(() => flattenToSkuRows(filteredData), [filteredData]);

    // Apply search filter
    const filteredRows = useMemo(
        () => (searchQuery ? filterSkuRows(allRows, searchQuery) : allRows),
        [allRows, searchQuery]
    );

    // Calculate summary stats
    const summary = useMemo(() => {
        const productIds = new Set<string>();
        const variationIds = new Set<string>();
        let totalStock = 0;

        for (const row of filteredRows) {
            productIds.add(row.productId);
            variationIds.add(row.variationId);
            totalStock += row.currentBalance || 0;
        }

        return {
            products: productIds.size,
            variations: variationIds.size,
            skus: filteredRows.length,
            totalStock,
        };
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

    // Click handler
    const handleRowClick = useCallback(
        (row: SkuViewRow) => {
            onEditProduct?.(row.skuNode);
        },
        [onEditProduct]
    );

    return (
        <div className="flex flex-col h-full">
            {/* Summary Stats */}
            <div className="flex items-center gap-3 px-1 mb-2 flex-shrink-0 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs">
                    <Package size={13} className="text-indigo-400" />
                    <span className="text-gray-600">{summary.products} Products</span>
                </div>
                <div className="w-px h-3 bg-gray-200" />
                <div className="flex items-center gap-1.5 text-xs">
                    <Layers size={13} className="text-purple-400" />
                    <span className="text-gray-600">{summary.variations} Variations</span>
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

            {/* Table */}
            <div className="border rounded-md overflow-hidden flex-1 min-h-0 flex flex-col">
                <div className="overflow-auto flex-1">
                    <table className="w-full text-[11px] border-collapse table-fixed">
                        <colgroup>
                            <col style={{ width: 72 }} />   {/* Image */}
                            <col style={{ width: 120 }} />  {/* SKU */}
                            <col />                         {/* Product / Colour / Size */}
                            <col style={{ width: 90 }} />   {/* Style Code */}
                            <col style={{ width: 100 }} />  {/* Fabric */}
                            <col style={{ width: 55 }} />   {/* Shopify */}
                            <col style={{ width: 68 }} />   {/* MRP */}
                            <col style={{ width: 68 }} />   {/* Shopify ₹ */}
                            <col style={{ width: 68 }} />   {/* Sale ₹ */}
                            <col style={{ width: 42 }} />   {/* Sale % */}
                            <col style={{ width: 60 }} />   {/* BOM */}
                            <col style={{ width: 42 }} />   {/* MRP× */}
                            <col style={{ width: 42 }} />   {/* Sale× */}
                        </colgroup>
                        <thead className="sticky top-0 z-10">
                            <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="px-1 py-1.5" />
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-left">SKU</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-left">Product</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-left">Style</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-left">Fabric</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-center">Shpfy</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">MRP</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">Shopify</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">Sale</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">Off%</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">BOM</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">MRP×</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">Sale×</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedRows.length === 0 ? (
                                <tr>
                                    <td colSpan={13} className="h-24 text-center text-muted-foreground">
                                        No SKUs found.
                                    </td>
                                </tr>
                            ) : (
                                paginatedRows.map((row) => (
                                    <SkuRow
                                        key={row.id}
                                        row={row}
                                        onClick={handleRowClick}
                                    />
                                ))
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
                        {filteredRows.length} SKUs
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
 * Single SKU row with conditional product/variation display and border styling
 */
interface SkuRowProps {
    row: SkuViewRow;
    onClick: (row: SkuViewRow) => void;
}

const SkuRow = memo(function SkuRow({ row, onClick }: SkuRowProps) {
    const mrpMultiple =
        row.mrp != null && row.bomCost != null && row.bomCost > 0
            ? row.mrp / row.bomCost
            : null;

    const actualSellingPrice = row.sellingPrice ?? row.shopifySalePrice;
    const saleMultiple =
        actualSellingPrice != null && row.bomCost != null && row.bomCost > 0
            ? actualSellingPrice / row.bomCost
            : null;

    const hasPriceMismatch =
        row.shopifyPrice != null && row.mrp != null && Math.round(row.shopifyPrice) !== Math.round(row.mrp);

    // Grouping borders: thick for products, medium for variations, thin for SKUs
    const borderClass = row.isFirstOfProduct
        ? 'border-t-2 border-t-gray-400'
        : row.isFirstOfVariation
        ? 'border-t border-t-gray-300'
        : 'border-t border-t-gray-100';

    return (
        <tr
            className={`cursor-pointer h-7 hover:bg-blue-50/40 ${borderClass}`}
            onClick={() => onClick(row)}
        >
            {/* Image — spans all SKUs of this variation */}
            {row.isFirstOfVariation && (
                <td
                    className="px-1 py-0.5 align-middle"
                    rowSpan={row.variationSkuCount}
                >
                    {(row.variationImageUrl || row.productImageUrl) ? (
                        <img
                            src={row.variationImageUrl || row.productImageUrl}
                            alt=""
                            className="w-full rounded object-cover"
                            loading="lazy"
                        />
                    ) : (
                        <span className="block w-full aspect-square rounded bg-gray-100" />
                    )}
                </td>
            )}

            {/* SKU */}
            <td className="px-2 py-0 font-mono text-gray-600 truncate">
                {row.skuCode}
            </td>

            {/* Product / Colour / Size */}
            <td className="px-2 py-0">
                <span className="inline-flex items-center gap-1.5 min-w-0">
                    {row.colorHex && (
                        <span
                            className="w-2.5 h-2.5 rounded-full border border-gray-200 flex-shrink-0"
                            style={{ backgroundColor: row.colorHex }}
                        />
                    )}
                    <span className={`truncate ${row.isFirstOfProduct ? 'font-medium text-gray-900' : 'text-gray-400'}`}>
                        {row.productName}
                    </span>
                    <span className="text-gray-400 flex-shrink-0">/</span>
                    <span className={`flex-shrink-0 ${row.isFirstOfVariation ? 'text-gray-700' : 'text-gray-400'}`}>
                        {row.colorName}
                    </span>
                    <span className="text-gray-400 flex-shrink-0">/</span>
                    <span className="font-medium text-gray-900 flex-shrink-0">{row.size}</span>
                </span>
            </td>

            {/* Style Code */}
            <td className="px-2 py-0 truncate font-mono text-gray-500">
                {row.styleCode || '-'}
            </td>

            {/* Fabric */}
            <td className="px-2 py-0 truncate text-gray-500">
                {row.fabricColourName || row.fabricColourCode || '-'}
            </td>

            {/* Shopify dot */}
            <td className="px-1 py-0 text-center">
                <ShopifyDot status={row.shopifyStatus} />
            </td>

            {/* MRP */}
            <td className="px-2 py-0 text-right tabular-nums">
                {formatCurrency(row.mrp)}
            </td>

            {/* Shopify Price */}
            <td className={`px-2 py-0 text-right tabular-nums ${hasPriceMismatch ? 'text-amber-600 font-medium' : ''}`}>
                {formatCurrency(row.shopifyPrice)}
            </td>

            {/* Sale Price */}
            <td className="px-2 py-0 text-right tabular-nums">
                {row.shopifySalePrice != null ? (
                    <span className="text-green-600">{formatCurrency(row.shopifySalePrice)}</span>
                ) : (
                    <span className="text-gray-300">-</span>
                )}
            </td>

            {/* Sale % */}
            <td className="px-1 py-0 text-right tabular-nums">
                {row.shopifySalePercent != null ? (
                    <span
                        className={
                            row.shopifySalePercent > 30
                                ? 'text-red-500'
                                : row.shopifySalePercent > 15
                                ? 'text-amber-600'
                                : 'text-green-600'
                        }
                    >
                        {row.shopifySalePercent}%
                    </span>
                ) : (
                    <span className="text-gray-300">-</span>
                )}
            </td>

            {/* BOM */}
            <td className="px-2 py-0 text-right tabular-nums text-gray-600">
                {formatCurrency(row.bomCost)}
            </td>

            {/* MRP× */}
            <td className="px-1 py-0 text-right tabular-nums">
                {mrpMultiple != null ? (
                    <span
                        className={
                            mrpMultiple >= 3
                                ? 'text-green-600'
                                : mrpMultiple >= 2
                                ? 'text-gray-600'
                                : 'text-red-500'
                        }
                    >
                        {mrpMultiple.toFixed(1)}×
                    </span>
                ) : (
                    <span className="text-gray-300">-</span>
                )}
            </td>

            {/* Sale× */}
            <td className="px-1 py-0 text-right tabular-nums">
                {saleMultiple != null ? (
                    <span
                        className={
                            saleMultiple >= 3
                                ? 'text-green-600'
                                : saleMultiple >= 2
                                ? 'text-gray-600'
                                : 'text-red-500'
                        }
                    >
                        {saleMultiple.toFixed(1)}×
                    </span>
                ) : (
                    <span className="text-gray-300">-</span>
                )}
            </td>
        </tr>
    );
});
