import { useMemo, useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

type Step = 'upload' | 'preview' | 'importing' | 'done';

interface PreviewRow {
  requestNumber: string;
  requestType: string | null;
  status: string | null;
  action: 'create' | 'update' | 'unchanged';
  customerComment: string | null;
  inspectionNotes: string | null;
  notes: string | null;
  existingCustomerComment: string | null;
  existingInspectionNotes: string | null;
  existingNotes: string | null;
}

interface PreviewData {
  cacheKey: string;
  sourceFile: string;
  parsedRows: number;
  validRows: number;
  skippedRows: number;
  duplicateRequestNumbers: number;
  distinctRequestNumbers: number;
  creates: number;
  updates: number;
  unchanged: number;
  matchedReturnPrimeRequests: number;
  matchedOrderLines: number;
  wouldEnrichOrderLines: number;
  rows: PreviewRow[];
}

interface ExecuteData {
  sourceFile: string;
  parsedRows: number;
  validRows: number;
  skippedRows: number;
  duplicateRequestNumbers: number;
  distinctRequestNumbers: number;
  matchedReturnPrimeRequests: number;
  created: number;
  updated: number;
  unchanged: number;
  orderLinesEnriched: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

async function previewUpload(file: File): Promise<PreviewData> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/returnprime/admin/csv-enrichment/preview-upload', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  const body = await res.json().catch(() => ({ success: false, error: 'Preview failed' }));
  if (!res.ok || body.success === false) {
    throw new Error(body.error || 'Preview failed');
  }
  return body.data as PreviewData;
}

async function executeImport(cacheKey: string, enrichOrderLines: boolean): Promise<ExecuteData> {
  const res = await fetch('/api/returnprime/admin/csv-enrichment/execute-import', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cacheKey, enrichOrderLines }),
  });
  const body = await res.json().catch(() => ({ success: false, error: 'Import failed' }));
  if (!res.ok || body.success === false) {
    throw new Error(body.error || 'Import failed');
  }
  return body.data as ExecuteData;
}

function actionBadgeClass(action: PreviewRow['action']): string {
  if (action === 'create') return 'bg-green-100 text-green-800';
  if (action === 'update') return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
}

export function ReturnPrimeCsvEnrichmentDialog({ open, onOpenChange, onImported }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ExecuteData | null>(null);
  const [enrichOrderLines, setEnrichOrderLines] = useState(true);

  const previewMutation = useMutation({
    mutationFn: previewUpload,
    onSuccess: (data) => {
      setPreview(data);
      setStep('preview');
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Preview failed';
      toast.error(message);
    },
  });

  const executeMutation = useMutation({
    mutationFn: ({ cacheKey, enrich }: { cacheKey: string; enrich: boolean }) => executeImport(cacheKey, enrich),
    onSuccess: (data) => {
      setResult(data);
      setStep('done');
      onImported?.();
      toast.success('Return Prime CSV enrichment imported');
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Import failed';
      toast.error(message);
      setStep('preview');
    },
  });

  const resetState = useCallback(() => {
    setStep('upload');
    setSelectedFile(null);
    setPreview(null);
    setResult(null);
    setEnrichOrderLines(true);
    previewMutation.reset();
    executeMutation.reset();
  }, [previewMutation, executeMutation]);

  useEffect(() => {
    if (!open) resetState();
  }, [open, resetState]);

  const previewRows = useMemo(() => preview?.rows.slice(0, 200) || [], [preview]);
  const actionableCount = (preview?.creates || 0) + (preview?.updates || 0);

  const handlePreview = useCallback(() => {
    if (!selectedFile) return;
    previewMutation.mutate(selectedFile);
  }, [selectedFile, previewMutation]);

  const handleConfirm = useCallback(() => {
    if (!preview) return;
    setStep('importing');
    executeMutation.mutate({ cacheKey: preview.cacheKey, enrich: enrichOrderLines });
  }, [preview, enrichOrderLines, executeMutation]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Return Prime CSV Enrichment</DialogTitle>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center relative">
              {selectedFile ? (
                <div className="space-y-2">
                  <FileText className="w-10 h-10 text-blue-600 mx-auto" />
                  <p className="font-medium">{selectedFile.name}</p>
                  <p className="text-sm text-gray-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                  <div className="flex justify-center gap-2">
                    <Button variant="outline" onClick={() => setSelectedFile(null)}>Choose Different File</Button>
                    <Button onClick={handlePreview} disabled={previewMutation.isPending}>
                      {previewMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                      Preview Changes
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                  <p className="font-medium">Upload Return Prime CSV export</p>
                  <p className="text-sm text-gray-500">Only .csv files are supported</p>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded border bg-gray-50">
                <p className="text-xs text-gray-500">Valid Requests</p>
                <p className="text-lg font-semibold">{preview.validRows}</p>
              </div>
              <div className="p-3 rounded border bg-green-50 border-green-200">
                <p className="text-xs text-green-700">Creates</p>
                <p className="text-lg font-semibold text-green-800">{preview.creates}</p>
              </div>
              <div className="p-3 rounded border bg-amber-50 border-amber-200">
                <p className="text-xs text-amber-700">Updates</p>
                <p className="text-lg font-semibold text-amber-800">{preview.updates}</p>
              </div>
              <div className="p-3 rounded border bg-blue-50 border-blue-200">
                <p className="text-xs text-blue-700">Would Enrich Order Lines</p>
                <p className="text-lg font-semibold text-blue-800">{preview.wouldEnrichOrderLines}</p>
              </div>
            </div>

            <div className="text-xs text-gray-600">
              File: <span className="font-medium">{preview.sourceFile}</span> | Parsed: {preview.parsedRows} | Skipped: {preview.skippedRows} | Duplicates: {preview.duplicateRequestNumbers}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enrichOrderLines}
                onChange={(e) => setEnrichOrderLines(e.target.checked)}
              />
              Also enrich linked return/exchange order lines
            </label>

            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Request</th>
                      <th className="px-3 py-2 text-left">Action</th>
                      <th className="px-3 py-2 text-left">Incoming Comment</th>
                      <th className="px-3 py-2 text-left">Existing Comment</th>
                      <th className="px-3 py-2 text-left">Incoming Inspection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={row.requestNumber} className="border-t">
                        <td className="px-3 py-2 font-mono">{row.requestNumber}</td>
                        <td className="px-3 py-2">
                          <Badge className={actionBadgeClass(row.action)}>{row.action}</Badge>
                        </td>
                        <td className="px-3 py-2 max-w-[260px] truncate">{row.customerComment || '-'}</td>
                        <td className="px-3 py-2 max-w-[260px] truncate">{row.existingCustomerComment || '-'}</td>
                        <td className="px-3 py-2 max-w-[220px] truncate">{row.inspectionNotes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows.length > previewRows.length && (
                <div className="px-3 py-2 text-xs text-gray-500 border-t bg-gray-50">
                  Showing first {previewRows.length} of {preview.rows.length} rows
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetState}>Start Over</Button>
              <Button
                onClick={handleConfirm}
                disabled={(actionableCount === 0 && (!enrichOrderLines || preview.wouldEnrichOrderLines === 0)) || executeMutation.isPending}
              >
                Confirm Import
              </Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="py-10 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
            <p className="text-sm text-gray-600">Applying CSV enrichment...</p>
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="w-5 h-5" />
              <p className="font-medium">Import completed</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded border bg-green-50 border-green-200">
                <p className="text-xs text-green-700">Created</p>
                <p className="text-lg font-semibold text-green-800">{result.created}</p>
              </div>
              <div className="p-3 rounded border bg-amber-50 border-amber-200">
                <p className="text-xs text-amber-700">Updated</p>
                <p className="text-lg font-semibold text-amber-800">{result.updated}</p>
              </div>
              <div className="p-3 rounded border bg-gray-50">
                <p className="text-xs text-gray-600">Unchanged</p>
                <p className="text-lg font-semibold">{result.unchanged}</p>
              </div>
              <div className="p-3 rounded border bg-blue-50 border-blue-200">
                <p className="text-xs text-blue-700">Order Lines Enriched</p>
                <p className="text-lg font-semibold text-blue-800">{result.orderLinesEnriched}</p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        )}

        {(previewMutation.isError || executeMutation.isError) && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="w-4 h-4" />
            <span>
              {(previewMutation.error as Error)?.message || (executeMutation.error as Error)?.message || 'Operation failed'}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
