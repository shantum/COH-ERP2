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
    AlertCircle, Package, Webhook, Copy, ExternalLink
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
    const [syncLimit, setSyncLimit] = useState(20);
    const [syncDays, setSyncDays] = useState(90);
    const [copiedWebhook, setCopiedWebhook] = useState<string | null>(null);

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

    // Cache status
    const { data: cacheStatus } = useQuery({
        queryKey: ['cacheStatus'],
        queryFn: () => shopifyApi.getCacheStatus().then(r => r.data),
        refetchInterval: 10000,
    });

    // Background sync jobs
    const { data: syncJobs, refetch: refetchJobs } = useQuery({
        queryKey: ['syncJobs'],
        queryFn: () => shopifyApi.getSyncJobs(10).then(r => r.data),
        refetchInterval: 3000,
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
        },
    });

    const backfillFromCacheMutation = useMutation({
        mutationFn: () => shopifyApi.backfillFromCache(),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['openOrders'] });
            queryClient.invalidateQueries({ queryKey: ['cacheStatus'] });
        },
    });

    const reprocessCacheMutation = useMutation({
        mutationFn: () => shopifyApi.reprocessCache(),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['cacheStatus'] });
        },
    });

    const startJobMutation = useMutation({
        mutationFn: ({ jobType, days }: { jobType: string; days: number }) =>
            shopifyApi.startSyncJob(jobType, days),
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

                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700">Sync limit:</label>
                        <select
                            className="input w-24"
                            value={syncLimit}
                            onChange={(e) => setSyncLimit(Number(e.target.value))}
                        >
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                            <option value={250}>250</option>
                        </select>
                        <span className="text-sm text-gray-500">records per sync</span>
                    </div>
                </div>
            )}

            {/* Products Sync */}
            {config?.hasAccessToken && (
                <div className="card border-2 border-primary-200 bg-primary-50/30">
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                        <Package size={18} /> Products & SKUs
                        <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">Sync First</span>
                    </h3>
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
                            onClick={() => syncProductsMutation.mutate({ limit: syncLimit })}
                            disabled={syncProductsMutation.isPending}
                        >
                            <Play size={16} />
                            {syncProductsMutation.isPending ? 'Syncing...' : `Sync ${syncLimit} Products`}
                        </button>
                        <button
                            className="btn bg-primary-700 text-white hover:bg-primary-800 flex items-center gap-2"
                            onClick={() => {
                                if (confirm('This will sync ALL products from Shopify. This may take a while. Continue?')) {
                                    syncProductsMutation.mutate({ syncAll: true });
                                }
                            }}
                            disabled={syncProductsMutation.isPending}
                        >
                            <RefreshCw size={16} />
                            {syncProductsMutation.isPending ? 'Syncing...' : 'Sync All Products'}
                        </button>
                    </div>

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

            {/* Orders & Customers */}
            {config?.hasAccessToken && (
                <div className="grid md:grid-cols-2 gap-6">
                    {/* Orders */}
                    <div className="card">
                        <h3 className="font-semibold mb-3 flex items-center gap-2">
                            <ShoppingCart size={18} /> Orders
                        </h3>

                        <div className="flex flex-wrap items-center gap-2 mb-4">
                            <button
                                className="btn btn-secondary flex items-center gap-2"
                                onClick={() => previewOrdersMutation.mutate()}
                                disabled={previewOrdersMutation.isPending}
                            >
                                <Eye size={16} />
                                {previewOrdersMutation.isPending ? 'Loading...' : 'Preview'}
                            </button>
                            <button
                                className="btn btn-primary flex items-center gap-2"
                                onClick={() => startJobMutation.mutate({ jobType: 'orders', days: syncDays })}
                                disabled={startJobMutation.isPending}
                            >
                                <Play size={16} />
                                {startJobMutation.isPending ? 'Starting...' : 'Sync Orders'}
                            </button>
                            <select
                                value={syncDays}
                                onChange={(e) => setSyncDays(Number(e.target.value))}
                                className="input py-1.5 text-sm w-32"
                            >
                                <option value={30}>Last 30 days</option>
                                <option value={60}>Last 60 days</option>
                                <option value={90}>Last 90 days</option>
                                <option value={180}>Last 6 months</option>
                                <option value={365}>Last year</option>
                            </select>
                        </div>

                        {/* Cache Status */}
                        {cacheStatus && (
                            <div className="mb-4 p-3 bg-gray-50 rounded-lg flex flex-wrap items-center gap-3 text-sm">
                                <span className="font-medium text-gray-700">Cache:</span>
                                <span className="text-gray-600">{cacheStatus.totalCached || 0} orders</span>
                                {(cacheStatus.failed || 0) > 0 && (
                                    <span className="text-red-600">{cacheStatus.failed} failed</span>
                                )}
                                {(cacheStatus.pending || 0) > 0 && (
                                    <span className="text-yellow-600">{cacheStatus.pending} pending</span>
                                )}
                                {(cacheStatus.failed || 0) > 0 && (
                                    <button
                                        className="btn btn-sm bg-orange-500 text-white hover:bg-orange-600 flex items-center gap-1"
                                        onClick={() => reprocessCacheMutation.mutate()}
                                        disabled={reprocessCacheMutation.isPending}
                                    >
                                        <RefreshCw size={14} className={reprocessCacheMutation.isPending ? 'animate-spin' : ''} />
                                        Retry Failed
                                    </button>
                                )}
                            </div>
                        )}

                        {backfillFromCacheMutation.data && (
                            <div className="mb-4 p-3 rounded-lg text-sm bg-purple-50 border border-purple-200">
                                <p className="font-medium text-purple-800">
                                    {backfillFromCacheMutation.data?.data.message}
                                </p>
                                <p className="text-purple-700">
                                    Updated: {backfillFromCacheMutation.data?.data.results?.updated || 0} of {backfillFromCacheMutation.data?.data.results?.total || 0} orders
                                </p>
                            </div>
                        )}

                        {reprocessCacheMutation.data && (
                            <div className="mb-4 p-3 rounded-lg text-sm bg-green-50 border border-green-200">
                                <p className="font-medium text-green-800">
                                    Reprocessed {reprocessCacheMutation.data?.data?.processed || 0} orders
                                </p>
                                <p className="text-green-700">
                                    Succeeded: {reprocessCacheMutation.data?.data?.succeeded || 0},
                                    Failed: {reprocessCacheMutation.data?.data?.failed || 0}
                                </p>
                            </div>
                        )}

                        {orderPreview && (
                            <div className="border rounded-lg overflow-hidden">
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

                    {/* Customers */}
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
                                    { topic: 'orders/create', path: '/shopify/orders/create', desc: 'New order placed' },
                                    { topic: 'orders/updated', path: '/shopify/orders/updated', desc: 'Order modified' },
                                    { topic: 'orders/cancelled', path: '/shopify/orders/cancelled', desc: 'Order cancelled' },
                                    { topic: 'orders/fulfilled', path: '/shopify/orders/fulfilled', desc: 'Order shipped/fulfilled' },
                                    { topic: 'customers/create', path: '/shopify/customers/create', desc: 'New customer registered' },
                                    { topic: 'customers/update', path: '/shopify/customers/update', desc: 'Customer info updated' },
                                    { topic: 'inventory_levels/update', path: '/shopify/inventory_levels/update', desc: 'Inventory quantity changed' },
                                ].map((webhook) => (
                                    <tr key={webhook.topic} className="hover:bg-gray-50">
                                        <td className="px-4 py-2">
                                            <code className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs">
                                                {webhook.topic}
                                            </code>
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

            {/* Background Sync Jobs */}
            {config?.hasAccessToken && (
                <div className="card">
                    <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <RefreshCw size={20} /> Background Sync Jobs
                    </h2>
                    <p className="text-sm text-gray-600 mb-4">
                        Start background sync jobs that process data in batches with automatic checkpointing.
                        Jobs can be resumed if interrupted.
                    </p>

                    <div className="flex flex-wrap items-center gap-3 mb-6 p-4 bg-gray-50 rounded-lg">
                        <span className="text-sm font-medium text-gray-700">Start new sync:</span>
                        <select
                            className="input w-36"
                            value={syncDays}
                            onChange={(e) => setSyncDays(Number(e.target.value))}
                        >
                            <option value={30}>Last 30 days</option>
                            <option value={60}>Last 60 days</option>
                            <option value={90}>Last 90 days</option>
                            <option value={180}>Last 6 months</option>
                            <option value={365}>Last year</option>
                            <option value={730}>Last 2 years</option>
                            <option value={9999}>All time</option>
                        </select>
                        <button
                            className="btn btn-primary flex items-center gap-2"
                            onClick={() => startJobMutation.mutate({ jobType: 'orders', days: syncDays })}
                            disabled={startJobMutation.isPending}
                        >
                            <ShoppingCart size={16} />
                            Sync Orders
                        </button>
                        <button
                            className="btn btn-secondary flex items-center gap-2"
                            onClick={() => startJobMutation.mutate({ jobType: 'customers', days: syncDays })}
                            disabled={startJobMutation.isPending}
                        >
                            <Users size={16} />
                            Sync Customers
                        </button>
                        <button
                            className="btn btn-secondary flex items-center gap-2"
                            onClick={() => startJobMutation.mutate({ jobType: 'products', days: syncDays })}
                            disabled={startJobMutation.isPending}
                        >
                            <Package size={16} />
                            Sync Products
                        </button>
                    </div>

                    {syncJobs && syncJobs.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-100">
                                    <tr>
                                        <th className="px-3 py-2 text-left">Type</th>
                                        <th className="px-3 py-2 text-left">Status</th>
                                        <th className="px-3 py-2 text-left">Progress</th>
                                        <th className="px-3 py-2 text-left">Created/Updated</th>
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
                                                        <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
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
                                                    {new Date(job.createdAt).toLocaleString()}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-gray-500">
                                                    {job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : '-'}
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
                            No sync jobs yet. Start one above.
                        </p>
                    )}

                    <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                        <strong>Legend:</strong> Progress shows (processed/total) with (+created / ~updated / !errors)
                    </div>
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
