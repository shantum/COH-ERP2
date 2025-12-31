import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

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
    getStockAnalysis: () => api.get('/fabrics/dashboard/stock-analysis'),
    createTransaction: (id: string, data: any) => api.post(`/fabrics/${id}/transactions`, data),
};

// Inventory
export const inventoryApi = {
    getBalance: (params?: Record<string, string>) => api.get('/inventory/balance', { params }),
    getTransactions: (params?: Record<string, string>) => api.get('/inventory/transactions', { params }),
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
    allocateLine: (lineId: string) => api.post(`/orders/lines/${lineId}/allocate`),
    unallocateLine: (lineId: string) => api.post(`/orders/lines/${lineId}/unallocate`),
    pickLine: (lineId: string) => api.post(`/orders/lines/${lineId}/pick`),
    unpickLine: (lineId: string) => api.post(`/orders/lines/${lineId}/unpick`),
    packLine: (lineId: string) => api.post(`/orders/lines/${lineId}/pack`),
    unpackLine: (lineId: string) => api.post(`/orders/lines/${lineId}/unpack`),
    ship: (id: string, data: any) => api.post(`/orders/${id}/ship`, data),
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
    getCapacity: (date?: string) => api.get('/production/capacity', { params: { date } }),
};

// Reports
export const reportsApi = {
    getDashboard: () => api.get('/reports/dashboard'),
    getSalesVelocity: (days?: number) => api.get('/reports/sales-velocity', { params: { days } }),
    getInventoryTurnover: () => api.get('/reports/inventory-turnover'),
    getCogsSummary: () => api.get('/reports/cogs-summary'),
};

export default api;
