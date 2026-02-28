/**
 * ImportExportTab component
 * CSV export and import functionality
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { importExportApi } from '../../../services/api';
import { Download, Upload, FileSpreadsheet } from 'lucide-react';

interface ImportResult {
    totalRows: number;
    results?: {
        created?: Record<string, number>;
        updated?: Record<string, number>;
        skipped?: number;
        errors?: string[];
    };
}

export function ImportExportTab() {
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importType, setImportType] = useState<'products' | 'fabrics'>('products');
    const [importResult, setImportResult] = useState<ImportResult | null>(null);

    const importMutation = useMutation({
        mutationFn: async () => {
            if (!importFile) throw new Error('No file selected');
            if (importType === 'products') {
                return importExportApi.importProducts(importFile);
            } else {
                return importExportApi.importFabrics(importFile);
            }
        },
        onSuccess: (res) => {
            setImportResult(res.data);
            setImportFile(null);
        },
        onError: (error: unknown) => {
            toast.error(error instanceof Error ? error.message : 'Import failed');
        },
    });

    const handleExport = async (type: 'products' | 'fabrics' | 'inventory') => {
        try {
            let response;
            let filename;
            if (type === 'products') {
                response = await importExportApi.exportProducts();
                filename = 'products-export.csv';
            } else if (type === 'fabrics') {
                response = await importExportApi.exportFabrics();
                filename = 'fabrics-export.csv';
            } else {
                response = await importExportApi.exportInventory();
                filename = 'inventory-transactions.csv';
            }

            const blob = new Blob([response.data], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch {
            toast.error('Export failed');
        }
    };

    return (
        <div className="space-y-6">
            {/* Export Card */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Download size={20} /> Export Data
                </h2>

                <div className="flex flex-wrap gap-3">
                    <button className="btn btn-secondary flex items-center gap-2" onClick={() => handleExport('products')}>
                        <FileSpreadsheet size={16} /> Export Products
                    </button>
                    <button className="btn btn-secondary flex items-center gap-2" onClick={() => handleExport('fabrics')}>
                        <FileSpreadsheet size={16} /> Export Fabrics
                    </button>
                    <button className="btn btn-secondary flex items-center gap-2" onClick={() => handleExport('inventory')}>
                        <FileSpreadsheet size={16} /> Export Inventory Transactions
                    </button>
                </div>

                <p className="text-sm text-gray-500 mt-3">
                    Export data as CSV files for backup or editing. You can import modified files back.
                </p>
            </div>

            {/* Import Card */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Upload size={20} /> Import Data
                </h2>

                <div className="max-w-xl space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Import Type</label>
                        <select
                            className="input"
                            value={importType}
                            onChange={(e) => setImportType(e.target.value as 'products' | 'fabrics')}
                        >
                            <option value="products">Products & SKUs</option>
                            <option value="fabrics">Fabrics</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">CSV File</label>
                        <input
                            type="file"
                            accept=".csv"
                            className="input"
                            onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                        />
                    </div>

                    <button
                        className="btn btn-primary flex items-center gap-2"
                        onClick={() => importMutation.mutate()}
                        disabled={!importFile || importMutation.isPending}
                    >
                        <Upload size={16} />
                        {importMutation.isPending ? 'Importing...' : 'Import CSV'}
                    </button>

                    {/* Import Result */}
                    {importResult && (
                        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                            <p className="font-medium text-green-800 mb-2">Import completed!</p>
                            <div className="text-sm text-green-700 space-y-1">
                                <p>Total rows: {importResult.totalRows}</p>
                                {importResult.results?.created && (
                                    <p>
                                        Created: {Object.entries(importResult.results.created).map(([k, v]) => `${v} ${k}`).join(', ')}
                                    </p>
                                )}
                                {importResult.results?.updated && (
                                    <p>
                                        Updated: {Object.entries(importResult.results.updated).map(([k, v]) => `${v} ${k}`).join(', ')}
                                    </p>
                                )}
                                {(importResult.results?.skipped ?? 0) > 0 && (
                                    <p className="text-yellow-700">Skipped: {importResult.results?.skipped}</p>
                                )}
                                {(importResult.results?.errors?.length ?? 0) > 0 && (
                                    <div className="mt-2">
                                        <p className="text-red-700 font-medium">Errors:</p>
                                        <ul className="list-disc list-inside text-red-600">
                                            {importResult.results?.errors?.slice(0, 5).map((err: string, i: number) => (
                                                <li key={i}>{err}</li>
                                            ))}
                                            {(importResult.results?.errors?.length ?? 0) > 5 && (
                                                <li>...and {(importResult.results?.errors?.length ?? 0) - 5} more</li>
                                            )}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800 font-medium mb-1">CSV Format Tips:</p>
                    <ul className="text-sm text-blue-700 list-disc list-inside space-y-1">
                        <li>First row should contain column headers</li>
                        <li>Products CSV: productName, category, productType, colorName, skuCode, size, mrp, barcode</li>
                        <li>Fabrics CSV: fabricTypeName, colorName, costPerUnit, supplierName</li>
                        <li>Existing SKUs will be updated, new ones will be created</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

export default ImportExportTab;
