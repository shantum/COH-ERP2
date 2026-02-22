/**
 * Test Utilities & Prisma Mock Setup
 * 
 * Provides mock utilities for testing with jest-mock-extended
 */

import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';

// Create a mock Prisma client
export const createMockPrisma = () => {
    const mockPrisma = mockDeep();

    // Reset between tests
    beforeEach(() => {
        mockReset(mockPrisma);
    });

    return mockPrisma;
};

// Common mock data factories
export const mockOrder = (overrides = {}) => ({
    id: 'order-1',
    orderNumber: 'ORD-001',
    shopifyOrderId: '12345',
    status: 'open',
    customerName: 'Test Customer',
    email: 'test@example.com',
    totalAmount: 1000,
    paymentMethod: 'Prepaid',
    channel: 'shopify',
    orderDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
});

export const mockOrderLine = (overrides = {}) => ({
    id: 'line-1',
    orderId: 'order-1',
    skuId: 'sku-1',
    qty: 1,
    unitPrice: 500,
    lineStatus: 'pending',
    ...overrides
});

export const mockSku = (overrides = {}) => ({
    id: 'sku-1',
    skuCode: 'LMD-M-S',
    size: 'M',
    isActive: true,
    isCustomSku: false,
    ...overrides
});

export const mockInventoryTransaction = (overrides = {}) => ({
    id: 'txn-1',
    skuId: 'sku-1',
    txnType: 'inward',
    qty: 10,
    reason: 'production',
    createdAt: new Date(),
    ...overrides
});

export const mockProductionBatch = (overrides = {}) => ({
    id: 'batch-1',
    batchCode: '20260108-001',
    batchDate: new Date(),
    status: 'planned',
    qtyPlanned: 10,
    qtyCompleted: 0,
    skuId: 'sku-1',
    ...overrides
});

// Shopify webhook payload factories
export const mockShopifyOrderPayload = (overrides = {}) => ({
    id: 5551234567890,
    name: '#1001',
    order_number: 1001,
    email: 'customer@example.com',
    total_price: '2999.00',
    financial_status: 'paid',
    fulfillment_status: null,
    created_at: '2024-01-15T10:30:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    customer: {
        id: 123456789,
        email: 'customer@example.com',
        first_name: 'John',
        last_name: 'Doe'
    },
    billing_address: {
        first_name: 'John',
        last_name: 'Doe',
        address1: '123 Main St',
        city: 'Mumbai',
        province: 'Maharashtra',
        country: 'India',
        zip: '400001',
        phone: '+919876543210'
    },
    shipping_address: {
        first_name: 'John',
        last_name: 'Doe',
        address1: '123 Main St',
        city: 'Mumbai',
        province: 'Maharashtra',
        country: 'India',
        zip: '400001',
        phone: '+919876543210'
    },
    line_items: [
        {
            id: 123,
            variant_id: 456,
            quantity: 2,
            price: '1499.50',
            sku: 'LMD-M-S',
            name: 'Test Product - Medium',
            title: 'Test Product'
        }
    ],
    ...overrides
});

export const mockShopifyProductPayload = (overrides = {}) => ({
    id: 7654321098765,
    title: 'Test Product',
    handle: 'test-product',
    status: 'active',
    vendor: 'COH',
    product_type: 'Dress',
    variants: [
        {
            id: 45678901234567,
            product_id: 7654321098765,
            title: 'M / Blue',
            sku: 'LMD-M-S',
            price: '1499.00',
            inventory_quantity: 10
        }
    ],
    ...overrides
});

// Express request/response mocks
export const createMockRequest = (overrides = {}) => ({
    body: {},
    params: {},
    query: {},
    headers: {},
    get: jest.fn((header) => overrides.headers?.[header]),
    prisma: createMockPrisma(),
    user: { id: 'user-1', email: 'admin@test.com' },
    ...overrides
});

export const createMockResponse = () => {
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis()
    };
    return res;
};

export const createMockNext = () => jest.fn();

// Mock Shopify order cache factory
export const mockShopifyOrderCache = (overrides = {}) => ({
    id: '5551234567890',
    rawData: '{}',
    orderNumber: '#1001',
    financialStatus: 'paid',
    fulfillmentStatus: null,
    lastWebhookAt: new Date(),
    webhookTopic: 'orders/create',
    processedAt: null,
    processingError: null,
    createdAt: new Date(),
    customerNotes: null,
    discountCodes: null,
    paymentMethod: 'Prepaid',
    shippedAt: null,
    shippingCity: 'Mumbai',
    shippingCountry: 'India',
    shippingState: 'Maharashtra',
    tags: null,
    trackingCompany: null,
    trackingNumber: null,
    processingLock: null,
    ...overrides
});

// Mock Shopify fulfillment factory
export const mockShopifyFulfillment = (overrides = {}) => ({
    id: 12345,
    tracking_number: 'AWB123456',
    tracking_company: 'Delhivery',
    tracking_url: 'https://tracking.example.com/AWB123456',
    tracking_urls: ['https://tracking.example.com/AWB123456'],
    created_at: '2024-01-15T10:30:00Z',
    shipment_status: 'in_transit',
    line_items: [
        { id: 123, variant_id: 456, quantity: 1 }
    ],
    ...overrides
});

// Create Axios-like error for testing API error handling
export const createAxiosError = (status, data, message = 'Request failed') => {
    const error = new Error(message);
    error.response = {
        status,
        data,
        headers: {},
        statusText: status === 429 ? 'Too Many Requests' : 'Error',
    };
    error.isAxiosError = true;
    return error;
};
