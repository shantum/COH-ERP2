import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  Loader2,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

// --- Types ---

interface PayoutSummary {
  grossRevenue: number;
  commission: number;
  bannerDeduction: number;
  shipping: number;
  returns: number;
  tds: number;
  otherIncome: number;
  netPayout: number;
}

interface OrderStats {
  totalLines: number;
  delivered: number;
  return: number;
  cancelled: number;
  matchedOrders: number;
  unmatchedOrders: string[];
}

interface BankMatch {
  found: boolean;
  bankName?: string;
}

interface PreviewResponse {
  success: boolean;
  error?: string;
  reportId?: string;
  reportType?: 'NF' | 'POPUP';
  period?: string;
  summary?: PayoutSummary;
  orderStats?: OrderStats;
  bankMatch?: BankMatch;
}

interface ConfirmResponse {
  success: boolean;
  error?: string;
  invoicesCreated?: number;
}

interface PayoutReport {
  id: string;
  marketplace: string;
  period: string;
  grossRevenue: number;
  netPayout: number;
  status: 'draft' | 'confirmed' | 'cancelled';
  createdAt: string;
}

interface ReportsResponse {
  success: boolean;
  reports: PayoutReport[];
}

// --- Helpers ---

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function statusBadgeVariant(
  status: PayoutReport['status']
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'confirmed':
      return 'default';
    case 'draft':
      return 'secondary';
    case 'cancelled':
      return 'destructive';
    default:
      return 'outline';
  }
}

// --- Component ---

type View = 'upload' | 'history';
type UploadState = 'idle' | 'uploading' | 'preview' | 'confirming' | 'done';

export function MarketplacePayoutTab() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('upload');
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unmatchedExpanded, setUnmatchedExpanded] = useState(false);

  // --- History query ---
  const reportsQuery = useQuery<ReportsResponse>({
    queryKey: ['finance', 'marketplace', 'reports'],
    queryFn: async () => {
      const res = await fetch('/api/marketplace-payout/reports', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch reports');
      return res.json();
    },
    enabled: view === 'history',
  });

  // --- Upload handler ---
  async function handleUpload() {
    if (!file) return;
    setError(null);
    setUploadState('uploading');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/marketplace-payout/upload-preview', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const data: PreviewResponse = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Upload failed');
        setUploadState('idle');
        return;
      }

      setPreview(data);
      setUploadState('preview');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploadState('idle');
    }
  }

  // --- Confirm handler ---
  async function handleConfirm() {
    if (!preview?.reportId) return;
    setError(null);
    setUploadState('confirming');

    try {
      const res = await fetch(`/api/marketplace-payout/confirm/${preview.reportId}`, {
        method: 'POST',
        credentials: 'include',
      });

      const data: ConfirmResponse = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Confirmation failed');
        setUploadState('preview');
        return;
      }

      setConfirmResult(data);
      setUploadState('done');
      queryClient.invalidateQueries({ queryKey: ['finance', 'marketplace', 'reports'] });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Confirmation failed');
      setUploadState('preview');
    }
  }

  // --- Reset ---
  function handleReset() {
    setFile(null);
    setPreview(null);
    setConfirmResult(null);
    setError(null);
    setUploadState('idle');
    setUnmatchedExpanded(false);
  }

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex gap-2">
        <Button
          variant={view === 'upload' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setView('upload')}
        >
          <Upload className="h-4 w-4 mr-1.5" />
          Upload Report
        </Button>
        <Button
          variant={view === 'history' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setView('history')}
        >
          <FileSpreadsheet className="h-4 w-4 mr-1.5" />
          History
        </Button>
      </div>

      {view === 'upload' && (
        <UploadView
          file={file}
          uploadState={uploadState}
          preview={preview}
          confirmResult={confirmResult}
          error={error}
          unmatchedExpanded={unmatchedExpanded}
          onFileChange={setFile}
          onUpload={handleUpload}
          onConfirm={handleConfirm}
          onReset={handleReset}
          onToggleUnmatched={() => setUnmatchedExpanded((prev) => !prev)}
        />
      )}

      {view === 'history' && <HistoryView query={reportsQuery} />}
    </div>
  );
}

// --- Upload View ---

interface UploadViewProps {
  file: File | null;
  uploadState: UploadState;
  preview: PreviewResponse | null;
  confirmResult: ConfirmResponse | null;
  error: string | null;
  unmatchedExpanded: boolean;
  onFileChange: (file: File | null) => void;
  onUpload: () => void;
  onConfirm: () => void;
  onReset: () => void;
  onToggleUnmatched: () => void;
}

function UploadView({
  file,
  uploadState,
  preview,
  confirmResult,
  error,
  unmatchedExpanded,
  onFileChange,
  onUpload,
  onConfirm,
  onReset,
  onToggleUnmatched,
}: UploadViewProps) {
  // Done state
  if (uploadState === 'done' && confirmResult) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-lg font-medium">
              {confirmResult.invoicesCreated} invoice{confirmResult.invoicesCreated !== 1 ? 's' : ''} created
              successfully
            </p>
            <Button variant="outline" onClick={onReset}>
              Upload Another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* File input */}
      {(uploadState === 'idle' || uploadState === 'uploading') && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload Marketplace Payout Report</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Input
                type="file"
                accept=".xlsx"
                onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
                className="max-w-sm"
              />
              <Button onClick={onUpload} disabled={!file || uploadState === 'uploading'}>
                {uploadState === 'uploading' ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-1.5" />
                    Upload &amp; Preview
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Preview */}
      {(uploadState === 'preview' || uploadState === 'confirming') && preview && (
        <PreviewCard
          preview={preview}
          uploading={uploadState === 'confirming'}
          unmatchedExpanded={unmatchedExpanded}
          onConfirm={onConfirm}
          onCancel={onReset}
          onToggleUnmatched={onToggleUnmatched}
        />
      )}
    </div>
  );
}

// --- Preview Card ---

interface PreviewCardProps {
  preview: PreviewResponse;
  uploading: boolean;
  unmatchedExpanded: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onToggleUnmatched: () => void;
}

function PreviewCard({
  preview,
  uploading,
  unmatchedExpanded,
  onConfirm,
  onCancel,
  onToggleUnmatched,
}: PreviewCardProps) {
  const { summary, orderStats, bankMatch } = preview;

  const summaryRows: Array<{ label: string; value: number; bold?: boolean }> = summary
    ? [
        { label: 'Gross Revenue', value: summary.grossRevenue },
        { label: 'Commission', value: summary.commission },
        { label: 'Banner Deduction', value: summary.bannerDeduction },
        { label: 'Shipping', value: summary.shipping },
        { label: 'Returns', value: summary.returns },
        { label: 'TDS', value: summary.tds },
        { label: 'Other Income', value: summary.otherIncome },
        { label: 'Net Payout', value: summary.netPayout, bold: true },
      ]
    : [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle className="text-base">Preview</CardTitle>
          {preview.reportType && (
            <Badge variant="outline">{preview.reportType}</Badge>
          )}
          {preview.period && (
            <span className="text-sm text-muted-foreground">{preview.period}</span>
          )}
          {bankMatch && (
            <Badge variant={bankMatch.found ? 'default' : 'secondary'}>
              {bankMatch.found
                ? `Bank: ${bankMatch.bankName ?? 'Matched'}`
                : 'Bank not matched'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary table */}
        {summary && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaryRows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className={row.bold ? 'font-semibold' : ''}>
                    {row.label}
                  </TableCell>
                  <TableCell className={`text-right ${row.bold ? 'font-semibold' : ''}`}>
                    {formatINR(row.value)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Order stats */}
        {orderStats && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Order Stats</p>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                Total Lines: <span className="font-medium">{orderStats.totalLines}</span>
              </div>
              <div>
                Delivered: <span className="font-medium">{orderStats.delivered}</span>
              </div>
              <div>
                Returns: <span className="font-medium">{orderStats.return}</span>
              </div>
              <div>
                Cancelled: <span className="font-medium">{orderStats.cancelled}</span>
              </div>
              <div>
                Matched: <span className="font-medium text-green-600">{orderStats.matchedOrders}</span>
              </div>
              <div>
                Unmatched:{' '}
                <span
                  className={`font-medium ${orderStats.unmatchedOrders.length > 0 ? 'text-amber-600' : 'text-green-600'}`}
                >
                  {orderStats.unmatchedOrders.length}
                </span>
              </div>
            </div>

            {/* Unmatched orders collapsible */}
            {orderStats.unmatchedOrders.length > 0 && (
              <div className="border rounded-md">
                <button
                  type="button"
                  className="flex items-center gap-1.5 w-full px-3 py-2 text-sm text-amber-700 hover:bg-muted/50"
                  onClick={onToggleUnmatched}
                >
                  {unmatchedExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  Unmatched Orders ({orderStats.unmatchedOrders.length})
                </button>
                {unmatchedExpanded && (
                  <div className="px-3 pb-2 space-y-0.5">
                    {orderStats.unmatchedOrders.map((orderId) => (
                      <div key={orderId} className="text-sm text-muted-foreground font-mono">
                        {orderId}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button onClick={onConfirm} disabled={uploading}>
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Confirming...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Confirm &amp; Create Invoices
              </>
            )}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={uploading}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- History View ---

interface HistoryViewProps {
  query: ReturnType<typeof useQuery<ReportsResponse>>;
}

function HistoryView({ query }: HistoryViewProps) {
  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Failed to load reports
      </div>
    );
  }

  const reports = query.data?.reports ?? [];

  if (reports.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground py-6">No reports yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Marketplace</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Gross Revenue</TableHead>
              <TableHead className="text-right">Net Payout</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((report) => (
              <TableRow key={report.id}>
                <TableCell>{report.marketplace}</TableCell>
                <TableCell>{report.period}</TableCell>
                <TableCell className="text-right">{formatINR(report.grossRevenue)}</TableCell>
                <TableCell className="text-right">{formatINR(report.netPayout)}</TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(report.status)}>
                    {report.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(report.createdAt).toLocaleDateString('en-IN')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
