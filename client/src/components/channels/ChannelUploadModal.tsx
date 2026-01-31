/**
 * Channel Upload Modal
 *
 * Modal for uploading BT report CSV files for marketplace channel data.
 * Features:
 * - Drag and drop file upload
 * - File validation (CSV only)
 * - Upload progress display
 * - Import results summary
 */

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';

interface ChannelUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ImportResult {
  message: string;
  batchId: string;
  totalRows: number;
  channels: string[];
  dateRange: {
    start: string | null;
    end: string | null;
  };
  results: {
    created: number;
    updated: number;
    skipped: number;
    errorCount: number;
    errors: Array<{ row: number; error: string }>;
  };
}

async function uploadChannelCSV(file: File): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);

  // Get auth token from cookie
  const response = await fetch('/api/channels/import', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error || 'Upload failed');
  }

  return response.json();
}

export function ChannelUploadModal({ open, onOpenChange }: ChannelUploadModalProps) {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const uploadMutation = useMutation({
    mutationFn: uploadChannelCSV,
    onSuccess: (data) => {
      setResult(data);
      // Invalidate all channel queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });

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
      setResult(null);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setResult(null);
    }
  }, []);

  const handleUpload = useCallback(() => {
    if (selectedFile) {
      uploadMutation.mutate(selectedFile);
    }
  }, [selectedFile, uploadMutation]);

  const handleClose = useCallback(() => {
    setSelectedFile(null);
    setResult(null);
    uploadMutation.reset();
    onOpenChange(false);
  }, [onOpenChange, uploadMutation]);

  const isUploading = uploadMutation.isPending;
  const hasError = uploadMutation.isError;
  const hasResult = result !== null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import BT Report</DialogTitle>
          <DialogDescription>
            Upload a CSV export from BT to import marketplace order data. Existing orders will be
            updated, new orders will be created.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File Drop Zone */}
          {!hasResult && (
            <div
              className={`
                border-2 border-dashed rounded-lg p-8 text-center transition-colors
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedFile(null);
                      setResult(null);
                    }}
                  >
                    Choose different file
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-10 h-10 text-muted-foreground" />
                  <p className="font-medium">Drop CSV file here</p>
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
          )}

          {/* Upload Progress */}
          {isUploading && (
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Processing CSV...</span>
            </div>
          )}

          {/* Error Display */}
          {hasError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2 text-red-700">
                <AlertCircle className="w-5 h-5" />
                <span className="font-medium">Upload Failed</span>
              </div>
              <p className="text-sm text-red-600 mt-1">
                {uploadMutation.error instanceof Error
                  ? uploadMutation.error.message
                  : 'An error occurred'}
              </p>
            </div>
          )}

          {/* Success Result */}
          {hasResult && (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">Import Successful</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Total Rows</p>
                  <p className="font-medium">{result.totalRows}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Channels</p>
                  <p className="font-medium capitalize">{result.channels.join(', ')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p className="font-medium text-green-600">{result.results.created}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Updated</p>
                  <p className="font-medium text-blue-600">{result.results.updated}</p>
                </div>
                {result.results.skipped > 0 && (
                  <div>
                    <p className="text-muted-foreground">Skipped</p>
                    <p className="font-medium text-amber-600">{result.results.skipped}</p>
                  </div>
                )}
                {result.dateRange.start && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Date Range</p>
                    <p className="font-medium">
                      {result.dateRange.start} to {result.dateRange.end}
                    </p>
                  </div>
                )}
              </div>

              {/* Errors */}
              {result.results.errorCount > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm font-medium text-amber-700">
                    {result.results.errorCount} rows had errors
                  </p>
                  <ul className="text-xs text-amber-600 mt-1 space-y-1">
                    {result.results.errors.slice(0, 5).map((err, idx) => (
                      <li key={idx}>
                        Row {err.row}: {err.error}
                      </li>
                    ))}
                    {result.results.errorCount > 5 && (
                      <li>...and {result.results.errorCount - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose}>
            {hasResult ? 'Close' : 'Cancel'}
          </Button>
          {!hasResult && (
            <Button onClick={handleUpload} disabled={!selectedFile || isUploading}>
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Import
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
