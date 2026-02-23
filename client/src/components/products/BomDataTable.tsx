/**
 * BomDataTable - Flat SKU spreadsheet with BOM/cost columns
 *
 * Same row structure as SkuWiseDataTable (one row per SKU),
 * but columns focus on BOM cost, margins, and stock value.
 */

import { useState, useMemo, useEffect, memo, useCallback } from 'react';
import {
    Layers,
    Box,
    Package,
    AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProductTreeNode } from './types';
import { flattenToSkuRows, filterSkuRows } from './utils/flattenToSkuRows';
import type { SkuViewRow } from './utils/flattenToSkuRows';

interface BomDataTableProps {
    filteredData: ProductTreeNode[];
    searchQuery?: string;
    onEditProduct?: (node: ProductTreeNode) => void;
}

const BATCH_SIZE = 250;

function formatCurrency(value: number | undefined | null): string {
    if (value == null) return '-';
    return `\u20B9${Math.round(value).toLocaleString('en-IN')}`;
}

function formatPercent(value: number | undefined | null): string {
    if (value == null) return '-';
    return `${value.toFixed(0)}%`;
}

export function BomDataTable({
    filteredData,
    searchQuery,
    onEditProduct,
}: BomDataTableProps) {
    const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

    const allRows = useMemo(() => flattenToSkuRows(filteredData), [filteredData]);

    const filteredRows = useMemo(
        () => (searchQuery ? filterSkuRows(allRows, searchQuery) : allRows),
        [allRows, searchQuery]
    );

    // BOM-specific summary stats
    const summary = useMemo(() => {
        const productIds = new Set<string>();
        const variationIds = new Set<string>();
        let totalBomValue = 0;
        let totalMrpValue = 0;
        let withBom = 0;
        let withoutBom = 0;
        let totalStockValue = 0;

        for (const row of filteredRows) {
            productIds.add(row.productId);
            variationIds.add(row.variationId);

            const bom = row.bomCost ?? 0;
            const stock = row.currentBalance ?? 0;

            if (bom > 0) {
                withBom++;
                totalBomValue += bom;
                totalStockValue += bom * stock;
            } else {
                withoutBom++;
            }

            if (row.mrp) totalMrpValue += row.mrp;
        }

        const avgMargin = totalMrpValue > 0 && totalBomValue > 0
            ? ((totalMrpValue - totalBomValue) / totalMrpValue) * 100
            : null;

        return {
            products: productIds.size,
            variations: variationIds.size,
            skus: filteredRows.length,
            withBom,
            withoutBom,
            avgMargin,
            totalStockValue,
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
                    <span className="text-gray-600">
                        {summary.withBom} with BOM
                    </span>
                </div>
                {summary.withoutBom > 0 && (
                    <>
                        <div className="w-px h-3 bg-gray-200" />
                        <div className="flex items-center gap-1.5 text-xs">
                            <AlertTriangle size={13} className="text-amber-500" />
                            <span className="text-amber-600 font-medium">
                                {summary.withoutBom} no BOM
                            </span>
                        </div>
                    </>
                )}
                {summary.avgMargin != null && (
                    <>
                        <div className="w-px h-3 bg-gray-200" />
                        <div className="flex items-center gap-1.5 text-xs">
                            <span className="text-gray-600">Avg Margin</span>
                            <span className={`font-semibold ${
                                summary.avgMargin >= 60 ? 'text-green-600' :
                                summary.avgMargin >= 40 ? 'text-gray-600' :
                                'text-red-500'
                            }`}>
                                {summary.avgMargin.toFixed(0)}%
                            </span>
                        </div>
                    </>
                )}
                <div className="w-px h-3 bg-gray-200" />
                <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-gray-600">Stock Value</span>
                    <span className="font-semibold text-green-600">
                        {formatCurrency(summary.totalStockValue)}
                    </span>
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
                            <col style={{ width: 180 }} />  {/* Fabric */}
                            <col style={{ width: 68 }} />   {/* BOM */}
                            <col style={{ width: 68 }} />   {/* MRP */}
                            <col style={{ width: 68 }} />   {/* Margin */}
                            <col style={{ width: 50 }} />   {/* Margin% */}
                            <col style={{ width: 42 }} />   {/* MRP× */}
                            <col style={{ width: 55 }} />   {/* Stock */}
                            <col style={{ width: 72 }} />   {/* Value */}
                        </colgroup>
                        <thead className="sticky top-0 z-10">
                            <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="px-1 py-1.5" />
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-left">SKU</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-left">Product</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-left">Fabric</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">BOM</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">MRP</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">Margin</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">Mgn%</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">MRP×</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">Stock</th>
                                <th className="px-2 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide text-right">Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleRows.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="h-24 text-center text-muted-foreground">
                                        No SKUs found.
                                    </td>
                                </tr>
                            ) : (
                                visibleRows.map((row) => (
                                    <BomRow
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
                        Showing {Math.min(visibleCount, filteredRows.length)} of {filteredRows.length} SKUs
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
 * Single BOM row — same grouping borders as SkuRow, different columns
 */
interface BomRowProps {
    row: SkuViewRow;
    onClick: (row: SkuViewRow) => void;
}

const BomRow = memo(function BomRow({ row, onClick }: BomRowProps) {
    const bom = row.bomCost ?? 0;
    const mrp = row.mrp ?? 0;
    const margin = mrp > 0 && bom > 0 ? mrp - bom : null;
    const marginPct = mrp > 0 && bom > 0 ? ((mrp - bom) / mrp) * 100 : null;
    const mrpMultiple = bom > 0 && mrp > 0 ? mrp / bom : null;
    const stock = row.currentBalance ?? 0;
    const stockValue = bom > 0 ? stock * bom : null;

    const borderClass = row.isFirstOfProduct
        ? 'border-t-2 border-t-gray-400'
        : row.isFirstOfVariation
        ? 'border-t border-t-gray-300'
        : 'border-t border-t-gray-100';

    const noBom = !row.bomCost || row.bomCost === 0;

    return (
        <tr
            className={`cursor-pointer h-7 hover:bg-blue-50/40 ${borderClass} ${noBom ? 'bg-amber-50/30' : ''}`}
            onClick={() => onClick(row)}
        >
            {/* Image */}
            {row.isFirstOfVariation && (
                <td className="px-1 py-0.5 align-middle" rowSpan={row.variationSkuCount}>
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

            {/* BOM Cost */}
            <td className={`px-2 py-0 text-right tabular-nums ${noBom ? 'text-amber-500' : 'text-gray-700 font-medium'}`}>
                {noBom ? <span className="text-amber-400 text-[10px]">none</span> : formatCurrency(row.bomCost)}
            </td>

            {/* MRP */}
            <td className="px-2 py-0 text-right tabular-nums">
                {formatCurrency(row.mrp)}
            </td>

            {/* Margin */}
            <td className={`px-2 py-0 text-right tabular-nums ${
                margin != null
                    ? margin >= 0 ? 'text-green-600' : 'text-red-500'
                    : ''
            }`}>
                {formatCurrency(margin)}
            </td>

            {/* Margin % */}
            <td className={`px-1 py-0 text-right tabular-nums ${
                marginPct != null
                    ? marginPct >= 60 ? 'text-green-600'
                    : marginPct >= 40 ? 'text-gray-600'
                    : 'text-red-500'
                    : ''
            }`}>
                {formatPercent(marginPct)}
            </td>

            {/* MRP× */}
            <td className="px-1 py-0 text-right tabular-nums">
                {mrpMultiple != null ? (
                    <span className={
                        mrpMultiple >= 3 ? 'text-green-600'
                        : mrpMultiple >= 2 ? 'text-gray-600'
                        : 'text-red-500'
                    }>
                        {mrpMultiple.toFixed(1)}×
                    </span>
                ) : (
                    <span className="text-gray-300">-</span>
                )}
            </td>

            {/* Stock */}
            <td className="px-2 py-0 text-right tabular-nums text-gray-600">
                {stock > 0 ? stock : <span className="text-gray-300">0</span>}
            </td>

            {/* Stock Value */}
            <td className="px-2 py-0 text-right tabular-nums text-gray-500">
                {stockValue != null && stockValue > 0 ? formatCurrency(stockValue) : <span className="text-gray-300">-</span>}
            </td>
        </tr>
    );
});
