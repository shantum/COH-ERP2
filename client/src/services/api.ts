import axios from 'axios';
import type {
    CreateProductData,
    UpdateProductData,
    CreateVariationData,
    UpdateVariationData,
    CreateSkuData,
    UpdateSkuData,
    CreateFabricData,
    CreateFabricTypeData,
    CreateSupplierData,
    CreateFabricTransactionData,
    CreateInventoryInwardData,
    CreateInventoryOutwardData,
    CreateOrderData,
    UpdateOrderData,
    ShipOrderData,
    AddOrderLineData,
    UpdateOrderLineData,
    CreateCustomerData,
    InitiateReverseData,
    ResolveReturnData,
    CreateTailorData,
    CreateBatchData,
    UpdateBatchData,
    CompleteBatchData,
} from '../types';

// In production, use relative URL; in development, use localhost
const API_BASE_URL = import.meta.env.VITE_API_URL ||
    (import.meta.env.PROD ? '/api' : 'http://localhost:3001/api');

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Handle auth errors - dispatch event instead of forcing page reload
// This allows React Router to handle navigation properly
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            // Dispatch custom event for React app to handle via Router
            window.dispatchEvent(new CustomEvent('auth:unauthorized'));
        }
        return Promise.reject(error);
    }
);

// Auth
export const authApi = {
    login: (email: string, password: string) => api.post('/auth/login', { email, password }),
    register: (data: { email: string; password: string; name: string }) => api.post('/auth/register', data),
    me: () => api.get('/auth/me'),
    changePassword: (data: { currentPassword: string; newPassword: string }) =>
        api.post('/auth/change-password', data),
};

// Products
export const productsApi = {
    getAll: (params?: Record<string, string>) => api.get('/products', { params }),
    getById: (id: string) => api.get(`/products/${id}`),
    create: (data: CreateProductData) => api.post('/products', data),
    update: (id: string, data: UpdateProductData) => api.put(`/products/${id}`, data),
    delete: (id: string) => api.delete(`/products/${id}`),
    getAllSkus: (params?: Record<string, string>) => api.get('/products/skus/all', { params }),
    getCogs: () => api.get('/products/cogs'),
    createVariation: (productId: string, data: CreateVariationData) => api.post(`/products/${productId}/variations`, data),
    updateVariation: (variationId: string, data: UpdateVariationData) => api.put(`/products/variations/${variationId}`, data),
    createSku: (variationId: string, data: CreateSkuData) => api.post(`/products/variations/${variationId}/skus`, data),
    updateSku: (skuId: string, data: UpdateSkuData) => api.put(`/products/skus/${skuId}`, data),
};

// Fabrics
export const fabricsApi = {
    getAll: (params?: Record<string, string>) => api.get('/fabrics', { params }),
    getFlat: (params?: { search?: string; status?: string; fabricTypeId?: string }) => api.get('/fabrics/flat', { params }),
    getFilters: () => api.get('/fabrics/filters'),
    getById: (id: string) => api.get(`/fabrics/${id}`),
    create: (data: CreateFabricData) => api.post('/fabrics', data),
    getTypes: () => api.get('/fabrics/types'),
    createType: (data: CreateFabricTypeData) => api.post('/fabrics/types', data),
    getSuppliers: () => api.get('/fabrics/suppliers/all'),
    createSupplier: (data: CreateSupplierData) => api.post('/fabrics/suppliers', data),
    getStockAnalysis: () => api.get('/fabrics/dashboard/stock-analysis'),
    createTransaction: (id: string, data: CreateFabricTransactionData) => api.post(`/fabrics/${id}/transactions`, data),
    getTransactions: (id: string) => api.get(`/fabrics/${id}/transactions`),
    getAllTransactions: (params?: { limit?: number; days?: number }) => api.get('/fabrics/transactions/all', { params }),
    deleteTransaction: (txnId: string) => api.delete(`/fabrics/transactions/${txnId}`),
    // Reconciliation
    getReconciliationHistory: (limit?: number) => api.get('/fabrics/reconciliation/history', { params: { limit } }),
    startReconciliation: () => api.post('/fabrics/reconciliation/start'),
    getReconciliation: (id: string) => api.get(`/fabrics/reconciliation/${id}`),
    updateReconciliation: (id: string, items: Array<{ id: string; physicalQty: number | null; systemQty: number; adjustmentReason?: string; notes?: string }>) =>
        api.put(`/fabrics/reconciliation/${id}`, { items }),
    submitReconciliation: (id: string) => api.post(`/fabrics/reconciliation/${id}/submit`),
    deleteReconciliation: (id: string) => api.delete(`/fabrics/reconciliation/${id}`),
};

// Inventory
export const inventoryApi = {
    getBalance: (params?: { belowTarget?: string; search?: string; limit?: number; offset?: number; includeCustomSkus?: string }) =>
        api.get('/inventory/balance', { params }),
    getSkuBalance: (skuId: string) => api.get(`/inventory/balance/${skuId}`),
    getTransactions: (params?: Record<string, string>) => api.get('/inventory/transactions', { params }),
    getSkuTransactions: (skuId: string) => api.get('/inventory/transactions', { params: { skuId } }),
    createInward: (data: CreateInventoryInwardData) => api.post('/inventory/inward', data),
    createOutward: (data: CreateInventoryOutwardData) => api.post('/inventory/outward', data),
    quickInward: (data: { skuCode?: string; barcode?: string; qty: number; reason?: string; notes?: string }) =>
        api.post('/inventory/quick-inward', data),
    getAlerts: () => api.get('/inventory/alerts'),
    // Production Inward
    getInwardHistory: (date?: string) => api.get('/inventory/inward-history', { params: { date } }),
    editInward: (id: string, data: { qty?: number; notes?: string }) => api.put(`/inventory/inward/${id}`, data),
    deleteInward: (id: string) => api.delete(`/inventory/inward/${id}`),
    // Delete any transaction (admin only)
    deleteTransaction: (id: string) => api.delete(`/inventory/transactions/${id}`),
    // Inward Hub
    getPendingSources: () => api.get('/inventory/pending-sources'),
    scanLookup: (code: string) => api.get(`/inventory/scan-lookup?code=${encodeURIComponent(code)}`),
    getRecentInwards: (limit?: number) => api.get(`/inventory/recent-inwards?limit=${limit || 50}`),
    undoTransaction: (id: string) => api.delete(`/inventory/transactions/${id}`),
    // Queue panel
    getPendingQueue: (source: string, params?: { limit?: number; offset?: number; search?: string }) =>
        api.get(`/inventory/pending-queue/${source}`, { params }),
    rtoInwardLine: (data: { lineId: string; condition: string; notes?: string }) =>
        api.post('/inventory/rto-inward-line', data),
    // Reconciliation
    getReconciliationHistory: (limit?: number) => api.get('/inventory/reconciliation/history', { params: { limit } }),
    startReconciliation: () => api.post('/inventory/reconciliation/start'),
    getReconciliation: (id: string) => api.get(`/inventory/reconciliation/${id}`),
    updateReconciliation: (id: string, items: Array<{ id: string; physicalQty: number | null; systemQty: number; adjustmentReason?: string; notes?: string }>) =>
        api.put(`/inventory/reconciliation/${id}`, { items }),
    submitReconciliation: (id: string) => api.post(`/inventory/reconciliation/${id}/submit`),
    deleteReconciliation: (id: string) => api.delete(`/inventory/reconciliation/${id}`),
    uploadReconciliationCsv: (id: string, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post(`/inventory/reconciliation/${id}/upload-csv`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
};

// Orders
export const ordersApi = {
    getAll: (params?: Record<string, string>) => api.get('/orders', { params }),
    getOpen: (params?: { limit?: number; offset?: number }) => api.get('/orders/open', { params }),
    getShipped: (params?: { limit?: number; offset?: number; days?: number; page?: number }) => {
        const { page, limit = 100, ...rest } = params || {};
        const offset = page ? (page - 1) * limit : rest.offset || 0;
        return api.get('/orders/shipped', { params: { limit, offset, ...rest } });
    },
    getCancelled: () => api.get('/orders/status/cancelled'),
    getArchived: (params?: { days?: number; sortBy?: 'orderDate' | 'archivedAt' }) => api.get('/orders/status/archived', { params }),
    getRto: (params?: { limit?: number; offset?: number }) => api.get('/orders/rto', { params }),
    getCodPending: (params?: { limit?: number; offset?: number }) => api.get('/orders/cod-pending', { params }),
    archive: (id: string) => api.post(`/orders/${id}/archive`),
    unarchive: (id: string) => api.post(`/orders/${id}/unarchive`),
    getById: (id: string) => api.get(`/orders/${id}`),
    create: (data: CreateOrderData) => api.post('/orders', data),
    update: (id: string, data: UpdateOrderData) => api.put(`/orders/${id}`, data),
    delete: (id: string) => api.delete(`/orders/${id}`),
    cancel: (id: string, reason?: string) => api.post(`/orders/${id}/cancel`, { reason }),
    uncancel: (id: string) => api.post(`/orders/${id}/uncancel`),
    addLine: (orderId: string, data: AddOrderLineData) => api.post(`/orders/${orderId}/lines`, data),
    updateLine: (lineId: string, data: UpdateOrderLineData) => api.put(`/orders/lines/${lineId}`, data),
    cancelLine: (lineId: string) => api.post(`/orders/lines/${lineId}/cancel`),
    uncancelLine: (lineId: string) => api.post(`/orders/lines/${lineId}/uncancel`),
    allocateLine: (lineId: string) => api.post(`/orders/lines/${lineId}/allocate`),
    unallocateLine: (lineId: string) => api.post(`/orders/lines/${lineId}/unallocate`),
    // Customization
    customizeLine: (lineId: string, data: { type: string; value: string; notes?: string }) =>
        api.post(`/orders/lines/${lineId}/customize`, data),
    removeCustomization: (lineId: string) => api.delete(`/orders/lines/${lineId}/customize`),
    pickLine: (lineId: string) => api.post(`/orders/lines/${lineId}/pick`),
    unpickLine: (lineId: string) => api.post(`/orders/lines/${lineId}/unpick`),
    packLine: (lineId: string) => api.post(`/orders/lines/${lineId}/pack`),
    unpackLine: (lineId: string) => api.post(`/orders/lines/${lineId}/unpack`),
    ship: (id: string, data: ShipOrderData) => api.post(`/orders/${id}/ship`, data),
    unship: (id: string) => api.post(`/orders/${id}/unship`),
    quickShip: (id: string) => api.post(`/orders/${id}/quick-ship`),
    bulkQuickShip: () => api.post('/orders/bulk-quick-ship'),
    deliver: (id: string) => api.post(`/orders/${id}/deliver`),
    // Summary and analytics endpoints
    getShippedSummary: (params?: { days?: number }) => api.get('/orders/shipped/summary', { params }),
    getArchivedAnalytics: (params?: { days?: number }) => api.get('/orders/archived/analytics', { params }),
    getRtoSummary: () => api.get('/orders/rto/summary'),
    // RTO actions
    markDelivered: (id: string) => api.post(`/orders/${id}/mark-delivered`),
    markRto: (id: string) => api.post(`/orders/${id}/mark-rto`),
    receiveRto: (id: string) => api.post(`/orders/${id}/receive-rto`),
    // Bulk archive
    archiveDeliveredPrepaid: () => api.post('/orders/archive-delivered-prepaid'),
};

// Catalog (combined products + inventory view)
export const catalogApi = {
    getSkuInventory: (params?: {
        gender?: string;
        category?: string;
        productId?: string;
        status?: string;
        search?: string;
        limit?: number;
        offset?: number;
    }) => api.get('/catalog/sku-inventory', { params }),
    getFilters: () => api.get('/catalog/filters'),
};

// Customers
export const customersApi = {
    getAll: (params?: Record<string, string>) => api.get('/customers', { params }),
    getById: (id: string) => api.get(`/customers/${id}`),
    create: (data: CreateCustomerData) => api.post('/customers', data),
    getHighValue: () => api.get('/customers/analytics/high-value'),
    getFrequentReturners: () => api.get('/customers/analytics/frequent-returners'),
    getAtRisk: () => api.get('/customers/analytics/at-risk'),
};

// Returns
export const returnsApi = {
    getAll: (params?: Record<string, string>) => api.get('/returns', { params }),
    getById: (id: string) => api.get(`/returns/${id}`),
    create: (data: {
        requestType: 'return' | 'exchange';
        resolution?: 'refund' | 'exchange_same' | 'exchange_up' | 'exchange_down';
        originalOrderId: string;
        reasonCategory: string;
        reasonDetails?: string;
        lines: Array<{ skuId: string; qty?: number; exchangeSkuId?: string; unitPrice?: number }>;
        returnValue?: number;
        replacementValue?: number;
        valueDifference?: number;
        courier?: string;
        awbNumber?: string;
    }) => api.post('/returns', data),
    update: (id: string, data: {
        courier?: string;
        awbNumber?: string;
        reasonCategory?: string;
        reasonDetails?: string;
    }) => api.put(`/returns/${id}`, data),
    delete: (id: string) => api.delete(`/returns/${id}`),
    cancel: (id: string, reason?: string) => api.post(`/returns/${id}/cancel`, { reason }),
    initiateReverse: (id: string, data: InitiateReverseData) => api.post(`/returns/${id}/initiate-reverse`, data),
    markReceived: (id: string) => api.post(`/returns/${id}/mark-received`),
    resolve: (id: string, data: ResolveReturnData) => api.post(`/returns/${id}/resolve`, data),
    getAnalyticsByProduct: () => api.get('/returns/analytics/by-product'),
    // Pending tickets (awaiting receipt)
    getPending: () => api.get('/returns/pending'),
    findBySkuCode: (code: string) => api.get('/returns/pending/by-sku', { params: { code } }),
    // Get order details for creating a return
    getOrder: (orderIdOrNumber: string) => api.get(`/returns/order/${orderIdOrNumber}`),
    // Receive item from a ticket
    receiveItem: (requestId: string, data: { lineId: string; condition: 'good' | 'used' | 'damaged' | 'wrong_product' }) =>
        api.post(`/returns/${requestId}/receive-item`, data),
    // Undo receive - remove from QC queue
    undoReceive: (requestId: string, lineId: string) =>
        api.post(`/returns/${requestId}/undo-receive`, { lineId }),
    // Add item to return request
    addItem: (requestId: string, skuId: string, qty?: number) =>
        api.post(`/returns/${requestId}/add-item`, { skuId, qty }),
    // Remove item from return request
    removeItem: (requestId: string, lineId: string) =>
        api.delete(`/returns/${requestId}/items/${lineId}`),
    // Exchange order linking
    linkExchangeOrder: (requestId: string, orderId: string) =>
        api.put(`/returns/${requestId}/link-exchange-order`, { orderId }),
    unlinkExchangeOrder: (requestId: string) =>
        api.put(`/returns/${requestId}/unlink-exchange-order`),
    // Exchange shipment tracking
    markReverseReceived: (requestId: string) =>
        api.put(`/returns/${requestId}/mark-reverse-received`),
    unmarkReverseReceived: (requestId: string) =>
        api.put(`/returns/${requestId}/unmark-reverse-received`),
    markForwardDelivered: (requestId: string) =>
        api.put(`/returns/${requestId}/mark-forward-delivered`),
    unmarkForwardDelivered: (requestId: string) =>
        api.put(`/returns/${requestId}/unmark-forward-delivered`),
    // Early-ship logic for exchanges
    markReverseInTransit: (requestId: string) =>
        api.put(`/returns/${requestId}/mark-reverse-in-transit`),
    shipReplacement: (requestId: string, data: { courier: string; awbNumber: string; notes?: string }) =>
        api.put(`/returns/${requestId}/ship-replacement`, data),
    // Action Queue dashboard
    getActionQueue: () => api.get('/returns/action-queue'),
};

// Repacking Queue & Write-offs
export const repackingApi = {
    // Queue operations
    getQueue: (params?: { status?: string; limit?: number }) => api.get('/repacking/queue', { params }),
    getQueueStats: () => api.get('/repacking/queue/stats'),
    getQueueHistory: (params?: { status?: 'ready' | 'write_off'; limit?: number }) =>
        api.get('/repacking/queue/history', { params }),
    addToQueue: (data: {
        skuId?: string;
        skuCode?: string;
        barcode?: string;
        qty?: number;
        condition?: string;
        returnRequestId?: string;
        returnLineId?: string;
        inspectionNotes?: string;
    }) => api.post('/repacking/queue', data),
    updateQueueItem: (id: string, data: { status?: string; condition?: string; inspectionNotes?: string }) =>
        api.put(`/repacking/queue/${id}`, data),
    deleteQueueItem: (id: string) => api.delete(`/repacking/queue/${id}`),
    // Process - move to stock or write-off
    process: (data: {
        itemId: string;
        action: 'ready' | 'write_off';
        writeOffReason?: string;
        qcComments?: string;
        notes?: string;
    }) => api.post('/repacking/process', data),
    // Undo processed item
    undoProcess: (id: string) => api.post(`/repacking/queue/${id}/undo`),
    // Write-offs
    getWriteOffs: (params?: { reason?: string; sourceType?: string; startDate?: string; endDate?: string; limit?: number }) =>
        api.get('/repacking/write-offs', { params }),
    getWriteOffStats: (params?: { startDate?: string; endDate?: string }) =>
        api.get('/repacking/write-offs/stats', { params }),
    createWriteOff: (data: {
        skuId?: string;
        skuCode?: string;
        qty: number;
        reason: string;
        sourceType?: string;
        notes?: string;
        costValue?: number;
    }) => api.post('/repacking/write-offs', data),
};

// Production
export const productionApi = {
    getTailors: () => api.get('/production/tailors'),
    createTailor: (data: CreateTailorData) => api.post('/production/tailors', data),
    getBatches: (params?: Record<string, string>) => api.get('/production/batches', { params }),
    createBatch: (data: CreateBatchData) => api.post('/production/batches', data),
    updateBatch: (id: string, data: UpdateBatchData) => api.put(`/production/batches/${id}`, data),
    deleteBatch: (id: string) => api.delete(`/production/batches/${id}`),
    startBatch: (id: string) => api.post(`/production/batches/${id}/start`),
    completeBatch: (id: string, data: CompleteBatchData) => api.post(`/production/batches/${id}/complete`, data),
    uncompleteBatch: (id: string) => api.post(`/production/batches/${id}/uncomplete`),
    getCapacity: (date?: string) => api.get('/production/capacity', { params: { date } }),
    getLockedDates: () => api.get('/production/locked-dates'),
    lockDate: (date: string) => api.post('/production/lock-date', { date }),
    unlockDate: (date: string) => api.post('/production/unlock-date', { date }),
    getRequirements: () => api.get('/production/requirements'),
    getPendingBySku: (skuId: string) => api.get(`/production/pending-by-sku/${skuId}`),
};

// Reports
export const reportsApi = {
    getDashboard: () => api.get('/reports/dashboard'),
    getSalesVelocity: (days?: number) => api.get('/reports/sales-velocity', { params: { days } }),
    getInventoryTurnover: () => api.get('/reports/inventory-turnover'),
    getCogsSummary: () => api.get('/reports/cogs-summary'),
};

// Shopify Integration
export const shopifyApi = {
    getConfig: () => api.get('/shopify/config'),
    updateConfig: (data: { shopDomain: string; accessToken: string }) => api.put('/shopify/config', data),
    testConnection: () => api.post('/shopify/test-connection'),
    getStatus: () => api.get('/shopify/status'),
    getSyncHistory: () => api.get('/shopify/sync/history'),
    // Preview endpoints
    previewProducts: (limit?: number) => api.post('/shopify/preview/products', { limit }),
    previewOrders: (limit?: number) => api.post('/shopify/preview/orders', { limit }),
    previewCustomers: (limit?: number) => api.post('/shopify/preview/customers', { limit }),
    // Direct sync (products and customers only - orders use background jobs)
    syncProducts: (data?: { limit?: number; syncAll?: boolean }) => api.post('/shopify/sync/products', data || {}),
    syncCustomers: (data?: { since_id?: string; created_at_min?: string; limit?: number }) =>
        api.post('/shopify/sync/customers', data || {}),
    syncAllCustomers: () =>
        api.post('/shopify/sync/customers/all'),
    // Cache utilities (use cached data, no API rate limits)
    backfillFromCache: () => api.post('/shopify/sync/backfill-from-cache'),
    backfillCacheFields: () => api.post('/shopify/sync/backfill-cache-fields'),
    reprocessCache: () => api.post('/shopify/sync/reprocess-cache'),
    getCacheStatus: () => api.get('/shopify/sync/cache-status'),
    // Simple sync operations (recommended)
    fullDump: (daysBack?: number) => api.post('/shopify/sync/full-dump', { daysBack }),
    lookupOrder: (orderNumber: string) => api.get(`/shopify/orders/${orderNumber}`),
    processCache: (limit?: number) => api.post('/shopify/sync/process-cache', { limit }),
    // Background sync jobs (legacy - use fullDump instead for orders)
    startSyncJob: (params: {
        jobType: string;
        syncMode?: 'deep' | 'quick' | 'update' | 'populate';
        days?: number;
        staleAfterMins?: number;
    }) => api.post('/shopify/sync/jobs/start', params),
    getSyncJobs: (limit?: number) =>
        api.get('/shopify/sync/jobs', { params: { limit } }),
    getSyncJobStatus: (jobId: string) =>
        api.get(`/shopify/sync/jobs/${jobId}`),
    resumeSyncJob: (jobId: string) =>
        api.post(`/shopify/sync/jobs/${jobId}/resume`),
    cancelSyncJob: (jobId: string) =>
        api.post(`/shopify/sync/jobs/${jobId}/cancel`),
    // Scheduler (hourly sync)
    getSchedulerStatus: () => api.get('/shopify/sync/scheduler/status'),
    triggerSchedulerSync: () => api.post('/shopify/sync/scheduler/trigger'),
    startScheduler: () => api.post('/shopify/sync/scheduler/start'),
    stopScheduler: () => api.post('/shopify/sync/scheduler/stop'),
    // Webhook activity
    getWebhookActivity: (params?: { hours?: number; limit?: number }) =>
        api.get('/shopify/webhooks/activity', { params }),
};

// Import/Export
export const importExportApi = {
    exportProducts: () => api.get('/export/products', { responseType: 'blob' }),
    exportFabrics: () => api.get('/export/fabrics', { responseType: 'blob' }),
    exportInventory: () => api.get('/export/inventory', { responseType: 'blob' }),
    importProducts: (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/import/products', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
    importFabrics: (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/import/fabrics', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
};

// Admin
export const adminApi = {
    getStats: () => api.get('/admin/stats'),
    clearTables: (tables: string[], confirmPhrase: string) =>
        api.post('/admin/clear', { tables, confirmPhrase }),
    getChannels: () => api.get('/admin/channels'),
    updateChannels: (channels: { id: string; name: string }[]) =>
        api.put('/admin/channels', { channels }),
    // User management
    getUsers: () => api.get('/admin/users'),
    createUser: (data: { email: string; password: string; name: string; role: string }) =>
        api.post('/admin/users', data),
    updateUser: (id: string, data: { email?: string; name?: string; role?: string; isActive?: boolean; password?: string }) =>
        api.put(`/admin/users/${id}`, data),
    deleteUser: (id: string) => api.delete(`/admin/users/${id}`),
    // Database inspector
    inspectOrders: (limit?: number, offset?: number) =>
        api.get('/admin/inspect/orders', { params: { limit, offset } }),
    inspectCustomers: (limit?: number, offset?: number) =>
        api.get('/admin/inspect/customers', { params: { limit, offset } }),
    inspectProducts: (limit?: number, offset?: number) =>
        api.get('/admin/inspect/products', { params: { limit, offset } }),
    inspectSkus: (limit?: number, offset?: number) =>
        api.get('/admin/inspect/skus', { params: { limit, offset } }),
    inspectShopifyOrderCache: (limit?: number, offset?: number) =>
        api.get('/admin/inspect/shopify-order-cache', { params: { limit, offset } }),
    inspectShopifyProductCache: (limit?: number, offset?: number) =>
        api.get('/admin/inspect/shopify-product-cache', { params: { limit, offset } }),
    // Tier thresholds
    getTierThresholds: () => api.get('/admin/tier-thresholds'),
    updateTierThresholds: (thresholds: { platinum: number; gold: number; silver: number }) =>
        api.put('/admin/tier-thresholds', thresholds),
};

// Tracking API (iThink Logistics integration)
export const trackingApi = {
    // Config
    getConfig: () => api.get('/tracking/config'),
    updateConfig: (data: { accessToken: string; secretKey: string }) =>
        api.put('/tracking/config', data),
    testConnection: () => api.post('/tracking/test-connection'),

    // Tracking
    getAwbTracking: (awbNumber: string) => api.get(`/tracking/awb/${awbNumber}`),
    getTrackingHistory: (awbNumber: string) => api.get(`/tracking/history/${awbNumber}`),
    batchTrack: (awbNumbers: string[]) => api.post('/tracking/batch', { awbNumbers }),
    trackOrders: (orderIds: string[]) => api.post('/tracking/orders', { orderIds }),

    // Sync
    syncBackfill: (params?: { days?: number; limit?: number }) =>
        api.post('/tracking/sync/backfill', {}, { params }),
    triggerSync: () => api.post('/tracking/sync/trigger'),
};

// COD Remittance API
export const remittanceApi = {
    // Upload CSV file to mark orders as paid
    upload: (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/remittance/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
    // Get pending COD orders (delivered but not yet paid)
    getPending: (limit?: number) =>
        api.get('/remittance/pending', { params: { limit } }),
    // Get summary stats
    getSummary: (days?: number) =>
        api.get('/remittance/summary', { params: { days } }),
    // Get failed Shopify sync orders
    getFailed: (limit?: number) =>
        api.get('/remittance/failed', { params: { limit } }),
    // Retry Shopify sync for specific orders or all failed
    retrySync: (data: { orderIds?: string[]; all?: boolean }) =>
        api.post('/remittance/retry-sync', data),
    // Approve manual review order and sync to Shopify
    approveManual: (data: { orderId: string; approvedAmount?: number }) =>
        api.post('/remittance/approve-manual', data),
};

export default api;
