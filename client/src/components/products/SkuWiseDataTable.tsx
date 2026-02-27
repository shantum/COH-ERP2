/**
 * SkuWiseDataTable - Variation-grouped product catalog
 *
 * Each row is a variation (product + colour).
 * Sizes shown as inline badges with per-size stock.
 * Product boundaries marked with heavier borders.
 */

import { useState, useMemo, useEffect, memo, useCallback } from 'react';
import { Package, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProductTreeNode, ShopifyStatus } from './types';
import { flattenToVariationRows, filterVariationRows } from './utils/flattenToVariationRows';
import type { VariationRow } from './utils/flattenToVariationRows';

interface SkuWiseDataTableProps {
    filteredData: ProductTreeNode[];
    searchQuery?: string;
    onViewProduct?: (node: ProductTreeNode) => void;
    onEditBom?: (node: ProductTreeNode) => void;
    onEditProduct?: (node: ProductTreeNode) => void;
}

const BATCH_SIZE = 200;

import { formatCurrencyOrDash as formatCurrency } from '../../utils/formatting';

/**
 * Shopify status dot
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
    const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

    // Transform to variation rows
    const allRows = useMemo(() => flattenToVariationRows(filteredData), [filteredData]);

    // Apply search filter
    const filteredRows = useMemo(
        () => (searchQuery ? filterVariationRows(allRows, searchQuery) : allRows),
        [allRows, searchQuery]
    );

    // Summary stats
    const summary = useMemo(() => {
        const productIds = new Set<string>();
        let totalStock = 0;
        let totalSkus = 0;

        for (const row of filteredRows) {
            productIds.add(row.productId);
            totalStock += row.totalStock;
            totalSkus += row.sizes.length;
        }

        return {
            products: productIds.size,
            variations: filteredRows.length,
            skus: totalSkus,
            totalStock,
        };
    }, [filteredRows]);

    const visibleRows = useMemo(
        () => filteredRows.slice(0, visibleCount),
        [filteredRows, visibleCount]
    );

    const hasMore = visibleCount < filteredRows.length;

    useEffect(() => {
        setVisibleCount(BATCH_SIZE);
    }, [searchQuery, filteredData]);

    const handleRowClick = useCallback(
        (row: VariationRow) => {
            onEditProduct?.(row.variationNode);
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
                            <col style={{ width: 64 }} />   {/* Image */}
                            <col />                         {/* Product - Color */}
                            <col style={{ width: 90 }} />   {/* Style */}
                            <col style={{ width: 160 }} />  {/* Sizes */}
                            <col style={{ width: 50 }} />   {/* Stock */}
                            <col style={{ width: 68 }} />   {/* MRP */}
                            <col style={{ width: 55 }} />   {/* Status */}
                            <col style={{ width: 160 }} />  {/* Fabric */}
                        </colgroup>
                        <thead className="sticky top-0 z-10">
                            <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="px-1 py-1.5" />
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-left">Product - Colour</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-left">Style</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-left">Sizes</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">Stock</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">MRP</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-center">Shpfy</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-left">Fabric</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleRows.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="h-24 text-center text-muted-foreground">
                                        No variations found.
                                    </td>
                                </tr>
                            ) : (
                                visibleRows.map((row) => (
                                    <VariationRowComponent
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

            {/* Load More */}
            {filteredRows.length > 0 && (
                <div className="flex items-center justify-between px-3 py-2 border rounded bg-gray-50/50 mt-2 flex-shrink-0">
                    <div className="text-xs text-muted-foreground">
                        Showing {Math.min(visibleCount, filteredRows.length)} of {filteredRows.length} variations
                    </div>
                    {hasMore && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setVisibleCount((c) => Math.min(c + BATCH_SIZE, filteredRows.length))}
                            className="h-7 px-3 text-xs"
                        >
                            Load more ({Math.min(BATCH_SIZE, filteredRows.length - visibleCount)})
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Single variation row with inline size badges
 */
interface VariationRowProps {
    row: VariationRow;
    onClick: (row: VariationRow) => void;
}

const VariationRowComponent = memo(function VariationRowComponent({ row, onClick }: VariationRowProps) {
    const borderClass = row.isFirstOfProduct
        ? 'border-t-2 border-t-gray-400'
        : 'border-t border-t-gray-200';

    return (
        <tr
            className={`cursor-pointer h-9 hover:bg-blue-50/40 ${borderClass}`}
            onClick={() => onClick(row)}
        >
            {/* Image */}
            <td className="px-1 py-0.5 align-middle">
                {row.imageUrl ? (
                    <img
                        src={row.imageUrl}
                        alt=""
                        className="w-14 h-14 rounded object-cover"
                        loading="lazy"
                    />
                ) : (
                    <span className="block w-14 h-14 rounded bg-gray-100" />
                )}
            </td>

            {/* Product - Colour */}
            <td className="px-2 py-0">
                <div className="flex items-center gap-1.5 min-w-0">
                    {row.colorHex && (
                        <span
                            className="w-3 h-3 rounded-full border border-gray-200 flex-shrink-0"
                            style={{ backgroundColor: row.colorHex }}
                        />
                    )}
                    <div className="min-w-0">
                        <div className="truncate font-medium text-gray-900 text-xs">
                            {row.displayName}
                        </div>
                        {row.isFirstOfProduct && row.productVariationCount > 1 && (
                            <div className="text-[10px] text-gray-400">
                                {row.productVariationCount} colours
                            </div>
                        )}
                    </div>
                </div>
            </td>

            {/* Style Code */}
            <td className="px-2 py-0 truncate font-mono text-gray-500 text-[10px]">
                {row.styleCode || '-'}
            </td>

            {/* Sizes - plain badges */}
            <td className="px-2 py-0">
                <div className="flex flex-wrap gap-0.5">
                    {row.sizes.map(s => (
                        <span
                            key={s.skuId}
                            className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] leading-4 font-medium ${
                                s.stock > 0
                                    ? 'bg-green-50 text-green-700 border border-green-200'
                                    : 'bg-gray-50 text-gray-400 border border-gray-200'
                            }`}
                            title={`${s.skuCode}: ${s.stock} in stock`}
                        >
                            {s.size}
                        </span>
                    ))}
                </div>
            </td>

            {/* Total Stock */}
            <td className="px-2 py-0 text-right tabular-nums">
                {row.totalStock > 0 ? (
                    <span className="font-semibold text-gray-800">{row.totalStock}</span>
                ) : (
                    <span className="text-gray-300">0</span>
                )}
            </td>

            {/* MRP */}
            <td className="px-2 py-0 text-right tabular-nums">
                {formatCurrency(row.mrp)}
            </td>

            {/* Shopify Status dot */}
            <td className="px-1 py-0 text-center">
                <ShopifyDot status={row.shopifyStatus} />
            </td>

            {/* Fabric */}
            <td className="px-2 py-0 truncate text-gray-500">
                {row.fabricName ? (
                    <>
                        {row.fabricName}
                        {row.fabricColourName && (
                            <span className="text-gray-400"> | {row.fabricColourName}</span>
                        )}
                    </>
                ) : (
                    <span className="text-gray-300">-</span>
                )}
            </td>
        </tr>
    );
});
