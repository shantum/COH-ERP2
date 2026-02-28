/**
 * SkuWiseDataTable - Variation-grouped product catalog (Grid Card layout)
 *
 * Each card is a variation (product + colour).
 * Responsive grid: 1-col mobile, 2-col tablet, 3-col desktop.
 * Product boundaries marked with full-width separator headers.
 */

import { useState, useMemo, useEffect, memo, useCallback, Fragment } from 'react';
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
 * Shopify status pill badge
 */
const ShopifyStatusPill = memo(function ShopifyStatusPill({ status }: { status?: ShopifyStatus }) {
    if (!status || status === 'not_linked' || status === 'not_cached' || status === 'unknown') {
        return <span className="text-gray-300 text-xs">&mdash;</span>;
    }
    const config =
        status === 'active'
            ? { dot: 'bg-emerald-500', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Live' }
            : status === 'draft'
            ? { dot: 'bg-amber-500', bg: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Draft' }
            : { dot: 'bg-gray-400', bg: 'bg-gray-100 text-gray-500 border-gray-200', label: 'Arch' };
    return (
        <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${config.bg}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
            {config.label}
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

    const handleCardClick = useCallback(
        (row: VariationRow) => {
            onEditProduct?.(row.variationNode);
        },
        [onEditProduct]
    );

    return (
        <div className="flex flex-col h-full">
            {/* Summary Stats */}
            <div className="flex items-center gap-3 px-1 mb-3 flex-shrink-0 flex-wrap">
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

            {/* Card Grid */}
            <div className="flex-1 min-h-0 overflow-auto">
                {visibleRows.length === 0 ? (
                    <div className="flex items-center justify-center h-24 text-sm text-gray-400">
                        No variations found.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-2">
                        {visibleRows.map((row) => (
                            <Fragment key={row.id}>
                                {row.isFirstOfProduct && row.productVariationCount > 1 && (
                                    <div className="col-span-full flex items-center gap-2 pt-2 pb-1 first:pt-0">
                                        <span className="text-xs font-semibold text-gray-700 tracking-wide">
                                            {row.productName}
                                        </span>
                                        <span className="text-xs text-gray-400">
                                            {row.productVariationCount} colours
                                        </span>
                                        <div className="flex-1 h-px bg-gray-200" />
                                    </div>
                                )}
                                <VariationCard
                                    row={row}
                                    onClick={handleCardClick}
                                />
                            </Fragment>
                        ))}
                    </div>
                )}
            </div>

            {/* Load More */}
            {filteredRows.length > 0 && (
                <div className="flex items-center justify-between px-3 py-2 border rounded-lg bg-gray-50/50 mt-2 flex-shrink-0">
                    <div className="text-xs text-gray-500">
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
 * Single variation card
 */
interface VariationCardProps {
    row: VariationRow;
    onClick: (row: VariationRow) => void;
}

const VariationCard = memo(function VariationCard({ row, onClick }: VariationCardProps) {
    return (
        <div
            className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all"
            onClick={() => onClick(row)}
        >
            {/* Top: Image + Name */}
            <div className="flex items-start gap-3">
                {row.imageUrl ? (
                    <img
                        src={row.imageUrl}
                        alt=""
                        className="w-14 h-14 rounded-lg object-cover flex-shrink-0 bg-gray-100"
                        loading="lazy"
                    />
                ) : row.colorHex ? (
                    <div
                        className="w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0 border border-gray-200/50"
                        style={{ background: `${row.colorHex}20` }}
                    >
                        <div
                            className="w-8 h-8 rounded-full border border-gray-200/30"
                            style={{ backgroundColor: row.colorHex }}
                        />
                    </div>
                ) : (
                    <div className="w-14 h-14 rounded-lg bg-gray-100 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                        {row.productName}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        {row.colorHex && (
                            <span
                                className="w-3.5 h-3.5 rounded-full border border-gray-200/50 flex-shrink-0"
                                style={{ backgroundColor: row.colorHex }}
                            />
                        )}
                        <span className="text-xs text-gray-500">{row.colorName}</span>
                    </div>
                    {row.styleCode && (
                        <code className="font-mono text-[10px] text-gray-400 mt-1 block">
                            {row.styleCode}
                        </code>
                    )}
                </div>
            </div>

            {/* Sizes */}
            <div className="flex flex-wrap gap-1">
                {row.sizes.map(s => (
                    <span
                        key={s.skuId}
                        className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${
                            s.stock > 0
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-gray-50 text-gray-400 border border-gray-200'
                        }`}
                        title={`${s.skuCode}: ${s.stock} in stock`}
                    >
                        {s.size}
                    </span>
                ))}
            </div>

            {/* Bottom meta */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <div className="flex items-center gap-4 text-xs">
                    <div className="flex flex-col">
                        <span className="text-gray-400">Stock</span>
                        <span className={row.totalStock > 0 ? 'font-semibold text-gray-900' : 'text-gray-300'}>
                            {row.totalStock}
                        </span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-gray-400">MRP</span>
                        <span className="font-semibold text-gray-900">{formatCurrency(row.mrp)}</span>
                    </div>
                </div>
                <ShopifyStatusPill status={row.shopifyStatus} />
            </div>

            {/* Fabric info */}
            {row.fabricName && (
                <div className="text-[11px] text-gray-400">
                    {row.fabricName}
                    {row.fabricColourName && (
                        <span> | {row.fabricColourName}</span>
                    )}
                </div>
            )}
        </div>
    );
});
