/**
 * ConsumptionGridView - Spreadsheet-like consumption editing
 *
 * Products as rows, sizes as columns for fast inline editing
 * of consumption values across the entire catalog.
 *
 * Features:
 * - Inline cell editing with keyboard navigation
 * - Copy/paste rows (copy all size values from one product to another)
 * - Batch save with pending changes tracking
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Search, X, Copy, ClipboardPaste, ChevronDown, ChevronRight, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useServerFn } from '@tanstack/react-start';
import {
    getConsumptionGrid,
    updateConsumptionGrid,
    type ConsumptionGridResult,
} from '../../../server/functions/bomMutations';
import { getOptimizedImageUrl } from '../../../utils/imageOptimization';

interface SizeData {
    quantity: number | null;
    skuCount: number;
}

interface GridRow {
    productId: string;
    productName: string;
    styleCode: string | null;
    category: string | null;
    gender: string | null;
    imageUrl: string | null;
    variationCount: number;
    skuCount: number;
    defaultQuantity: number | null;
    sizes: Record<string, SizeData>;
}

// Group structure for gender → category hierarchy
interface CategoryGroup {
    category: string;
    rows: GridRow[];
}

interface GenderGroup {
    gender: string;
    categories: CategoryGroup[];
    totalProducts: number;
}

// GridData is now imported as ConsumptionGridResult from bomMutations

// Pending changes for batch save
interface PendingChange {
    productId: string;
    size: string;
    quantity: number;
}

// Copied row data
interface CopiedRowData {
    productId: string;
    productName: string;
    sizes: Record<string, number | null>;
}

// Consumption filter type
type ConsumptionFilter = 'all' | 'same' | 'missing';

export function ConsumptionGridView() {
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
    const [consumptionFilter, setConsumptionFilter] = useState<ConsumptionFilter>('all');
    const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
    const [editingCell, setEditingCell] = useState<{ productId: string; size: string } | null>(null);
    const [copiedRow, setCopiedRow] = useState<CopiedRowData | null>(null);
    const [collapsedGenders, setCollapsedGenders] = useState<Set<string>>(new Set());
    const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
    const inputRef = useRef<HTMLInputElement>(null);

    // Server Functions
    const getConsumptionGridFn = useServerFn(getConsumptionGrid);
    const updateConsumptionGridFn = useServerFn(updateConsumptionGrid);

    // Fetch grid data
    const { data: gridData, isLoading, error } = useQuery<ConsumptionGridResult | null>({
        queryKey: ['consumptionGrid'],
        queryFn: async () => {
            const result = await getConsumptionGridFn({ data: {} });
            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Failed to load consumption grid');
            }
            return result.data;
        },
    });

    // Batch update mutation
    const updateMutation = useMutation({
        mutationFn: async (changes: PendingChange[]) => {
            if (!gridData?.roleId) throw new Error('No role ID');
            const result = await updateConsumptionGridFn({
                data: {
                    updates: changes,
                    roleId: gridData.roleId,
                },
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update consumption grid');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['consumptionGrid'] });
            setPendingChanges(new Map());
        },
    });

    // Helper to determine consumption status of a row
    const getConsumptionStatus = useCallback((row: GridRow): 'missing' | 'same' | 'normal' => {
        const consumptionValues = Object.values(row.sizes)
            .filter((s): s is { quantity: number; skuCount: number } =>
                s !== null && s !== undefined && s.quantity !== null && s.skuCount > 0
            )
            .map(s => s.quantity);

        // Check if all zeros (or no data) - missing
        const isAllZero = consumptionValues.length === 0 ||
            consumptionValues.every(v => v === 0 || v === null);

        if (isAllZero) return 'missing';

        // Check if all values are the same (and not zero)
        const isAllSame = consumptionValues.length > 1 &&
            consumptionValues.every(v => v === consumptionValues[0]);

        if (isAllSame) return 'same';

        return 'normal';
    }, []);

    // Filter rows by search and consumption filter
    const filteredRows = useMemo(() => {
        if (!gridData?.rows) return [];

        let rows = gridData.rows;

        // Apply search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            rows = rows.filter(
                (row) =>
                    row.productName.toLowerCase().includes(query) ||
                    row.styleCode?.toLowerCase().includes(query) ||
                    row.category?.toLowerCase().includes(query) ||
                    row.gender?.toLowerCase().includes(query)
            );
        }

        // Apply consumption filter
        if (consumptionFilter !== 'all') {
            rows = rows.filter((row) => getConsumptionStatus(row) === consumptionFilter);
        }

        return rows;
    }, [gridData?.rows, searchQuery, consumptionFilter, getConsumptionStatus]);

    // Group rows by gender → category
    const groupedData = useMemo((): GenderGroup[] => {
        const genderMap = new Map<string, Map<string, GridRow[]>>();

        for (const row of filteredRows) {
            const gender = row.gender || 'Unspecified';
            const category = row.category || 'Uncategorized';

            if (!genderMap.has(gender)) {
                genderMap.set(gender, new Map());
            }
            const categoryMap = genderMap.get(gender)!;
            if (!categoryMap.has(category)) {
                categoryMap.set(category, []);
            }
            categoryMap.get(category)!.push(row);
        }

        // Convert to array structure
        const result: GenderGroup[] = [];
        for (const [gender, categoryMap] of genderMap) {
            const categories: CategoryGroup[] = [];
            let totalProducts = 0;

            for (const [category, rows] of categoryMap) {
                categories.push({ category, rows });
                totalProducts += rows.length;
            }

            // Sort categories alphabetically
            categories.sort((a, b) => a.category.localeCompare(b.category));
            result.push({ gender, categories, totalProducts });
        }

        // Sort genders: Men, Women, Unisex, then others alphabetically
        const genderOrder = ['Men', 'Women', 'Unisex', 'Unspecified'];
        result.sort((a, b) => {
            const indexA = genderOrder.indexOf(a.gender);
            const indexB = genderOrder.indexOf(b.gender);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return a.gender.localeCompare(b.gender);
        });

        return result;
    }, [filteredRows]);

    // Toggle gender collapse
    const toggleGender = useCallback((gender: string) => {
        setCollapsedGenders((prev) => {
            const next = new Set(prev);
            if (next.has(gender)) {
                next.delete(gender);
            } else {
                next.add(gender);
            }
            return next;
        });
    }, []);

    // Toggle category collapse
    const toggleCategory = useCallback((key: string) => {
        setCollapsedCategories((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }, []);

    // Get cell value (pending change or original)
    const getCellValue = useCallback(
        (productId: string, size: string, originalQuantity: number | null): string => {
            const key = `${productId}:${size}`;
            const pending = pendingChanges.get(key);
            if (pending !== undefined) {
                return pending.quantity.toString();
            }
            return originalQuantity?.toString() ?? '';
        },
        [pendingChanges]
    );

    // Handle cell value change
    const handleCellChange = useCallback(
        (productId: string, size: string, value: string) => {
            const key = `${productId}:${size}`;
            const numValue = parseFloat(value);

            if (value === '' || isNaN(numValue)) {
                // Remove from pending if empty
                setPendingChanges((prev) => {
                    const next = new Map(prev);
                    next.delete(key);
                    return next;
                });
            } else {
                setPendingChanges((prev) => {
                    const next = new Map(prev);
                    next.set(key, { productId, size, quantity: numValue });
                    return next;
                });
            }
        },
        []
    );

    // Handle save
    const handleSave = useCallback(() => {
        const changes = Array.from(pendingChanges.values());
        if (changes.length > 0) {
            updateMutation.mutate(changes);
        }
    }, [pendingChanges, updateMutation]);

    // Copy row - captures current values (including pending changes)
    const handleCopyRow = useCallback(
        (row: GridRow) => {
            const sizes: Record<string, number | null> = {};

            // Get values from row, applying any pending changes
            for (const [size, sizeData] of Object.entries(row.sizes)) {
                const key = `${row.productId}:${size}`;
                const pending = pendingChanges.get(key);
                sizes[size] = pending?.quantity ?? sizeData.quantity;
            }

            setCopiedRow({
                productId: row.productId,
                productName: row.productName,
                sizes,
            });
        },
        [pendingChanges]
    );

    // Paste row - applies copied values to target row
    const handlePasteRow = useCallback(
        (targetRow: GridRow) => {
            if (!copiedRow) return;

            setPendingChanges((prev) => {
                const next = new Map(prev);

                // Apply copied values to all sizes that exist in target row
                for (const [size, quantity] of Object.entries(copiedRow.sizes)) {
                    // Only paste if target row has this size (has SKUs for it)
                    if (targetRow.sizes[size]?.skuCount > 0 && quantity !== null) {
                        const key = `${targetRow.productId}:${size}`;
                        next.set(key, {
                            productId: targetRow.productId,
                            size,
                            quantity,
                        });
                    }
                }

                return next;
            });
        },
        [copiedRow]
    );

    // Focus input when editing
    useEffect(() => {
        if (editingCell && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editingCell]);

    // Handle keyboard navigation
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent, productId: string, size: string, sizes: string[], rows: GridRow[]) => {
            const currentSizeIdx = sizes.indexOf(size);
            const currentRowIdx = rows.findIndex((r) => r.productId === productId);

            let nextCell: { productId: string; size: string } | null = null;

            switch (e.key) {
                case 'Enter':
                case 'ArrowDown':
                    e.preventDefault();
                    if (currentRowIdx < rows.length - 1) {
                        nextCell = { productId: rows[currentRowIdx + 1].productId, size };
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    if (currentRowIdx > 0) {
                        nextCell = { productId: rows[currentRowIdx - 1].productId, size };
                    }
                    break;
                case 'Tab':
                    e.preventDefault();
                    if (e.shiftKey) {
                        // Move left
                        if (currentSizeIdx > 0) {
                            nextCell = { productId, size: sizes[currentSizeIdx - 1] };
                        } else if (currentRowIdx > 0) {
                            nextCell = { productId: rows[currentRowIdx - 1].productId, size: sizes[sizes.length - 1] };
                        }
                    } else {
                        // Move right
                        if (currentSizeIdx < sizes.length - 1) {
                            nextCell = { productId, size: sizes[currentSizeIdx + 1] };
                        } else if (currentRowIdx < rows.length - 1) {
                            nextCell = { productId: rows[currentRowIdx + 1].productId, size: sizes[0] };
                        }
                    }
                    break;
                case 'Escape':
                    setEditingCell(null);
                    return;
            }

            if (nextCell) {
                setEditingCell(nextCell);
            }
        },
        []
    );

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 size={24} className="animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Loading consumption data...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-64 text-red-500">
                Failed to load consumption data
            </div>
        );
    }

    if (!gridData) return null;

    const hasChanges = pendingChanges.size > 0;

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                <div>
                    <h3 className="text-sm font-medium text-gray-900">
                        Consumption Grid
                    </h3>
                    <p className="text-xs text-gray-500">
                        {gridData.roleName} ({gridData.roleType}) - {filteredRows.length} products
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Search */}
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search products..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8 pr-8 py-1.5 text-sm border rounded-md w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Consumption Filter */}
                    <div className="relative">
                        <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <select
                            value={consumptionFilter}
                            onChange={(e) => setConsumptionFilter(e.target.value as ConsumptionFilter)}
                            className="pl-8 pr-8 py-1.5 text-sm border rounded-md appearance-none focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white cursor-pointer"
                        >
                            <option value="all">All Variations</option>
                            <option value="same">Same Consumption</option>
                            <option value="missing">Missing Data</option>
                        </select>
                    </div>

                    {/* Save Button */}
                    <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={!hasChanges || updateMutation.isPending}
                        className="gap-1"
                    >
                        {updateMutation.isPending ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Save size={14} />
                        )}
                        Save {hasChanges && `(${pendingChanges.size})`}
                    </Button>
                </div>
            </div>

            {/* Copy indicator banner */}
            {copiedRow && (
                <div className="px-4 py-1.5 border-b bg-blue-50 text-xs text-blue-700 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Copy size={12} />
                        <span>
                            Copied from <strong>{copiedRow.productName}</strong> - Click paste icon on any row to apply
                        </span>
                    </div>
                    <button
                        onClick={() => setCopiedRow(null)}
                        className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                        <X size={12} />
                        Clear
                    </button>
                </div>
            )}

            {/* Color legend */}
            <div className="px-4 py-1 border-b bg-gray-50 text-[10px] text-gray-500 flex items-center gap-4">
                <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-red-100 border border-red-200" />
                    No consumption data
                </span>
                <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-200" />
                    Same across all sizes
                </span>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-auto">
                <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 bg-gray-50 z-10">
                        <tr>
                            <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-500 border-b border-r w-64 min-w-64">
                                Product
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 border-b w-16 min-w-16">
                                {copiedRow ? 'Paste' : 'Copy'}
                            </th>
                            {gridData.sizes.map((size) => (
                                <th
                                    key={size}
                                    className="px-3 py-2 text-center text-xs font-medium text-gray-500 border-b w-20 min-w-20"
                                >
                                    {size}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {groupedData.map((genderGroup) => {
                            const isGenderCollapsed = collapsedGenders.has(genderGroup.gender);

                            return (
                                <React.Fragment key={genderGroup.gender}>
                                    {/* Gender header row */}
                                    <tr
                                        className="bg-gray-100 cursor-pointer hover:bg-gray-200"
                                        onClick={() => toggleGender(genderGroup.gender)}
                                    >
                                        <td
                                            colSpan={2 + gridData.sizes.length}
                                            className="sticky left-0 bg-gray-100 px-3 py-2 border-b font-semibold text-gray-700"
                                        >
                                            <div className="flex items-center gap-2">
                                                {isGenderCollapsed ? (
                                                    <ChevronRight size={16} />
                                                ) : (
                                                    <ChevronDown size={16} />
                                                )}
                                                <span>{genderGroup.gender}</span>
                                                <span className="text-xs font-normal text-gray-500">
                                                    ({genderGroup.totalProducts} products)
                                                </span>
                                            </div>
                                        </td>
                                    </tr>

                                    {/* Category groups (hidden when gender collapsed) */}
                                    {!isGenderCollapsed && genderGroup.categories.map((categoryGroup) => {
                                        const categoryKey = `${genderGroup.gender}:${categoryGroup.category}`;
                                        const isCategoryCollapsed = collapsedCategories.has(categoryKey);

                                        return (
                                            <React.Fragment key={categoryKey}>
                                                {/* Category header row */}
                                                <tr
                                                    className="bg-gray-50 cursor-pointer hover:bg-gray-100"
                                                    onClick={() => toggleCategory(categoryKey)}
                                                >
                                                    <td
                                                        colSpan={2 + gridData.sizes.length}
                                                        className="sticky left-0 bg-gray-50 px-3 py-1.5 border-b text-gray-600"
                                                    >
                                                        <div className="flex items-center gap-2 pl-4">
                                                            {isCategoryCollapsed ? (
                                                                <ChevronRight size={14} />
                                                            ) : (
                                                                <ChevronDown size={14} />
                                                            )}
                                                            <span className="font-medium text-sm">{categoryGroup.category}</span>
                                                            <span className="text-xs text-gray-400">
                                                                ({categoryGroup.rows.length})
                                                            </span>
                                                        </div>
                                                    </td>
                                                </tr>

                                                {/* Product rows (hidden when category collapsed) */}
                                                {!isCategoryCollapsed && categoryGroup.rows.map((row) => {
                                                    const isCopiedRow = copiedRow?.productId === row.productId;
                                                    const canPaste = copiedRow && !isCopiedRow;

                                                    // Get consumption status using helper
                                                    const consumptionStatus = getConsumptionStatus(row);

                                                    // Determine row background
                                                    let rowBg = '';
                                                    let stickyBg = 'bg-white';
                                                    if (isCopiedRow) {
                                                        rowBg = 'bg-blue-50';
                                                        stickyBg = 'bg-blue-50';
                                                    } else if (consumptionStatus === 'missing') {
                                                        rowBg = 'bg-red-50';
                                                        stickyBg = 'bg-red-50';
                                                    } else if (consumptionStatus === 'same') {
                                                        rowBg = 'bg-yellow-50';
                                                        stickyBg = 'bg-yellow-50';
                                                    }

                                                    return (
                                                        <tr
                                                            key={row.productId}
                                                            className={`hover:bg-gray-50 group ${rowBg}`}
                                                        >
                                                            {/* Product cell (sticky) */}
                                                            <td className={`sticky left-0 ${stickyBg} group-hover:bg-gray-50 px-3 py-2 border-b border-r`}>
                                                                <div className="flex items-center gap-2 pl-6">
                                                                    {row.imageUrl ? (
                                                                        <img
                                                                            src={getOptimizedImageUrl(row.imageUrl, 'sm') || row.imageUrl}
                                                                            alt=""
                                                                            className="w-8 h-8 rounded object-cover flex-shrink-0"
                                                                            loading="lazy"
                                                                        />
                                                                    ) : (
                                                                        <div className="w-8 h-8 rounded bg-gray-100 flex-shrink-0" />
                                                                    )}
                                                                    <div className="min-w-0">
                                                                        <div className="text-gray-900 font-medium truncate text-xs">
                                                                            {row.productName}
                                                                        </div>
                                                                        {row.styleCode && (
                                                                            <div className="text-[10px] text-gray-400 truncate">
                                                                                {row.styleCode}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </td>

                                                            {/* Copy/Paste cell */}
                                                            <td className={`px-1 py-1 border-b text-center ${rowBg}`}>
                                                                {isCopiedRow ? (
                                                                    <button
                                                                        onClick={() => setCopiedRow(null)}
                                                                        className="p-1 text-blue-600 hover:text-blue-800 rounded hover:bg-blue-100"
                                                                        title="Clear copied"
                                                                    >
                                                                        <X size={14} />
                                                                    </button>
                                                                ) : canPaste ? (
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handlePasteRow(row);
                                                                        }}
                                                                        className="p-1 text-green-600 hover:text-green-800 rounded hover:bg-green-100"
                                                                        title={`Paste from ${copiedRow.productName}`}
                                                                    >
                                                                        <ClipboardPaste size={14} />
                                                                    </button>
                                                                ) : (
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleCopyRow(row);
                                                                        }}
                                                                        className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
                                                                        title="Copy row values"
                                                                    >
                                                                        <Copy size={14} />
                                                                    </button>
                                                                )}
                                                            </td>

                                                            {/* Size cells */}
                                                            {gridData.sizes.map((size) => {
                                                                const sizeData = row.sizes[size];
                                                                const originalQty = sizeData?.quantity ?? null;
                                                                const isEditing =
                                                                    editingCell?.productId === row.productId &&
                                                                    editingCell?.size === size;
                                                                const key = `${row.productId}:${size}`;
                                                                const isPending = pendingChanges.has(key);
                                                                const displayValue = getCellValue(row.productId, size, originalQty);
                                                                const hasSkus = sizeData?.skuCount > 0;

                                                                return (
                                                                    <td
                                                                        key={size}
                                                                        className={`px-1 py-1 border-b text-center ${
                                                                            isPending ? 'bg-yellow-50' : ''
                                                                        } ${!hasSkus ? 'bg-gray-100' : ''}`}
                                                                        onClick={() => hasSkus && setEditingCell({ productId: row.productId, size })}
                                                                    >
                                                                        {isEditing ? (
                                                                            <input
                                                                                ref={inputRef}
                                                                                type="number"
                                                                                step="0.1"
                                                                                value={displayValue}
                                                                                onChange={(e) =>
                                                                                    handleCellChange(row.productId, size, e.target.value)
                                                                                }
                                                                                onBlur={() => setEditingCell(null)}
                                                                                onKeyDown={(e) =>
                                                                                    handleKeyDown(e, row.productId, size, gridData.sizes, filteredRows)
                                                                                }
                                                                                className="w-full px-1 py-0.5 text-center text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                                            />
                                                                        ) : (
                                                                            <span
                                                                                className={`block w-full px-1 py-0.5 rounded cursor-pointer ${
                                                                                    hasSkus
                                                                                        ? 'hover:bg-blue-50 text-gray-700'
                                                                                        : 'text-gray-400 cursor-not-allowed'
                                                                                } ${isPending ? 'font-medium text-amber-700' : ''}`}
                                                                            >
                                                                                {displayValue || (hasSkus ? '-' : '')}
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                );
                                                            })}
                                                        </tr>
                                                    );
                                                })}
                                            </React.Fragment>
                                        );
                                    })}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>

                {filteredRows.length === 0 && (
                    <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
                        {searchQuery ? 'No products match your search' : 'No products found'}
                    </div>
                )}
            </div>

            {/* Footer with pending changes indicator */}
            {hasChanges && (
                <div className="px-4 py-2 border-t bg-amber-50 text-xs text-amber-700 flex items-center justify-between">
                    <span>{pendingChanges.size} unsaved changes</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPendingChanges(new Map())}
                            className="text-amber-600 hover:text-amber-800 underline"
                        >
                            Discard
                        </button>
                        <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                            Save Changes
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
