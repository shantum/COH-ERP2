import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shopifyApi, importExportApi, adminApi, authApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import JsonViewer from '../components/JsonViewer';
import {
    Store, Key, CheckCircle, XCircle, RefreshCw, Download, Upload,
    ShoppingCart, Users, Eye, Play, AlertCircle, FileSpreadsheet, Package,
    Trash2, AlertOctagon, Database, Settings as SettingsIcon, Plus, X,
    Lock, UserPlus, Edit2, Shield, Webhook, Copy, ExternalLink
} from 'lucide-react';

export default function Settings() {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<'general' | 'shopify' | 'importExport' | 'database'>('general');

    // Shopify config state
    const [shopDomain, setShopDomain] = useState('');
    const [accessToken, setAccessToken] = useState('');
    const [showToken, setShowToken] = useState(false);

    // Preview state
    const [productPreview, setProductPreview] = useState<any>(null);
    const [orderPreview, setOrderPreview] = useState<any>(null);
    const [customerPreview, setCustomerPreview] = useState<any>(null);
    const [syncLimit, setSyncLimit] = useState(20);
    const [copiedWebhook, setCopiedWebhook] = useState<string | null>(null);

    // Import state
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importType, setImportType] = useState<'products' | 'fabrics'>('products');
    const [importResult, setImportResult] = useState<any>(null);

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

    // Update config mutation
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

    // Test connection mutation
    const testConnectionMutation = useMutation({
        mutationFn: () => shopifyApi.testConnection(),
    });

    // Preview mutations
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

    // Product sync mutation
    const syncProductsMutation = useMutation({
        mutationFn: (params: { limit?: number; syncAll?: boolean }) => shopifyApi.syncProducts(params),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shopifySyncHistory'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
        },
    });

    // Sync mutations
    const syncOrdersMutation = useMutation({
        mutationFn: (params: { limit: number; skipSkuMatching: boolean }) =>
            shopifyApi.syncOrders({ limit: params.limit, skipSkuMatching: params.skipSkuMatching }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shopifySyncHistory'] });
        },
    });

    const syncCustomersMutation = useMutation({
        mutationFn: (limit: number) => shopifyApi.syncCustomers({ limit }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shopifySyncHistory'] });
        },
    });

    // Bulk sync mutations
    const syncAllOrdersMutation = useMutation({
        mutationFn: () => shopifyApi.syncAllOrders(),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shopifySyncHistory'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
        },
    });

    const syncAllCustomersMutation = useMutation({
        mutationFn: () => shopifyApi.syncAllCustomers(),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shopifySyncHistory'] });
            queryClient.invalidateQueries({ queryKey: ['customers'] });
        },
    });

    // Import mutation
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
        onError: (error: any) => {
            alert(error.response?.data?.error || 'Import failed');
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
        } catch (error) {
            alert('Export failed');
        }
    };

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
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

            {/* Tabs */}
            <div className="flex gap-2 border-b">
                <button
                    className={`px-4 py-2 font-medium flex items-center gap-2 ${activeTab === 'general' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setActiveTab('general')}
                >
                    <SettingsIcon size={18} /> General
                </button>
                <button
                    className={`px-4 py-2 font-medium flex items-center gap-2 ${activeTab === 'shopify' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setActiveTab('shopify')}
                >
                    <Store size={18} /> Shopify Integration
                </button>
                <button
                    className={`px-4 py-2 font-medium flex items-center gap-2 ${activeTab === 'importExport' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setActiveTab('importExport')}
                >
                    <FileSpreadsheet size={18} /> CSV Import/Export
                </button>
                <button
                    className={`px-4 py-2 font-medium flex items-center gap-2 ${activeTab === 'database' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setActiveTab('database')}
                >
                    <Database size={18} /> Database
                </button>
            </div>

            {/* General Tab */}
            {activeTab === 'general' && (
                <GeneralTab queryClient={queryClient} />
            )}

            {/* Shopify Tab */}
            {activeTab === 'shopify' && (
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

                    {/* Products Sync - Important: Sync first! */}
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

                            {/* Product Preview - Raw Data */}
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

                            {/* Sync result */}
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

                    {/* Preview & Sync Cards */}
                    {config?.hasAccessToken && (
                        <div className="grid md:grid-cols-2 gap-6">
                            {/* Orders */}
                            <div className="card">
                                <h3 className="font-semibold mb-3 flex items-center gap-2">
                                    <ShoppingCart size={18} /> Orders
                                </h3>

                                <div className="flex flex-wrap gap-2 mb-4">
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
                                        onClick={() => syncOrdersMutation.mutate({ limit: syncLimit, skipSkuMatching: false })}
                                        disabled={syncOrdersMutation.isPending || syncAllOrdersMutation.isPending}
                                    >
                                        <Play size={16} />
                                        {syncOrdersMutation.isPending ? 'Syncing...' : `Sync ${syncLimit} Orders`}
                                    </button>
                                    <button
                                        className="btn bg-blue-700 text-white hover:bg-blue-800 flex items-center gap-2"
                                        onClick={() => {
                                            if (confirm('This will sync ALL orders from Shopify. This may take several minutes for large datasets. Continue?')) {
                                                syncAllOrdersMutation.mutate();
                                            }
                                        }}
                                        disabled={syncOrdersMutation.isPending || syncAllOrdersMutation.isPending}
                                    >
                                        <RefreshCw size={16} className={syncAllOrdersMutation.isPending ? 'animate-spin' : ''} />
                                        {syncAllOrdersMutation.isPending ? 'Syncing All...' : 'Sync All Orders'}
                                    </button>
                                </div>

                                {/* Order Preview - Raw Data */}
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

                                {/* Sync result */}
                                {syncOrdersMutation.data && (
                                    <div className={`mt-3 p-3 rounded-lg text-sm ${syncOrdersMutation.data.data.results?.errors?.length > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
                                        <p className={`font-medium ${syncOrdersMutation.data.data.results?.errors?.length > 0 ? 'text-yellow-800' : 'text-green-800'}`}>
                                            Sync completed! (Fetched: {syncOrdersMutation.data.data.fetched})
                                        </p>
                                        <p className="text-green-700">
                                            Created: {syncOrdersMutation.data.data.results?.created?.orders || 0} orders,{' '}
                                            Updated: {syncOrdersMutation.data.data.results?.updated || 0},
                                            Skipped: {syncOrdersMutation.data.data.results?.skipped || 0}
                                        </p>
                                        {syncOrdersMutation.data.data.results?.errors?.length > 0 && (
                                            <div className="mt-2 text-yellow-700">
                                                <p className="font-medium">Skipped reasons:</p>
                                                <ul className="list-disc list-inside text-xs max-h-24 overflow-y-auto">
                                                    {syncOrdersMutation.data.data.results.errors.slice(0, 5).map((err: string, i: number) => (
                                                        <li key={i}>{err}</li>
                                                    ))}
                                                    {syncOrdersMutation.data.data.results.errors.length > 5 && (
                                                        <li>...and {syncOrdersMutation.data.data.results.errors.length - 5} more</li>
                                                    )}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Bulk sync result */}
                                {syncAllOrdersMutation.data && (
                                    <div className={`mt-3 p-3 rounded-lg text-sm ${syncAllOrdersMutation.data.data.results?.errors?.length > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
                                        <p className="font-medium text-green-800">
                                            Bulk sync completed! (Total in Shopify: {syncAllOrdersMutation.data.data.totalInShopify}, Fetched: {syncAllOrdersMutation.data.data.results?.totalFetched || 0})
                                        </p>
                                        <p className="text-green-700">
                                            Created: {syncAllOrdersMutation.data.data.results?.created?.orders || 0} orders, {syncAllOrdersMutation.data.data.results?.created?.customers || 0} customers |{' '}
                                            Updated: {syncAllOrdersMutation.data.data.results?.updated || 0} |
                                            Skipped: {syncAllOrdersMutation.data.data.results?.skipped || 0}
                                        </p>
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
                                        onClick={() => syncCustomersMutation.mutate(syncLimit)}
                                        disabled={syncCustomersMutation.isPending || syncAllCustomersMutation.isPending}
                                    >
                                        <Play size={16} />
                                        {syncCustomersMutation.isPending ? 'Syncing...' : `Sync ${syncLimit} Customers`}
                                    </button>
                                    <button
                                        className="btn bg-blue-700 text-white hover:bg-blue-800 flex items-center gap-2"
                                        onClick={() => {
                                            if (confirm('This will sync ALL customers from Shopify (only those with at least 1 order). This may take several minutes for large datasets. Continue?')) {
                                                syncAllCustomersMutation.mutate();
                                            }
                                        }}
                                        disabled={syncCustomersMutation.isPending || syncAllCustomersMutation.isPending}
                                    >
                                        <RefreshCw size={16} className={syncAllCustomersMutation.isPending ? 'animate-spin' : ''} />
                                        {syncAllCustomersMutation.isPending ? 'Syncing All...' : 'Sync All Customers'}
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 mb-3">
                                    Only customers with at least 1 order are synced.
                                </p>

                                {/* Customer Preview - Raw Data */}
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

                                {/* Sync result */}
                                {syncCustomersMutation.data && (
                                    <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
                                        <p className="font-medium text-green-800">Sync completed!</p>
                                        <p className="text-green-700">
                                            Created: {syncCustomersMutation.data.data.results?.created || 0},{' '}
                                            Updated: {syncCustomersMutation.data.data.results?.updated || 0}
                                            {syncCustomersMutation.data.data.results?.skippedNoOrders > 0 && (
                                                <span className="text-gray-500"> | Skipped (no orders): {syncCustomersMutation.data.data.results.skippedNoOrders}</span>
                                            )}
                                        </p>
                                    </div>
                                )}

                                {/* Bulk sync result */}
                                {syncAllCustomersMutation.data && (
                                    <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
                                        <p className="font-medium text-green-800">
                                            Bulk sync completed! (Total in Shopify: {syncAllCustomersMutation.data.data.totalInShopify}, Fetched: {syncAllCustomersMutation.data.data.results?.totalFetched || 0})
                                        </p>
                                        <p className="text-green-700">
                                            Created: {syncAllCustomersMutation.data.data.results?.created || 0},{' '}
                                            Updated: {syncAllCustomersMutation.data.data.results?.updated || 0}
                                            {syncAllCustomersMutation.data.data.results?.skippedNoOrders > 0 && (
                                                <span className="text-gray-500"> | Skipped (no orders): {syncAllCustomersMutation.data.data.results.skippedNoOrders}</span>
                                            )}
                                        </p>
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

                            {/* Base URL */}
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
                                <p className="text-xs text-gray-500 mt-1">
                                    Use this as the base URL. Add the endpoint path for each webhook topic.
                                </p>
                            </div>

                            {/* Webhook Endpoints Table */}
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

                            {/* Setup Instructions */}
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

                            {/* Link to Shopify */}
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
            )}

            {/* Import/Export Tab */}
            {activeTab === 'importExport' && (
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
                                        {importResult.results?.skipped > 0 && (
                                            <p className="text-yellow-700">Skipped: {importResult.results.skipped}</p>
                                        )}
                                        {importResult.results?.errors?.length > 0 && (
                                            <div className="mt-2">
                                                <p className="text-red-700 font-medium">Errors:</p>
                                                <ul className="list-disc list-inside text-red-600">
                                                    {importResult.results.errors.slice(0, 5).map((err: string, i: number) => (
                                                        <li key={i}>{err}</li>
                                                    ))}
                                                    {importResult.results.errors.length > 5 && (
                                                        <li>...and {importResult.results.errors.length - 5} more</li>
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
            )}

            {/* Database Tab */}
            {activeTab === 'database' && (
                <DatabaseTab queryClient={queryClient} />
            )}
        </div>
    );
}

// Separate component for General tab
function GeneralTab({ queryClient }: { queryClient: any }) {
    const { user } = useAuth();
    const [newChannel, setNewChannel] = useState({ id: '', name: '' });

    // Password change state
    const [passwordData, setPasswordData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const [passwordError, setPasswordError] = useState('');
    const [passwordSuccess, setPasswordSuccess] = useState('');

    // User management state
    const [showAddUser, setShowAddUser] = useState(false);
    const [editingUser, setEditingUser] = useState<any>(null);
    const [newUser, setNewUser] = useState({ email: '', password: '', name: '', role: 'staff' });

    const { data: channels, isLoading } = useQuery({
        queryKey: ['orderChannels'],
        queryFn: () => adminApi.getChannels().then(r => r.data),
    });

    const { data: users, isLoading: usersLoading } = useQuery({
        queryKey: ['users'],
        queryFn: () => adminApi.getUsers().then(r => r.data),
        enabled: user?.role === 'admin',
    });

    const updateChannelsMutation = useMutation({
        mutationFn: (channels: { id: string; name: string }[]) => adminApi.updateChannels(channels),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orderChannels'] });
        },
    });

    const changePasswordMutation = useMutation({
        mutationFn: (data: { currentPassword: string; newPassword: string }) => authApi.changePassword(data),
        onSuccess: () => {
            setPasswordSuccess('Password changed successfully!');
            setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
            setPasswordError('');
        },
        onError: (error: any) => {
            setPasswordError(error.response?.data?.error || 'Failed to change password');
            setPasswordSuccess('');
        },
    });

    const createUserMutation = useMutation({
        mutationFn: (data: { email: string; password: string; name: string; role: string }) =>
            adminApi.createUser(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setShowAddUser(false);
            setNewUser({ email: '', password: '', name: '', role: 'staff' });
        },
        onError: (error: any) => {
            alert(error.response?.data?.error || 'Failed to create user');
        },
    });

    const updateUserMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => adminApi.updateUser(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setEditingUser(null);
        },
        onError: (error: any) => {
            alert(error.response?.data?.error || 'Failed to update user');
        },
    });

    const deleteUserMutation = useMutation({
        mutationFn: (id: string) => adminApi.deleteUser(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
        },
        onError: (error: any) => {
            alert(error.response?.data?.error || 'Failed to delete user');
        },
    });

    const validatePasswordStrength = (password: string) => {
        const errors = [];
        if (password.length < 8) errors.push('At least 8 characters');
        if (!/[A-Z]/.test(password)) errors.push('One uppercase letter');
        if (!/[a-z]/.test(password)) errors.push('One lowercase letter');
        if (!/[0-9]/.test(password)) errors.push('One number');
        if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push('One special character');
        return errors;
    };

    const handleChangePassword = () => {
        setPasswordError('');
        setPasswordSuccess('');

        if (!passwordData.currentPassword || !passwordData.newPassword) {
            setPasswordError('All fields are required');
            return;
        }
        if (passwordData.newPassword !== passwordData.confirmPassword) {
            setPasswordError('New passwords do not match');
            return;
        }

        const passwordErrors = validatePasswordStrength(passwordData.newPassword);
        if (passwordErrors.length > 0) {
            setPasswordError('Password requirements: ' + passwordErrors.join(', '));
            return;
        }

        changePasswordMutation.mutate({
            currentPassword: passwordData.currentPassword,
            newPassword: passwordData.newPassword,
        });
    };

    const addChannel = () => {
        if (!newChannel.id || !newChannel.name) {
            alert('Both ID and Name are required');
            return;
        }
        const channelId = newChannel.id.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        if (channels?.some((c: any) => c.id === channelId)) {
            alert('Channel ID already exists');
            return;
        }
        const updatedChannels = [...(channels || []), { id: channelId, name: newChannel.name }];
        updateChannelsMutation.mutate(updatedChannels);
        setNewChannel({ id: '', name: '' });
    };

    const removeChannel = (id: string) => {
        if (!confirm('Remove this channel?')) return;
        const updatedChannels = channels?.filter((c: any) => c.id !== id) || [];
        updateChannelsMutation.mutate(updatedChannels);
    };

    return (
        <div className="space-y-6">
            {/* Change Password */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Lock size={20} /> Change Password
                </h2>

                <div className="max-w-md space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
                        <input
                            type="password"
                            className="input"
                            value={passwordData.currentPassword}
                            onChange={(e) => setPasswordData(d => ({ ...d, currentPassword: e.target.value }))}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                        <input
                            type="password"
                            className="input"
                            value={passwordData.newPassword}
                            onChange={(e) => setPasswordData(d => ({ ...d, newPassword: e.target.value }))}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Min 8 chars with uppercase, lowercase, number & special character
                        </p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                        <input
                            type="password"
                            className="input"
                            value={passwordData.confirmPassword}
                            onChange={(e) => setPasswordData(d => ({ ...d, confirmPassword: e.target.value }))}
                        />
                    </div>

                    {passwordError && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                            {passwordError}
                        </div>
                    )}
                    {passwordSuccess && (
                        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex items-center gap-2">
                            <CheckCircle size={16} /> {passwordSuccess}
                        </div>
                    )}

                    <button
                        onClick={handleChangePassword}
                        className="btn btn-primary"
                        disabled={changePasswordMutation.isPending}
                    >
                        {changePasswordMutation.isPending ? 'Changing...' : 'Change Password'}
                    </button>
                </div>
            </div>

            {/* User Management (Admin only) */}
            {user?.role === 'admin' && (
                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <Users size={20} /> User Management
                        </h2>
                        <button
                            onClick={() => setShowAddUser(true)}
                            className="btn btn-primary flex items-center gap-2"
                        >
                            <UserPlus size={16} /> Add User
                        </button>
                    </div>

                    {usersLoading ? (
                        <div className="flex justify-center p-4">
                            <RefreshCw size={24} className="animate-spin text-gray-400" />
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-4 py-2 text-left">Name</th>
                                        <th className="px-4 py-2 text-left">Email</th>
                                        <th className="px-4 py-2 text-left">Role</th>
                                        <th className="px-4 py-2 text-left">Status</th>
                                        <th className="px-4 py-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users?.map((u: any) => (
                                        <tr key={u.id} className="border-t">
                                            <td className="px-4 py-3 font-medium">{u.name}</td>
                                            <td className="px-4 py-3">{u.email}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                    u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                                                }`}>
                                                    {u.role === 'admin' && <Shield size={12} className="inline mr-1" />}
                                                    {u.role}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 rounded-full text-xs ${
                                                    u.isActive !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                                }`}>
                                                    {u.isActive !== false ? 'Active' : 'Disabled'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    onClick={() => setEditingUser(u)}
                                                    className="text-blue-600 hover:text-blue-800 mr-3"
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                                {u.id !== user?.id && (
                                                    <button
                                                        onClick={() => {
                                                            if (confirm(`Delete user ${u.name}?`)) {
                                                                deleteUserMutation.mutate(u.id);
                                                            }
                                                        }}
                                                        className="text-red-600 hover:text-red-800"
                                                        disabled={deleteUserMutation.isPending}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Add User Modal */}
                    {showAddUser && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                            <div className="bg-white rounded-lg p-6 w-full max-w-md">
                                <h3 className="text-lg font-semibold mb-4">Add New User</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                                        <input
                                            type="text"
                                            className="input"
                                            value={newUser.name}
                                            onChange={(e) => setNewUser(u => ({ ...u, name: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                        <input
                                            type="email"
                                            className="input"
                                            value={newUser.email}
                                            onChange={(e) => setNewUser(u => ({ ...u, email: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                                        <input
                                            type="password"
                                            className="input"
                                            value={newUser.password}
                                            onChange={(e) => setNewUser(u => ({ ...u, password: e.target.value }))}
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Min 8 chars with uppercase, lowercase, number & special character
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                                        <select
                                            className="input"
                                            value={newUser.role}
                                            onChange={(e) => setNewUser(u => ({ ...u, role: e.target.value }))}
                                        >
                                            <option value="staff">Staff</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="flex justify-end gap-2 mt-6">
                                    <button
                                        onClick={() => setShowAddUser(false)}
                                        className="btn btn-secondary"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => createUserMutation.mutate(newUser)}
                                        className="btn btn-primary"
                                        disabled={createUserMutation.isPending || !newUser.email || !newUser.password || !newUser.name}
                                    >
                                        {createUserMutation.isPending ? 'Creating...' : 'Create User'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Edit User Modal */}
                    {editingUser && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                            <div className="bg-white rounded-lg p-6 w-full max-w-md">
                                <h3 className="text-lg font-semibold mb-4">Edit User</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                                        <input
                                            type="text"
                                            className="input"
                                            value={editingUser.name}
                                            onChange={(e) => setEditingUser((u: any) => ({ ...u, name: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                        <input
                                            type="email"
                                            className="input"
                                            value={editingUser.email}
                                            onChange={(e) => setEditingUser((u: any) => ({ ...u, email: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">New Password (leave blank to keep current)</label>
                                        <input
                                            type="password"
                                            className="input"
                                            value={editingUser.newPassword || ''}
                                            onChange={(e) => setEditingUser((u: any) => ({ ...u, newPassword: e.target.value }))}
                                            placeholder="Enter new password"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Min 8 chars with uppercase, lowercase, number & special character
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                                        <select
                                            className="input"
                                            value={editingUser.role}
                                            onChange={(e) => setEditingUser((u: any) => ({ ...u, role: e.target.value }))}
                                        >
                                            <option value="staff">Staff</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            id="userActive"
                                            checked={editingUser.isActive !== false}
                                            onChange={(e) => setEditingUser((u: any) => ({ ...u, isActive: e.target.checked }))}
                                            className="rounded border-gray-300"
                                        />
                                        <label htmlFor="userActive" className="text-sm text-gray-700">Active</label>
                                    </div>
                                </div>
                                <div className="flex justify-end gap-2 mt-6">
                                    <button
                                        onClick={() => setEditingUser(null)}
                                        className="btn btn-secondary"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => {
                                            const updateData: any = {
                                                name: editingUser.name,
                                                email: editingUser.email,
                                                role: editingUser.role,
                                                isActive: editingUser.isActive,
                                            };
                                            if (editingUser.newPassword) {
                                                updateData.password = editingUser.newPassword;
                                            }
                                            updateUserMutation.mutate({ id: editingUser.id, data: updateData });
                                        }}
                                        className="btn btn-primary"
                                        disabled={updateUserMutation.isPending}
                                    >
                                        {updateUserMutation.isPending ? 'Saving...' : 'Save Changes'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Order Channels */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <ShoppingCart size={20} /> Order Channels
                </h2>
                <p className="text-sm text-gray-600 mb-4">
                    Configure the sales channels available when creating new orders.
                </p>

                {isLoading ? (
                    <div className="flex justify-center p-4">
                        <RefreshCw size={24} className="animate-spin text-gray-400" />
                    </div>
                ) : (
                    <>
                        {/* Current Channels */}
                        <div className="space-y-2 mb-4">
                            {channels?.map((channel: any) => (
                                <div key={channel.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                    <div>
                                        <span className="font-medium text-gray-900">{channel.name}</span>
                                        <span className="ml-2 text-xs text-gray-500 font-mono">({channel.id})</span>
                                    </div>
                                    <button
                                        onClick={() => removeChannel(channel.id)}
                                        className="text-gray-400 hover:text-red-500"
                                        disabled={updateChannelsMutation.isPending}
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                            ))}
                            {(!channels || channels.length === 0) && (
                                <p className="text-gray-500 text-sm py-4 text-center">No channels configured</p>
                            )}
                        </div>

                        {/* Add New Channel */}
                        <div className="border-t pt-4">
                            <p className="text-sm font-medium text-gray-700 mb-2">Add New Channel</p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    className="input flex-1"
                                    placeholder="Channel name (e.g., Instagram)"
                                    value={newChannel.name}
                                    onChange={(e) => setNewChannel(c => ({
                                        ...c,
                                        name: e.target.value,
                                        id: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
                                    }))}
                                />
                                <input
                                    type="text"
                                    className="input w-32 font-mono text-sm"
                                    placeholder="ID"
                                    value={newChannel.id}
                                    onChange={(e) => setNewChannel(c => ({ ...c, id: e.target.value }))}
                                />
                                <button
                                    onClick={addChannel}
                                    className="btn btn-primary flex items-center gap-1"
                                    disabled={updateChannelsMutation.isPending || !newChannel.name}
                                >
                                    <Plus size={16} /> Add
                                </button>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                ID is auto-generated from name, but can be customized
                            </p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// Separate component for Database tab to manage its own state
function DatabaseTab({ queryClient }: { queryClient: any }) {
    const [clearConfirm, setClearConfirm] = useState('');
    const [selectedTables, setSelectedTables] = useState<string[]>([]);

    const { data: stats, isLoading: statsLoading } = useQuery({
        queryKey: ['dbStats'],
        queryFn: () => adminApi.getStats().then(r => r.data),
    });

    const clearMutation = useMutation({
        mutationFn: () => adminApi.clearTables(selectedTables, clearConfirm),
        onSuccess: (res) => {
            queryClient.invalidateQueries();
            setClearConfirm('');
            setSelectedTables([]);
            alert(`Database cleared! Deleted: ${JSON.stringify(res.data.deleted)}`);
        },
        onError: (error: any) => {
            alert(error.response?.data?.error || 'Failed to clear database');
        },
    });

    const tableOptions = [
        { id: 'orders', label: 'Orders & Order Lines', count: stats?.orders },
        { id: 'customers', label: 'Customers', count: stats?.customers },
        { id: 'products', label: 'Products, Variations & SKUs', count: stats?.products },
        { id: 'fabrics', label: 'Fabrics & Fabric Types', count: stats?.fabrics },
        { id: 'inventoryTransactions', label: 'Inventory Transactions', count: stats?.inventoryTransactions },
    ];

    const toggleTable = (id: string) => {
        if (id === 'all') {
            setSelectedTables(selectedTables.includes('all') ? [] : ['all']);
        } else {
            setSelectedTables(prev =>
                prev.includes(id) ? prev.filter(t => t !== id) : [...prev.filter(t => t !== 'all'), id]
            );
        }
    };

    return (
        <div className="space-y-6">
            {/* Database Stats */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Database size={20} /> Database Statistics
                </h2>

                {statsLoading ? (
                    <div className="flex justify-center p-4">
                        <RefreshCw size={24} className="animate-spin text-gray-400" />
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{stats?.products || 0}</p>
                            <p className="text-sm text-gray-500">Products</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{stats?.skus || 0}</p>
                            <p className="text-sm text-gray-500">SKUs</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{stats?.orders || 0}</p>
                            <p className="text-sm text-gray-500">Orders</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{stats?.customers || 0}</p>
                            <p className="text-sm text-gray-500">Customers</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{stats?.fabrics || 0}</p>
                            <p className="text-sm text-gray-500">Fabrics</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{stats?.variations || 0}</p>
                            <p className="text-sm text-gray-500">Variations</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center col-span-2">
                            <p className="text-2xl font-bold text-gray-900">{stats?.inventoryTransactions || 0}</p>
                            <p className="text-sm text-gray-500">Inventory Transactions</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Danger Zone */}
            <div className="card border-2 border-red-200">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-red-700">
                    <AlertOctagon size={20} /> Danger Zone
                </h2>

                <p className="text-sm text-gray-600 mb-4">
                    Clear data from the database. This action cannot be undone. Select the tables you want to clear:
                </p>

                <div className="space-y-2 mb-4">
                    <label className="flex items-center gap-2 p-2 rounded hover:bg-red-50 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={selectedTables.includes('all')}
                            onChange={() => toggleTable('all')}
                            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                        />
                        <span className="font-medium text-red-700">Clear ALL Data</span>
                    </label>
                    <div className="border-t pt-2 ml-4 space-y-1">
                        {tableOptions.map(table => (
                            <label key={table.id} className="flex items-center gap-2 p-1 rounded hover:bg-gray-50 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={selectedTables.includes('all') || selectedTables.includes(table.id)}
                                    onChange={() => toggleTable(table.id)}
                                    disabled={selectedTables.includes('all')}
                                    className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                                />
                                <span className="text-gray-700">{table.label}</span>
                                <span className="text-gray-400 text-sm">({table.count || 0})</span>
                            </label>
                        ))}
                    </div>
                </div>

                {selectedTables.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <p className="text-sm text-red-700 mb-3">
                            Type <code className="bg-red-100 px-1 rounded font-mono">DELETE ALL DATA</code> to confirm:
                        </p>
                        <input
                            type="text"
                            className="input mb-3"
                            placeholder="Type confirmation phrase..."
                            value={clearConfirm}
                            onChange={(e) => setClearConfirm(e.target.value)}
                        />
                        <button
                            className="btn bg-red-600 text-white hover:bg-red-700 flex items-center gap-2"
                            onClick={() => clearMutation.mutate()}
                            disabled={clearConfirm !== 'DELETE ALL DATA' || clearMutation.isPending}
                        >
                            <Trash2 size={16} />
                            {clearMutation.isPending ? 'Clearing...' : 'Clear Selected Data'}
                        </button>
                    </div>
                )}
            </div>

            {/* Deployment Info */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Database size={20} /> Deployment Guide
                </h2>

                <div className="prose prose-sm max-w-none">
                    <p className="text-gray-600 mb-4">
                        Current database: <code className="bg-gray-100 px-2 py-1 rounded">SQLite</code> (development only)
                    </p>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                        <p className="font-medium text-blue-800 mb-2">For Production Deployment:</p>
                        <ol className="list-decimal list-inside text-sm text-blue-700 space-y-2">
                            <li><strong>Switch to PostgreSQL</strong> - Update <code>schema.prisma</code> provider and <code>DATABASE_URL</code></li>
                            <li><strong>Use a cloud database</strong> - Supabase, Neon, Railway, or PlanetScale</li>
                            <li><strong>Deploy backend</strong> - Railway, Render, or Fly.io</li>
                            <li><strong>Deploy frontend</strong> - Vercel, Netlify, or Cloudflare Pages</li>
                        </ol>
                    </div>

                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <p className="font-medium text-gray-800 mb-2">Quick Steps to Switch to PostgreSQL:</p>
                        <pre className="text-xs bg-gray-800 text-gray-100 p-3 rounded overflow-x-auto">
{`# 1. Update prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

# 2. Update .env
DATABASE_URL="postgresql://user:pass@host:5432/db"

# 3. Run migrations
npx prisma migrate dev --name init
npx prisma generate`}
                        </pre>
                    </div>
                </div>
            </div>
        </div>
    );
}
