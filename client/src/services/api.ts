/**
 * Axios API Client
 *
 * MINIMAL VERSION - Only APIs that CANNOT use Server Functions:
 * - authApi: Login/logout (cookie management)
 * - inventoryApi: CSV file uploads
 * - shopifyApi: Admin sync operations
 * - importExportApi: File imports/exports
 * - pincodeApi: File uploads
 * - remittanceApi: File uploads
 *
 * All other APIs have been migrated to TanStack Start Server Functions.
 * See client/src/server/functions/ for the new implementations.
 */

import axios from 'axios';

// In production, use relative URL; in development, use localhost
const API_BASE_URL = import.meta.env.VITE_API_URL ||
    (import.meta.env.PROD ? '/api' : 'http://localhost:3001/api');

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    // Enable cookies for all requests (auth_token HttpOnly cookie)
    withCredentials: true,
});

// Add auth token to requests (SSR-safe)
api.interceptors.request.use((config) => {
    if (typeof window !== 'undefined') {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
    }
    return config;
});

// Handle auth errors - dispatch event instead of forcing page reload
// This allows React Router to handle navigation properly (SSR-safe)
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (typeof window !== 'undefined' && error.response?.status === 401) {
            localStorage.removeItem('token');
            // Dispatch custom event for React app to handle via Router
            window.dispatchEvent(new CustomEvent('auth:unauthorized'));
        }
        return Promise.reject(error);
    }
);

// ==================== AUTH ====================
// Must stay in Axios for cookie management
export const authApi = {
    login: (email: string, password: string) => api.post('/auth/login', { email, password }),
    register: (data: { email: string; password: string; name: string }) => api.post('/auth/register', data),
    me: () => api.get('/auth/me'),
    changePassword: (data: { currentPassword: string; newPassword: string }) =>
        api.post('/auth/change-password', data),
    logout: () => api.post('/auth/logout'),
};

// ==================== INVENTORY (CSV Upload Only) ====================
// Only the CSV upload method - other methods migrated to Server Functions
export const inventoryApi = {
    uploadReconciliationCsv: (id: string, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post(`/inventory/reconciliation/${id}/upload-csv`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
};

// ==================== SHOPIFY ====================
// Admin sync operations - not yet migrated to Server Functions
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
    // Direct sync
    syncProducts: (data?: { limit?: number; syncAll?: boolean }) => api.post('/shopify/sync/products', data || {}),
    syncCustomers: (data?: { since_id?: string; created_at_min?: string; limit?: number }) =>
        api.post('/shopify/sync/customers', data || {}),
    syncAllCustomers: () => api.post('/shopify/sync/customers/all'),
    // Cache utilities
    backfillFromCache: () => api.post('/shopify/sync/backfill-from-cache'),
    backfillCacheFields: () => api.post('/shopify/sync/backfill-cache-fields'),
    reprocessCache: () => api.post('/shopify/sync/reprocess-cache'),
    getCacheStatus: () => api.get('/shopify/sync/cache-status'),
    getProductCacheStatus: () => api.get('/shopify/sync/product-cache-status'),
    // Simple sync operations
    fullDump: (daysBack?: number) => api.post('/shopify/sync/full-dump', { daysBack }),
    lookupOrder: (orderNumber: string) => api.get(`/shopify/orders/${orderNumber}`),
    processCache: (limit?: number, retryFailed?: boolean) =>
        api.post('/shopify/sync/process-cache', { limit, retryFailed }),
    // Background sync jobs
    startSyncJob: (params: {
        jobType: string;
        syncMode?: 'deep' | 'incremental';
        days?: number;
        staleAfterMins?: number;
    }) => api.post('/shopify/sync/jobs/start', params),
    getSyncJobs: (limit?: number) => api.get('/shopify/sync/jobs', { params: { limit } }),
    getSyncJobStatus: (jobId: string) => api.get(`/shopify/sync/jobs/${jobId}`),
    resumeSyncJob: (jobId: string) => api.post(`/shopify/sync/jobs/${jobId}/resume`),
    cancelSyncJob: (jobId: string) => api.post(`/shopify/sync/jobs/${jobId}/cancel`),
    // Scheduler
    getSchedulerStatus: () => api.get('/shopify/sync/scheduler/status'),
    triggerSchedulerSync: () => api.post('/shopify/sync/scheduler/trigger'),
    startScheduler: () => api.post('/shopify/sync/scheduler/start'),
    stopScheduler: () => api.post('/shopify/sync/scheduler/stop'),
    // Webhook activity
    getWebhookActivity: (params?: { hours?: number; limit?: number }) =>
        api.get('/shopify/webhooks/activity', { params }),
    getWebhookDetail: (id: string) => api.get(`/shopify/webhooks/webhook/${id}`),
};

// ==================== IMPORT/EXPORT ====================
// File uploads - cannot use Server Functions
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

// ==================== PINCODES ====================
// File uploads - cannot use Server Functions
export const pincodeApi = {
    upload: (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/pincodes/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
    lookup: (pincode: string) => api.get(`/pincodes/lookup/${pincode}`),
    batchLookup: (pincodes: string[]) => api.post('/pincodes/lookup', { pincodes }),
    getStats: () => api.get('/pincodes/stats'),
};

// ==================== REMITTANCE ====================
// File uploads - cannot use Server Functions
export const remittanceApi = {
    upload: (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/remittance/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
    getPending: (limit?: number) => api.get('/remittance/pending', { params: { limit } }),
    getSummary: (days?: number) => api.get('/remittance/summary', { params: { days } }),
    getFailed: (limit?: number) => api.get('/remittance/failed', { params: { limit } }),
    retrySync: (data: { orderIds?: string[]; all?: boolean }) => api.post('/remittance/retry-sync', data),
    approveManual: (data: { orderId: string; approvedAmount?: number }) =>
        api.post('/remittance/approve-manual', data),
};

export default api;
