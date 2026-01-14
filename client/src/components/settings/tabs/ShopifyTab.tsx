/**
 * ShopifyTab component
 * Shopify integration configuration, sync controls, and webhook management
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shopifyApi } from '../../../services/api';
import JsonViewer from '../../JsonViewer';
import {
    Key, CheckCircle, XCircle, RefreshCw, ShoppingCart, Users, Eye, Play,
    AlertCircle, Package, Webhook, Copy, ExternalLink, Search, Database, Download,
    Activity, Clock, Zap, Pause
} from 'lucide-react';

export function ShopifyTab() {
    const queryClient = useQueryClient();

    // Config state
    const [shopDomain, setShopDomain] = useState('');
    const [accessToken, setAccessToken] = useState('');
    const [showToken, setShowToken] = useState(false);

    // Preview state
    const [productPreview, setProductPreview] = useState<any>(null);
    const [orderPreview, setOrderPreview] = useState<any>(null);
    const [customerPreview, setCustomerPreview] = useState<any>(null);
    const [copiedWebhook, setCopiedWebhook] = useState<string | null>(null);

    // Full dump state
    const [dumpDays, setDumpDays] = useState(30);

    // Order lookup state
    const [lookupOrderNumber, setLookupOrderNumber] = useState('');
    const [lookupResult, setLookupResult] = useState<any>(null);
    const [lookupError, setLookupError] = useState<string | null>(null);

    // Fetch current config
    const { data: config, isLoading: configLoading } = useQuery({
        queryKey: ['shopifyConfig'],
        queryFn: async () => {
            const res = await shopifyApi.getConfig();
            setShopDomain(res.data.shopDomain || '');
            return res.data;
        },
    });

    // Fetch sync history
    const { data: syncHistory } = useQuery({
        queryKey: ['shopifySyncHistory'],
        queryFn: () => shopifyApi.getSyncHistory().then(r => r.data),
    });

    // Cache status (orders)
    const { data: cacheStatus } = useQuery({
        queryKey: ['cacheStatus'],
        queryFn: () => shopifyApi.getCacheStatus().then(r => r.data),
        refetchInterval: 10000,
    });

    // Product cache status
    const { data: productCacheStatus } = useQuery({
        queryKey: ['productCacheStatus'],
        queryFn: () => shopifyApi.getProductCacheStatus().then(r => r.data),
        refetchInterval: 10000,
    });

    // Background sync jobs
    const { data: syncJobs, refetch: refetchJobs } = useQuery({
        queryKey: ['syncJobs'],
        queryFn: () => shopifyApi.getSyncJobs(10).then(r => r.data),
        refetchInterval: 3000,
    });

    // Scheduler status
    const { data: schedulerStatus, refetch: refetchScheduler } = useQuery({
        queryKey: ['schedulerStatus'],
        queryFn: () => shopifyApi.getSchedulerStatus().then(r => r.data),
        refetchInterval: 10000,
    });

    // Webhook activity
    const { data: webhookActivity, refetch: refetchWebhooks } = useQuery({
        queryKey: ['webhookActivity'],
        queryFn: () => shopifyApi.getWebhookActivity({ hours: 24, limit: 20 }).then(r => r.data),
        refetchInterval: 15000,
    });

    // Mutations
    const updateConfigMutation = useMutation({
        mutationFn: (data: { shopDomain: string; accessToken: string }) =>
            shopifyApi.updateConfig(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shopifyConfig'] });
            setAccessToken('');
            alert('Configuration saved successfully!');
        },
        onError: (error: any) => {
            alert(error.response?.data?.error || 'Failed to save configuration');
        },
    });

    const testConnectionMutation = useMutation({
        mutationFn: () => shopifyApi.testConnection(),
    });

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

    // Full dump mutation
    const fullDumpMutation = useMutation({
        mutationFn: (daysBack?: number) => shopifyApi.fullDump(daysBack),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['cacheStatus'] });
            queryClient.invalidateQueries({ queryKey: ['syncJobs'] });
        },
    });

    // Process cache mutation
    const processCacheMutation = useMutation({
        mutationFn: ({ limit, retryFailed }: { limit?: number; retryFailed?: boolean }) =>
            shopifyApi.processCache(limit, retryFailed),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['openOrders'] });
            queryClient.invalidateQueries({ queryKey: ['cacheStatus'] });
        },
    });

    // Lookup order mutation
    const lookupOrderMutation = useMutation({
        mutationFn: (orderNumber: string) => shopifyApi.lookupOrder(orderNumber),
        onSuccess: (res) => {
            setLookupResult(res.data);
            setLookupError(null);
        },
        onError: (error: any) => {
            setLookupResult(null);
            setLookupError(error.response?.data?.error || 'Order not found');
        },
    });

    const startJobMutation = useMutation({
        mutationFn: (params: {
            jobType: string;
            syncMode?: 'deep' | 'incremental';
            days?: number;
            staleAfterMins?: number;
        }) => shopifyApi.startSyncJob(params),
        onSuccess: () => refetchJobs(),
        onError: (error: any) => {
            alert(error.response?.data?.error || 'Failed to start sync job');
        },
    });

    const cancelJobMutation = useMutation({
        mutationFn: (jobId: string) => shopifyApi.cancelSyncJob(jobId),
        onSuccess: () => refetchJobs(),
    });

    const resumeJobMutation = useMutation({
        mutationFn: (jobId: string) => shopifyApi.resumeSyncJob(jobId),
        onSuccess: () => refetchJobs(),
    });

    // Scheduler mutations
    const triggerSyncMutation = useMutation({
        mutationFn: () => shopifyApi.triggerSchedulerSync(),
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

    const handleSaveConfig = () => {
        if (!shopDomain) {
            alert('Shop domain is required');
            return;
        }
        if (!accessToken && !config?.hasAccessToken) {
            alert('Access token is required');
            return;
        }
        updateConfigMutation.mutate({
            shopDomain,
            accessToken: accessToken || 'KEEP_EXISTING',
        });
    };

    if (configLoading) {
        return (
            <div className="flex justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Configuration Card */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Key size={20} /> Shopify API Configuration
                </h2>

                <div className="grid gap-4 max-w-xl">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Shop Domain
                        </label>
                        <input
                            type="text"
                            className="input"
                            placeholder="yourstore.myshopify.com"
                            value={shopDomain}
                            onChange={(e) => setShopDomain(e.target.value)}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Your store name or full domain (e.g., yourstore or yourstore.myshopify.com)
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Admin API Access Token
                        </label>
                        <div className="relative">
                            <input
                                type={showToken ? 'text' : 'password'}
                                className="input pr-20"
                                placeholder={config?.hasAccessToken ? '(token saved - enter new to change)' : 'shpat_xxxxx'}
                                value={accessToken}
                                onChange={(e) => setAccessToken(e.target.value)}
                            />
                            <button
                                type="button"
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-gray-500 hover:text-gray-700"
                                onClick={() => setShowToken(!showToken)}
                            >
                                {showToken ? 'Hide' : 'Show'}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            Create in Shopify Admin → Settings → Apps → Develop apps → Configure Admin API scopes
                        </p>
                    </div>

                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm font-medium text-blue-800 mb-1">Required API Scopes:</p>
                        <ul className="text-sm text-blue-700 list-disc list-inside">
                            <li><code className="bg-blue-100 px-1 rounded">read_products</code> - to import products</li>
                            <li><code className="bg-blue-100 px-1 rounded">read_orders</code> - to import orders</li>
                            <li><code className="bg-blue-100 px-1 rounded">read_customers</code> - to import customers</li>
                        </ul>
                    </div>

                    <div className="flex gap-2">
                        <button
                            className="btn btn-primary"
                            onClick={handleSaveConfig}
                            disabled={updateConfigMutation.isPending}
                        >
                            {updateConfigMutation.isPending ? 'Saving...' : 'Save Configuration'}
                        </button>
                        <button
                            className="btn btn-secondary"
                            onClick={() => testConnectionMutation.mutate()}
                            disabled={testConnectionMutation.isPending || !config?.hasAccessToken}
                        >
                            {testConnectionMutation.isPending ? (
                                <RefreshCw size={16} className="animate-spin" />
                            ) : (
                                'Test Connection'
                            )}
                        </button>
                    </div>

                    {/* Connection Test Result */}
                    {testConnectionMutation.data && (
                        <div className={`p-3 rounded-lg ${testConnectionMutation.data.data.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                            <div className="flex items-center gap-2">
                                {testConnectionMutation.data.data.success ? (
                                    <CheckCircle size={20} className="text-green-600" />
                                ) : (
                                    <XCircle size={20} className="text-red-600" />
                                )}
                                <span className={testConnectionMutation.data.data.success ? 'text-green-800' : 'text-red-800'}>
                                    {testConnectionMutation.data.data.message}
                                </span>
                            </div>
                            {testConnectionMutation.data.data.stats && (
                                <div className="mt-2 text-sm text-green-700">
                                    Orders: {testConnectionMutation.data.data.stats.totalOrders} | Customers: {testConnectionMutation.data.data.stats.totalCustomers}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

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
                                            {(fullDumpMutation.error as any)?.response?.data?.error || 'Full dump failed'}
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
                                                {processCacheMutation.data.data.errors.slice(0, 3).map((err: any, i: number) => (
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

                    {/* Order Lookup */}
                    <div className="border rounded-lg p-4 bg-gray-50">
                        <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                            <Search size={18} /> Order Lookup
                        </h3>
                        <p className="text-sm text-gray-600 mb-3">
                            Look up raw Shopify order data from cache by order number.
                        </p>

                        <div className="flex gap-2">
                            <input
                                type="text"
                                className="input flex-1"
                                placeholder="Enter order number (e.g., 63965)"
                                value={lookupOrderNumber}
                                onChange={(e) => setLookupOrderNumber(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && lookupOrderNumber) {
                                        lookupOrderMutation.mutate(lookupOrderNumber);
                                    }
                                }}
                            />
                            <button
                                className="btn btn-secondary flex items-center gap-2"
                                onClick={() => lookupOrderMutation.mutate(lookupOrderNumber)}
                                disabled={lookupOrderMutation.isPending || !lookupOrderNumber}
                            >
                                <Search size={16} />
                                {lookupOrderMutation.isPending ? 'Searching...' : 'Lookup'}
                            </button>
                        </div>

                        {lookupError && (
                            <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-center gap-2">
                                <XCircle size={16} />
                                {lookupError}
                            </div>
                        )}

                        {lookupResult && (
                            <div className="mt-3 border rounded-lg overflow-hidden bg-white">
                                <div className="bg-gray-100 px-3 py-2 text-sm font-medium flex justify-between items-center">
                                    <span>
                                        Order {lookupResult.orderNumber} | Status: {lookupResult.financialStatus} |
                                        {lookupResult.processedAt ? (
                                            <span className="text-green-600 ml-1">Processed</span>
                                        ) : (
                                            <span className="text-yellow-600 ml-1">Pending</span>
                                        )}
                                    </span>
                                    <button onClick={() => setLookupResult(null)} className="text-gray-400 hover:text-gray-600">
                                        <XCircle size={16} />
                                    </button>
                                </div>
                                <JsonViewer data={lookupResult.rawData} rootName="shopifyOrder" />
                            </div>
                        )}
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
                        Configure these webhooks in Shopify Admin to receive real-time updates. Go to{' '}
                        <span className="font-medium">Settings → Notifications → Webhooks</span>.
                    </p>

                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Your API Base URL</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                className="input flex-1 font-mono text-sm bg-gray-50"
                                value={window.location.origin + '/api/webhooks'}
                                readOnly
                            />
                            <button
                                className="btn btn-secondary flex items-center gap-1"
                                onClick={() => {
                                    navigator.clipboard.writeText(window.location.origin + '/api/webhooks');
                                    setCopiedWebhook('base');
                                    setTimeout(() => setCopiedWebhook(null), 2000);
                                }}
                            >
                                {copiedWebhook === 'base' ? <CheckCircle size={16} className="text-green-600" /> : <Copy size={16} />}
                            </button>
                        </div>
                    </div>

                    <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left font-medium text-gray-700">Shopify Topic</th>
                                    <th className="px-4 py-2 text-left font-medium text-gray-700">Endpoint URL</th>
                                    <th className="px-4 py-2 text-left font-medium text-gray-700">Description</th>
                                    <th className="px-4 py-2 w-12"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {[
                                    { topic: 'orders/create', path: '/shopify/orders', desc: 'New order placed', unified: true },
                                    { topic: 'orders/updated', path: '/shopify/orders', desc: 'Order modified', unified: true },
                                    { topic: 'orders/cancelled', path: '/shopify/orders', desc: 'Order cancelled', unified: true },
                                    { topic: 'orders/fulfilled', path: '/shopify/orders', desc: 'Order shipped/fulfilled', unified: true },
                                    { topic: 'products/create', path: '/shopify/products/create', desc: 'New product created' },
                                    { topic: 'products/update', path: '/shopify/products/update', desc: 'Product modified' },
                                    { topic: 'products/delete', path: '/shopify/products/delete', desc: 'Product deleted' },
                                    { topic: 'customers/create', path: '/shopify/customers/create', desc: 'New customer registered' },
                                    { topic: 'customers/update', path: '/shopify/customers/update', desc: 'Customer info updated' },
                                    { topic: 'inventory_levels/update', path: '/shopify/inventory_levels/update', desc: 'Inventory quantity changed' },
                                ].map((webhook) => (
                                    <tr key={webhook.topic} className="hover:bg-gray-50">
                                        <td className="px-4 py-2">
                                            <div className="flex items-center gap-2">
                                                <code className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs">
                                                    {webhook.topic}
                                                </code>
                                                {webhook.unified && (
                                                    <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs font-medium">
                                                        Unified
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-2">
                                            <code className="text-xs text-gray-600 font-mono">
                                                {window.location.origin}/api/webhooks{webhook.path}
                                            </code>
                                        </td>
                                        <td className="px-4 py-2 text-gray-600">{webhook.desc}</td>
                                        <td className="px-4 py-2">
                                            <button
                                                className="p-1 hover:bg-gray-100 rounded"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(window.location.origin + '/api/webhooks' + webhook.path);
                                                    setCopiedWebhook(webhook.topic);
                                                    setTimeout(() => setCopiedWebhook(null), 2000);
                                                }}
                                                title="Copy URL"
                                            >
                                                {copiedWebhook === webhook.topic ? (
                                                    <CheckCircle size={14} className="text-green-600" />
                                                ) : (
                                                    <Copy size={14} className="text-gray-400" />
                                                )}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm font-medium text-blue-800 mb-2">Setup Instructions:</p>
                        <ol className="text-sm text-blue-700 list-decimal list-inside space-y-1">
                            <li>Go to Shopify Admin → Settings → Notifications → Webhooks</li>
                            <li>Click "Create webhook"</li>
                            <li>Select the event (e.g., "Order creation")</li>
                            <li>Paste the corresponding URL from the table above</li>
                            <li>Set format to JSON</li>
                            <li>Save the webhook</li>
                        </ol>
                        <div className="mt-3 p-3 bg-white border border-blue-300 rounded">
                            <p className="text-sm font-medium text-blue-800 mb-1">Order Webhooks (Unified Endpoint):</p>
                            <p className="text-xs text-blue-700">
                                All order-related webhooks (create, updated, cancelled, fulfilled) use the same endpoint: <code className="bg-blue-100 px-1 rounded">/shopify/orders</code>.
                                The endpoint automatically detects the event type from the X-Shopify-Topic header.
                            </p>
                        </div>
                        <p className="text-sm text-blue-600 mt-3">
                            <strong>Note:</strong> Webhooks require your server to be publicly accessible (not localhost).
                        </p>
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

                            {/* Last Sync Result */}
                            {schedulerStatus?.lastSyncResult && (
                                <div className="bg-white rounded-lg p-3 mb-4 text-sm">
                                    <div className="font-medium text-gray-700 mb-2">Last Sync Result</div>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div>
                                            <span className="text-gray-500">Fetched:</span>{' '}
                                            <span className="font-medium">{schedulerStatus.lastSyncResult.step1_dump?.fetched || 0}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Cached:</span>{' '}
                                            <span className="font-medium text-green-600">{schedulerStatus.lastSyncResult.step1_dump?.cached || 0}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Processed:</span>{' '}
                                            <span className="font-medium">{schedulerStatus.lastSyncResult.step2_process?.processed || 0}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Duration:</span>{' '}
                                            <span className="font-medium">{Math.round((schedulerStatus.lastSyncResult.durationMs || 0) / 1000)}s</span>
                                        </div>
                                    </div>
                                    {schedulerStatus.lastSyncResult.error && (
                                        <div className="mt-2 text-red-600 text-xs">
                                            Error: {schedulerStatus.lastSyncResult.error}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="flex gap-2">
                                <button
                                    className="btn btn-primary btn-sm flex-1 flex items-center justify-center gap-1"
                                    onClick={() => triggerSyncMutation.mutate()}
                                    disabled={triggerSyncMutation.isPending || schedulerStatus?.isRunning}
                                >
                                    {triggerSyncMutation.isPending || schedulerStatus?.isRunning ? (
                                        <RefreshCw size={14} className="animate-spin" />
                                    ) : (
                                        <Zap size={14} />
                                    )}
                                    Sync Now
                                </button>
                                <button
                                    className={`btn btn-sm flex items-center gap-1 ${
                                        schedulerStatus?.schedulerActive
                                            ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                                    }`}
                                    onClick={() => toggleSchedulerMutation.mutate(
                                        schedulerStatus?.schedulerActive ? 'stop' : 'start'
                                    )}
                                    disabled={toggleSchedulerMutation.isPending}
                                >
                                    {schedulerStatus?.schedulerActive ? (
                                        <>
                                            <Pause size={14} />
                                            Stop
                                        </>
                                    ) : (
                                        <>
                                            <Play size={14} />
                                            Start
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Webhook Activity Summary */}
                        <div className="border rounded-lg p-4 bg-gradient-to-br from-green-50 to-emerald-50">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="font-semibold text-green-800 flex items-center gap-2">
                                    <Webhook size={18} /> Webhook Activity (24h)
                                </h3>
                                <button
                                    className="text-green-600 hover:text-green-800"
                                    onClick={() => refetchWebhooks()}
                                    title="Refresh"
                                >
                                    <RefreshCw size={16} />
                                </button>
                            </div>

                            {webhookActivity && (
                                <>
                                    {/* Summary Stats */}
                                    <div className="grid grid-cols-3 gap-2 mb-4">
                                        <div className="bg-white rounded-lg p-2 text-center">
                                            <p className="text-xl font-bold text-gray-900">
                                                {(webhookActivity.summary?.processed || 0) + (webhookActivity.summary?.failed || 0)}
                                            </p>
                                            <p className="text-xs text-gray-500">Total</p>
                                        </div>
                                        <div className="bg-white rounded-lg p-2 text-center">
                                            <p className="text-xl font-bold text-green-600">{webhookActivity.summary?.processed || 0}</p>
                                            <p className="text-xs text-gray-500">Processed</p>
                                        </div>
                                        <div className="bg-white rounded-lg p-2 text-center">
                                            <p className="text-xl font-bold text-red-600">{webhookActivity.summary?.failed || 0}</p>
                                            <p className="text-xs text-gray-500">Failed</p>
                                        </div>
                                    </div>

                                    {/* By Topic */}
                                    {webhookActivity.byTopic && Object.keys(webhookActivity.byTopic).length > 0 && (
                                        <div className="bg-white rounded-lg p-3 mb-4">
                                            <div className="font-medium text-gray-700 mb-2 text-sm">By Topic</div>
                                            <div className="space-y-1">
                                                {Object.entries(webhookActivity.byTopic).map(([topic, count]) => (
                                                    <div key={topic} className="flex justify-between text-xs">
                                                        <code className="text-purple-600">{topic}</code>
                                                        <span className="font-medium">{count as number}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Status Indicator */}
                                    <div className={`flex items-center gap-2 text-sm ${
                                        (webhookActivity.summary?.failed || 0) > 0 ? 'text-yellow-700' : 'text-green-700'
                                    }`}>
                                        {(webhookActivity.summary?.failed || 0) > 0 ? (
                                            <>
                                                <AlertCircle size={16} />
                                                <span>{webhookActivity.summary?.failed} webhooks failed - check logs</span>
                                            </>
                                        ) : (
                                            <>
                                                <CheckCircle size={16} />
                                                <span>All webhooks processed successfully</span>
                                            </>
                                        )}
                                    </div>
                                </>
                            )}

                            {!webhookActivity && (
                                <div className="text-center text-gray-500 py-4">
                                    <Activity size={24} className="mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">Loading webhook activity...</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Recent Webhook Logs */}
                    {webhookActivity?.recentLogs && webhookActivity.recentLogs.length > 0 && (
                        <div>
                            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                <Activity size={16} /> Recent Webhooks
                            </h3>
                            <div className="overflow-x-auto border rounded-lg">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-medium text-gray-600">Time</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-600">Topic</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-600">Resource ID</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-600">Duration</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {webhookActivity.recentLogs.slice(0, 10).map((log: any) => (
                                            <tr key={log.id} className="hover:bg-gray-50">
                                                <td className="px-3 py-2 text-xs text-gray-500">
                                                    {new Date(log.receivedAt).toLocaleTimeString()}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <code className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-xs">
                                                        {log.topic}
                                                    </code>
                                                </td>
                                                <td className="px-3 py-2 text-xs text-gray-600 font-mono">
                                                    {log.resourceId?.slice(-8) || '-'}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                                                        log.status === 'processed'
                                                            ? 'bg-green-100 text-green-700'
                                                            : log.status === 'failed'
                                                            ? 'bg-red-100 text-red-700'
                                                            : 'bg-yellow-100 text-yellow-700'
                                                    }`}>
                                                        {log.status}
                                                    </span>
                                                    {log.error && (
                                                        <span className="ml-1 text-red-500" title={log.error}>⚠</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-gray-500">
                                                    {log.processingTimeMs ? `${log.processingTimeMs}ms` : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {webhookActivity?.recentLogs?.length === 0 && (
                        <div className="text-center py-6 bg-gray-50 rounded-lg">
                            <Webhook size={32} className="mx-auto mb-2 text-gray-300" />
                            <p className="text-gray-500 text-sm">No webhook activity in the last 24 hours</p>
                            <p className="text-gray-400 text-xs mt-1">Configure webhooks in Shopify to receive real-time updates</p>
                        </div>
                    )}
                </div>
            )}

            {/* Background Sync Jobs */}
            {config?.hasAccessToken && (
                <div className="card">
                    <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <RefreshCw size={20} /> Sync Job History
                    </h2>
                    <p className="text-sm text-gray-600 mb-4">
                        Background sync jobs with automatic checkpointing. Failed jobs can be resumed.
                    </p>

                    {syncJobs && syncJobs.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-100">
                                    <tr>
                                        <th className="px-3 py-2 text-left">Type</th>
                                        <th className="px-3 py-2 text-left">Mode</th>
                                        <th className="px-3 py-2 text-left">Status</th>
                                        <th className="px-3 py-2 text-left">Progress</th>
                                        <th className="px-3 py-2 text-left">Started</th>
                                        <th className="px-3 py-2 text-left">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {syncJobs.map((job: any) => {
                                        const progress = job.totalRecords
                                            ? Math.round((job.processed / job.totalRecords) * 100)
                                            : 0;
                                        return (
                                            <tr key={job.id} className="hover:bg-gray-50">
                                                <td className="px-3 py-2 capitalize font-medium">{job.jobType}</td>
                                                <td className="px-3 py-2">
                                                    {job.syncMode ? (
                                                        <span className={`px-2 py-0.5 rounded text-xs ${
                                                            job.syncMode === 'deep' ? 'bg-amber-100 text-amber-700' :
                                                            'bg-blue-100 text-blue-700'
                                                        }`}>
                                                            {job.syncMode === 'deep' ? 'deep' : 'incremental'}
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">incremental</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                                                        job.status === 'completed' ? 'bg-green-100 text-green-700' :
                                                        job.status === 'running' ? 'bg-blue-100 text-blue-700' :
                                                        job.status === 'failed' ? 'bg-red-100 text-red-700' :
                                                        job.status === 'cancelled' ? 'bg-gray-100 text-gray-700' :
                                                        'bg-yellow-100 text-yellow-700'
                                                    }`}>
                                                        {job.status}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full transition-all ${
                                                                    job.status === 'completed' ? 'bg-green-500' :
                                                                    job.status === 'failed' ? 'bg-red-500' :
                                                                    'bg-blue-500'
                                                                }`}
                                                                style={{ width: `${progress}%` }}
                                                            />
                                                        </div>
                                                        <span className="text-xs text-gray-600 whitespace-nowrap">
                                                            {job.processed}/{job.totalRecords || '?'}
                                                            {job.status !== 'pending' && (
                                                                <span className="text-gray-400 ml-1">
                                                                    (+{job.created} / ~{job.updated} / !{job.errors})
                                                                </span>
                                                            )}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 text-xs text-gray-500">
                                                    {job.startedAt ? new Date(job.startedAt).toLocaleString() : '-'}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {(job.status === 'running' || job.status === 'pending') && (
                                                        <button
                                                            className="text-red-600 hover:text-red-800 text-xs"
                                                            onClick={() => cancelJobMutation.mutate(job.id)}
                                                        >
                                                            Cancel
                                                        </button>
                                                    )}
                                                    {(job.status === 'failed' || job.status === 'cancelled') && (
                                                        <button
                                                            className="text-blue-600 hover:text-blue-800 text-xs"
                                                            onClick={() => resumeJobMutation.mutate(job.id)}
                                                        >
                                                            Resume
                                                        </button>
                                                    )}
                                                    {job.lastError && (
                                                        <span className="text-xs text-red-500 ml-2" title={job.lastError}>
                                                            ⚠
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {(!syncJobs || syncJobs.length === 0) && (
                        <p className="text-gray-500 text-sm text-center py-4">
                            No sync jobs yet. Use the Order Sync section above to start syncing.
                        </p>
                    )}

                    {syncJobs && syncJobs.length > 0 && (
                        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                            <strong>Legend:</strong> Progress shows (processed/total) with (+created / ~updated / !errors)
                        </div>
                    )}
                </div>
            )}

            {/* Warning if not configured */}
            {!config?.hasAccessToken && (
                <div className="flex items-center gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <AlertCircle size={20} className="text-yellow-600" />
                    <p className="text-yellow-800">
                        Configure your Shopify API credentials above to enable order and customer sync.
                    </p>
                </div>
            )}
        </div>
    );
}

export default ShopifyTab;
