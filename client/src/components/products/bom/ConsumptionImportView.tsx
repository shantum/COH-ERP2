/**
 * ConsumptionImportView - CSV Import with Product Mapping
 *
 * Allows importing consumption data from CSV by mapping
 * external product names to internal products.
 */

import { useState, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Loader2,
    Upload,
    Search,
    Check,
    X,
    AlertCircle,
    FileSpreadsheet,
    Link2,
    Link2Off,
    CheckCircle2,
    Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useServerFn } from '@tanstack/react-start';
import {
    getProductsForMapping,
    importConsumption,
    resetConsumption,
    type ProductForMappingResult,
} from '../../../server/functions/bomMutations';
import { getOptimizedImageUrl } from '../../../utils/imageOptimization';

interface CsvRow {
    id: string;
    productName: string;
    uom: string;
    sizes: Record<string, number | null>;
    avgConsumption: number | null;
    fabricCode: string;
    // Mapping state
    mappedProductId: string | null;
    mappedProductName: string | null;
    autoMatched: boolean;
}

// ProductForMappingResult is now imported as ProductForMappingResult from bomMutations

const SIZE_COLUMNS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

function parseCsv(csvText: string): CsvRow[] {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    const rows: CsvRow[] = [];
    let id = 0;

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        // Parse CSV line (handle commas in quoted strings)
        const values: string[] = [];
        let current = '';
        let inQuotes = false;

        for (const char of line) {
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim());

        const productName = values[0];
        if (!productName) continue;

        const sizes: Record<string, number | null> = {};
        SIZE_COLUMNS.forEach((size, idx) => {
            const val = values[idx + 2]; // Skip name and UOM columns
            if (val && val !== '-' && val !== '#N/A' && val !== '') {
                const num = parseFloat(val);
                sizes[size] = isNaN(num) ? null : num;
            } else {
                sizes[size] = null;
            }
        });

        // Check if row has any consumption data
        const hasData = Object.values(sizes).some((v) => v !== null);
        if (!hasData) continue;

        const avgVal = values[9];
        const avgConsumption = avgVal ? parseFloat(avgVal) : null;

        rows.push({
            id: `row-${id++}`,
            productName,
            uom: values[1] || '',
            sizes,
            avgConsumption: avgConsumption !== null && isNaN(avgConsumption) ? null : avgConsumption,
            fabricCode: values[10] || '',
            mappedProductId: null,
            mappedProductName: null,
            autoMatched: false,
        });
    }

    return rows;
}

// Fuzzy match score (higher is better)
function matchScore(csvName: string, productName: string): number {
    const csv = csvName.toLowerCase().trim();
    const prod = productName.toLowerCase().trim();

    // Exact match
    if (csv === prod) return 100;

    // One contains the other
    if (prod.includes(csv) || csv.includes(prod)) return 80;

    // Word-based matching
    const csvWords = csv.split(/\s+/);
    const prodWords = prod.split(/\s+/);

    let matchedWords = 0;
    for (const cw of csvWords) {
        if (prodWords.some((pw) => pw.includes(cw) || cw.includes(pw))) {
            matchedWords++;
        }
    }

    const wordScore = (matchedWords / Math.max(csvWords.length, prodWords.length)) * 70;
    return wordScore;
}

export function ConsumptionImportView() {
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
    const [searchingRowId, setSearchingRowId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterUnmapped, setFilterUnmapped] = useState(false);

    // Server Functions
    const getProductsForMappingFn = useServerFn(getProductsForMapping);
    const importConsumptionFn = useServerFn(importConsumption);
    const resetConsumptionFn = useServerFn(resetConsumption);

    // Fetch internal products
    const { data: internalProducts = [], isLoading: loadingProducts } = useQuery<ProductForMappingResult[]>({
        queryKey: ['productsForMapping'],
        queryFn: async () => {
            const result = await getProductsForMappingFn({ data: undefined });
            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Failed to load products');
            }
            return result.data;
        },
    });

    // Import mutation
    const importMutation = useMutation({
        mutationFn: async (rows: CsvRow[]) => {
            const mappedRows = rows.filter((r) => r.mappedProductId);

            // Aggregate by productId - combine sizes from multiple rows mapped to same product
            const productMap = new Map<string, Record<string, number>>();

            for (const row of mappedRows) {
                const productId = row.mappedProductId!;
                if (!productMap.has(productId)) {
                    productMap.set(productId, {});
                }
                const sizes = productMap.get(productId)!;

                // Merge sizes - later values overwrite earlier ones
                for (const [size, qty] of Object.entries(row.sizes)) {
                    if (qty !== null && qty !== undefined) {
                        sizes[size] = qty;
                    }
                }
            }

            const imports = Array.from(productMap.entries()).map(([productId, sizes]) => ({
                productId,
                sizes,
            }));

            console.log('Importing:', imports.length, 'unique products from', mappedRows.length, 'mapped rows');
            console.log('Sample import:', imports[0]);

            const result = await importConsumptionFn({ data: { imports } });
            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Import failed');
            }
            return result.data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['consumptionGrid'] });
            alert(`Import complete!\n\nProducts processed: ${data.productsImported}\nSKUs updated: ${data.skusUpdated}`);
        },
        onError: (error: Error) => {
            console.error('Import error:', error);
            alert(`Import failed: ${error.message || 'Unknown error'}`);
        },
    });

    // Reset mutation
    const resetMutation = useMutation({
        mutationFn: async () => {
            const result = await resetConsumptionFn({ data: undefined });
            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Reset failed');
            }
            return result.data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['consumptionGrid'] });
            alert(`Reset complete! ${data.deletedBomLines} BOM lines deleted, ${data.resetSkus} SKUs reset.`);
        },
    });

    // Handle reset with confirmation
    const handleReset = useCallback(() => {
        if (confirm('This will delete ALL fabric consumption data. Are you sure?')) {
            resetMutation.mutate();
        }
    }, [resetMutation]);

    // Auto-match products when CSV is loaded
    // Skips products that already have consumption data to avoid accidental overwrites
    const autoMatchProducts = useCallback(
        (rows: CsvRow[]): CsvRow[] => {
            return rows.map((row) => {
                // Find best match (skip products with existing consumption)
                let bestMatch: ProductForMappingResult | null = null;
                let bestScore = 0;

                for (const prod of internalProducts) {
                    // Skip products with existing consumption for auto-match
                    if (prod.hasConsumption) continue;

                    const score = matchScore(row.productName, prod.name);
                    if (score > bestScore && score >= 60) {
                        bestScore = score;
                        bestMatch = prod;
                    }
                }

                if (bestMatch) {
                    return {
                        ...row,
                        mappedProductId: bestMatch.id,
                        mappedProductName: bestMatch.name,
                        autoMatched: true,
                    };
                }
                return row;
            });
        },
        [internalProducts]
    );

    // Handle file upload
    const handleFileUpload = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const text = event.target?.result as string;
                const rows = parseCsv(text);
                const matchedRows = autoMatchProducts(rows);
                setCsvRows(matchedRows);
            };
            reader.readAsText(file);

            // Reset input
            e.target.value = '';
        },
        [autoMatchProducts]
    );

    // Handle paste
    const handlePaste = useCallback(
        (e: React.ClipboardEvent) => {
            const text = e.clipboardData.getData('text');
            if (text) {
                const rows = parseCsv(text);
                const matchedRows = autoMatchProducts(rows);
                setCsvRows(matchedRows);
            }
        },
        [autoMatchProducts]
    );

    // Map a row to a product
    const mapRow = useCallback((rowId: string, product: ProductForMappingResult | null) => {
        setCsvRows((prev) =>
            prev.map((row) =>
                row.id === rowId
                    ? {
                          ...row,
                          mappedProductId: product?.id || null,
                          mappedProductName: product?.name || null,
                          autoMatched: false,
                      }
                    : row
            )
        );
        setSearchingRowId(null);
        setSearchQuery('');
    }, []);

    // Filtered products for search
    const filteredProducts = useMemo(() => {
        if (!searchQuery.trim()) return internalProducts.slice(0, 20);
        const q = searchQuery.toLowerCase();
        return internalProducts
            .filter(
                (p) =>
                    p.name.toLowerCase().includes(q) ||
                    p.styleCode?.toLowerCase().includes(q) ||
                    p.category?.toLowerCase().includes(q)
            )
            .slice(0, 20);
    }, [internalProducts, searchQuery]);

    // Stats and duplicate detection
    const { stats, duplicateMappings } = useMemo(() => {
        const total = csvRows.length;
        const mapped = csvRows.filter((r) => r.mappedProductId).length;
        const unmapped = total - mapped;
        const autoMatched = csvRows.filter((r) => r.autoMatched).length;

        // Find products mapped to multiple rows
        const productIdCounts = new Map<string, number>();
        for (const row of csvRows) {
            if (row.mappedProductId) {
                productIdCounts.set(
                    row.mappedProductId,
                    (productIdCounts.get(row.mappedProductId) || 0) + 1
                );
            }
        }
        const duplicates = new Set<string>();
        for (const [productId, count] of productIdCounts) {
            if (count > 1) duplicates.add(productId);
        }

        const uniqueProducts = productIdCounts.size;

        return {
            stats: { total, mapped, unmapped, autoMatched, uniqueProducts },
            duplicateMappings: duplicates,
        };
    }, [csvRows]);

    // Filtered rows
    const displayRows = useMemo(() => {
        if (filterUnmapped) {
            return csvRows.filter((r) => !r.mappedProductId);
        }
        return csvRows;
    }, [csvRows, filterUnmapped]);

    if (loadingProducts) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 size={24} className="animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Loading products...</span>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                <div>
                    <h3 className="text-sm font-medium text-gray-900">Import Consumption Data</h3>
                    <p className="text-xs text-gray-500">
                        Upload CSV or paste data, then map to internal products
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        onChange={handleFileUpload}
                        className="hidden"
                    />
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleReset}
                        disabled={resetMutation.isPending}
                        className="gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                        {resetMutation.isPending ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Trash2 size={14} />
                        )}
                        Reset All
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="gap-1"
                    >
                        <Upload size={14} />
                        Upload CSV
                    </Button>
                    {csvRows.length > 0 && stats.mapped > 0 && (
                        <Button
                            size="sm"
                            onClick={() => importMutation.mutate(csvRows)}
                            disabled={importMutation.isPending}
                            className="gap-1"
                        >
                            {importMutation.isPending ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <CheckCircle2 size={14} />
                            )}
                            Import {stats.uniqueProducts} Products
                        </Button>
                    )}
                </div>
            </div>

            {/* Empty state - paste zone */}
            {csvRows.length === 0 && (
                <div
                    className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-300 m-4 rounded-lg"
                    onPaste={handlePaste}
                >
                    <div className="text-center">
                        <FileSpreadsheet size={48} className="mx-auto mb-4 text-gray-300" />
                        <p className="text-gray-600 mb-2">Upload a CSV file or paste data here</p>
                        <p className="text-xs text-gray-400 mb-4">
                            Expected columns: Product Name, UOM, XS, S, M, L, XL, 2XL, 3XL, Avg, Fabric Code
                        </p>
                        <Button
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                            className="gap-1"
                        >
                            <Upload size={14} />
                            Choose File
                        </Button>
                    </div>
                </div>
            )}

            {/* Data loaded */}
            {csvRows.length > 0 && (
                <>
                    {/* Stats bar */}
                    <div className="px-4 py-2 border-b bg-gray-50 flex items-center gap-4 text-xs">
                        <span className="text-gray-600">
                            <strong>{stats.total}</strong> rows
                        </span>
                        <span className="text-green-600">
                            <Check size={12} className="inline mr-1" />
                            <strong>{stats.mapped}</strong> mapped → <strong>{stats.uniqueProducts}</strong> products
                        </span>
                        {stats.unmapped > 0 && (
                            <span className="text-amber-600">
                                <AlertCircle size={12} className="inline mr-1" />
                                <strong>{stats.unmapped}</strong> unmapped
                            </span>
                        )}
                        {duplicateMappings.size > 0 && (
                            <span className="text-purple-600">
                                <strong>{duplicateMappings.size}</strong> duplicates (will merge)
                            </span>
                        )}
                        <div className="flex-1" />
                        <label className="flex items-center gap-1 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={filterUnmapped}
                                onChange={(e) => setFilterUnmapped(e.target.checked)}
                                className="rounded"
                            />
                            <span>Show only unmapped</span>
                        </label>
                        <button
                            onClick={() => setCsvRows([])}
                            className="text-gray-400 hover:text-gray-600"
                        >
                            Clear all
                        </button>
                    </div>

                    {/* Table */}
                    <div className="flex-1 overflow-auto">
                        <table className="w-full text-sm border-collapse">
                            <thead className="sticky top-0 bg-gray-50 z-10">
                                <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 border-b w-64">
                                        CSV Product Name
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 border-b w-64">
                                        Mapped To
                                    </th>
                                    {SIZE_COLUMNS.map((size) => (
                                        <th
                                            key={size}
                                            className="px-2 py-2 text-center text-xs font-medium text-gray-500 border-b w-16"
                                        >
                                            {size}
                                        </th>
                                    ))}
                                    <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 border-b w-16">
                                        Avg
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayRows.map((row) => (
                                    <tr
                                        key={row.id}
                                        className={`border-b hover:bg-gray-50 ${
                                            !row.mappedProductId ? 'bg-amber-50/50' : ''
                                        }`}
                                    >
                                        {/* CSV Name */}
                                        <td className="px-3 py-2">
                                            <div className="font-medium text-gray-900 text-xs">
                                                {row.productName}
                                            </div>
                                            {row.fabricCode && (
                                                <div className="text-[10px] text-gray-400">
                                                    {row.fabricCode}
                                                </div>
                                            )}
                                        </td>

                                        {/* Mapped Product */}
                                        <td className="px-3 py-2">
                                            {searchingRowId === row.id ? (
                                                <div className="relative">
                                                    <Search
                                                        size={14}
                                                        className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
                                                    />
                                                    <input
                                                        type="text"
                                                        autoFocus
                                                        placeholder="Search products..."
                                                        value={searchQuery}
                                                        onChange={(e) => setSearchQuery(e.target.value)}
                                                        onBlur={() => {
                                                            setTimeout(() => {
                                                                setSearchingRowId(null);
                                                                setSearchQuery('');
                                                            }, 200);
                                                        }}
                                                        className="w-full pl-7 pr-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                    />
                                                    {/* Dropdown */}
                                                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-lg z-20 max-h-48 overflow-auto">
                                                        {filteredProducts.map((prod) => (
                                                            <button
                                                                key={prod.id}
                                                                onMouseDown={() => mapRow(row.id, prod)}
                                                                className={`w-full px-3 py-2 text-left hover:bg-gray-100 flex items-center gap-2 ${
                                                                    prod.hasConsumption ? 'bg-orange-50' : ''
                                                                }`}
                                                            >
                                                                {prod.imageUrl ? (
                                                                    <img
                                                                        src={getOptimizedImageUrl(prod.imageUrl, 'xs') || prod.imageUrl}
                                                                        alt=""
                                                                        className="w-6 h-6 rounded object-cover"
                                                                        loading="lazy"
                                                                    />
                                                                ) : (
                                                                    <div className="w-6 h-6 rounded bg-gray-100" />
                                                                )}
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="text-xs font-medium truncate flex items-center gap-1">
                                                                        {prod.name}
                                                                        {prod.hasConsumption && (
                                                                            <span className="text-[9px] px-1 py-0.5 bg-orange-200 text-orange-700 rounded">
                                                                                {prod.avgConsumption.toFixed(2)}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    {prod.styleCode && (
                                                                        <div className="text-[10px] text-gray-400">
                                                                            {prod.styleCode}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </button>
                                                        ))}
                                                        {filteredProducts.length === 0 && (
                                                            <div className="px-3 py-2 text-xs text-gray-400">
                                                                No products found
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ) : row.mappedProductId ? (
                                                <div className="flex items-center gap-2">
                                                    <Link2 size={12} className="text-green-500 flex-shrink-0" />
                                                    <span className="text-xs text-gray-700 truncate flex-1">
                                                        {row.mappedProductName}
                                                    </span>
                                                    {row.autoMatched && (
                                                        <span className="text-[10px] px-1 py-0.5 bg-blue-100 text-blue-600 rounded">
                                                            auto
                                                        </span>
                                                    )}
                                                    {duplicateMappings.has(row.mappedProductId) && (
                                                        <span className="text-[10px] px-1 py-0.5 bg-purple-100 text-purple-600 rounded" title="This product is mapped to multiple rows - sizes will be merged">
                                                            dup
                                                        </span>
                                                    )}
                                                    <button
                                                        onClick={() => setSearchingRowId(row.id)}
                                                        className="text-gray-400 hover:text-gray-600"
                                                        title="Change mapping"
                                                    >
                                                        <Search size={12} />
                                                    </button>
                                                    <button
                                                        onClick={() => mapRow(row.id, null)}
                                                        className="text-gray-400 hover:text-red-500"
                                                        title="Remove mapping"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setSearchingRowId(row.id)}
                                                    className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700"
                                                >
                                                    <Link2Off size={12} />
                                                    Click to map
                                                </button>
                                            )}
                                        </td>

                                        {/* Size values */}
                                        {SIZE_COLUMNS.map((size) => (
                                            <td
                                                key={size}
                                                className="px-2 py-2 text-center text-xs tabular-nums text-gray-600"
                                            >
                                                {row.sizes[size]?.toFixed(2) ?? '-'}
                                            </td>
                                        ))}

                                        {/* Average */}
                                        <td className="px-2 py-2 text-center text-xs tabular-nums text-gray-500">
                                            {row.avgConsumption?.toFixed(2) ?? '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
