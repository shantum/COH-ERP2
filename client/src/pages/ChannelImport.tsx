import { useState, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  X,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { compactThemeSmall } from '../utils/agGridHelpers';

ModuleRegistry.registerModules([AllCommunityModule]);

// ============================================
// TYPES
// ============================================

interface PreviewLine {
  channelItemId: string;
  skuCode: string;
  skuId: string | null;
  skuMatched: boolean;
  skuTitle: string | null;
  qty: number;
  unitPrice: number;
  fulfillmentStatus: string;
  previousStatus?: string;
  courierName: string | null;
  awbNumber: string | null;
  dispatchDate: string | null;
  manifestedDate: string | null;
  deliveryDate: string | null;
}

interface PreviewOrder {
  channelOrderId: string;
  channelRef: string;
  channel: string;
  importStatus: 'new' | 'existing_unchanged' | 'existing_updated';
  existingOrderId?: string;
  orderDate: string;
  orderType: string;
  customerName: string | null;
  customerPhone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  dispatchByDate: string | null;
  lines: PreviewLine[];
  totalAmount: number;
}

interface PreviewResponse {
  orders: PreviewOrder[];
  summary: {
    totalOrders: number;
    newOrders: number;
    existingUnchanged: number;
    existingUpdated: number;
    unmatchedSkus: string[];
  };
  rawRows: unknown[];
}

interface ExecuteResult {
  ordersCreated: number;
  ordersUpdated: number;
  sheetPushed?: number;
  sheetSkipped?: number;
  sheetError?: string;
  errors: Array<{ order: string; error: string }>;
}

interface ImportBatch {
  id: string;
  channel: string;
  filename: string;
  rowsTotal: number;
  rowsImported: number;
  rowsUpdated: number;
  importedAt: string;
  importType: string;
  ordersCreated: number;
  ordersUpdated: number;
}

// Flat row for AG-Grid (one row per line item)
interface GridRow {
  orderId: string;
  channelRef: string;
  channel: string;
  importStatus: string;
  orderDate: string;
  orderType: string;
  customerName: string | null;
  city: string | null;
  skuCode: string;
  skuMatched: boolean;
  skuTitle: string | null;
  qty: number;
  unitPrice: number;
  fulfillmentStatus: string;
  previousStatus?: string;
  courierName: string | null;
  awbNumber: string | null;
  totalAmount: number;
  // Hidden fields for selection
  _order: PreviewOrder;
}

type PageState = 'idle' | 'previewing' | 'preview' | 'importing' | 'complete';

// ============================================
// API FUNCTIONS
// ============================================

async function previewImport(file: File): Promise<PreviewResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/channels/preview-import', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Preview failed' }));
    throw new Error(err.error || 'Preview failed');
  }
  return res.json();
}

async function executeImport(data: {
  selectedOrders: PreviewOrder[];
  rawRows: unknown[];
  filename: string;
}): Promise<ExecuteResult> {
  const res = await fetch('/api/channels/execute-import', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Import failed' }));
    throw new Error(err.error || 'Import failed');
  }
  return res.json();
}

// ============================================
// CHANNEL BADGE COLORS
// ============================================

const CHANNEL_COLORS: Record<string, string> = {
  myntra: 'bg-pink-100 text-pink-800',
  ajio: 'bg-orange-100 text-orange-800',
  nykaa: 'bg-purple-100 text-purple-800',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-green-100 text-green-800',
  existing_updated: 'bg-yellow-100 text-yellow-800',
  existing_unchanged: 'bg-gray-100 text-gray-600',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  existing_updated: 'Updated',
  existing_unchanged: 'Imported',
};

// ============================================
// COMPONENT
// ============================================

export default function ChannelImport() {
  const queryClient = useQueryClient();
  const gridRef = useRef<AgGridReact>(null);

  const [pageState, setPageState] = useState<PageState>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);

  // Import history
  const historyQuery = useQuery<ImportBatch[]>({
    queryKey: ['channels', 'import-history'],
    queryFn: async () => {
      const res = await fetch('/api/channels/import-history', { credentials: 'include' });
      return res.json();
    },
  });

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: previewImport,
    onSuccess: (data) => {
      setPreview(data);
      // Auto-select all "new" + "existing_updated" orders
      const autoSelect = new Set(
        data.orders
          .filter(o => o.importStatus === 'new' || o.importStatus === 'existing_updated')
          .map(o => o.channelOrderId)
      );
      setSelectedOrderIds(autoSelect);
      setPageState('preview');
    },
    onError: () => {
      setPageState('idle');
    },
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: executeImport,
    onSuccess: (data) => {
      setExecuteResult(data);
      setPageState('complete');
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  // ============================================
  // FILE HANDLERS
  // ============================================

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'text/csv' || file.name.endsWith('.csv'))) {
      setSelectedFile(file);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  }, []);

  const handleUpload = useCallback(() => {
    if (!selectedFile) return;
    setPageState('previewing');
    previewMutation.mutate(selectedFile);
  }, [selectedFile, previewMutation]);

  const handleExecute = useCallback(() => {
    if (!preview) return;
    const selected = preview.orders.filter(o => selectedOrderIds.has(o.channelOrderId));
    if (selected.length === 0) return;
    setPageState('importing');
    executeMutation.mutate({
      selectedOrders: selected,
      rawRows: preview.rawRows,
      filename: selectedFile?.name || 'import.csv',
    });
  }, [preview, selectedOrderIds, selectedFile, executeMutation]);

  const handleReset = useCallback(() => {
    setPageState('idle');
    setSelectedFile(null);
    setPreview(null);
    setSelectedOrderIds(new Set());
    setExecuteResult(null);
    previewMutation.reset();
    executeMutation.reset();
  }, [previewMutation, executeMutation]);

  // ============================================
  // SELECTION HELPERS
  // ============================================

  const toggleOrder = useCallback((orderId: string) => {
    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  const selectAllNew = useCallback(() => {
    if (!preview) return;
    const ids = preview.orders.filter(o => o.importStatus === 'new').map(o => o.channelOrderId);
    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
  }, [preview]);

  const selectAllUpdated = useCallback(() => {
    if (!preview) return;
    const ids = preview.orders.filter(o => o.importStatus === 'existing_updated').map(o => o.channelOrderId);
    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
  }, [preview]);

  const deselectAll = useCallback(() => {
    setSelectedOrderIds(new Set());
  }, []);

  // ============================================
  // AG-GRID
  // ============================================

  // Flatten orders into grid rows (one row per line item)
  const gridRows: GridRow[] = useMemo(() => {
    if (!preview) return [];
    const rows: GridRow[] = [];
    for (const order of preview.orders) {
      for (const line of order.lines) {
        rows.push({
          orderId: order.channelOrderId,
          channelRef: order.channelRef,
          channel: order.channel,
          importStatus: order.importStatus,
          orderDate: order.orderDate ? new Date(order.orderDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
          orderType: order.orderType,
          customerName: order.customerName,
          city: order.city,
          skuCode: line.skuCode,
          skuMatched: line.skuMatched,
          skuTitle: line.skuTitle,
          qty: line.qty,
          unitPrice: line.unitPrice,
          fulfillmentStatus: line.fulfillmentStatus,
          previousStatus: line.previousStatus,
          courierName: line.courierName,
          awbNumber: line.awbNumber,
          totalAmount: order.totalAmount,
          _order: order,
        });
      }
    }
    return rows;
  }, [preview]);

  const columnDefs: ColDef<GridRow>[] = useMemo(() => [
    {
      headerName: '',
      field: 'orderId',
      width: 40,
      cellRenderer: (params: { data: GridRow }) => {
        if (!params.data) return null;
        const checked = selectedOrderIds.has(params.data.orderId);
        const disabled = params.data.importStatus === 'existing_unchanged';
        return (
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={() => toggleOrder(params.data.orderId)}
            className="cursor-pointer"
          />
        );
      },
      suppressHeaderMenuButton: true,
    },
    {
      headerName: 'Status',
      field: 'importStatus',
      width: 90,
      cellRenderer: (params: { value: string }) => {
        const label = STATUS_LABELS[params.value] || params.value;
        const color = STATUS_COLORS[params.value] || 'bg-gray-100 text-gray-600';
        return <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>{label}</span>;
      },
    },
    {
      headerName: 'Channel',
      field: 'channel',
      width: 80,
      cellRenderer: (params: { value: string }) => {
        const color = CHANNEL_COLORS[params.value] || 'bg-gray-100 text-gray-600';
        return <span className={`px-1.5 py-0.5 rounded text-xs font-medium capitalize ${color}`}>{params.value}</span>;
      },
    },
    { headerName: 'Channel Ref', field: 'channelRef', width: 200 },
    { headerName: 'Date', field: 'orderDate', width: 100 },
    { headerName: 'Customer', field: 'customerName', width: 140 },
    { headerName: 'City', field: 'city', width: 100 },
    {
      headerName: 'SKU',
      field: 'skuCode',
      width: 160,
      cellRenderer: (params: { data: GridRow }) => {
        if (!params.data) return null;
        const icon = params.data.skuMatched ? '✓' : '✗';
        const color = params.data.skuMatched ? 'text-green-600' : 'text-red-500';
        return (
          <span>
            <span className={`${color} mr-1`}>{icon}</span>
            {params.data.skuCode}
          </span>
        );
      },
    },
    { headerName: 'Qty', field: 'qty', width: 55 },
    {
      headerName: 'Price',
      field: 'unitPrice',
      width: 80,
      valueFormatter: (params: { value: number }) => params.value ? `₹${params.value.toLocaleString('en-IN')}` : '',
    },
    { headerName: 'Type', field: 'orderType', width: 70 },
    {
      headerName: 'Fulfillment',
      field: 'fulfillmentStatus',
      width: 150,
      cellRenderer: (params: { data: GridRow }) => {
        if (!params.data) return null;
        if (params.data.previousStatus) {
          return (
            <span className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">{params.data.previousStatus}</span>
              <ArrowRight className="w-3 h-3" />
              <span className="font-medium text-yellow-700">{params.data.fulfillmentStatus}</span>
            </span>
          );
        }
        return <span className="text-xs">{params.data.fulfillmentStatus}</span>;
      },
    },
    { headerName: 'Courier', field: 'courierName', width: 100 },
    { headerName: 'AWB', field: 'awbNumber', width: 140 },
  ], [selectedOrderIds, toggleOrder]);

  const defaultColDef: ColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    suppressMovable: true,
  }), []);

  const onGridReady = useCallback((params: GridReadyEvent) => {
    params.api.sizeColumnsToFit();
  }, []);

  // ============================================
  // COMPUTED
  // ============================================

  const selectedCount = selectedOrderIds.size;
  const selectedNewCount = preview?.orders.filter(o => selectedOrderIds.has(o.channelOrderId) && o.importStatus === 'new').length || 0;
  const selectedUpdatedCount = preview?.orders.filter(o => selectedOrderIds.has(o.channelOrderId) && o.importStatus === 'existing_updated').length || 0;

  // Filter import history to show order_import batches
  const orderImportHistory = useMemo(() => {
    return (historyQuery.data || []).filter(b => b.importType === 'order_import');
  }, [historyQuery.data]);

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="p-4 space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Channel Order Import</h1>
        {pageState !== 'idle' && pageState !== 'previewing' && (
          <Button variant="outline" size="sm" onClick={handleReset}>
            <X className="w-4 h-4 mr-1" /> Start Over
          </Button>
        )}
      </div>

      {/* Upload Section */}
      {pageState === 'idle' && (
        <Card>
          <CardContent className="pt-6">
            <div
              className={`
                border-2 border-dashed rounded-lg p-8 text-center transition-colors relative
                ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
                ${selectedFile ? 'border-primary' : ''}
              `}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {selectedFile ? (
                <div className="flex flex-col items-center gap-2">
                  <FileText className="w-10 h-10 text-primary" />
                  <p className="font-medium">{selectedFile.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                  <div className="flex gap-2 mt-2">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedFile(null)}>
                      Choose different file
                    </Button>
                    <Button size="sm" onClick={handleUpload}>
                      <Upload className="w-4 h-4 mr-1" /> Preview Import
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-10 h-10 text-muted-foreground" />
                  <p className="font-medium">Drop BT Report CSV here</p>
                  <p className="text-sm text-muted-foreground">or click to browse</p>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleFileSelect}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {pageState === 'previewing' && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Parsing CSV and matching SKUs...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview Error */}
      {previewMutation.isError && pageState === 'idle' && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-red-700">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">Preview failed</span>
            </div>
            <p className="text-sm text-red-600 mt-1">
              {previewMutation.error instanceof Error ? previewMutation.error.message : 'Unknown error'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Preview Results */}
      {(pageState === 'preview' || pageState === 'importing') && preview && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-xs text-muted-foreground">Total Orders</p>
                <p className="text-lg font-semibold">{preview.summary.totalOrders}</p>
              </CardContent>
            </Card>
            <Card className="border-green-200">
              <CardContent className="py-3 px-4">
                <p className="text-xs text-green-600">New</p>
                <p className="text-lg font-semibold text-green-700">{preview.summary.newOrders}</p>
              </CardContent>
            </Card>
            <Card className="border-yellow-200">
              <CardContent className="py-3 px-4">
                <p className="text-xs text-yellow-600">Updated</p>
                <p className="text-lg font-semibold text-yellow-700">{preview.summary.existingUpdated}</p>
              </CardContent>
            </Card>
            <Card className="border-gray-200">
              <CardContent className="py-3 px-4">
                <p className="text-xs text-muted-foreground">Already Imported</p>
                <p className="text-lg font-semibold text-gray-500">{preview.summary.existingUnchanged}</p>
              </CardContent>
            </Card>
            {preview.summary.unmatchedSkus.length > 0 && (
              <Card className="border-red-200">
                <CardContent className="py-3 px-4">
                  <p className="text-xs text-red-600">Unmatched SKUs</p>
                  <p className="text-lg font-semibold text-red-700">{preview.summary.unmatchedSkus.length}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Unmatched SKUs Warning */}
          {preview.summary.unmatchedSkus.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm font-medium text-amber-700">
                These SKU codes weren't found in the ERP — their lines will be skipped:
              </p>
              <p className="text-xs text-amber-600 mt-1">
                {preview.summary.unmatchedSkus.slice(0, 20).join(', ')}
                {preview.summary.unmatchedSkus.length > 20 && ` ...and ${preview.summary.unmatchedSkus.length - 20} more`}
              </p>
            </div>
          )}

          {/* Action Bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="outline" size="sm" onClick={selectAllNew}>
              Select All New ({preview.summary.newOrders})
            </Button>
            {preview.summary.existingUpdated > 0 && (
              <Button variant="outline" size="sm" onClick={selectAllUpdated}>
                Select All Updated ({preview.summary.existingUpdated})
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={deselectAll}>
              Deselect All
            </Button>
            <div className="flex-1" />
            <span className="text-sm text-muted-foreground">
              {selectedCount} selected ({selectedNewCount} new, {selectedUpdatedCount} updated)
            </span>
            <Button
              onClick={handleExecute}
              disabled={selectedCount === 0 || pageState === 'importing'}
            >
              {pageState === 'importing' ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Importing...
                </>
              ) : (
                <>Import {selectedCount} Orders</>
              )}
            </Button>
          </div>

          {/* AG-Grid Preview Table */}
          <div className="ag-theme-quartz" style={{ height: Math.min(600, 80 + gridRows.length * 28) }}>
            <AgGridReact<GridRow>
              ref={gridRef}
              theme={compactThemeSmall}
              rowData={gridRows}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              onGridReady={onGridReady}
              suppressCellFocus
              animateRows={false}
              getRowStyle={(params) => {
                if (params.data?.importStatus === 'existing_unchanged') {
                  return { opacity: '0.5' };
                }
                return undefined;
              }}
            />
          </div>
        </>
      )}

      {/* Complete */}
      {pageState === 'complete' && executeResult && (
        <Card className="border-green-200">
          <CardContent className="py-6">
            <div className="flex items-center gap-2 text-green-700 mb-4">
              <CheckCircle className="w-6 h-6" />
              <span className="text-lg font-medium">Import Complete</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm max-w-md">
              <div>
                <p className="text-muted-foreground">Orders Created</p>
                <p className="text-xl font-semibold text-green-700">{executeResult.ordersCreated}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Orders Updated</p>
                <p className="text-xl font-semibold text-blue-700">{executeResult.ordersUpdated}</p>
              </div>
            </div>
            {(executeResult.sheetPushed != null || executeResult.sheetSkipped != null) && (
              <div className="mt-4 text-sm text-muted-foreground">
                Google Sheet: {executeResult.sheetPushed ?? 0} pushed, {executeResult.sheetSkipped ?? 0} already there
              </div>
            )}
            {executeResult.sheetError && (
              <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-medium text-red-700">{executeResult.sheetError}</p>
              </div>
            )}
            {executeResult.errors.length > 0 && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm font-medium text-amber-700">
                  {executeResult.errors.length} order(s) had errors
                </p>
                <ul className="text-xs text-amber-600 mt-1 space-y-1">
                  {executeResult.errors.slice(0, 10).map((err, idx) => (
                    <li key={idx}>{err.order}: {err.error}</li>
                  ))}
                </ul>
              </div>
            )}
            <Button className="mt-4" onClick={handleReset}>
              Import Another File
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Import History */}
      {orderImportHistory.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Import History</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2">
              {orderImportHistory.slice(0, 10).map(batch => (
                <div key={batch.id} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0">
                  <span className="text-muted-foreground w-28">
                    {new Date(batch.importedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                  <span className="truncate flex-1">{batch.filename}</span>
                  <Badge variant="outline" className="text-xs">
                    {batch.ordersCreated} created
                  </Badge>
                  {batch.ordersUpdated > 0 && (
                    <Badge variant="outline" className="text-xs">
                      {batch.ordersUpdated} updated
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">{batch.rowsTotal} rows</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
