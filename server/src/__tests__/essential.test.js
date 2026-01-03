/**
 * Essential Tests for COH-ERP2
 * 
 * Tests pure utility functions that are critical to business logic:
 * - Inventory balance calculations
 * - Fabric consumption calculations
 * - Shopify status mapping
 */

import {
    TXN_TYPE,
    TXN_REASON,
    getEffectiveFabricConsumption,
} from '../utils/queryPatterns.js';
import shopifyClient from '../services/shopify.js';

// ============================================
// INVENTORY CALCULATION TESTS
// ============================================

describe('getEffectiveFabricConsumption', () => {
    it('should use SKU-specific value when set and positive', () => {
        const sku = {
            fabricConsumption: 2.5,
            variation: {
                product: {
                    defaultFabricConsumption: 1.0
                }
            }
        };
        expect(getEffectiveFabricConsumption(sku)).toBe(2.5);
    });

    it('should fallback to product default when SKU consumption is 0', () => {
        const sku = {
            fabricConsumption: 0,
            variation: {
                product: {
                    defaultFabricConsumption: 1.8
                }
            }
        };
        expect(getEffectiveFabricConsumption(sku)).toBe(1.8);
    });

    it('should fallback to product default when SKU consumption is not set', () => {
        const sku = {
            variation: {
                product: {
                    defaultFabricConsumption: 2.0
                }
            }
        };
        expect(getEffectiveFabricConsumption(sku)).toBe(2.0);
    });

    it('should return 1.5 as final fallback when no values set', () => {
        const sku = {
            fabricConsumption: 0,
            variation: {
                product: {}
            }
        };
        expect(getEffectiveFabricConsumption(sku)).toBe(1.5);
    });

    it('should return 1.5 when product default is 0', () => {
        const sku = {
            fabricConsumption: 0,
            variation: {
                product: {
                    defaultFabricConsumption: 0
                }
            }
        };
        expect(getEffectiveFabricConsumption(sku)).toBe(1.5);
    });

    it('should handle missing variation gracefully', () => {
        const sku = {
            fabricConsumption: 0,
            variation: null
        };
        expect(getEffectiveFabricConsumption(sku)).toBe(1.5);
    });
});

// ============================================
// TRANSACTION CONSTANTS TESTS
// ============================================

describe('Transaction Constants', () => {
    it('should have correct transaction types', () => {
        expect(TXN_TYPE.INWARD).toBe('inward');
        expect(TXN_TYPE.OUTWARD).toBe('outward');
        expect(TXN_TYPE.RESERVED).toBe('reserved');
    });

    it('should have correct transaction reasons', () => {
        expect(TXN_REASON.ORDER_ALLOCATION).toBe('order_allocation');
        expect(TXN_REASON.PRODUCTION).toBe('production');
        expect(TXN_REASON.SALE).toBe('sale');
        expect(TXN_REASON.RETURN_RECEIPT).toBe('return_receipt');
    });
});

// ============================================
// SHOPIFY STATUS MAPPING TESTS
// ============================================

describe('ShopifyClient.mapOrderStatus', () => {
    it('should map cancelled orders correctly', () => {
        const order = { cancelled_at: '2024-01-15T10:00:00Z' };
        expect(shopifyClient.mapOrderStatus(order)).toBe('cancelled');
    });

    it('should map fulfilled orders to delivered', () => {
        const order = { fulfillment_status: 'fulfilled' };
        expect(shopifyClient.mapOrderStatus(order)).toBe('delivered');
    });

    it('should default to open for unfulfilled orders', () => {
        const order = { fulfillment_status: null };
        expect(shopifyClient.mapOrderStatus(order)).toBe('open');
    });

    it('should default to open for empty order', () => {
        const order = {};
        expect(shopifyClient.mapOrderStatus(order)).toBe('open');
    });

    it('should prioritize cancelled over fulfilled', () => {
        const order = {
            cancelled_at: '2024-01-15T10:00:00Z',
            fulfillment_status: 'fulfilled'
        };
        expect(shopifyClient.mapOrderStatus(order)).toBe('cancelled');
    });
});

describe('ShopifyClient.mapOrderChannel', () => {
    it('should detect online store orders', () => {
        const order = { source_name: 'web' };
        expect(shopifyClient.mapOrderChannel(order)).toBe('shopify_online');
    });

    it('should detect POS orders', () => {
        const order = { source_name: 'pos' };
        expect(shopifyClient.mapOrderChannel(order)).toBe('shopify_pos');
    });

    it('should default to shopify_online for unknown sources', () => {
        const order = { source_name: 'unknown' };
        expect(shopifyClient.mapOrderChannel(order)).toBe('shopify_online');
    });
});

describe('ShopifyClient.normalizeGender', () => {
    it('should normalize women variants', () => {
        expect(shopifyClient.normalizeGender('Women')).toBe('women');
        expect(shopifyClient.normalizeGender('womens')).toBe('women');
        expect(shopifyClient.normalizeGender('WOMEN')).toBe('women');
        expect(shopifyClient.normalizeGender('female')).toBe('women');
        // Note: 'ladies' is not currently recognized by implementation
    });

    it('should normalize men variants', () => {
        expect(shopifyClient.normalizeGender('Men')).toBe('men');
        expect(shopifyClient.normalizeGender('mens')).toBe('men');
        expect(shopifyClient.normalizeGender('MEN')).toBe('men');
        expect(shopifyClient.normalizeGender('male')).toBe('men');
    });

    it('should return unisex for unknown values', () => {
        expect(shopifyClient.normalizeGender('unknown')).toBe('unisex');
        expect(shopifyClient.normalizeGender('')).toBe('unisex');
        expect(shopifyClient.normalizeGender(null)).toBe('unisex');
        expect(shopifyClient.normalizeGender('ladies')).toBe('unisex'); // Not recognized
    });
});

// ============================================
// PAYMENT METHOD DETECTION TESTS
// ============================================

describe('Payment Method Detection Logic', () => {
    // Testing the logic used in shopifyOrderProcessor.js
    const detectPaymentMethod = (shopifyOrder) => {
        const gatewayNames = (shopifyOrder.payment_gateway_names || []).join(', ').toLowerCase();
        const isPrepaidGateway = gatewayNames.includes('shopflo') || gatewayNames.includes('razorpay');
        return isPrepaidGateway ? 'Prepaid' :
            (shopifyOrder.financial_status === 'pending' ? 'COD' : 'Prepaid');
    };

    it('should detect COD for pending financial status', () => {
        const order = {
            financial_status: 'pending',
            payment_gateway_names: []
        };
        expect(detectPaymentMethod(order)).toBe('COD');
    });

    it('should detect Prepaid for paid orders', () => {
        const order = {
            financial_status: 'paid',
            payment_gateway_names: []
        };
        expect(detectPaymentMethod(order)).toBe('Prepaid');
    });

    it('should detect Prepaid for Razorpay gateway', () => {
        const order = {
            financial_status: 'pending',
            payment_gateway_names: ['razorpay']
        };
        expect(detectPaymentMethod(order)).toBe('Prepaid');
    });

    it('should detect Prepaid for Shopflo gateway', () => {
        const order = {
            financial_status: 'pending',
            payment_gateway_names: ['shopflo']
        };
        expect(detectPaymentMethod(order)).toBe('Prepaid');
    });

    it('should handle missing payment_gateway_names', () => {
        const order = { financial_status: 'pending' };
        expect(detectPaymentMethod(order)).toBe('COD');
    });
});

// ============================================
// INVENTORY BALANCE LOGIC TESTS
// ============================================

describe('Inventory Balance Logic', () => {
    // Testing the calculation logic (without database)
    const calculateBalance = (transactions) => {
        let totalInward = 0;
        let totalOutward = 0;
        let totalReserved = 0;

        transactions.forEach(t => {
            if (t.txnType === 'inward') totalInward += t.qty;
            else if (t.txnType === 'outward') totalOutward += t.qty;
            else if (t.txnType === 'reserved') totalReserved += t.qty;
        });

        return {
            totalInward,
            totalOutward,
            totalReserved,
            currentBalance: totalInward - totalOutward,
            availableBalance: totalInward - totalOutward - totalReserved
        };
    };

    it('should return zero for empty transactions', () => {
        const balance = calculateBalance([]);
        expect(balance.currentBalance).toBe(0);
        expect(balance.availableBalance).toBe(0);
    });

    it('should calculate inward correctly', () => {
        const transactions = [
            { txnType: 'inward', qty: 10 },
            { txnType: 'inward', qty: 5 }
        ];
        const balance = calculateBalance(transactions);
        expect(balance.totalInward).toBe(15);
        expect(balance.currentBalance).toBe(15);
        expect(balance.availableBalance).toBe(15);
    });

    it('should subtract outward from balance', () => {
        const transactions = [
            { txnType: 'inward', qty: 20 },
            { txnType: 'outward', qty: 8 }
        ];
        const balance = calculateBalance(transactions);
        expect(balance.currentBalance).toBe(12);
        expect(balance.availableBalance).toBe(12);
    });

    it('should subtract reserved from available but not current', () => {
        const transactions = [
            { txnType: 'inward', qty: 20 },
            { txnType: 'reserved', qty: 5 }
        ];
        const balance = calculateBalance(transactions);
        expect(balance.currentBalance).toBe(20);
        expect(balance.availableBalance).toBe(15);
    });

    it('should handle complex transaction mix', () => {
        const transactions = [
            { txnType: 'inward', qty: 100 },   // +100
            { txnType: 'outward', qty: 30 },   // -30
            { txnType: 'reserved', qty: 20 },  // soft hold
            { txnType: 'inward', qty: 10 },    // +10
            { txnType: 'outward', qty: 5 }     // -5
        ];
        const balance = calculateBalance(transactions);
        expect(balance.totalInward).toBe(110);
        expect(balance.totalOutward).toBe(35);
        expect(balance.totalReserved).toBe(20);
        expect(balance.currentBalance).toBe(75);  // 110 - 35
        expect(balance.availableBalance).toBe(55); // 75 - 20
    });

    it('should allow negative available balance (oversold)', () => {
        const transactions = [
            { txnType: 'inward', qty: 10 },
            { txnType: 'reserved', qty: 15 }
        ];
        const balance = calculateBalance(transactions);
        expect(balance.currentBalance).toBe(10);
        expect(balance.availableBalance).toBe(-5);
    });
});
