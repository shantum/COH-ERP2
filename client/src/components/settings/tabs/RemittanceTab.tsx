/**
 * RemittanceTab component
 * COD remittance CSV upload and tracking with Shopify sync
 */

import React, { useState } from 'react';
import { formatCurrencyFull } from '../../../utils/formatting';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { remittanceApi } from '../../../services/api';
import { Upload, FileSpreadsheet, DollarSign, CheckCircle, AlertCircle, Clock, RefreshCw, ExternalLink, RotateCcw, Zap, Link2, ChevronDown, ChevronUp } from 'lucide-react';

interface UploadResult {
    success: boolean;
    message: string;
    results: {
        total: number;
        matched: number;
        updated: number;
        alreadyPaid: number;
        shopifySynced?: number;
        shopifyFailed?: number;
        manualReview?: number;
        notFound: Array<{ orderNumber: string; customer: string; amount: string }>;
        errors: Array<{ orderNumber: string; error: string }>;
        dateRange?: { earliest: string; latest: string };
    };
}

interface FailedOrder {
    id: string;
    orderNumber: string;
    shopifyOrderId: string | null;
    customerName: string;
    totalAmount: number;
    codRemittedAt: string;
    codRemittanceUtr: string | null;
    codRemittedAmount: number | null;
    codShopifySyncStatus: string;
    codShopifySyncError: string | null;
}

interface CodRemittance {
    id: string;
    remittanceId: string;
    remittanceDate: string;
    codGenerated: number;
    codRemitted: number;
    transactionCharges: number;
    transactionGstCharges: number;
    orderCount: number;
    ordersProcessed: number;
    bankTransactionId: string | null;
    matchConfidence: string | null;
    orderDetails: unknown;
}

export function RemittanceTab() {
    const [file, setFile] = useState<File | null>(null);
    const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
    const [showFailedSync, setShowFailedSync] = useState(false);
    const [showApiSync, setShowApiSync] = useState(true);
    const [expandedRemittance, setExpandedRemittance] = useState<string | null>(null);
    const queryClient = useQueryClient();

    // Fetch summary data
    const { data: summaryData, isLoading: summaryLoading } = useQuery({
        queryKey: ['remittanceSummary'],
        queryFn: () => remittanceApi.getSummary(30),
    });

    // Fetch failed sync orders
    const { data: failedData, isLoading: failedLoading, refetch: refetchFailed } = useQuery({
        queryKey: ['remittanceFailed'],
        queryFn: () => remittanceApi.getFailed(100),
        enabled: showFailedSync,
    });

    // Upload mutation
    const uploadMutation = useMutation({
        mutationFn: (file: File) => remittanceApi.upload(file),
        onSuccess: (response) => {
            setUploadResult(response.data);
            setFile(null);
            queryClient.invalidateQueries({ queryKey: ['remittanceSummary'] });
            queryClient.invalidateQueries({ queryKey: ['remittanceFailed'] });
        },
        onError: (error: unknown) => {
            alert(error instanceof Error ? error.message : 'Upload failed');
        },
    });

    // Retry sync mutation
    const retrySyncMutation = useMutation({
        mutationFn: (data: { orderIds?: string[]; all?: boolean }) => remittanceApi.retrySync(data),
        onSuccess: (response) => {
            const result = response.data;
            alert(`${result.message}`);
            queryClient.invalidateQueries({ queryKey: ['remittanceFailed'] });
        },
        onError: (error: unknown) => {
            alert(error instanceof Error ? error.message : 'Retry failed');
        },
    });

    // Approve manual mutation
    const approveManualMutation = useMutation({
        mutationFn: (data: { orderId: string; approvedAmount?: number }) => remittanceApi.approveManual(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['remittanceFailed'] });
        },
        onError: (error: unknown) => {
            alert(error instanceof Error ? error.message : 'Approval failed');
        },
    });

    // API Sync status query
    const { data: syncStatusData, isLoading: syncStatusLoading } = useQuery({
        queryKey: ['remittanceSyncStatus'],
        queryFn: () => remittanceApi.getSyncStatus(),
        enabled: showApiSync,
        refetchInterval: 30000, // Refresh every 30s when visible
    });

    // Trigger sync mutation
    const triggerSyncMutation = useMutation({
        mutationFn: () => remittanceApi.triggerSync(),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['remittanceSyncStatus'] });
            queryClient.invalidateQueries({ queryKey: ['remittanceSummary'] });
        },
        onError: (error: unknown) => {
            alert(error instanceof Error ? error.message : 'Sync trigger failed');
        },
    });

    const handleUpload = () => {
        if (file) {
            uploadMutation.mutate(file);
        }
    };

    const handleRetryAll = () => {
        if (confirm('Retry syncing all failed orders to Shopify?')) {
            retrySyncMutation.mutate({ all: true });
        }
    };

    const handleRetryOne = (orderId: string) => {
        retrySyncMutation.mutate({ orderIds: [orderId] });
    };

    const handleApproveManual = (orderId: string) => {
        if (confirm('Approve this order and sync to Shopify?')) {
            approveManualMutation.mutate({ orderId });
        }
    };

    const formatCurrency = formatCurrencyFull;

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    };

    const summary = summaryData?.data;

    return (
        <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Pending COD */}
                <div className="card bg-amber-50 border-amber-200">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-100 rounded-lg">
                            <Clock className="text-amber-600" size={24} />
                        </div>
                        <div>
                            <p className="text-sm text-amber-700">Pending COD</p>
                            <p className="text-2xl font-bold text-amber-800">
                                {summaryLoading ? '...' : (summary?.pending?.count || 0)}
                            </p>
                            <p className="text-sm text-amber-600">
                                {summaryLoading ? '-' : formatCurrency(summary?.pending?.amount || 0)}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Paid (Last 30 Days) */}
                <div className="card bg-green-50 border-green-200">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-100 rounded-lg">
                            <CheckCircle className="text-green-600" size={24} />
                        </div>
                        <div>
                            <p className="text-sm text-green-700">Paid (Last 30 Days)</p>
                            <p className="text-2xl font-bold text-green-800">
                                {summaryLoading ? '...' : (summary?.paid?.count || 0)}
                            </p>
                            <p className="text-sm text-green-600">
                                {summaryLoading ? '-' : formatCurrency(summary?.paid?.amount || 0)}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Processed Range */}
                <div className="card bg-blue-50 border-blue-200">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <DollarSign className="text-blue-600" size={24} />
                        </div>
                        <div>
                            <p className="text-sm text-blue-700">Processed Range</p>
                            {summary?.processedRange?.earliest ? (
                                <>
                                    <p className="text-sm font-medium text-blue-800">
                                        {formatDate(summary.processedRange.earliest)}
                                    </p>
                                    <p className="text-sm text-blue-600">
                                        to {formatDate(summary.processedRange.latest)}
                                    </p>
                                </>
                            ) : (
                                <p className="text-sm text-blue-600">No remittances processed yet</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* iThink API Sync Card */}
            <div className="card">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Zap size={20} /> iThink API Sync
                    </h2>
                    <div className="flex items-center gap-2">
                        <button
                            className="btn btn-sm btn-primary flex items-center gap-2"
                            onClick={() => triggerSyncMutation.mutate()}
                            disabled={triggerSyncMutation.isPending}
                        >
                            <RefreshCw size={14} className={triggerSyncMutation.isPending ? 'animate-spin' : ''} />
                            {triggerSyncMutation.isPending ? 'Syncing...' : 'Sync Now'}
                        </button>
                        <button
                            className="btn btn-sm"
                            onClick={() => setShowApiSync(!showApiSync)}
                        >
                            {showApiSync ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                    </div>
                </div>

                {showApiSync && (
                    <div className="space-y-4">
                        {/* Status indicator */}
                        {syncStatusLoading ? (
                            <p className="text-gray-500 text-sm">Loading sync status...</p>
                        ) : syncStatusData?.data?.status ? (
                            <div className="flex items-center gap-4 text-sm">
                                <span className={`flex items-center gap-1.5 px-2 py-1 rounded ${
                                    syncStatusData.data.status.schedulerActive
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-gray-100 text-gray-600'
                                }`}>
                                    <span className={`w-2 h-2 rounded-full ${
                                        syncStatusData.data.status.isRunning
                                            ? 'bg-blue-500 animate-pulse'
                                            : syncStatusData.data.status.schedulerActive
                                            ? 'bg-green-500'
                                            : 'bg-gray-400'
                                    }`} />
                                    {syncStatusData.data.status.isRunning
                                        ? 'Running'
                                        : syncStatusData.data.status.schedulerActive
                                        ? 'Active'
                                        : 'Idle'}
                                </span>
                                {syncStatusData.data.status.lastSyncAt && (
                                    <span className="text-gray-500">
                                        Last sync: {formatDate(syncStatusData.data.status.lastSyncAt)}
                                    </span>
                                )}
                                <span className="text-gray-400">
                                    Every {syncStatusData.data.status.intervalHours}h
                                </span>
                            </div>
                        ) : null}

                        {/* Last sync result summary */}
                        {syncStatusData?.data?.status?.lastSyncResult && (
                            <div className="p-3 bg-gray-50 rounded-lg text-sm">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <div><span className="text-gray-500">Remittances:</span> <span className="font-medium">{syncStatusData.data.status.lastSyncResult.remittancesNew} new</span></div>
                                    <div><span className="text-gray-500">Orders:</span> <span className="font-medium">{syncStatusData.data.status.lastSyncResult.ordersUpdated} updated</span></div>
                                    <div><span className="text-gray-500">Shopify:</span> <span className="font-medium text-green-600">{syncStatusData.data.status.lastSyncResult.shopifySynced} synced</span></div>
                                    {syncStatusData.data.status.lastSyncResult.errors > 0 && (
                                        <div><span className="text-gray-500">Errors:</span> <span className="font-medium text-red-600">{syncStatusData.data.status.lastSyncResult.errors}</span></div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Recent remittances table */}
                        {syncStatusData?.data?.recentRemittances?.length > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 text-left">
                                        <tr>
                                            <th className="px-3 py-2">Date</th>
                                            <th className="px-3 py-2 text-right">COD Generated</th>
                                            <th className="px-3 py-2 text-right">Charges</th>
                                            <th className="px-3 py-2 text-right">GST</th>
                                            <th className="px-3 py-2 text-right">Net Remitted</th>
                                            <th className="px-3 py-2 text-center">Orders</th>
                                            <th className="px-3 py-2 text-center">Bank</th>
                                            <th className="px-3 py-2"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {(syncStatusData!.data.recentRemittances as CodRemittance[]).map((r) => (
                                            <React.Fragment key={r.id}>
                                                <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpandedRemittance(expandedRemittance === r.id ? null : r.id)}>
                                                    <td className="px-3 py-2">{formatDate(r.remittanceDate)}</td>
                                                    <td className="px-3 py-2 text-right">{formatCurrency(r.codGenerated)}</td>
                                                    <td className="px-3 py-2 text-right text-orange-600">{formatCurrency(r.transactionCharges)}</td>
                                                    <td className="px-3 py-2 text-right text-orange-600">{formatCurrency(r.transactionGstCharges)}</td>
                                                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(r.codRemitted)}</td>
                                                    <td className="px-3 py-2 text-center">{r.ordersProcessed}/{r.orderCount}</td>
                                                    <td className="px-3 py-2 text-center">
                                                        {r.bankTransactionId ? (
                                                            <span className="inline-flex items-center gap-1 text-green-600" title={`Matched: ${r.matchConfidence}`}>
                                                                <Link2 size={14} />
                                                            </span>
                                                        ) : (
                                                            <span className="text-gray-400">-</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        {expandedRemittance === r.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                    </td>
                                                </tr>
                                                {expandedRemittance === r.id && Array.isArray(r.orderDetails) && (
                                                    <tr>
                                                        <td colSpan={8} className="px-3 py-2 bg-blue-50">
                                                            <div className="max-h-48 overflow-y-auto">
                                                                <table className="w-full text-xs">
                                                                    <thead className="text-gray-500">
                                                                        <tr>
                                                                            <th className="text-left py-1">AWB</th>
                                                                            <th className="text-left py-1">Order</th>
                                                                            <th className="text-right py-1">Amount</th>
                                                                            <th className="text-left py-1">Delivered</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {(r.orderDetails as Array<{ airway_bill_no: string; order_no: string; price: string; delivered_date: string }>).slice(0, 20).map((d) => (
                                                                            <tr key={d.airway_bill_no || d.order_no} className="border-t border-blue-100">
                                                                                <td className="py-1 font-mono">{d.airway_bill_no}</td>
                                                                                <td className="py-1">{d.order_no}</td>
                                                                                <td className="py-1 text-right">{formatCurrency(parseFloat(d.price))}</td>
                                                                                <td className="py-1">{d.delivered_date}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Upload Card (Manual Fallback) */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Upload size={20} /> Manual Upload (CSV Fallback)
                </h2>

                <div className="max-w-xl space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            CSV File from iThink Logistics
                        </label>
                        <input
                            type="file"
                            accept=".csv"
                            className="input"
                            onChange={(e) => {
                                setFile(e.target.files?.[0] || null);
                                setUploadResult(null);
                            }}
                        />
                    </div>

                    <button
                        className="btn btn-primary flex items-center gap-2"
                        onClick={handleUpload}
                        disabled={!file || uploadMutation.isPending}
                    >
                        <FileSpreadsheet size={16} />
                        {uploadMutation.isPending ? 'Processing...' : 'Process Remittance CSV'}
                    </button>

                    {/* Upload Result */}
                    {uploadResult && (
                        <div className={`p-4 rounded-lg ${
                            uploadResult.results.updated > 0
                                ? 'bg-green-50 border border-green-200'
                                : 'bg-yellow-50 border border-yellow-200'
                        }`}>
                            <p className={`font-medium mb-2 ${
                                uploadResult.results.updated > 0 ? 'text-green-800' : 'text-yellow-800'
                            }`}>
                                {uploadResult.message}
                            </p>

                            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-600">Total rows:</span>
                                    <span className="font-medium">{uploadResult.results.total}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-600">Matched:</span>
                                    <span className="font-medium">{uploadResult.results.matched}</span>
                                </div>
                                <div className="flex items-center gap-2 text-green-700">
                                    <CheckCircle size={14} />
                                    <span>Updated:</span>
                                    <span className="font-medium">{uploadResult.results.updated}</span>
                                </div>
                                <div className="flex items-center gap-2 text-blue-700">
                                    <span className="text-gray-600">Already Paid:</span>
                                    <span className="font-medium">{uploadResult.results.alreadyPaid}</span>
                                </div>
                            </div>

                            {/* Shopify Sync Results */}
                            {(uploadResult.results.shopifySynced !== undefined ||
                              uploadResult.results.shopifyFailed !== undefined ||
                              uploadResult.results.manualReview !== undefined) && (
                                <div className="p-3 bg-indigo-50 rounded-lg mb-3">
                                    <p className="font-medium text-indigo-800 flex items-center gap-2 mb-2">
                                        <ExternalLink size={14} /> Shopify Sync Status
                                    </p>
                                    <div className="grid grid-cols-3 gap-2 text-sm">
                                        {uploadResult.results.shopifySynced !== undefined && (
                                            <div className="flex items-center gap-2 text-green-700">
                                                <CheckCircle size={14} />
                                                <span>Synced: {uploadResult.results.shopifySynced}</span>
                                            </div>
                                        )}
                                        {uploadResult.results.shopifyFailed !== undefined && uploadResult.results.shopifyFailed > 0 && (
                                            <div className="flex items-center gap-2 text-red-700">
                                                <AlertCircle size={14} />
                                                <span>Failed: {uploadResult.results.shopifyFailed}</span>
                                            </div>
                                        )}
                                        {uploadResult.results.manualReview !== undefined && uploadResult.results.manualReview > 0 && (
                                            <div className="flex items-center gap-2 text-amber-700">
                                                <Clock size={14} />
                                                <span>Manual Review: {uploadResult.results.manualReview}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Date range processed */}
                            {uploadResult.results.dateRange && (
                                <div className="text-sm text-blue-700 mb-3 p-2 bg-blue-50 rounded">
                                    Remittance dates: {formatDate(uploadResult.results.dateRange.earliest)} to {formatDate(uploadResult.results.dateRange.latest)}
                                </div>
                            )}

                            {/* Not Found Orders */}
                            {uploadResult.results.notFound.length > 0 && (
                                <div className="mt-3">
                                    <p className="text-amber-700 font-medium flex items-center gap-1">
                                        <AlertCircle size={14} />
                                        Orders not found ({uploadResult.results.notFound.length}):
                                    </p>
                                    <div className="mt-1 max-h-40 overflow-y-auto">
                                        <table className="w-full text-sm">
                                            <thead className="text-left text-gray-500">
                                                <tr>
                                                    <th className="pr-2">Order #</th>
                                                    <th className="pr-2">Customer</th>
                                                    <th>Amount</th>
                                                </tr>
                                            </thead>
                                            <tbody className="text-amber-800">
                                                {uploadResult.results.notFound.slice(0, 10).map((item, i) => (
                                                    <tr key={i}>
                                                        <td className="pr-2">{item.orderNumber}</td>
                                                        <td className="pr-2">{item.customer}</td>
                                                        <td>{item.amount}</td>
                                                    </tr>
                                                ))}
                                                {uploadResult.results.notFound.length > 10 && (
                                                    <tr>
                                                        <td colSpan={3} className="text-gray-500">
                                                            ...and {uploadResult.results.notFound.length - 10} more
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Errors */}
                            {uploadResult.results.errors.length > 0 && (
                                <div className="mt-3">
                                    <p className="text-red-700 font-medium">
                                        Errors ({uploadResult.results.errors.length}):
                                    </p>
                                    <ul className="list-disc list-inside text-red-600 text-sm">
                                        {uploadResult.results.errors.slice(0, 5).map((err, i) => (
                                            <li key={i}>{err.orderNumber}: {err.error}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* CSV Format Info */}
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800 font-medium mb-1">Expected CSV Format:</p>
                    <ul className="text-sm text-blue-700 list-disc list-inside space-y-1">
                        <li>Download the COD remittance report from iThink Logistics</li>
                        <li>Required column: <code className="bg-blue-100 px-1 rounded">Order No.</code></li>
                        <li>Optional columns: <code className="bg-blue-100 px-1 rounded">AWB NO.</code>, <code className="bg-blue-100 px-1 rounded">Price</code>, <code className="bg-blue-100 px-1 rounded">Remittance Date</code>, <code className="bg-blue-100 px-1 rounded">Remittance UTR</code></li>
                        <li>Orders will be marked as paid and automatically synced to Shopify</li>
                    </ul>
                </div>
            </div>

            {/* Shopify Sync Management */}
            <div className="card">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <RefreshCw size={20} /> Shopify Sync Management
                    </h2>
                    <button
                        className="btn btn-sm"
                        onClick={() => {
                            setShowFailedSync(!showFailedSync);
                            if (!showFailedSync) refetchFailed();
                        }}
                    >
                        {showFailedSync ? 'Hide' : 'Show Failed/Pending'}
                    </button>
                </div>

                {showFailedSync && (
                    <div className="space-y-4">
                        {failedLoading ? (
                            <p className="text-gray-500">Loading...</p>
                        ) : (
                            <>
                                {/* Summary counts */}
                                {failedData?.data?.counts && (
                                    <div className="flex gap-4 text-sm">
                                        {failedData.data.counts.failed > 0 && (
                                            <span className="px-2 py-1 rounded bg-red-100 text-red-700">
                                                Failed: {failedData.data.counts.failed}
                                            </span>
                                        )}
                                        {failedData.data.counts.pending > 0 && (
                                            <span className="px-2 py-1 rounded bg-yellow-100 text-yellow-700">
                                                Pending: {failedData.data.counts.pending}
                                            </span>
                                        )}
                                        {failedData.data.counts.manual_review > 0 && (
                                            <span className="px-2 py-1 rounded bg-amber-100 text-amber-700">
                                                Manual Review: {failedData.data.counts.manual_review}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Retry All Button */}
                                {failedData?.data?.orders?.length > 0 && (
                                    <div className="flex gap-2">
                                        <button
                                            className="btn btn-sm btn-primary flex items-center gap-2"
                                            onClick={handleRetryAll}
                                            disabled={retrySyncMutation.isPending}
                                        >
                                            <RotateCcw size={14} />
                                            {retrySyncMutation.isPending ? 'Retrying...' : 'Retry All Failed'}
                                        </button>
                                    </div>
                                )}

                                {/* Orders List */}
                                {failedData?.data?.orders?.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead className="bg-gray-50 text-left">
                                                <tr>
                                                    <th className="px-3 py-2">Order #</th>
                                                    <th className="px-3 py-2">Customer</th>
                                                    <th className="px-3 py-2">Amount</th>
                                                    <th className="px-3 py-2">Status</th>
                                                    <th className="px-3 py-2">Error</th>
                                                    <th className="px-3 py-2">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y">
                                                {(failedData!.data.orders as FailedOrder[]).map((order) => (
                                                    <tr key={order.id} className="hover:bg-gray-50">
                                                        <td className="px-3 py-2 font-medium">{order.orderNumber}</td>
                                                        <td className="px-3 py-2">{order.customerName}</td>
                                                        <td className="px-3 py-2">
                                                            {formatCurrency(order.codRemittedAmount || order.totalAmount)}
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <span className={`px-2 py-0.5 rounded text-xs ${
                                                                order.codShopifySyncStatus === 'failed'
                                                                    ? 'bg-red-100 text-red-700'
                                                                    : order.codShopifySyncStatus === 'pending'
                                                                    ? 'bg-yellow-100 text-yellow-700'
                                                                    : 'bg-amber-100 text-amber-700'
                                                            }`}>
                                                                {order.codShopifySyncStatus}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate" title={order.codShopifySyncError || ''}>
                                                            {order.codShopifySyncError || '-'}
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex gap-1">
                                                                {(order.codShopifySyncStatus === 'failed' || order.codShopifySyncStatus === 'pending') && (
                                                                    <button
                                                                        className="btn btn-xs"
                                                                        onClick={() => handleRetryOne(order.id)}
                                                                        disabled={retrySyncMutation.isPending}
                                                                        title="Retry sync"
                                                                    >
                                                                        <RotateCcw size={12} />
                                                                    </button>
                                                                )}
                                                                {order.codShopifySyncStatus === 'manual_review' && (
                                                                    <button
                                                                        className="btn btn-xs btn-primary"
                                                                        onClick={() => handleApproveManual(order.id)}
                                                                        disabled={approveManualMutation.isPending}
                                                                        title="Approve and sync"
                                                                    >
                                                                        <CheckCircle size={12} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p className="text-green-600 text-sm flex items-center gap-2">
                                        <CheckCircle size={16} />
                                        All remittances synced to Shopify successfully!
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default RemittanceTab;
