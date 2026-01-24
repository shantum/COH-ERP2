/**
 * StyleCodesTable - Quick view and inline edit for product style codes
 *
 * Features:
 * - Sortable columns by name, category, style code
 * - Search filtering
 * - Inline editing with click-to-edit
 * - Visual indication of missing style codes
 * - CSV import for bulk updates
 */

import { useState, useMemo, useCallback, memo, useRef } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Check, X, Pencil, RefreshCw, AlertCircle, Upload, FileText, AlertTriangle } from 'lucide-react';
import { useServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { getStyleCodes } from '@/server/functions/products';
import { updateStyleCode, importStyleCodes } from '@/server/functions/productsMutations';

interface StyleCodeItem {
    id: string;
    name: string;
    category: string;
    productType: string;
    styleCode: string | null;
    variationCount: number;
    skuCount: number;
    isActive: boolean;
}

interface EditableCellProps {
    productId: string;
    value: string | null;
    onSave: (productId: string, styleCode: string | null) => void;
    isPending: boolean;
}

const EditableStyleCodeCell = memo(function EditableStyleCodeCell({
    productId,
    value,
    onSave,
    isPending,
}: EditableCellProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value || '');

    const handleStartEdit = useCallback(() => {
        setEditValue(value || '');
        setIsEditing(true);
    }, [value]);

    const handleSave = useCallback(() => {
        const trimmed = editValue.trim();
        onSave(productId, trimmed || null);
        setIsEditing(false);
    }, [productId, editValue, onSave]);

    const handleCancel = useCallback(() => {
        setEditValue(value || '');
        setIsEditing(false);
    }, [value]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    }, [handleSave, handleCancel]);

    if (isEditing) {
        return (
            <div className="flex items-center gap-1">
                <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-7 w-32 text-sm font-mono"
                    placeholder="Enter code..."
                    autoFocus
                    disabled={isPending}
                />
                <button
                    onClick={handleSave}
                    disabled={isPending}
                    className="p-1 rounded hover:bg-green-100 text-green-600 disabled:opacity-50"
                    title="Save"
                >
                    <Check size={14} />
                </button>
                <button
                    onClick={handleCancel}
                    disabled={isPending}
                    className="p-1 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-50"
                    title="Cancel"
                >
                    <X size={14} />
                </button>
            </div>
        );
    }

    return (
        <div
            className="group flex items-center gap-2 cursor-pointer min-w-[120px]"
            onClick={handleStartEdit}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleStartEdit()}
        >
            {value ? (
                <span className="font-mono text-sm">{value}</span>
            ) : (
                <span className="flex items-center gap-1 text-amber-600 text-sm">
                    <AlertCircle size={12} />
                    Not set
                </span>
            )}
            <Pencil
                size={12}
                className="opacity-0 group-hover:opacity-100 text-gray-400 transition-opacity"
            />
        </div>
    );
});

interface CsvRow {
    barcode: string;
    styleCode: string;
    rowNumber: number;
}

interface RawCsvData {
    headers: string[];
    rawRows: string[][];
}

function parseCSV(content: string): RawCsvData {
    const lines = content.split('\n');
    const headers = lines[0]?.split(',').map(h => h.trim()) || [];
    const rawRows: string[][] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        rawRows.push(line.split(',').map(c => c.trim()));
    }

    return { headers, rawRows };
}

function extractRows(rawRows: string[][], skuIdx: number, styleCodeIdx: number): CsvRow[] {
    return rawRows
        .map((row, idx) => ({
            barcode: row[skuIdx] || '',
            styleCode: row[styleCodeIdx] || '',
            rowNumber: idx + 2, // +2 for 1-indexed and header row
        }))
        .filter(r => r.barcode && r.styleCode);
}

export function StyleCodesTable() {
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Import dialog state
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [rawCsvData, setRawCsvData] = useState<RawCsvData | null>(null);
    const [skuColIndex, setSkuColIndex] = useState(0);
    const [styleCodeColIndex, setStyleCodeColIndex] = useState(5);

    // Derived: parsed rows based on current column selection
    const parsedRows = useMemo(() => {
        if (!rawCsvData) return [];
        return extractRows(rawCsvData.rawRows, skuColIndex, styleCodeColIndex);
    }, [rawCsvData, skuColIndex, styleCodeColIndex]);

    // Server Function hooks
    const getStyleCodesFn = useServerFn(getStyleCodes);
    const updateStyleCodeFn = useServerFn(updateStyleCode);
    const importStyleCodesFn = useServerFn(importStyleCodes);

    // Fetch products with style codes
    const { data, isLoading, refetch, isFetching } = useQuery({
        queryKey: ['styleCodes'],
        queryFn: () => getStyleCodesFn({ data: {} }),
    });

    // Update mutation
    const mutation = useMutation({
        mutationFn: ({ productId, styleCode }: { productId: string; styleCode: string | null }) =>
            updateStyleCodeFn({ data: { id: productId, styleCode } }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['styleCodes'] });
            queryClient.invalidateQueries({ queryKey: ['productsTree'] });
        },
    });

    // Import mutation
    const importMutation = useMutation({
        mutationFn: (rows: { barcode: string; styleCode: string }[]) =>
            importStyleCodesFn({ data: { rows } }),
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ['styleCodes'] });
            queryClient.invalidateQueries({ queryKey: ['productsTree'] });
            setIsImportOpen(false);
            setRawCsvData(null);
            if (result.success) {
                alert(`Import complete!\n\nUpdated: ${result.updated}\nSkipped (not found): ${result.notFound}\nSkipped (duplicates): ${result.duplicates}\nErrors: ${result.errors}`);
            }
        },
    });

    const handleSave = useCallback((productId: string, styleCode: string | null) => {
        mutation.mutate({ productId, styleCode });
    }, [mutation]);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            const csvData = parseCSV(content);

            // Auto-detect columns
            let skuIdx = 0;
            let styleCodeIdx = 5;

            // Try to find by header name
            csvData.headers.forEach((h, i) => {
                const lower = h.toLowerCase();
                if (lower.includes('barcode') || lower.includes('sku')) skuIdx = i;
                if (lower.includes('style') && lower.includes('code')) styleCodeIdx = i;
            });

            setSkuColIndex(skuIdx);
            setStyleCodeColIndex(styleCodeIdx);
            setRawCsvData(csvData);
            setIsImportOpen(true);
        };
        reader.readAsText(file);

        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, []);

    const handleImport = useCallback(() => {
        if (parsedRows.length === 0) return;
        importMutation.mutate(parsedRows.map(r => ({
            barcode: r.barcode,
            styleCode: r.styleCode,
        })));
    }, [parsedRows, importMutation]);

    const items: StyleCodeItem[] = data?.items || [];

    // Summary stats
    const stats = useMemo(() => {
        const total = items.length;
        const withCode = items.filter(p => p.styleCode).length;
        const missing = total - withCode;
        return { total, withCode, missing };
    }, [items]);

    // Unique style codes in preview
    const previewStats = useMemo(() => {
        if (parsedRows.length === 0) return null;
        const uniqueCodes = new Set(parsedRows.map(r => r.styleCode));
        return {
            totalRows: parsedRows.length,
            uniqueCodes: uniqueCodes.size,
        };
    }, [parsedRows]);

    // Column definitions
    const columns = useMemo<ColumnDef<StyleCodeItem>[]>(() => [
        {
            accessorKey: 'name',
            header: 'Product Name',
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="font-medium">{row.original.name}</span>
                    <span className="text-xs text-muted-foreground">
                        {row.original.variationCount} variations, {row.original.skuCount} SKUs
                    </span>
                </div>
            ),
        },
        {
            accessorKey: 'category',
            header: 'Category',
            cell: ({ row }) => (
                <Badge variant="secondary" className="capitalize">
                    {row.original.category}
                </Badge>
            ),
        },
        {
            accessorKey: 'productType',
            header: 'Type',
            cell: ({ row }) => (
                <span className="text-sm text-muted-foreground capitalize">
                    {row.original.productType}
                </span>
            ),
        },
        {
            accessorKey: 'styleCode',
            header: 'Style Code',
            cell: ({ row }) => (
                <EditableStyleCodeCell
                    productId={row.original.id}
                    value={row.original.styleCode}
                    onSave={handleSave}
                    isPending={mutation.isPending}
                />
            ),
        },
        {
            accessorKey: 'isActive',
            header: 'Status',
            cell: ({ row }) => (
                <Badge variant={row.original.isActive ? 'success' : 'secondary'}>
                    {row.original.isActive ? 'Active' : 'Inactive'}
                </Badge>
            ),
        },
    ], [handleSave, mutation.isPending]);

    return (
        <div className="space-y-4">
            {/* Stats Summary */}
            <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Total:</span>
                    <span className="font-medium">{stats.total}</span>
                </div>
                <div className="w-px h-4 bg-gray-300" />
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">With Code:</span>
                    <span className="font-medium text-green-600">{stats.withCode}</span>
                </div>
                <div className="w-px h-4 bg-gray-300" />
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Missing:</span>
                    <span className="font-medium text-amber-600">{stats.missing}</span>
                </div>
            </div>

            <DataTable
                columns={columns}
                data={items}
                searchKey="name"
                searchPlaceholder="Search products..."
                isLoading={isLoading}
                pageSize={50}
                emptyMessage="No products found."
                toolbarRight={
                    <div className="flex items-center gap-2">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv"
                            onChange={handleFileSelect}
                            className="hidden"
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload className="h-4 w-4 mr-1" />
                            Import CSV
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => refetch()}
                            disabled={isFetching}
                        >
                            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                }
            />

            {/* Import Dialog */}
            <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Import Style Codes from CSV
                        </DialogTitle>
                        <DialogDescription>
                            Review the data before importing. Style codes will be matched to products via SKU barcodes.
                        </DialogDescription>
                    </DialogHeader>

                    {rawCsvData && (
                        <div className="space-y-4">
                            {/* Column Selection */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium">SKU/Barcode Column</label>
                                    <select
                                        value={skuColIndex}
                                        onChange={(e) => setSkuColIndex(parseInt(e.target.value))}
                                        className="w-full mt-1 h-9 rounded-md border px-3 text-sm"
                                    >
                                        {rawCsvData.headers.map((h, i) => (
                                            <option key={i} value={i}>
                                                {h || `Column ${i + 1}`}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Style Code Column</label>
                                    <select
                                        value={styleCodeColIndex}
                                        onChange={(e) => setStyleCodeColIndex(parseInt(e.target.value))}
                                        className="w-full mt-1 h-9 rounded-md border px-3 text-sm"
                                    >
                                        {rawCsvData.headers.map((h, i) => (
                                            <option key={i} value={i}>
                                                {h || `Column ${i + 1}`}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Stats */}
                            {previewStats && (
                                <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-md text-sm">
                                    <div>
                                        <span className="text-muted-foreground">Rows to process:</span>{' '}
                                        <span className="font-medium">{previewStats.totalRows}</span>
                                    </div>
                                    <div className="w-px h-4 bg-gray-300" />
                                    <div>
                                        <span className="text-muted-foreground">Unique style codes:</span>{' '}
                                        <span className="font-medium">{previewStats.uniqueCodes}</span>
                                    </div>
                                </div>
                            )}

                            {/* Preview Table */}
                            <div className="border rounded-md max-h-64 overflow-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                            <th className="text-left p-2 font-medium">Row</th>
                                            <th className="text-left p-2 font-medium">SKU/Barcode</th>
                                            <th className="text-left p-2 font-medium">Style Code</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {parsedRows.slice(0, 20).map((row, i) => (
                                            <tr key={i} className="border-t">
                                                <td className="p-2 text-muted-foreground">{row.rowNumber}</td>
                                                <td className="p-2 font-mono">{row.barcode}</td>
                                                <td className="p-2 font-mono">{row.styleCode}</td>
                                            </tr>
                                        ))}
                                        {parsedRows.length > 20 && (
                                            <tr className="border-t bg-gray-50">
                                                <td colSpan={3} className="p-2 text-center text-muted-foreground">
                                                    ... and {parsedRows.length - 20} more rows
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Note */}
                            <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-md text-sm text-blue-800">
                                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                <div>
                                    <strong>Note:</strong> Multiple products can share the same style code.
                                    Products that already have a style code will be skipped.
                                </div>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsImportOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleImport}
                            disabled={importMutation.isPending || parsedRows.length === 0}
                        >
                            {importMutation.isPending ? 'Importing...' : `Import ${parsedRows.length} Rows`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
