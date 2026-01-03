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
  QuickInwardData,
  CreateOrderData,
  UpdateOrderData,
  ShipOrderData,
  AddOrderLineData,
  UpdateOrderLineData,
  CreateCustomerData,
  CreateReturnData,
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

// Handle auth errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            window.location.href = '/login';
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
    getById: (id: string) => api.get(`/fabrics/${id}`),
    create: (data: CreateFabricData) => api.post('/fabrics', data),
    getTypes: () => api.get('/fabrics/types'),
    createType: (data: CreateFabricTypeData) => api.post('/fabrics/types', data),
    getSuppliers: () => api.get('/fabrics/suppliers/all'),
    createSupplier: (data: CreateSupplierData) => api.post('/fabrics/suppliers', data),
    getStockAnalysis: () => api.get('/fabrics/dashboard/stock-analysis'),
    createTransaction: (id: string, data: CreateFabricTransactionData) => api.post(`/fabrics/${id}/transactions`, data),
    getTransactions: (id: string) => api.get(`/fabrics/${id}/transactions`),
};

// Inventory
export const inventoryApi = {
    getBalance: (params?: Record<string, string>) => api.get('/inventory/balance', { params }),
    getSkuBalance: (skuId: string) => api.get(`/inventory/balance/${skuId}`),
    getTransactions: (params?: Record<string, string>) => api.get('/inventory/transactions', { params }),
    getSkuTransactions: (skuId: string) => api.get('/inventory/transactions', { params: { skuId } }),
    createInward: (data: CreateInventoryInwardData) => api.post('/inventory/inward', data),
    createOutward: (data: CreateInventoryOutwardData) => api.post('/inventory/outward', data),
    quickInward: (data: QuickInwardData) => api.post('/inventory/quick-inward', data),
    getAlerts: () => api.get('/inventory/alerts'),
};

// Orders
export const ordersApi = {
    getAll: (params?: Record<string, string>) => api.get('/orders', { params }),
    getOpen: () => api.get('/orders/open'),
    getShipped: () => api.get('/orders/shipped'),
    getCancelled: () => api.get('/orders/status/cancelled'),
    getArchived: () => api.get('/orders/status/archived'),
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
    pickLine: (lineId: string) => api.post(`/orders/lines/${lineId}/pick`),
    unpickLine: (lineId: string) => api.post(`/orders/lines/${lineId}/unpick`),
    packLine: (lineId: string) => api.post(`/orders/lines/${lineId}/pack`),
    unpackLine: (lineId: string) => api.post(`/orders/lines/${lineId}/unpack`),
    ship: (id: string, data: ShipOrderData) => api.post(`/orders/${id}/ship`, data),
    unship: (id: string) => api.post(`/orders/${id}/unship`),
    deliver: (id: string) => api.post(`/orders/${id}/deliver`),
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
    create: (data: CreateReturnData) => api.post('/returns', data),
    initiateReverse: (id: string, data: InitiateReverseData) => api.post(`/returns/${id}/initiate-reverse`, data),
    markReceived: (id: string) => api.post(`/returns/${id}/mark-received`),
    resolve: (id: string, data: ResolveReturnData) => api.post(`/returns/${id}/resolve`, data),
    getAnalyticsByProduct: () => api.get('/returns/analytics/by-product'),
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
    reprocessCache: () => api.post('/shopify/sync/reprocess-cache'),
    getCacheStatus: () => api.get('/shopify/sync/cache-status'),
    // Background sync jobs (recommended for orders sync)
    startSyncJob: (jobType: string, days?: number) =>
        api.post('/shopify/sync/jobs/start', { jobType, days }),
    getSyncJobs: (limit?: number) =>
        api.get('/shopify/sync/jobs', { params: { limit } }),
    getSyncJobStatus: (jobId: string) =>
        api.get(`/shopify/sync/jobs/${jobId}`),
    resumeSyncJob: (jobId: string) =>
        api.post(`/shopify/sync/jobs/${jobId}/resume`),
    cancelSyncJob: (jobId: string) =>
        api.post(`/shopify/sync/jobs/${jobId}/cancel`),
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
};

export default api;
