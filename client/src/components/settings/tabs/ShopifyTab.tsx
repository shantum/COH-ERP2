/**
 * ShopifyTab component
 * Shopify integration configuration, sync controls, and webhook management
 *
 * Partially migrated to use TanStack Start Server Functions.
 * Some APIs still use axios (shopifyApi) for features not yet migrated to Server Functions.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { shopifyApi } from '../../../services/api';
import JsonViewer from '../../JsonViewer';
import {
    CheckCircle, XCircle, RefreshCw, ShoppingCart, Users, Eye, Play,
    AlertCircle, Package, Webhook, Copy, ExternalLink, Database, Download,
    Activity, Clock, Zap, Pause, ChevronDown, ChevronRight, FileJson,
} from 'lucide-react';

// Server Functions (partial migration - only migrated APIs)
import {
    getShopifyConfig,
    getShopifySyncHistory,
    getSyncJobs,
    startSyncJob,
    cancelSyncJob,
    getCacheStatus,
    triggerSync,
    type SyncJobResult,
} from '../../../server/functions/shopify';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyData = any;

export function ShopifyTab() {
    const queryClient = useQueryClient();

    // Config state
    const [shopDomain, setShopDomain] = useState('');

    // Preview state
    const [productPreview, setProductPreview] = useState<AnyData>(null);
    const [orderPreview, setOrderPreview] = useState<AnyData>(null);
    const [customerPreview, setCustomerPreview] = useState<AnyData>(null);
    const [copiedWebhook, setCopiedWebhook] = useState<string | null>(null);

    // Full dump state
    const [dumpDays, setDumpDays] = useState(30);

    // Webhook Inspector state
    const [expandedWebhookId, setExpandedWebhookId] = useState<string | null>(null);
    const [webhookDetail, setWebhookDetail] = useState<AnyData>(null);
    const [loadingWebhookDetail, setLoadingWebhookDetail] = useState(false);

    // Server Function wrappers
    const getShopifyConfigFn = useServerFn(getShopifyConfig);
    const getShopifySyncHistoryFn = useServerFn(getShopifySyncHistory);
    const getSyncJobsFn = useServerFn(getSyncJobs);
    const startSyncJobFn = useServerFn(startSyncJob);
    const cancelSyncJobFn = useServerFn(cancelSyncJob);
    const getCacheStatusFn = useServerFn(getCacheStatus);
    const triggerSyncFn = useServerFn(triggerSync);

    // Fetch current config using Server Function
    const { data: config, isLoading: configLoading, error: configError } = useQuery({
        queryKey: ['shopifyConfig'],
        queryFn: async () => {
            const result = await getShopifyConfigFn();
            if (!result.success) throw new Error(result.error?.message);
            setShopDomain(result.data?.shopDomain || '');
            return result.data;
        },
    });

    // Fetch sync history using Server Function
    const { data: syncHistory } = useQuery({
        queryKey: ['shopifySyncHistory'],
        queryFn: async () => {
            const result = await getShopifySyncHistoryFn();
            if (!result.success) throw new Error(result.error?.message);
            return result.data;
        },
    });

    // Cache status using Server Function
    const { data: cacheStatus } = useQuery({
        queryKey: ['cacheStatus'],
        queryFn: async () => {
            const result = await getCacheStatusFn();
            if (!result.success) throw new Error(result.error?.message);
            return result.data;
        },
        refetchInterval: 10000,
    });

    // Product cache status (still using axios - not yet migrated)
    const { data: productCacheStatus } = useQuery({
        queryKey: ['productCacheStatus'],
        queryFn: () => shopifyApi.getProductCacheStatus().then(r => r.data),
        refetchInterval: 10000,
    });

    // Background sync jobs using Server Function
    const { data: syncJobs, refetch: refetchJobs } = useQuery({
        queryKey: ['syncJobs'],
        queryFn: async () => {
            const result = await getSyncJobsFn({ data: { limit: 10 } });
            if (!result.success) throw new Error(result.error?.message);
            return result.data;
        },
        refetchInterval: 3000,
    });

    // Scheduler status (still using axios - not yet migrated)
    const { data: schedulerStatus, refetch: refetchScheduler } = useQuery({
        queryKey: ['schedulerStatus'],
        queryFn: () => shopifyApi.getSchedulerStatus().then(r => r.data),
        refetchInterval: 10000,
    });

    // Webhook activity (still using axios - not yet migrated)
    const { data: webhookActivity, refetch: refetchWebhooks } = useQuery({
        queryKey: ['webhookActivity'],
        queryFn: () => shopifyApi.getWebhookActivity({ hours: 24, limit: 20 }).then(r => r.data),
        refetchInterval: 15000,
    });

    // Mutations - still using axios (not yet migrated to Server Functions)
    const previewProductsMutation = useMutation({
        mutationFn: () => shopifyApi.previewProducts(10),
        onSuccess: (res) => setProductPreview(res.data),
    });

    const previewOrdersMutation = useMutation({
        mutationFn: () => shopifyApi.previewOrders(10),
        onSuccess: (res) => setOrderPreview(res.data),
    });

    const previewCustomersMutation = useMutation({
        mutationFn: () => shopifyApi.previewCustomers(10),
        onSuccess: (res) => setCustomerPreview(res.data),
    });

    const syncProductsMutation = useMutation({
        mutationFn: (params: { limit?: number; syncAll?: boolean }) => shopifyApi.syncProducts(params),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shopifySyncHistory'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['productCacheStatus'] });
        },
    });

    // Full dump mutation (still using axios)
    const fullDumpMutation = useMutation({
        mutationFn: (daysBack?: number) => shopifyApi.fullDump(daysBack),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['cacheStatus'] });
            queryClient.invalidateQueries({ queryKey: ['syncJobs'] });
        },
    });

    // Process cache mutation (still using axios)
    const processCacheMutation = useMutation({
        mutationFn: ({ limit, retryFailed }: { limit?: number; retryFailed?: boolean }) =>
            shopifyApi.processCache(limit, retryFailed),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['openOrders'] });
            queryClient.invalidateQueries({ queryKey: ['cacheStatus'] });
        },
    });

    // Start job mutation using Server Function
    const startJobMutation = useMutation({
        mutationFn: async (params: {
            jobType: string;
            syncMode?: 'deep' | 'incremental' | 'quick' | 'update';
            days?: number;
            staleAfterMins?: number;
        }) => {
            const result = await startSyncJobFn({
                data: {
                    jobType: params.jobType as 'orders' | 'customers' | 'products',
                    syncMode: params.syncMode,
                    days: params.days,
                    staleAfterMins: params.staleAfterMins,
                },
            });
            if (!result.success) throw new Error(result.error?.message);
            return result.data;
        },
        onSuccess: () => refetchJobs(),
        onError: (error: Error) => {
            alert(error.message || 'Failed to start sync job');
        },
    });

    // Cancel job mutation using Server Function
    const cancelJobMutation = useMutation({
        mutationFn: async (jobId: string) => {
            const result = await cancelSyncJobFn({ data: { jobId } });
            if (!result.success) throw new Error(result.error?.message);
            return result.data;
        },
        onSuccess: () => refetchJobs(),
    });

    // Resume job mutation (still using axios - not in Server Functions)
    const resumeJobMutation = useMutation({
        mutationFn: (jobId: string) => shopifyApi.resumeSyncJob(jobId),
        onSuccess: () => refetchJobs(),
    });

    // Scheduler mutations (still using axios - not yet migrated)
    const triggerSyncMutation = useMutation({
        mutationFn: async () => {
            const result = await triggerSyncFn();
            if (!result.success) throw new Error(result.error?.message);
            return result.data;
        },
        onSuccess: () => {
            refetchScheduler();
            queryClient.invalidateQueries({ queryKey: ['cacheStatus'] });
        },
    });

    const toggleSchedulerMutation = useMutation({
        mutationFn: (action: 'start' | 'stop') =>
            action === 'start' ? shopifyApi.startScheduler() : shopifyApi.stopScheduler(),
        onSuccess: () => refetchScheduler(),
    });

    // Toggle webhook detail expansion
    const toggleWebhookDetail = async (webhookId: string) => {
        if (expandedWebhookId === webhookId) {
            // Collapse
            setExpandedWebhookId(null);
            setWebhookDetail(null);
            return;
        }

        // Expand and fetch detail
        setExpandedWebhookId(webhookId);
        setLoadingWebhookDetail(true);
        try {
            const res = await shopifyApi.getWebhookDetail(webhookId);
            setWebhookDetail(res.data);
        } catch (e) {
            console.error('Failed to fetch webhook detail:', e);
            setWebhookDetail({ error: 'Failed to load webhook detail' });
        } finally {
            setLoadingWebhookDetail(false);
        }
    };

    if (configLoading) {
        return (
            <div className="flex justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    // Show error state if config fetch failed
    if (configError) {
        return (
            <div className="card">
                <div className="flex items-center gap-3 text-red-700 bg-red-50 p-4 rounded-lg">
                    <AlertCircle size={24} />
                    <div>
                        <p className="font-medium">Failed to load Shopify configuration</p>
                        <p className="text-sm">{configError instanceof Error ? configError.message : 'Unknown error'}</p>
                        <p className="text-xs mt-2 text-gray-600">
                            Make sure the server is running and SHOPIFY_ACCESS_TOKEN / SHOPIFY_SHOP_DOMAIN are set in your environment.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Sync Status Card */}
            {config?.hasAccessToken && (
                <div className="card">
                    <h2 className="text-lg font-semibold mb-4">Sync Status</h2>

                    <div className="grid grid-cols-3 gap-4 mb-4">
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{syncHistory?.counts?.syncedOrders || 0}</p>
                            <p className="text-sm text-gray-500">Orders Synced</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{syncHistory?.counts?.syncedCustomers || 0}</p>
                            <p className="text-sm text-gray-500">Customers Synced</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">
                                {syncHistory?.lastSync ? new Date(syncHistory.lastSync).toLocaleDateString() : '-'}
                            </p>
                            <p className="text-sm text-gray-500">Last Sync</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Products Sync */}
            {config?.hasAccessToken && (
                <div className="card border-2 border-primary-200 bg-primary-50/30">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold flex items-center gap-2">
                            <Package size={18} /> Products & SKUs
                            <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">Sync First</span>
                        </h3>
                        {productCacheStatus?.lastSyncAt && (
                            <span className="text-xs text-gray-500">
                                Last sync: {new Date(productCacheStatus.lastSyncAt).toLocaleString()}
                            </span>
                        )}
                    </div>

                    {/* Product Sync Status */}
                    {productCacheStatus && (
                        <div className="mb-4 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                                <div className="bg-white rounded-lg p-2 text-center shadow-sm">
                                    <p className="text-xl font-bold text-gray-900">{productCacheStatus.totalCached}</p>
                                    <p className="text-xs text-gray-500">Cached</p>
                                </div>
                                <div className="bg-white rounded-lg p-2 text-center shadow-sm">
                                    <p className="text-xl font-bold text-green-600">{productCacheStatus.processed}</p>
                                    <p className="text-xs text-gray-500">Processed</p>
                                </div>
                                <div className="bg-white rounded-lg p-2 text-center shadow-sm">
                                    <p className="text-xl font-bold text-yellow-600">{productCacheStatus.pending}</p>
                                    <p className="text-xs text-gray-500">Pending</p>
                                </div>
                                <div className="bg-white rounded-lg p-2 text-center shadow-sm">
                                    <p className="text-xl font-bold text-red-600">{productCacheStatus.failed}</p>
                                    <p className="text-xs text-gray-500">Failed</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {/* Shopify Status */}
                                <div className="bg-white rounded-lg p-2 shadow-sm">
                                    <p className="text-xs font-medium text-gray-600 mb-1">Shopify Status</p>
                                    <div className="flex flex-wrap gap-1">
                                        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                                            Active: {productCacheStatus.shopifyStatus?.active || 0}
                                        </span>
                                        <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">
                                            Draft: {productCacheStatus.shopifyStatus?.draft || 0}
                                        </span>
                                        <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">
                                            Archived: {productCacheStatus.shopifyStatus?.archived || 0}
                                        </span>
                                    </div>
                                </div>

                                {/* ERP Products */}
                                <div className="bg-white rounded-lg p-2 shadow-sm">
                                    <p className="text-xs font-medium text-gray-600 mb-1">ERP Products</p>
                                    <div className="flex flex-wrap gap-1">
                                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                                            Total: {productCacheStatus.erpProducts?.total || 0}
                                        </span>
                                        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                                            Linked: {productCacheStatus.erpProducts?.linked || 0}
                                        </span>
                                        <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-xs">
                                            Not Linked: {productCacheStatus.erpProducts?.notLinked || 0}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <p className="text-sm text-gray-600 mb-3">
                        Sync products first to create SKUs in the ERP. This enables order line items to link properly.
                    </p>

                    <div className="flex flex-wrap gap-2 mb-4">
                        <button
                            className="btn btn-secondary flex items-center gap-2"
                            onClick={() => previewProductsMutation.mutate()}
                            disabled={previewProductsMutation.isPending}
                        >
                            <Eye size={16} />
                            {previewProductsMutation.isPending ? 'Loading...' : 'Preview'}
                        </button>
                        <button
                            className="btn btn-primary flex items-center gap-2"
                            onClick={() => syncProductsMutation.mutate({ syncAll: true })}
                            disabled={syncProductsMutation.isPending}
                        >
                            {syncProductsMutation.isPending ? (
                                <RefreshCw size={16} className="animate-spin" />
                            ) : (
                                <RefreshCw size={16} />
                            )}
                            {syncProductsMutation.isPending ? 'Syncing...' : 'Sync All Products'}
                        </button>
                    </div>

                    {/* Sync in progress indicator */}
                    {syncProductsMutation.isPending && (
                        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <div className="flex items-center gap-3">
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent"></div>
                                <div>
                                    <p className="text-sm font-medium text-blue-800">Syncing products from Shopify...</p>
                                    <p className="text-xs text-blue-600">This may take a few minutes for large catalogs</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {productPreview && (
                        <div className="border rounded-lg overflow-hidden bg-white">
                            <div className="bg-gray-50 px-3 py-2 text-sm font-medium flex justify-between items-center">
                                <span>Raw Shopify Data ({productPreview.previewCount} of {productPreview.totalAvailable} products)</span>
                                <button onClick={() => setProductPreview(null)} className="text-gray-400 hover:text-gray-600">
                                    <XCircle size={16} />
                                </button>
                            </div>
                            <JsonViewer data={productPreview.products} rootName="products" />
                        </div>
                    )}

                    {syncProductsMutation.data && (
                        <div className={`mt-3 p-3 rounded-lg text-sm ${syncProductsMutation.data.data.results?.errors?.length > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
                            <p className="font-medium text-green-800">
                                Product sync completed! (Fetched: {syncProductsMutation.data.data.fetched}{syncProductsMutation.data.data.syncAll ? ' - ALL products' : ''})
                            </p>
                            <p className="text-green-700">
                                Created: {syncProductsMutation.data.data.results?.created?.products || 0} products,{' '}
                                {syncProductsMutation.data.data.results?.created?.variations || 0} variations,{' '}
                                {syncProductsMutation.data.data.results?.created?.skus || 0} SKUs |{' '}
                                Updated: {syncProductsMutation.data.data.results?.updated?.products || 0} products,{' '}
                                {syncProductsMutation.data.data.results?.updated?.variations || 0} variations,{' '}
                                {syncProductsMutation.data.data.results?.updated?.skus || 0} SKUs
                            </p>
                            {syncProductsMutation.data.data.results?.errors?.length > 0 && (
                                <div className="mt-2 text-yellow-700">
                                    <p className="font-medium">Errors:</p>
                                    <ul className="list-disc list-inside text-xs max-h-24 overflow-y-auto">
                                        {syncProductsMutation.data.data.results.errors.slice(0, 5).map((err: string, i: number) => (
                                            <li key={i}>{err}</li>
                                        ))}
                                        {syncProductsMutation.data.data.results.errors.length > 5 && (
                                            <li>...and {syncProductsMutation.data.data.results.errors.length - 5} more</li>
                                        )}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Order Sync - Simple Cache-First Architecture */}
            {config?.hasAccessToken && (
                <div className="card">
                    <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
                        <ShoppingCart size={20} /> Order Sync
                    </h2>
                    <p className="text-sm text-gray-600 mb-4">
                        Cache-first architecture: Orders are stored in cache, then processed to ERP. Webhooks keep cache updated in real-time.
                    </p>

                    {/* Cache Status - Prominent */}
                    {cacheStatus && (
                        <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                            <div className="flex items-center gap-2 mb-3">
                                <Database size={18} className="text-blue-600" />
                                <span className="font-semibold text-blue-800">Cache Status</span>
                            </div>
                            <div className="grid grid-cols-4 gap-4 text-center">
                                <div className="bg-white rounded-lg p-3 shadow-sm">
                                    <p className="text-2xl font-bold text-gray-900">{(cacheStatus.totalCached || 0).toLocaleString()}</p>
                                    <p className="text-xs text-gray-500">Total Cached</p>
                                </div>
                                <div className="bg-white rounded-lg p-3 shadow-sm">
                                    <p className="text-2xl font-bold text-green-600">{(cacheStatus.processed || 0).toLocaleString()}</p>
                                    <p className="text-xs text-gray-500">Processed</p>
                                </div>
                                <div className="bg-white rounded-lg p-3 shadow-sm">
                                    <p className="text-2xl font-bold text-yellow-600">{cacheStatus.pending || 0}</p>
                                    <p className="text-xs text-gray-500">Pending</p>
                                </div>
                                <div className="bg-white rounded-lg p-3 shadow-sm">
                                    <p className="text-2xl font-bold text-red-600">{cacheStatus.failed || 0}</p>
                                    <p className="text-xs text-gray-500">Failed</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Two Column Layout */}
                    <div className="grid md:grid-cols-2 gap-4 mb-4">
                        {/* Full Dump Card */}
                        <div className="border-2 border-blue-200 bg-blue-50/30 rounded-lg p-4">
                            <h3 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
                                <Download size={18} /> Full Dump from Shopify
                            </h3>
                            <p className="text-sm text-blue-700 mb-3">
                                Fetch all orders from Shopify and store in cache. Use for initial setup or to catch missing orders.
                            </p>

                            <div className="flex items-center gap-2 mb-3">
                                <label className="text-sm text-gray-700">Period:</label>
                                <select
                                    value={dumpDays}
                                    onChange={(e) => setDumpDays(Number(e.target.value))}
                                    className="input py-1.5 text-sm flex-1"
                                >
                                    <option value={7}>Last 7 days</option>
                                    <option value={30}>Last 30 days</option>
                                    <option value={90}>Last 90 days</option>
                                    <option value={180}>Last 6 months</option>
                                    <option value={365}>Last year</option>
                                    <option value={0}>All time</option>
                                </select>
                            </div>

                            <button
                                className="btn btn-primary w-full flex items-center justify-center gap-2"
                                onClick={() => {
                                    const days = dumpDays === 0 ? undefined : dumpDays;
                                    fullDumpMutation.mutate(days);
                                }}
                                disabled={fullDumpMutation.isPending}
                            >
                                {fullDumpMutation.isPending ? (
                                    <>
                                        <RefreshCw size={16} className="animate-spin" />
                                        Fetching from Shopify...
                                    </>
                                ) : (
                                    <>
                                        <Download size={16} />
                                        Start Full Dump
                                    </>
                                )}
                            </button>

                            {/* Loading indicator */}
                            {fullDumpMutation.isPending && (
                                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent"></div>
                                        <div>
                                            <p className="text-sm font-medium text-blue-800">Fetching orders from Shopify...</p>
                                            <p className="text-xs text-blue-600">This may take a few minutes depending on the number of orders</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Success result */}
                            {fullDumpMutation.data && !fullDumpMutation.isPending && (
                                <div className="mt-3 p-3 bg-green-100 border border-green-200 rounded-lg">
                                    <div className="flex items-center gap-2 mb-1">
                                        <CheckCircle size={16} className="text-green-600" />
                                        <span className="font-medium text-green-800">Full Dump Complete</span>
                                    </div>
                                    <div className="text-sm text-green-700 grid grid-cols-3 gap-2">
                                        <div>Fetched: <span className="font-semibold">{fullDumpMutation.data.data.fetched}</span></div>
                                        <div>Cached: <span className="font-semibold">{fullDumpMutation.data.data.cached}</span></div>
                                        <div>Duration: <span className="font-semibold">{fullDumpMutation.data.data.durationSeconds}s</span></div>
                                    </div>
                                    {fullDumpMutation.data.data.skipped > 0 && (
                                        <div className="text-xs text-yellow-600 mt-1">
                                            Skipped: {fullDumpMutation.data.data.skipped} orders (errors)
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Error result */}
                            {fullDumpMutation.error && !fullDumpMutation.isPending && (
                                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <XCircle size={16} className="text-red-600" />
                                        <span className="text-sm font-medium text-red-800">
                                            {(fullDumpMutation.error as AnyData)?.response?.data?.error || 'Full dump failed'}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Process Cache Card */}
                        <div className="border-2 border-green-200 bg-green-50/30 rounded-lg p-4">
                            <h3 className="font-semibold text-green-800 mb-2 flex items-center gap-2">
                                <RefreshCw size={18} /> Process Cache to ERP
                            </h3>
                            <p className="text-sm text-green-700 mb-3">
                                Convert unprocessed cache entries into ERP Order records. Run after full dump or to retry failed processing.
                            </p>

                            <div className="flex gap-2 mb-3">
                                <button
                                    className="btn bg-green-600 text-white hover:bg-green-700 flex-1 flex items-center justify-center gap-2"
                                    onClick={() => processCacheMutation.mutate({ limit: 100 })}
                                    disabled={processCacheMutation.isPending || (cacheStatus?.pending || 0) === 0}
                                >
                                    {processCacheMutation.isPending ? (
                                        <>
                                            <RefreshCw size={16} className="animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <Play size={16} />
                                            Process Pending ({cacheStatus?.pending || 0})
                                        </>
                                    )}
                                </button>
                                {(cacheStatus?.failed || 0) > 0 && (
                                    <button
                                        className="btn bg-orange-500 text-white hover:bg-orange-600 flex items-center gap-1"
                                        onClick={() => processCacheMutation.mutate({ limit: 100, retryFailed: true })}
                                        disabled={processCacheMutation.isPending}
                                    >
                                        <RefreshCw size={14} className={processCacheMutation.isPending ? 'animate-spin' : ''} />
                                        Retry Failed ({cacheStatus?.failed || 0})
                                    </button>
                                )}
                            </div>

                            {/* Processing indicator */}
                            {processCacheMutation.isPending && (
                                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent"></div>
                                        <div>
                                            <p className="text-sm font-medium text-blue-800">Processing cache entries...</p>
                                            <p className="text-xs text-blue-600">Converting orders to ERP format (up to 100 at a time)</p>
                                        </div>
                                    </div>
                                </div>
                            )}


                            {/* Success result */}
                            {processCacheMutation.data && !processCacheMutation.isPending && (
                                <div className="mt-3 p-3 bg-green-100 border border-green-200 rounded-lg">
                                    <div className="flex items-center gap-2 mb-1">
                                        <CheckCircle size={16} className="text-green-600" />
                                        <span className="font-medium text-green-800">Processing Complete</span>
                                    </div>
                                    <div className="text-sm text-green-700 grid grid-cols-2 gap-2">
                                        <div>Processed: <span className="font-semibold">{processCacheMutation.data.data.processed}</span></div>
                                        <div>Failed: <span className="font-semibold">{processCacheMutation.data.data.failed}</span></div>
                                    </div>
                                    {processCacheMutation.data.data.errors?.length > 0 && (
                                        <div className="mt-2 text-xs text-red-600">
                                            <p className="font-medium">Errors:</p>
                                            <ul className="list-disc list-inside max-h-20 overflow-y-auto">
                                                {processCacheMutation.data.data.errors.slice(0, 3).map((err: AnyData, i: number) => (
                                                    <li key={i}>{err.orderNumber}: {err.error}</li>
                                                ))}
                                                {processCacheMutation.data.data.errors.length > 3 && (
                                                    <li>...and {processCacheMutation.data.data.errors.length - 3} more</li>
                                                )}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>
                    </div>

                    {/* Preview button */}
                    <div className="mt-4 flex justify-end">
                        <button
                            className="btn btn-secondary btn-sm flex items-center gap-1"
                            onClick={() => previewOrdersMutation.mutate()}
                            disabled={previewOrdersMutation.isPending}
                        >
                            <Eye size={14} />
                            {previewOrdersMutation.isPending ? 'Loading...' : 'Preview from Shopify API'}
                        </button>
                    </div>

                    {orderPreview && (
                        <div className="mt-4 border rounded-lg overflow-hidden">
                            <div className="bg-gray-50 px-3 py-2 text-sm font-medium flex justify-between items-center">
                                <span>Raw Shopify Data ({orderPreview.previewCount} of {orderPreview.totalAvailable} orders)</span>
                                <button onClick={() => setOrderPreview(null)} className="text-gray-400 hover:text-gray-600">
                                    <XCircle size={16} />
                                </button>
                            </div>
                            <JsonViewer data={orderPreview.orders} rootName="orders" />
                        </div>
                    )}
                </div>
            )}

            {/* Customers */}
            {config?.hasAccessToken && (
                <div className="card">
                    <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <Users size={18} /> Customers
                    </h3>

                    <div className="flex flex-wrap gap-2 mb-4">
                        <button
                            className="btn btn-secondary flex items-center gap-2"
                            onClick={() => previewCustomersMutation.mutate()}
                            disabled={previewCustomersMutation.isPending}
                        >
                            <Eye size={16} />
                            {previewCustomersMutation.isPending ? 'Loading...' : 'Preview'}
                        </button>
                        <button
                            className="btn btn-primary flex items-center gap-2"
                            onClick={() => startJobMutation.mutate({ jobType: 'customers', days: 9999 })}
                            disabled={startJobMutation.isPending}
                        >
                            <Play size={16} />
                            {startJobMutation.isPending ? 'Starting...' : 'Sync Customers'}
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">
                        Only customers with at least 1 order are synced.
                    </p>

                    {customerPreview && (
                        <div className="border rounded-lg overflow-hidden">
                            <div className="bg-gray-50 px-3 py-2 text-sm font-medium flex justify-between items-center">
                                <span>Raw Shopify Data ({customerPreview.previewCount} of {customerPreview.totalAvailable} customers)</span>
                                <button onClick={() => setCustomerPreview(null)} className="text-gray-400 hover:text-gray-600">
                                    <XCircle size={16} />
                                </button>
                            </div>
                            <JsonViewer data={customerPreview.customers} rootName="customers" />
                        </div>
                    )}
                </div>
            )}

            {/* Webhooks Section */}
            {config?.hasAccessToken && (
                <div className="card">
                    <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <Webhook size={20} /> Webhook Endpoints
                    </h2>
                    <p className="text-sm text-gray-600 mb-4">
                        Configure these in Shopify Admin - Settings - Notifications - Webhooks.
                        All events for each type use a single unified endpoint.
                    </p>

                    <div className="space-y-3">
                        {[
                            { name: 'Orders', path: '/shopify/orders', topics: 'create, updated, cancelled, fulfilled', topicPrefix: 'orders/' },
                            { name: 'Products', path: '/shopify/products', topics: 'create, update, delete', topicPrefix: 'products/' },
                            { name: 'Customers', path: '/shopify/customers', topics: 'create, update', topicPrefix: 'customers/' },
                        ].map((endpoint) => {
                            const lastLog = webhookActivity?.recentLogs?.find(
                                (log: AnyData) => log.topic?.startsWith(endpoint.topicPrefix)
                            );
                            return (
                                <div key={endpoint.name} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-sm">{endpoint.name}</span>
                                            {lastLog && (
                                                <span className="text-xs text-gray-500">
                                                    Last: {new Date(lastLog.receivedAt).toLocaleString()}
                                                </span>
                                            )}
                                        </div>
                                        <code className="text-xs text-gray-600 font-mono">
                                            {typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks{endpoint.path}
                                        </code>
                                        <div className="text-xs text-gray-500 mt-1">
                                            Topics: {endpoint.topics}
                                        </div>
                                    </div>
                                    <button
                                        className="btn btn-secondary btn-sm flex items-center gap-1"
                                        onClick={() => {
                                            if (typeof window !== 'undefined') {
                                                navigator.clipboard.writeText(window.location.origin + '/api/webhooks' + endpoint.path);
                                                setCopiedWebhook(endpoint.name);
                                                setTimeout(() => setCopiedWebhook(null), 2000);
                                            }
                                        }}
                                    >
                                        {copiedWebhook === endpoint.name ? (
                                            <CheckCircle size={14} className="text-green-600" />
                                        ) : (
                                            <Copy size={14} />
                                        )}
                                        Copy
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {shopDomain && (
                        <div className="mt-4">
                            <a
                                href={`https://${shopDomain.replace('.myshopify.com', '')}.myshopify.com/admin/settings/notifications`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-secondary inline-flex items-center gap-2"
                            >
                                <ExternalLink size={16} />
                                Open Shopify Webhook Settings
                            </a>
                        </div>
                    )}
                </div>
            )}

            {/* Webhook Activity & Scheduler Status */}
            {config?.hasAccessToken && (
                <div className="card">
                    <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <Activity size={20} /> Real-Time Sync Status
                    </h2>

                    {/* Two Column Layout: Scheduler + Webhook Summary */}
                    <div className="grid md:grid-cols-2 gap-6 mb-6">
                        {/* Scheduler Status */}
                        <div className="border rounded-lg p-4 bg-gradient-to-br from-indigo-50 to-purple-50">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="font-semibold text-indigo-800 flex items-center gap-2">
                                    <Clock size={18} /> Hourly Sync Scheduler
                                </h3>
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                    schedulerStatus?.schedulerActive
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-gray-100 text-gray-600'
                                }`}>
                                    {schedulerStatus?.schedulerActive ? 'Active' : 'Stopped'}
                                </span>
                            </div>

                            <div className="space-y-2 mb-4">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Interval:</span>
                                    <span className="font-medium">Every {schedulerStatus?.intervalMinutes || 60} minutes</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Lookback:</span>
                                    <span className="font-medium">{schedulerStatus?.lookbackHours || 24} hours</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Last Sync:</span>
                                    <span className="font-medium">
                                        {schedulerStatus?.lastSyncAt
                                            ? new Date(schedulerStatus.lastSyncAt).toLocaleTimeString()
                                            : 'Never'}
                                    </span>
                                </div>
                                {schedulerStatus?.isRunning && (
                                    <div className="flex items-center gap-2 text-blue-600 text-sm">
                                        <RefreshCw size={14} className="animate-spin" />
                                        <span>Sync in progress...</span>
                                    </div>
                                )}
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-2">
                                <button
                                    className="btn btn-primary flex-1 flex items-center justify-center gap-1"
                                    onClick={() => triggerSyncMutation.mutate()}
                                    disabled={triggerSyncMutation.isPending || schedulerStatus?.isRunning}
                                >
                                    <Zap size={14} />
                                    {triggerSyncMutation.isPending ? 'Triggering...' : 'Trigger Now'}
                                </button>
                                <button
                                    className={`btn ${schedulerStatus?.schedulerActive ? 'btn-secondary' : 'btn-primary'} flex items-center gap-1`}
                                    onClick={() => toggleSchedulerMutation.mutate(schedulerStatus?.schedulerActive ? 'stop' : 'start')}
                                    disabled={toggleSchedulerMutation.isPending}
                                >
                                    {schedulerStatus?.schedulerActive ? <Pause size={14} /> : <Play size={14} />}
                                    {schedulerStatus?.schedulerActive ? 'Stop' : 'Start'}
                                </button>
                            </div>
                        </div>

                        {/* Webhook Activity Summary */}
                        <div className="border rounded-lg p-4 bg-gradient-to-br from-blue-50 to-cyan-50">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="font-semibold text-blue-800 flex items-center gap-2">
                                    <Webhook size={18} /> Webhook Activity (24h)
                                </h3>
                                <button
                                    onClick={() => refetchWebhooks()}
                                    className="text-blue-600 hover:text-blue-800"
                                >
                                    <RefreshCw size={14} />
                                </button>
                            </div>

                            {webhookActivity && (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        <div className="bg-white rounded-lg p-2">
                                            <p className="text-lg font-bold text-gray-900">{webhookActivity.stats?.total || 0}</p>
                                            <p className="text-xs text-gray-500">Total</p>
                                        </div>
                                        <div className="bg-white rounded-lg p-2">
                                            <p className="text-lg font-bold text-green-600">{webhookActivity.stats?.success || 0}</p>
                                            <p className="text-xs text-gray-500">Success</p>
                                        </div>
                                        <div className="bg-white rounded-lg p-2">
                                            <p className="text-lg font-bold text-red-600">{webhookActivity.stats?.failed || 0}</p>
                                            <p className="text-xs text-gray-500">Failed</p>
                                        </div>
                                    </div>

                                    {/* Recent Webhooks */}
                                    {webhookActivity.recentLogs?.length > 0 && (
                                        <div className="mt-3">
                                            <p className="text-xs font-medium text-gray-600 mb-1">Recent Activity:</p>
                                            <div className="space-y-1 max-h-32 overflow-y-auto">
                                                {webhookActivity.recentLogs.slice(0, 5).map((log: AnyData) => (
                                                    <div
                                                        key={log.id}
                                                        className="flex items-center gap-2 text-xs bg-white rounded p-1.5 cursor-pointer hover:bg-gray-50"
                                                        onClick={() => toggleWebhookDetail(log.id)}
                                                    >
                                                        {expandedWebhookId === log.id ? (
                                                            <ChevronDown size={12} className="text-gray-400" />
                                                        ) : (
                                                            <ChevronRight size={12} className="text-gray-400" />
                                                        )}
                                                        <span className={`w-2 h-2 rounded-full ${log.processedSuccessfully ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                                        <span className="font-mono text-gray-700">{log.topic}</span>
                                                        <span className="text-gray-400 ml-auto">
                                                            {new Date(log.receivedAt).toLocaleTimeString()}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Expanded Webhook Detail */}
                    {expandedWebhookId && (
                        <div className="border rounded-lg p-4 bg-gray-50">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="font-medium text-gray-700 flex items-center gap-2">
                                    <FileJson size={16} /> Webhook Detail
                                </h4>
                                <button
                                    onClick={() => {
                                        setExpandedWebhookId(null);
                                        setWebhookDetail(null);
                                    }}
                                    className="text-gray-400 hover:text-gray-600"
                                >
                                    <XCircle size={16} />
                                </button>
                            </div>

                            {loadingWebhookDetail && (
                                <div className="flex items-center gap-2 text-gray-500">
                                    <RefreshCw size={14} className="animate-spin" />
                                    Loading...
                                </div>
                            )}

                            {webhookDetail && !loadingWebhookDetail && (
                                <div className="space-y-3">
                                    {webhookDetail.error ? (
                                        <p className="text-red-600">{webhookDetail.error}</p>
                                    ) : (
                                        <>
                                            <div className="grid grid-cols-2 gap-4 text-sm">
                                                <div>
                                                    <span className="text-gray-500">Topic:</span>
                                                    <span className="ml-2 font-mono">{webhookDetail.topic}</span>
                                                </div>
                                                <div>
                                                    <span className="text-gray-500">Order:</span>
                                                    <span className="ml-2">{webhookDetail.orderNumber || 'N/A'}</span>
                                                </div>
                                                <div>
                                                    <span className="text-gray-500">Received:</span>
                                                    <span className="ml-2">{new Date(webhookDetail.receivedAt).toLocaleString()}</span>
                                                </div>
                                                <div>
                                                    <span className="text-gray-500">Status:</span>
                                                    <span className={`ml-2 ${webhookDetail.processedSuccessfully ? 'text-green-600' : 'text-red-600'}`}>
                                                        {webhookDetail.processedSuccessfully ? 'Success' : 'Failed'}
                                                    </span>
                                                </div>
                                            </div>

                                            {webhookDetail.processingError && (
                                                <div className="p-2 bg-red-50 rounded text-sm text-red-700">
                                                    <span className="font-medium">Error:</span> {webhookDetail.processingError}
                                                </div>
                                            )}

                                            {webhookDetail.payload && (
                                                <div>
                                                    <p className="text-xs font-medium text-gray-600 mb-1">Payload:</p>
                                                    <JsonViewer data={webhookDetail.payload} rootName="payload" />
                                                </div>
                                            )}

                                            {webhookDetail.processingResult && (
                                                <div>
                                                    <p className="text-xs font-medium text-gray-600 mb-1">Processing Result:</p>
                                                    <JsonViewer data={webhookDetail.processingResult} rootName="result" />
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Background Sync Jobs */}
                    {syncJobs && syncJobs.length > 0 && (
                        <div className="mt-6">
                            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                <RefreshCw size={16} /> Background Sync Jobs
                            </h3>
                            <div className="space-y-2">
                                {syncJobs.map((job: SyncJobResult) => (
                                    <div key={job.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                                        <div className={`w-3 h-3 rounded-full ${
                                            job.status === 'running' ? 'bg-blue-500 animate-pulse' :
                                            job.status === 'completed' ? 'bg-green-500' :
                                            job.status === 'failed' ? 'bg-red-500' :
                                            'bg-gray-400'
                                        }`}></div>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-sm capitalize">{job.jobType}</span>
                                                <span className={`text-xs px-2 py-0.5 rounded ${
                                                    job.status === 'running' ? 'bg-blue-100 text-blue-700' :
                                                    job.status === 'completed' ? 'bg-green-100 text-green-700' :
                                                    job.status === 'failed' ? 'bg-red-100 text-red-700' :
                                                    'bg-gray-100 text-gray-700'
                                                }`}>
                                                    {job.status}
                                                </span>
                                                {job.progress !== undefined && job.status === 'running' && (
                                                    <span className="text-xs text-gray-500">{job.progress}%</span>
                                                )}
                                            </div>
                                            {job.startedAt && (
                                                <span className="text-xs text-gray-500">
                                                    Started: {new Date(job.startedAt).toLocaleString()}
                                                </span>
                                            )}
                                        </div>
                                        {job.status === 'running' && (
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => cancelJobMutation.mutate(job.id)}
                                                disabled={cancelJobMutation.isPending}
                                            >
                                                Cancel
                                            </button>
                                        )}
                                        {job.status === 'paused' && (
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={() => resumeJobMutation.mutate(job.id)}
                                                disabled={resumeJobMutation.isPending}
                                            >
                                                Resume
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Not Configured Message */}
            {!config?.hasAccessToken && (
                <div className="card">
                    <div className="flex items-center gap-3 text-yellow-700 bg-yellow-50 p-4 rounded-lg">
                        <AlertCircle size={24} />
                        <div>
                            <p className="font-medium">Shopify Not Configured</p>
                            <p className="text-sm">Please configure your Shopify credentials to enable sync features.</p>
                            <p className="text-xs mt-2 text-gray-600">
                                Set <code className="bg-gray-100 px-1 rounded">SHOPIFY_SHOP_DOMAIN</code> and{' '}
                                <code className="bg-gray-100 px-1 rounded">SHOPIFY_ACCESS_TOKEN</code> in your environment variables,
                                or use the database settings.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ShopifyTab;
