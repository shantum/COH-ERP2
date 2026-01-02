import axios from 'axios';

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
    create: (data: any) => api.post('/products', data),
    update: (id: string, data: any) => api.put(`/products/${id}`, data),
    delete: (id: string) => api.delete(`/products/${id}`),
    getAllSkus: (params?: Record<string, string>) => api.get('/products/skus/all', { params }),
    getCogs: () => api.get('/products/cogs'),
    createVariation: (productId: string, data: any) => api.post(`/products/${productId}/variations`, data),
    updateVariation: (variationId: string, data: any) => api.put(`/products/variations/${variationId}`, data),
    createSku: (variationId: string, data: any) => api.post(`/products/variations/${variationId}/skus`, data),
    updateSku: (skuId: string, data: any) => api.put(`/products/skus/${skuId}`, data),
};

// Fabrics
export const fabricsApi = {
    getAll: (params?: Record<string, string>) => api.get('/fabrics', { params }),
    getById: (id: string) => api.get(`/fabrics/${id}`),
    create: (data: any) => api.post('/fabrics', data),
    getTypes: () => api.get('/fabrics/types'),
    createType: (data: any) => api.post('/fabrics/types', data),
    getSuppliers: () => api.get('/fabrics/suppliers/all'),
    createSupplier: (data: any) => api.post('/fabrics/suppliers', data),
    getStockAnalysis: () => api.get('/fabrics/dashboard/stock-analysis'),
    createTransaction: (id: string, data: any) => api.post(`/fabrics/${id}/transactions`, data),
    getTransactions: (id: string) => api.get(`/fabrics/${id}/transactions`),
};

// Inventory
export const inventoryApi = {
    getBalance: (params?: Record<string, string>) => api.get('/inventory/balance', { params }),
    getSkuBalance: (skuId: string) => api.get(`/inventory/balance/${skuId}`),
    getTransactions: (params?: Record<string, string>) => api.get('/inventory/transactions', { params }),
    getSkuTransactions: (skuId: string) => api.get('/inventory/transactions', { params: { skuId } }),
    createInward: (data: any) => api.post('/inventory/inward', data),
    createOutward: (data: any) => api.post('/inventory/outward', data),
    quickInward: (data: any) => api.post('/inventory/quick-inward', data),
    getAlerts: () => api.get('/inventory/alerts'),
};

// Orders
export const ordersApi = {
    getAll: (params?: Record<string, string>) => api.get('/orders', { params }),
    getOpen: () => api.get('/orders/open'),
    getShipped: () => api.get('/orders/shipped'),
    getById: (id: string) => api.get(`/orders/${id}`),
    create: (data: any) => api.post('/orders', data),
    delete: (id: string) => api.delete(`/orders/${id}`),
    allocateLine: (lineId: string) => api.post(`/orders/lines/${lineId}/allocate`),
    unallocateLine: (lineId: string) => api.post(`/orders/lines/${lineId}/unallocate`),
    pickLine: (lineId: string) => api.post(`/orders/lines/${lineId}/pick`),
    unpickLine: (lineId: string) => api.post(`/orders/lines/${lineId}/unpick`),
    packLine: (lineId: string) => api.post(`/orders/lines/${lineId}/pack`),
    unpackLine: (lineId: string) => api.post(`/orders/lines/${lineId}/unpack`),
    ship: (id: string, data: any) => api.post(`/orders/${id}/ship`, data),
    unship: (id: string) => api.post(`/orders/${id}/unship`),
    deliver: (id: string) => api.post(`/orders/${id}/deliver`),
};

// Customers
export const customersApi = {
    getAll: (params?: Record<string, string>) => api.get('/customers', { params }),
    getById: (id: string) => api.get(`/customers/${id}`),
    create: (data: any) => api.post('/customers', data),
    getHighValue: () => api.get('/customers/analytics/high-value'),
    getFrequentReturners: () => api.get('/customers/analytics/frequent-returners'),
    getAtRisk: () => api.get('/customers/analytics/at-risk'),
};

// Returns
export const returnsApi = {
    getAll: (params?: Record<string, string>) => api.get('/returns', { params }),
    getById: (id: string) => api.get(`/returns/${id}`),
    create: (data: any) => api.post('/returns', data),
    initiateReverse: (id: string, data: any) => api.post(`/returns/${id}/initiate-reverse`, data),
    markReceived: (id: string) => api.post(`/returns/${id}/mark-received`),
    resolve: (id: string, data: any) => api.post(`/returns/${id}/resolve`, data),
    getAnalyticsByProduct: () => api.get('/returns/analytics/by-product'),
};

// Production
export const productionApi = {
    getTailors: () => api.get('/production/tailors'),
    createTailor: (data: any) => api.post('/production/tailors', data),
    getBatches: (params?: Record<string, string>) => api.get('/production/batches', { params }),
    createBatch: (data: any) => api.post('/production/batches', data),
    updateBatch: (id: string, data: any) => api.put(`/production/batches/${id}`, data),
    deleteBatch: (id: string) => api.delete(`/production/batches/${id}`),
    startBatch: (id: string) => api.post(`/production/batches/${id}/start`),
    completeBatch: (id: string, data: any) => api.post(`/production/batches/${id}/complete`, data),
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
    previewProducts: (limit?: number) => api.post('/shopify/preview/products', { limit }),
    previewOrders: (limit?: number) => api.post('/shopify/preview/orders', { limit }),
    previewCustomers: (limit?: number) => api.post('/shopify/preview/customers', { limit }),
    syncProducts: (data?: { limit?: number; syncAll?: boolean }) => api.post('/shopify/sync/products', data || {}),
    syncOrders: (data?: { since_id?: string; created_at_min?: string; limit?: number; skipSkuMatching?: boolean }) =>
        api.post('/shopify/sync/orders', data || {}),
    syncCustomers: (data?: { since_id?: string; created_at_min?: string; limit?: number }) =>
        api.post('/shopify/sync/customers', data || {}),
    syncAllOrders: (data?: { status?: string; days?: number }) =>
        api.post('/shopify/sync/orders/all', data || {}),
    syncAllCustomers: () =>
        api.post('/shopify/sync/customers/all'),
    // Background sync jobs
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
