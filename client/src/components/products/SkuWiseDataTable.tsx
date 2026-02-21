/**
 * SkuWiseDataTable - Flat SKU view for Products
 *
 * Every row is a single SKU (one size of one color of one product).
 * Product and variation info shown only on first row of each group.
 * Single border between variations, double border between products.
 *
 * Columns: Barcode/SKU | Product | Colour | Size | Style Code | Fabric Colour |
 *          Shopify (status + variant ID + product ID) | ERP Price | Shopify Price |
 *          Sale Price | Sale % | BOM | Multiple
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

const PAGE_SIZE = 200;

/** Format currency as Indian Rupees */
function formatCurrency(value: number | undefined | null): string {
    if (value == null) return '-';
    return `\u20B9${Math.round(value).toLocaleString('en-IN')}`;
}

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
            <div className="rounded-md border overflow-hidden flex-1 min-h-0 flex flex-col">
                <div className="overflow-auto flex-1">
                    <table className="w-full text-sm border-collapse table-fixed">
                        <colgroup>
                            <col style={{ width: 160 }} />  {/* Barcode/SKU */}
                            <col style={{ width: 180 }} />  {/* Product */}
                            <col style={{ width: 55 }} />   {/* Gender */}
                            <col style={{ width: 110 }} />  {/* Colour */}
                            <col style={{ width: 50 }} />   {/* Size */}
                            <col style={{ width: 90 }} />   {/* Style Code */}
                            <col style={{ width: 130 }} />  {/* Fabric Colour */}
                            <col style={{ width: 180 }} />  {/* Shopify */}
                            <col style={{ width: 70 }} />   {/* ERP Price */}
                            <col style={{ width: 80 }} />   {/* Shopify Price */}
                            <col style={{ width: 80 }} />   {/* Sale Price */}
                            <col style={{ width: 55 }} />   {/* Sale % */}
                            <col style={{ width: 65 }} />   {/* BOM */}
                            <col style={{ width: 55 }} />   {/* MRP× */}
                            <col style={{ width: 55 }} />   {/* Sale× */}
                        </colgroup>
                        <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
                            <tr className="border-b border-gray-200">
                                <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Barcode/SKU
                                </th>
                                <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Product
                                </th>
                                <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Gender
                                </th>
                                <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Colour
                                </th>
                                <th className="text-center px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Size
                                </th>
                                <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Style Code
                                </th>
                                <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Fabric Colour
                                </th>
                                <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Shopify
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    ERP Price
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Shopify Price
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Sale Price
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Sale %
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    BOM
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    MRP&times;
                                </th>
                                <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Sale&times;
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedRows.length === 0 ? (
                                <tr>
                                    <td colSpan={15} className="h-24 text-center text-muted-foreground">
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
    // MRP× uses ERP MRP (full retail price)
    const mrpMultiple =
        row.mrp != null && row.bomCost != null && row.bomCost > 0
            ? row.mrp / row.bomCost
            : null;

    // Sale× uses ERP sellingPrice (discounted), fallback to Shopify sale price
    const actualSellingPrice = row.sellingPrice ?? row.shopifySalePrice;
    const saleMultiple =
        actualSellingPrice != null && row.bomCost != null && row.bomCost > 0
            ? actualSellingPrice / row.bomCost
            : null;

    // Price mismatch: Shopify price differs from ERP price
    const hasPriceMismatch =
        row.shopifyPrice != null && row.mrp != null && Math.round(row.shopifyPrice) !== Math.round(row.mrp);

    // Border classes based on grouping
    const borderClass = row.isFirstOfProduct
        ? 'border-t-2 border-gray-400'
        : row.isFirstOfVariation
        ? 'border-t border-gray-300'
        : 'border-t border-gray-100';

    // Subtle background tint for product-first rows
    const bgClass = row.isFirstOfProduct
        ? 'bg-gray-50/30 hover:bg-gray-50/50'
        : 'hover:bg-gray-50/50';

    return (
        <tr
            className={`cursor-pointer h-8 ${borderClass} ${bgClass}`}
            onClick={() => onClick(row)}
        >
            {/* 1. Barcode/SKU */}
            <td className="px-2 py-0.5">
                <span className="text-xs font-mono text-gray-700">{row.skuCode}</span>
            </td>

            {/* 2. Product Name */}
            <td className="px-2 py-0.5 whitespace-nowrap overflow-hidden">
                {row.isFirstOfProduct ? (
                    <div className="text-xs font-medium text-gray-900 truncate">
                        {row.productName}
                    </div>
                ) : null}
            </td>

            {/* 3. Gender */}
            <td className="px-2 py-0.5 whitespace-nowrap overflow-hidden">
                {row.isFirstOfProduct && row.gender ? (
                    <span className="text-xs text-gray-500">{row.gender}</span>
                ) : null}
            </td>

            {/* 4. Colour */}
            <td className="px-2 py-0.5 whitespace-nowrap overflow-hidden">
                {row.isFirstOfVariation ? (
                    <div className="flex items-center gap-1.5">
                        {row.colorHex && (
                            <span
                                className="w-3 h-3 rounded-full border border-gray-200 flex-shrink-0"
                                style={{ backgroundColor: row.colorHex }}
                            />
                        )}
                        <span className="text-xs text-gray-700 truncate">
                            {row.colorName}
                        </span>
                    </div>
                ) : null}
            </td>

            {/* 4. Size */}
            <td className="px-2 py-0.5 text-center">
                <span className="text-xs font-semibold text-gray-900">{row.size}</span>
            </td>

            {/* 5. Style Code */}
            <td className="px-2 py-0.5 whitespace-nowrap overflow-hidden">
                {row.isFirstOfProduct && row.styleCode ? (
                    <span className="text-xs font-mono text-gray-500">{row.styleCode}</span>
                ) : null}
            </td>

            {/* 7. Fabric Colour */}
            <td className="px-2 py-0.5 whitespace-nowrap overflow-hidden">
                {row.isFirstOfVariation ? (
                    <div className="text-xs truncate">
                        {row.fabricColourCode ? (
                            <>
                                <span className="font-mono text-gray-500">{row.fabricColourCode}</span>
                                {row.fabricColourName && (
                                    <span className="text-gray-600"> {row.fabricColourName}</span>
                                )}
                            </>
                        ) : (
                            <span className="text-gray-600">{row.fabricColourName || '-'}</span>
                        )}
                    </div>
                ) : null}
            </td>

            {/* 7. Shopify (status badge + variant ID + product ID) */}
            <td className="px-2 py-0.5">
                {row.shopifyVariantId ? (
                    <div className="flex flex-col gap-0">
                        <ShopifyStatusBadge status={row.shopifyStatus} />
                        <span className="text-[10px] text-gray-400 font-mono leading-tight">
                            V:{row.shopifyVariantId}
                        </span>
                        {row.isFirstOfVariation && row.shopifyProductId && (
                            <span className="text-[10px] text-gray-400 font-mono leading-tight">
                                P:{row.shopifyProductId}
                            </span>
                        )}
                    </div>
                ) : (
                    <span className="text-xs text-gray-300">-</span>
                )}
            </td>

            {/* 8. ERP Price */}
            <td className="px-2 py-0.5 text-right tabular-nums text-xs">
                {formatCurrency(row.mrp)}
            </td>

            {/* 9. Shopify Price */}
            <td className={`px-2 py-0.5 text-right tabular-nums text-xs ${hasPriceMismatch ? 'text-amber-600 font-medium' : ''}`}>
                {formatCurrency(row.shopifyPrice)}
            </td>

            {/* 10. Sale Price */}
            <td className="px-2 py-0.5 text-right tabular-nums text-xs">
                {row.shopifySalePrice != null ? (
                    <span className="text-green-600 font-medium">
                        {formatCurrency(row.shopifySalePrice)}
                    </span>
                ) : (
                    <span className="text-gray-300">-</span>
                )}
            </td>

            {/* 11. Sale % */}
            <td className="px-2 py-0.5 text-right tabular-nums text-xs">
                {row.shopifySalePercent != null ? (
                    <span
                        className={`font-medium ${
                            row.shopifySalePercent > 30
                                ? 'text-red-500'
                                : row.shopifySalePercent > 15
                                ? 'text-amber-600'
                                : 'text-green-600'
                        }`}
                    >
                        {row.shopifySalePercent}%
                    </span>
                ) : (
                    <span className="text-gray-300">-</span>
                )}
            </td>

            {/* 12. BOM */}
            <td className="px-2 py-0.5 text-right tabular-nums text-xs text-gray-600">
                {formatCurrency(row.bomCost)}
            </td>

            {/* 13. MRP Multiple */}
            <td className="px-2 py-0.5 text-right tabular-nums text-xs">
                {mrpMultiple != null ? (
                    <span
                        className={`font-medium ${
                            mrpMultiple >= 3
                                ? 'text-green-600'
                                : mrpMultiple >= 2
                                ? 'text-gray-600'
                                : 'text-red-500'
                        }`}
                    >
                        {mrpMultiple.toFixed(1)}&times;
                    </span>
                ) : (
                    <span className="text-gray-300">-</span>
                )}
            </td>

            {/* 14. Sale Multiple */}
            <td className="px-2 py-0.5 text-right tabular-nums text-xs">
                {saleMultiple != null ? (
                    <span
                        className={`font-medium ${
                            saleMultiple >= 3
                                ? 'text-green-600'
                                : saleMultiple >= 2
                                ? 'text-gray-600'
                                : 'text-red-500'
                        }`}
                    >
                        {saleMultiple.toFixed(1)}&times;
                    </span>
                ) : (
                    <span className="text-gray-300">-</span>
                )}
            </td>
        </tr>
    );
});
