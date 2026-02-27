/**
 * BOM (Bill of Materials) Page
 *
 * Flat table: one row per SKU showing product, fabric, consumption, rate, cost.
 * Dynamic role columns for any future roles beyond Main Fabric.
 */

import { useState, useMemo, useCallback, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getBomList, type BomRoleColumn, type SkuBomRow } from '../server/functions/bomList';
import { Link } from '@tanstack/react-router';
import { Search, Package, Download, Pencil, X } from 'lucide-react';
import { getOptimizedImageUrl } from '../utils/imageOptimization';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
    Tooltip,
    TooltipTrigger,
    TooltipContent,
    TooltipProvider,
} from '@/components/ui/tooltip';

// ============================================
// CONSTANTS
// ============================================

const ROWS_PER_PAGE = 200;

// ============================================
// HELPERS
// ============================================

function formatCurrency(value: number): string {
    if (value >= 1000) {
        return `\u20B9${value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    return `\u20B9${value.toFixed(2)}`;
}

function computeSkuCost(row: SkuBomRow): number {
    let total = 0;
    for (const comp of Object.values(row.components)) {
        if (comp.quantity != null && comp.costPerUnit != null) {
            total += comp.quantity * comp.costPerUnit;
        }
    }
    return total;
}

/** Find the "main" fabric role (code === 'main') from the roles list */
function findMainFabricRole(roles: BomRoleColumn[]): BomRoleColumn | undefined {
    return roles.find(r => r.roleCode === 'main' && r.typeCode === 'FABRIC');
}

// ============================================
// CSV EXPORT
// ============================================

function exportCsv(rows: SkuBomRow[], mainRoleId: string | undefined, extraRoles: BomRoleColumn[]) {
    const headers = ['Product', 'SKU', 'Size', 'Color', 'Fabric', 'Consumption', 'Unit', 'Rate', 'Fabric Cost'];
    for (const role of extraRoles) {
        headers.push(`${role.roleName} - Material`, `${role.roleName} - Qty`, `${role.roleName} - Cost`);
    }
    headers.push('Total Cost');

    const csvRows = [headers.join(',')];
    for (const row of rows) {
        const main = mainRoleId ? row.components[mainRoleId] : undefined;
        const cells: string[] = [
            `"${row.productName.replace(/"/g, '""')}"`,
            row.skuCode,
            row.size,
            `"${row.colorName.replace(/"/g, '""')}"`,
            main ? `"${main.name.replace(/"/g, '""')}"` : '',
            main?.quantity != null ? `${main.quantity}` : '',
            main?.unit ?? '',
            main?.costPerUnit != null ? `${main.costPerUnit}` : '',
            main?.quantity != null && main?.costPerUnit != null ? `${(main.quantity * main.costPerUnit).toFixed(2)}` : '',
        ];
        for (const role of extraRoles) {
            const comp = row.components[role.roleId];
            cells.push(
                comp ? `"${comp.name.replace(/"/g, '""')}"` : '',
                comp?.quantity != null ? `${comp.quantity}` : '',
                comp?.costPerUnit != null ? `${comp.costPerUnit}` : '',
            );
        }
        cells.push(computeSkuCost(row).toFixed(2));
        csvRows.push(cells.join(','));
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bom-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function Bom() {
    const getBomListFn = useServerFn(getBomList);
    const [search, setSearch] = useState('');
    const [hideEmpty, setHideEmpty] = useState(true);
    const [visibleCount, setVisibleCount] = useState(ROWS_PER_PAGE);

    const { data, isLoading, error } = useQuery({
        queryKey: ['catalog', 'list', 'bom-list'],
        queryFn: () => getBomListFn({ data: undefined }),
    });

    const roles = data?.roles ?? [];
    const allRows = data?.rows ?? [];

    // Separate main fabric role from any extra roles
    const mainRole = useMemo(() => findMainFabricRole(roles), [roles]);
    const extraRoles = useMemo(
        () => roles.filter(r => r.roleId !== mainRole?.roleId),
        [roles, mainRole]
    );

    // Filter rows
    const filteredRows = useMemo(() => {
        let result = allRows;
        if (hideEmpty) {
            result = result.filter(row => Object.keys(row.components).length > 0);
        }
        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(row =>
                row.skuCode.toLowerCase().includes(q) ||
                row.productName.toLowerCase().includes(q) ||
                row.colorName.toLowerCase().includes(q) ||
                Object.values(row.components).some(c => c.name.toLowerCase().includes(q))
            );
        }
        return result;
    }, [allRows, search, hideEmpty]);

    // Paginated rows
    const visibleRows = useMemo(
        () => filteredRows.slice(0, visibleCount),
        [filteredRows, visibleCount]
    );
    const hasMore = visibleCount < filteredRows.length;

    const productCount = useMemo(() => {
        const ids = new Set(filteredRows.map(r => r.productId));
        return ids.size;
    }, [filteredRows]);

    const handleExport = useCallback(() => {
        exportCsv(filteredRows, mainRole?.roleId, extraRoles);
    }, [filteredRows, mainRole, extraRoles]);

    const handleLoadMore = useCallback(() => {
        setVisibleCount(prev => prev + ROWS_PER_PAGE);
    }, []);

    // Reset pagination when filters change
    useMemo(() => {
        setVisibleCount(ROWS_PER_PAGE);
    }, [search, hideEmpty]);

    if (isLoading) {
        return (
            <div className="p-6">
                <div className="animate-pulse space-y-3">
                    <div className="h-7 bg-gray-200 rounded w-48" />
                    <div className="h-9 bg-gray-100 rounded w-full" />
                    <div className="h-[600px] bg-gray-100 rounded" />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                    Failed to load BOM data: {error instanceof Error ? error.message : 'Unknown error'}
                </div>
            </div>
        );
    }

    // 8 fixed cols: Product, SKU, Size, Color, Fabric, Consumption, Rate, Cost + extra roles
    const colCount = 8 + extraRoles.length;

    return (
        <TooltipProvider delayDuration={300}>
            <div className="p-6 space-y-3">
                {/* Header */}
                <div>
                    <h1 className="text-xl font-semibold text-gray-900">Bill of Materials</h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        {filteredRows.length.toLocaleString()} SKUs across {productCount.toLocaleString()} products
                        {hideEmpty && allRows.length !== filteredRows.length && (
                            <span className="text-gray-400">
                                {' '}({(allRows.length - filteredRows.length).toLocaleString()} empty hidden)
                            </span>
                        )}
                    </p>
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative w-72">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <Input
                            type="text"
                            placeholder="Search SKU, product, color, fabric..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="pl-8 h-8 text-sm"
                        />
                        {search && (
                            <button
                                onClick={() => setSearch('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    <div className="w-px h-6 bg-gray-200" />

                    <button
                        onClick={() => setHideEmpty(prev => !prev)}
                        className={`
                            px-2.5 py-1 text-xs font-medium rounded-md border transition-colors
                            ${hideEmpty
                                ? 'bg-gray-800 text-white border-gray-800 hover:bg-gray-700'
                                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                            }
                        `}
                    >
                        Hide empty
                    </button>

                    <div className="flex-1" />

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="sm" onClick={handleExport} className="h-8">
                                <Download className="h-3.5 w-3.5" />
                                <span className="sr-only sm:not-sr-only">Export</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Export filtered data as CSV</TooltipContent>
                    </Tooltip>
                </div>

                {/* Table */}
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto max-h-[calc(100vh-200px)]">
                        <table className="w-full text-sm border-collapse">
                            <thead className="sticky top-0 z-20">
                                <tr className="bg-gray-50 border-b border-gray-200">
                                    <th className="px-2.5 py-2 text-left font-medium text-gray-600 sticky left-0 bg-gray-50 z-30 min-w-[180px] border-r border-gray-200">
                                        Product
                                    </th>
                                    <th className="px-2 py-2 text-left font-medium text-gray-600 w-[110px] min-w-[110px] border-l border-gray-100">
                                        SKU
                                    </th>
                                    <th className="px-2 py-2 text-left font-medium text-gray-600 w-[50px] border-l border-gray-100">
                                        Size
                                    </th>
                                    <th className="px-2 py-2 text-left font-medium text-gray-600 w-[100px] border-l border-gray-100">
                                        Color
                                    </th>
                                    {/* Main fabric columns */}
                                    <th className="px-2.5 py-2 text-left font-medium text-gray-600 min-w-[200px] border-l border-emerald-300 bg-emerald-50/50">
                                        <div className="flex items-center gap-1.5">
                                            <span>Fabric</span>
                                            <Badge className="bg-emerald-100 text-emerald-700 text-[9px] px-1.5 py-0 font-medium border-0">
                                                MAIN
                                            </Badge>
                                        </div>
                                    </th>
                                    <th className="px-2 py-2 text-right font-medium text-gray-600 w-[90px] border-l border-emerald-200 bg-emerald-50/50">
                                        Consumption
                                    </th>
                                    <th className="px-2 py-2 text-right font-medium text-gray-600 w-[80px] border-l border-emerald-200 bg-emerald-50/50">
                                        Rate
                                    </th>
                                    {/* Extra role columns (future) */}
                                    {extraRoles.map(role => (
                                        <th
                                            key={role.roleId}
                                            className="px-2.5 py-1.5 text-left font-medium min-w-[180px] border-l border-gray-200 bg-gray-50"
                                        >
                                            <div className="flex flex-col gap-0.5">
                                                <span className="text-gray-800 text-xs">{role.roleName}</span>
                                                <Badge className="bg-gray-100 text-gray-600 text-[9px] px-1.5 py-0 font-medium w-fit border-0">
                                                    {role.typeCode}
                                                </Badge>
                                            </div>
                                        </th>
                                    ))}
                                    <th className="px-2.5 py-2 text-right font-medium text-gray-600 w-[90px] border-l border-gray-200 bg-gray-50">
                                        Cost
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleRows.map(row => (
                                    <SkuRow
                                        key={row.skuId}
                                        row={row}
                                        mainRoleId={mainRole?.roleId}
                                        extraRoles={extraRoles}
                                    />
                                ))}
                                {visibleRows.length === 0 && (
                                    <tr>
                                        <td colSpan={colCount} className="px-3 py-12 text-center text-gray-400">
                                            <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                                            No SKUs found
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {hasMore && (
                    <div className="flex justify-center pt-1">
                        <Button variant="outline" size="sm" onClick={handleLoadMore}>
                            Load more ({(filteredRows.length - visibleCount).toLocaleString()} SKUs remaining)
                        </Button>
                    </div>
                )}
            </div>
        </TooltipProvider>
    );
}

// ============================================
// SKU ROW
// ============================================

const SkuRow = memo(function SkuRow({
    row,
    mainRoleId,
    extraRoles,
}: {
    row: SkuBomRow;
    mainRoleId: string | undefined;
    extraRoles: BomRoleColumn[];
}) {
    const cost = useMemo(() => computeSkuCost(row), [row]);
    const main = mainRoleId ? row.components[mainRoleId] : undefined;

    return (
        <tr className="border-t border-gray-100 hover:bg-blue-50/30 group transition-colors">
            {/* Product */}
            <td className="px-2.5 py-1 sticky left-0 bg-white group-hover:bg-blue-50/30 z-10 border-r border-gray-100 transition-colors">
                <div className="flex items-center gap-2">
                    {row.imageUrl ? (
                        <img
                            src={getOptimizedImageUrl(row.imageUrl, 'sm') || row.imageUrl}
                            alt={row.productName}
                            className="w-7 h-7 rounded object-cover flex-shrink-0"
                            loading="lazy"
                        />
                    ) : (
                        <div className="w-7 h-7 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                            <Package size={12} className="text-gray-400" />
                        </div>
                    )}
                    <Link
                        to="/products/$productSlug/edit"
                        params={{ productSlug: row.productId }}
                        className="text-xs text-gray-800 hover:text-blue-600 hover:underline truncate"
                    >
                        {row.productName}
                    </Link>
                    <Link
                        to="/products/$productSlug/edit"
                        params={{ productSlug: row.productId }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-blue-600 flex-shrink-0"
                    >
                        <Pencil className="h-3 w-3" />
                    </Link>
                </div>
            </td>
            {/* SKU */}
            <td className="px-2 py-1 font-mono text-[11px] text-gray-500 border-l border-gray-50">
                {row.skuCode}
            </td>
            {/* Size */}
            <td className="px-2 py-1 text-xs text-gray-600 border-l border-gray-50">
                {row.size}
            </td>
            {/* Color */}
            <td className="px-2 py-1 border-l border-gray-50">
                <div className="flex items-center gap-1.5">
                    {row.colorHex && (
                        <span
                            className="inline-block w-3.5 h-3.5 rounded-full border border-gray-200/80 flex-shrink-0 shadow-sm"
                            style={{ backgroundColor: row.colorHex }}
                        />
                    )}
                    <span className="text-xs text-gray-700 truncate">{row.colorName}</span>
                </div>
            </td>
            {/* Main Fabric Name */}
            <td className="px-2.5 py-1 border-l border-emerald-200 bg-emerald-50/20">
                {main ? (
                    <span className="text-xs text-gray-800 truncate block" title={main.name}>
                        {main.name}
                    </span>
                ) : (
                    <span className="text-[10px] text-gray-300 italic">No fabric</span>
                )}
            </td>
            {/* Consumption */}
            <td className="px-2 py-1 text-right border-l border-emerald-100 bg-emerald-50/20 tabular-nums">
                {main?.quantity != null ? (
                    <span className="text-xs text-gray-700">
                        {main.quantity} <span className="text-gray-400">{main.unit ?? 'unit'}</span>
                    </span>
                ) : (
                    <span className="text-[10px] text-gray-300">--</span>
                )}
            </td>
            {/* Rate */}
            <td className="px-2 py-1 text-right border-l border-emerald-100 bg-emerald-50/20 tabular-nums">
                {main?.costPerUnit != null ? (
                    <span className="text-xs text-gray-700">
                        {'\u20B9'}{main.costPerUnit.toFixed(0)}<span className="text-gray-400">/{main.unit ?? 'unit'}</span>
                    </span>
                ) : (
                    <span className="text-[10px] text-gray-300">--</span>
                )}
            </td>
            {/* Extra role columns */}
            {extraRoles.map(role => {
                const comp = row.components[role.roleId];
                return (
                    <td key={role.roleId} className={`px-2.5 py-1 border-l border-gray-100 ${!comp ? 'bg-gray-50/30' : ''}`}>
                        {comp ? (
                            <div className="flex flex-col leading-tight">
                                <span className="text-xs text-gray-800 truncate">{comp.name}</span>
                                {comp.quantity != null && (
                                    <span className="text-[10px] text-gray-400">
                                        {comp.quantity} {comp.unit ?? 'unit'}
                                        {comp.costPerUnit != null && <> &times; {'\u20B9'}{comp.costPerUnit.toFixed(0)}</>}
                                    </span>
                                )}
                            </div>
                        ) : (
                            <span className="text-[10px] text-gray-300 italic">--</span>
                        )}
                    </td>
                );
            })}
            {/* Total Cost */}
            <td className="px-2.5 py-1 text-right border-l border-gray-200 tabular-nums">
                {cost > 0 ? (
                    <span className="text-xs font-medium text-gray-800">{formatCurrency(cost)}</span>
                ) : (
                    <span className="text-[10px] text-gray-300">--</span>
                )}
            </td>
        </tr>
    );
});
