/**
 * Fabric Invoices Page
 *
 * Upload fabric supplier invoices (PDF/photo), AI-parse them,
 * review/edit extracted data, match to fabric colours, and confirm.
 *
 * Three views:
 * - Upload: Drag-and-drop zone + AI parsing spinner
 * - Review: Editable table of parsed lines with matching controls
 * - History: List of past invoices
 */

import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import {
    Upload,
    FileText,
    Check,
    X,
    AlertCircle,
    Loader2,
    Download,
    Trash2,
    Eye,
    ChevronLeft,
    Sparkles,
    Link2,
    Plus,
} from 'lucide-react';

import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { listFabricInvoices, getFabricInvoice } from '../server/functions/fabricInvoices';
import { getFabricColoursFlat } from '../server/functions/materials';

// ============================================
// ROUTE API
// ============================================

const routeApi = getRouteApi('/_authenticated/fabric-invoices');

// ============================================
// TYPES
// ============================================

interface InvoiceLine {
    id: string;
    description: string | null;
    hsnCode: string | null;
    qty: number | null;
    unit: string | null;
    rate: number | null;
    amount: number | null;
    gstPercent: number | null;
    gstAmount: number | null;
    fabricColourId: string | null;
    matchedTxnId: string | null;
    matchType: string | null;
    fabricColour: {
        id: string;
        colourName: string;
        code: string | null;
        fabric: { id: string; name: string };
    } | null;
    matchedTxn: {
        id: string;
        qty: number;
        unit?: string;
        costPerUnit?: number | null;
        createdAt: string | Date;
    } | null;
}

interface InvoiceSummary {
    id: string;
    invoiceNumber: string | null;
    invoiceDate: string | Date | null;
    supplierName: string | null;
    totalAmount: number | null;
    status: string;
    fileName: string;
    fileSizeBytes: number;
    aiConfidence: number | null;
    createdAt: string | Date;
    party: { id: string; name: string } | null;
    _count: { lines: number };
}

interface InvoiceDetail {
    id: string;
    invoiceNumber: string | null;
    invoiceDate: string | Date | null;
    partyId: string | null;
    supplierName: string | null;
    subtotal: number | null;
    gstAmount: number | null;
    totalAmount: number | null;
    fileName: string;
    fileMimeType: string;
    fileSizeBytes: number;
    status: string;
    aiConfidence: number | null;
    createdAt: string | Date;
    updatedAt: string | Date;
    lines: InvoiceLine[];
    party: { id: string; name: string } | null;
    createdBy: { id: string; name: string } | null;
}

// ============================================
// HELPERS
// ============================================

function formatCurrency(amount: number | null | undefined): string {
    if (amount == null) return '—';
    return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date: string | Date | null | undefined): string {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const statusBadgeVariant: Record<string, 'success' | 'warning' | 'secondary'> = {
    draft: 'warning',
    confirmed: 'success',
    cancelled: 'secondary',
};

// ============================================
// API HELPERS (Express routes need fetch, not server fns)
// ============================================

async function uploadInvoiceFile(file: File): Promise<{ success: boolean; invoice: InvoiceDetail }> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/fabric-invoices/upload', {
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

async function updateInvoiceLines(invoiceId: string, body: Record<string, unknown>): Promise<{ success: boolean; invoice: InvoiceDetail }> {
    const response = await fetch(`/api/fabric-invoices/${invoiceId}/lines`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Update failed' }));
        throw new Error(error.error || 'Update failed');
    }

    return response.json();
}

async function confirmInvoice(invoiceId: string): Promise<{ success: boolean; invoice: InvoiceDetail }> {
    const response = await fetch(`/api/fabric-invoices/${invoiceId}/confirm`, {
        method: 'POST',
        credentials: 'include',
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Confirm failed' }));
        throw new Error(error.error || 'Confirm failed');
    }

    return response.json();
}

async function deleteInvoice(invoiceId: string): Promise<void> {
    const response = await fetch(`/api/fabric-invoices/${invoiceId}`, {
        method: 'DELETE',
        credentials: 'include',
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Delete failed' }));
        throw new Error(error.error || 'Delete failed');
    }
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function FabricInvoices() {
    const queryClient = useQueryClient();
    const searchParams = routeApi.useSearch();

    const [activeTab, setActiveTab] = useState<string>(searchParams.invoiceId ? 'review' : searchParams.view ?? 'history');
    const [reviewInvoiceId, setReviewInvoiceId] = useState<string | null>(searchParams.invoiceId ?? null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Navigate to review view
    const openReview = useCallback((invoiceId: string) => {
        setReviewInvoiceId(invoiceId);
        setActiveTab('review');
        setError(null);
        setSuccess(null);
    }, []);

    // Navigate back to history
    const backToHistory = useCallback(() => {
        setReviewInvoiceId(null);
        setActiveTab('history');
        setError(null);
        setSuccess(null);
    }, []);

    return (
        <div className="p-4 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h1 className="text-xl font-semibold">Fabric Invoices</h1>
                    <p className="text-sm text-muted-foreground">Upload supplier invoices, AI reads them, you review and confirm</p>
                </div>
            </div>

            {error && (
                <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
                </div>
            )}

            {success && (
                <div className="mb-4 p-3 rounded-md bg-green-50 border border-green-200 text-green-700 text-sm flex items-center gap-2">
                    <Check className="w-4 h-4 shrink-0" />
                    {success}
                    <button onClick={() => setSuccess(null)} className="ml-auto"><X className="w-4 h-4" /></button>
                </div>
            )}

            {activeTab === 'review' && reviewInvoiceId ? (
                <InvoiceReview
                    invoiceId={reviewInvoiceId}
                    onBack={backToHistory}
                    onError={setError}
                    onSuccess={setSuccess}
                />
            ) : (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList>
                        <TabsTrigger value="history">Invoice History</TabsTrigger>
                        <TabsTrigger value="upload">Upload New</TabsTrigger>
                    </TabsList>

                    <TabsContent value="history">
                        <InvoiceHistory
                            searchParams={searchParams}
                            onOpenReview={openReview}
                            onDelete={(id) => {
                                deleteInvoice(id).then(() => {
                                    queryClient.invalidateQueries({ queryKey: ['fabric-invoices'] });
                                    setSuccess('Invoice deleted');
                                }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Delete failed'));
                            }}
                        />
                    </TabsContent>

                    <TabsContent value="upload">
                        <UploadView
                            onUploaded={(invoiceId) => {
                                queryClient.invalidateQueries({ queryKey: ['fabric-invoices'] });
                                openReview(invoiceId);
                            }}
                            onError={setError}
                        />
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
}

// ============================================
// UPLOAD VIEW
// ============================================

function UploadView({ onUploaded, onError }: { onUploaded: (id: string) => void; onError: (msg: string) => void }) {
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const uploadMutation = useMutation({
        mutationFn: uploadInvoiceFile,
        onSuccess: (data) => {
            onUploaded(data.invoice.id);
        },
        onError: (e: Error) => {
            onError(e.message);
        },
    });

    const handleFile = useCallback((file: File) => {
        const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
        if (!validTypes.includes(file.type)) {
            onError('Please upload a PDF, JPEG, PNG, or WebP file.');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            onError('File is too large. Maximum size is 10MB.');
            return;
        }
        uploadMutation.mutate(file);
    }, [uploadMutation, onError]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);

    if (uploadMutation.isPending) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="relative">
                    <Loader2 className="w-12 h-12 text-primary animate-spin" />
                    <Sparkles className="w-5 h-5 text-yellow-500 absolute -top-1 -right-1 animate-pulse" />
                </div>
                <div className="text-center">
                    <p className="font-medium text-lg">AI is reading your invoice...</p>
                    <p className="text-sm text-muted-foreground mt-1">This usually takes 10-30 seconds</p>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
                isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
        >
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    e.target.value = '';
                }}
            />
            <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">Drop a fabric invoice here, or click to browse</p>
            <p className="text-sm text-muted-foreground mt-1">PDF, JPEG, PNG, WebP — up to 10MB</p>
        </div>
    );
}

// ============================================
// INVOICE HISTORY VIEW
// ============================================

function InvoiceHistory({
    searchParams,
    onOpenReview,
    onDelete,
}: {
    searchParams: { status?: string; page?: number };
    onOpenReview: (id: string) => void;
    onDelete: (id: string) => void;
}) {
    const listFn = useServerFn(listFabricInvoices);

    const { data, isLoading } = useQuery({
        queryKey: ['fabric-invoices', 'list', searchParams.status, searchParams.page],
        queryFn: () => listFn({
            data: {
                ...(searchParams.status ? { status: searchParams.status as 'draft' | 'confirmed' | 'cancelled' } : {}),
                page: searchParams.page ?? 1,
            },
        }),
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const invoices = (data?.invoices ?? []) as InvoiceSummary[];

    if (invoices.length === 0) {
        return (
            <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>No invoices yet. Upload one to get started.</p>
            </div>
        );
    }

    return (
        <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
                <thead className="bg-muted/50">
                    <tr>
                        <th className="text-left p-3 font-medium">Invoice</th>
                        <th className="text-left p-3 font-medium">Supplier</th>
                        <th className="text-left p-3 font-medium">Date</th>
                        <th className="text-right p-3 font-medium">Total</th>
                        <th className="text-center p-3 font-medium">Lines</th>
                        <th className="text-center p-3 font-medium">Status</th>
                        <th className="text-center p-3 font-medium">AI</th>
                        <th className="text-right p-3 font-medium">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-muted/30">
                            <td className="p-3">
                                <div className="font-medium">{inv.invoiceNumber || '(no number)'}</div>
                                <div className="text-xs text-muted-foreground">{inv.fileName}</div>
                            </td>
                            <td className="p-3">{inv.party?.name ?? inv.supplierName ?? '—'}</td>
                            <td className="p-3">{formatDate(inv.invoiceDate)}</td>
                            <td className="p-3 text-right font-mono">{formatCurrency(inv.totalAmount)}</td>
                            <td className="p-3 text-center">{inv._count.lines}</td>
                            <td className="p-3 text-center">
                                <Badge variant={statusBadgeVariant[inv.status] ?? 'secondary'}>
                                    {inv.status}
                                </Badge>
                            </td>
                            <td className="p-3 text-center">
                                {inv.aiConfidence != null && (
                                    <span className={`text-xs font-medium ${inv.aiConfidence >= 0.8 ? 'text-green-600' : inv.aiConfidence >= 0.5 ? 'text-yellow-600' : 'text-red-600'}`}>
                                        {Math.round(inv.aiConfidence * 100)}%
                                    </span>
                                )}
                            </td>
                            <td className="p-3">
                                <div className="flex items-center justify-end gap-1">
                                    <button
                                        onClick={() => onOpenReview(inv.id)}
                                        className="p-1.5 rounded hover:bg-muted"
                                        title="View / Edit"
                                    >
                                        <Eye className="w-4 h-4" />
                                    </button>
                                    <a
                                        href={`/api/fabric-invoices/${inv.id}/file`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1.5 rounded hover:bg-muted"
                                        title="Download file"
                                    >
                                        <Download className="w-4 h-4" />
                                    </a>
                                    {inv.status === 'draft' && (
                                        <button
                                            onClick={() => {
                                                if (confirm('Delete this draft invoice?')) onDelete(inv.id);
                                            }}
                                            className="p-1.5 rounded hover:bg-red-50 text-red-500"
                                            title="Delete"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ============================================
// INVOICE REVIEW VIEW
// ============================================

function InvoiceReview({
    invoiceId,
    onBack,
    onError,
    onSuccess,
}: {
    invoiceId: string;
    onBack: () => void;
    onError: (msg: string) => void;
    onSuccess: (msg: string) => void;
}) {
    const queryClient = useQueryClient();
    const [editingLines, setEditingLines] = useState<Record<string, Partial<InvoiceLine>>>({});
    const [saving, setSaving] = useState(false);
    const [confirming, setConfirming] = useState(false);

    const getInvoiceFn = useServerFn(getFabricInvoice);
    const getFabricColoursFn = useServerFn(getFabricColoursFlat);

    const { data, isLoading, refetch } = useQuery({
        queryKey: ['fabric-invoices', 'detail', invoiceId],
        queryFn: () => getInvoiceFn({ data: { id: invoiceId } }),
    });

    // Load fabric colours for dropdown
    const { data: fabricColoursData } = useQuery({
        queryKey: ['fabric-colours', 'flat', 'for-invoice'],
        queryFn: () => getFabricColoursFn({ data: { activeOnly: true } }),
    });

    const invoice = data?.success ? (data as { success: true; invoice: InvoiceDetail }).invoice : null;
    const fabricColours = (fabricColoursData as { success: boolean; items: Array<{ id: string; colourName: string; code: string | null; fabricName: string }> } | undefined)?.items ?? [];
    const isDraft = invoice?.status === 'draft';

    // Track line edits
    const updateLine = useCallback((lineId: string, field: string, value: unknown) => {
        setEditingLines(prev => ({
            ...prev,
            [lineId]: { ...prev[lineId], [field]: value },
        }));
    }, []);

    // Save all edits
    const handleSave = useCallback(async () => {
        if (!invoice) return;
        const lineUpdates = invoice.lines.map(line => {
            const edits = editingLines[line.id] ?? {};
            return { id: line.id, ...edits };
        }).filter(l => Object.keys(l).length > 1); // Only lines with actual changes

        if (lineUpdates.length === 0) {
            onSuccess('No changes to save');
            return;
        }

        setSaving(true);
        try {
            await updateInvoiceLines(invoiceId, { lines: lineUpdates });
            setEditingLines({});
            refetch();
            onSuccess('Changes saved');
        } catch (e: unknown) {
            onError(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    }, [invoice, editingLines, invoiceId, refetch, onSuccess, onError]);

    // Confirm invoice
    const handleConfirm = useCallback(async () => {
        if (!confirm('Confirm this invoice? Lines marked "new entry" will create new fabric transactions.')) return;

        setConfirming(true);
        try {
            await confirmInvoice(invoiceId);
            queryClient.invalidateQueries({ queryKey: ['fabric-invoices'] });
            refetch();
            onSuccess('Invoice confirmed! Transactions created.');
        } catch (e: unknown) {
            onError(e instanceof Error ? e.message : 'Confirm failed');
        } finally {
            setConfirming(false);
        }
    }, [invoiceId, queryClient, refetch, onSuccess, onError]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!invoice) {
        return (
            <div className="text-center py-12 text-muted-foreground">
                <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>Invoice not found</p>
                <button onClick={onBack} className="mt-3 text-primary underline">Back to list</button>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
                <button onClick={onBack} className="p-1.5 rounded hover:bg-muted">
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <h2 className="text-lg font-semibold">
                            {invoice.invoiceNumber || 'Invoice'}
                        </h2>
                        <Badge variant={statusBadgeVariant[invoice.status] ?? 'secondary'}>
                            {invoice.status}
                        </Badge>
                        {invoice.aiConfidence != null && (
                            <span className="text-xs text-muted-foreground">
                                AI confidence: {Math.round(invoice.aiConfidence * 100)}%
                            </span>
                        )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {invoice.party?.name ?? invoice.supplierName ?? 'Unknown supplier'} · {formatDate(invoice.invoiceDate)} · {invoice.fileName}
                    </p>
                </div>
                <a
                    href={`/api/fabric-invoices/${invoice.id}/file`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
                >
                    <Download className="w-4 h-4" /> View File
                </a>
            </div>

            {/* Invoice totals */}
            <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="border rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">Subtotal</p>
                    <p className="font-mono font-medium">{formatCurrency(invoice.subtotal)}</p>
                </div>
                <div className="border rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">GST</p>
                    <p className="font-mono font-medium">{formatCurrency(invoice.gstAmount)}</p>
                </div>
                <div className="border rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="font-mono font-medium text-lg">{formatCurrency(invoice.totalAmount)}</p>
                </div>
            </div>

            {/* Lines table */}
            <div className="border rounded-lg overflow-x-auto mb-4">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                        <tr>
                            <th className="text-left p-3 font-medium w-[200px]">Description</th>
                            <th className="text-right p-3 font-medium w-[80px]">Qty</th>
                            <th className="text-left p-3 font-medium w-[70px]">Unit</th>
                            <th className="text-right p-3 font-medium w-[90px]">Rate</th>
                            <th className="text-right p-3 font-medium w-[100px]">Amount</th>
                            <th className="text-right p-3 font-medium w-[60px]">GST%</th>
                            <th className="text-left p-3 font-medium w-[200px]">Fabric Colour</th>
                            <th className="text-center p-3 font-medium w-[120px]">Match</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {invoice.lines.map((line) => {
                            const edits = editingLines[line.id] ?? {};
                            const currentFabricColourId = (edits.fabricColourId !== undefined ? edits.fabricColourId : line.fabricColourId) as string | null;
                            const currentMatchType = (edits.matchType !== undefined ? edits.matchType : line.matchType) as string | null;

                            return (
                                <tr key={line.id} className="hover:bg-muted/30">
                                    <td className="p-3">
                                        {isDraft ? (
                                            <input
                                                type="text"
                                                className="w-full border rounded px-2 py-1 text-sm"
                                                defaultValue={line.description ?? ''}
                                                onBlur={(e) => {
                                                    if (e.target.value !== (line.description ?? '')) {
                                                        updateLine(line.id, 'description', e.target.value || null);
                                                    }
                                                }}
                                            />
                                        ) : (
                                            <span>{line.description ?? '—'}</span>
                                        )}
                                    </td>
                                    <td className="p-3 text-right font-mono">
                                        {isDraft ? (
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="w-full border rounded px-2 py-1 text-sm text-right"
                                                defaultValue={line.qty ?? ''}
                                                onBlur={(e) => {
                                                    const val = parseFloat(e.target.value);
                                                    if (!isNaN(val) && val !== line.qty) {
                                                        updateLine(line.id, 'qty', val);
                                                    }
                                                }}
                                            />
                                        ) : (
                                            <span>{line.qty ?? '—'}</span>
                                        )}
                                    </td>
                                    <td className="p-3">
                                        {isDraft ? (
                                            <select
                                                className="border rounded px-2 py-1 text-sm"
                                                defaultValue={line.unit ?? ''}
                                                onChange={(e) => updateLine(line.id, 'unit', e.target.value || null)}
                                            >
                                                <option value="">—</option>
                                                <option value="meter">meter</option>
                                                <option value="kg">kg</option>
                                                <option value="yard">yard</option>
                                            </select>
                                        ) : (
                                            <span>{line.unit ?? '—'}</span>
                                        )}
                                    </td>
                                    <td className="p-3 text-right font-mono">
                                        {isDraft ? (
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="w-full border rounded px-2 py-1 text-sm text-right"
                                                defaultValue={line.rate ?? ''}
                                                onBlur={(e) => {
                                                    const val = parseFloat(e.target.value);
                                                    if (!isNaN(val) && val !== line.rate) {
                                                        updateLine(line.id, 'rate', val);
                                                    }
                                                }}
                                            />
                                        ) : (
                                            <span>{formatCurrency(line.rate)}</span>
                                        )}
                                    </td>
                                    <td className="p-3 text-right font-mono">{formatCurrency(line.amount)}</td>
                                    <td className="p-3 text-right">
                                        {line.gstPercent != null ? `${line.gstPercent}%` : '—'}
                                    </td>
                                    <td className="p-3">
                                        {isDraft ? (
                                            <select
                                                className="w-full border rounded px-2 py-1 text-sm"
                                                value={currentFabricColourId ?? ''}
                                                onChange={(e) => {
                                                    const val = e.target.value || null;
                                                    updateLine(line.id, 'fabricColourId', val);
                                                    updateLine(line.id, 'matchType', val ? 'new_entry' : null);
                                                    updateLine(line.id, 'matchedTxnId', null);
                                                }}
                                            >
                                                <option value="">— Select —</option>
                                                {fabricColours.map(fc => (
                                                    <option key={fc.id} value={fc.id}>
                                                        {fc.fabricName} — {fc.colourName} {fc.code ? `(${fc.code})` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            line.fabricColour ? (
                                                <span>{line.fabricColour.fabric.name} — {line.fabricColour.colourName}</span>
                                            ) : (
                                                <span className="text-muted-foreground">Not matched</span>
                                            )
                                        )}
                                    </td>
                                    <td className="p-3 text-center">
                                        <MatchBadge matchType={currentFabricColourId ? 'new_entry' : currentMatchType} />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Action buttons */}
            {isDraft && (
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleSave}
                        disabled={saving || Object.keys(editingLines).length === 0}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                    >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                        Save Changes
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={confirming}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                        {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Confirm Invoice
                    </button>
                    <button
                        onClick={onBack}
                        className="px-4 py-2 border rounded-md text-sm hover:bg-muted"
                    >
                        Cancel
                    </button>
                </div>
            )}
        </div>
    );
}

// ============================================
// MATCH BADGE
// ============================================

function MatchBadge({ matchType }: { matchType: string | null }) {
    if (!matchType) return <span className="text-muted-foreground text-xs">—</span>;

    if (matchType === 'auto_matched') {
        return (
            <Badge variant="info" className="text-xs gap-1">
                <Sparkles className="w-3 h-3" /> Auto
            </Badge>
        );
    }
    if (matchType === 'manual_matched') {
        return (
            <Badge variant="secondary" className="text-xs gap-1">
                <Link2 className="w-3 h-3" /> Linked
            </Badge>
        );
    }
    if (matchType === 'new_entry') {
        return (
            <Badge variant="success" className="text-xs gap-1">
                <Plus className="w-3 h-3" /> New
            </Badge>
        );
    }

    return <span className="text-xs">{matchType}</span>;
}
