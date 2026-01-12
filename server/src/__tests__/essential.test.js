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
import { validatePassword } from '../utils/validation.js';
import { calculateTier, calculateLTV, DEFAULT_TIER_THRESHOLDS } from '../utils/tierUtils.js';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption.js';
import { normalizeSize, buildVariantImageMap, groupVariantsByColor } from '../services/productSyncService.ts';
import { buildCustomerData } from '../services/customerSyncService.ts';

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

    it('should default to open for fulfilled orders (ERP manages ship status)', () => {
        // Note: Shopify fulfillment_status is informational only
        // ERP manages shipped/delivered status via Ship Order action
        const order = { fulfillment_status: 'fulfilled' };
        expect(shopifyClient.mapOrderStatus(order)).toBe('open');
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

// ============================================
// PASSWORD VALIDATION TESTS
// ============================================

describe('validatePassword', () => {
    it('should accept a valid password with all requirements', () => {
        const result = validatePassword('MyPass123!');
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('should reject password shorter than 8 characters', () => {
        const result = validatePassword('Ab1!xyz');
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Password must be at least 8 characters long');
    });

    it('should reject password without uppercase letter', () => {
        const result = validatePassword('mypass123!');
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one uppercase letter');
    });

    it('should reject password without lowercase letter', () => {
        const result = validatePassword('MYPASS123!');
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one lowercase letter');
    });

    it('should reject password without number', () => {
        const result = validatePassword('MyPassword!');
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one number');
    });

    it('should reject password without special character', () => {
        const result = validatePassword('MyPassword123');
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('special character'));
    });

    it('should return multiple errors for very weak password', () => {
        const result = validatePassword('abc');
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(1);
    });

    it('should handle null/undefined password', () => {
        const result = validatePassword(null);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Password must be at least 8 characters long');
    });
});

// ============================================
// CUSTOMER TIER CALCULATION TESTS
// ============================================

describe('calculateTier', () => {
    it('should return platinum for LTV >= 50000', () => {
        expect(calculateTier(50000)).toBe('platinum');
        expect(calculateTier(75000)).toBe('platinum');
        expect(calculateTier(100000)).toBe('platinum');
    });

    it('should return gold for LTV >= 25000 but < 50000', () => {
        expect(calculateTier(25000)).toBe('gold');
        expect(calculateTier(35000)).toBe('gold');
        expect(calculateTier(49999)).toBe('gold');
    });

    it('should return silver for LTV >= 10000 but < 25000', () => {
        expect(calculateTier(10000)).toBe('silver');
        expect(calculateTier(15000)).toBe('silver');
        expect(calculateTier(24999)).toBe('silver');
    });

    it('should return bronze for LTV < 10000', () => {
        expect(calculateTier(0)).toBe('bronze');
        expect(calculateTier(5000)).toBe('bronze');
        expect(calculateTier(9999)).toBe('bronze');
    });

    it('should use custom thresholds when provided', () => {
        const customThresholds = { platinum: 100000, gold: 50000, silver: 20000 };
        expect(calculateTier(75000, customThresholds)).toBe('gold'); // Would be platinum with defaults
        expect(calculateTier(35000, customThresholds)).toBe('silver'); // Would be gold with defaults
    });
});

describe('calculateLTV', () => {
    it('should return 0 for empty orders array', () => {
        expect(calculateLTV([])).toBe(0);
    });

    it('should return 0 for null/undefined orders', () => {
        expect(calculateLTV(null)).toBe(0);
        expect(calculateLTV(undefined)).toBe(0);
    });

    it('should sum total amounts from valid orders', () => {
        const orders = [
            { totalAmount: 10000, status: 'delivered' },
            { totalAmount: 5000, status: 'open' },
            { totalAmount: 2000, status: 'shipped' }
        ];
        expect(calculateLTV(orders)).toBe(17000);
    });

    it('should exclude cancelled orders from LTV', () => {
        const orders = [
            { totalAmount: 10000, status: 'delivered' },
            { totalAmount: 5000, status: 'cancelled' }, // Should be excluded
            { totalAmount: 3000, status: 'open' }
        ];
        expect(calculateLTV(orders)).toBe(13000);
    });

    it('should handle string amounts', () => {
        const orders = [
            { totalAmount: '10000', status: 'delivered' },
            { totalAmount: '5000', status: 'open' }
        ];
        expect(calculateLTV(orders)).toBe(15000);
    });
});

describe('DEFAULT_TIER_THRESHOLDS', () => {
    it('should have correct default values', () => {
        expect(DEFAULT_TIER_THRESHOLDS.platinum).toBe(50000);
        expect(DEFAULT_TIER_THRESHOLDS.gold).toBe(25000);
        expect(DEFAULT_TIER_THRESHOLDS.silver).toBe(10000);
    });
});

// ============================================
// ENCRYPTION UTILITY TESTS
// ============================================

describe('Encryption Utilities', () => {
    // Set JWT_SECRET for encryption tests
    const originalEnv = process.env.JWT_SECRET;

    beforeAll(() => {
        process.env.JWT_SECRET = 'test-secret-key-for-encryption-tests';
    });

    afterAll(() => {
        process.env.JWT_SECRET = originalEnv;
    });

    describe('encrypt and decrypt', () => {
        it('should encrypt and decrypt a string correctly', () => {
            const plaintext = 'my-secret-api-key';
            const encrypted = encrypt(plaintext);
            const decrypted = decrypt(encrypted);
            expect(decrypted).toBe(plaintext);
        });

        it('should produce different ciphertext for same plaintext (random IV)', () => {
            const plaintext = 'same-value';
            const encrypted1 = encrypt(plaintext);
            const encrypted2 = encrypt(plaintext);
            expect(encrypted1).not.toBe(encrypted2);
        });

        it('should return null for null input', () => {
            expect(encrypt(null)).toBeNull();
            expect(decrypt(null)).toBeNull();
        });

        it('should return null for empty string', () => {
            expect(encrypt('')).toBeNull();
            expect(decrypt('')).toBeNull();
        });

        it('should handle special characters', () => {
            const plaintext = 'key!@#$%^&*()_+-=[]{}|;\':",./<>?';
            const encrypted = encrypt(plaintext);
            const decrypted = decrypt(encrypted);
            expect(decrypted).toBe(plaintext);
        });

        it('should handle unicode characters', () => {
            const plaintext = 'こんにちは世界🌍';
            const encrypted = encrypt(plaintext);
            const decrypted = decrypt(encrypted);
            expect(decrypted).toBe(plaintext);
        });
    });

    describe('isEncrypted', () => {
        it('should return true for encrypted values', () => {
            const encrypted = encrypt('test-value');
            expect(isEncrypted(encrypted)).toBe(true);
        });

        it('should return false for plaintext values', () => {
            expect(isEncrypted('plain-api-key')).toBe(false);
            expect(isEncrypted('short')).toBe(false);
        });

        it('should return false for null/empty values', () => {
            expect(isEncrypted(null)).toBe(false);
            expect(isEncrypted('')).toBe(false);
            expect(isEncrypted(undefined)).toBe(false);
        });
    });
});

// ============================================
// PRODUCT SYNC SERVICE TESTS
// ============================================

describe('normalizeSize', () => {
    it('should normalize XXL to 2XL', () => {
        expect(normalizeSize('XXL')).toBe('2XL');
        expect(normalizeSize('xxl')).toBe('2XL');
    });

    it('should normalize XXXL to 3XL', () => {
        expect(normalizeSize('XXXL')).toBe('3XL');
        expect(normalizeSize('xxxl')).toBe('3XL');
    });

    it('should normalize XXXXL to 4XL', () => {
        expect(normalizeSize('XXXXL')).toBe('4XL');
        expect(normalizeSize('xxxxl')).toBe('4XL');
    });

    it('should leave other sizes unchanged', () => {
        expect(normalizeSize('S')).toBe('S');
        expect(normalizeSize('M')).toBe('M');
        expect(normalizeSize('L')).toBe('L');
        expect(normalizeSize('XL')).toBe('XL');
        expect(normalizeSize('2XL')).toBe('2XL');
        expect(normalizeSize('One Size')).toBe('One Size');
    });
});

describe('buildVariantImageMap', () => {
    it('should map variant IDs to image URLs', () => {
        const product = {
            images: [
                { src: 'https://cdn.shopify.com/red.jpg', variant_ids: [123, 456] },
                { src: 'https://cdn.shopify.com/blue.jpg', variant_ids: [789] }
            ]
        };
        const map = buildVariantImageMap(product);
        expect(map[123]).toBe('https://cdn.shopify.com/red.jpg');
        expect(map[456]).toBe('https://cdn.shopify.com/red.jpg');
        expect(map[789]).toBe('https://cdn.shopify.com/blue.jpg');
    });

    it('should return empty object for product without images', () => {
        expect(buildVariantImageMap({})).toEqual({});
        expect(buildVariantImageMap({ images: [] })).toEqual({});
    });

    it('should handle images without variant_ids', () => {
        const product = {
            images: [{ src: 'https://cdn.shopify.com/main.jpg' }]
        };
        expect(buildVariantImageMap(product)).toEqual({});
    });
});

describe('groupVariantsByColor', () => {
    it('should group variants by color option (option1)', () => {
        const variants = [
            { id: 1, option1: 'Red', option2: 'S' },
            { id: 2, option1: 'Red', option2: 'M' },
            { id: 3, option1: 'Blue', option2: 'S' },
            { id: 4, option1: 'Blue', option2: 'M' }
        ];
        const grouped = groupVariantsByColor(variants);
        expect(Object.keys(grouped)).toEqual(['Red', 'Blue']);
        expect(grouped.Red).toHaveLength(2);
        expect(grouped.Blue).toHaveLength(2);
    });

    it('should use "Default" for variants without color option', () => {
        const variants = [
            { id: 1, option2: 'S' },
            { id: 2, option2: 'M' }
        ];
        const grouped = groupVariantsByColor(variants);
        expect(grouped.Default).toHaveLength(2);
    });

    it('should handle empty/null variants array', () => {
        expect(groupVariantsByColor([])).toEqual({});
        expect(groupVariantsByColor(null)).toEqual({});
        expect(groupVariantsByColor(undefined)).toEqual({});
    });
});

// ============================================
// CUSTOMER SYNC SERVICE TESTS
// ============================================

describe('buildCustomerData', () => {
    // Mock shopifyClient.formatAddress for this test
    const mockFormatAddress = (addr) => ({
        address1: addr.address1,
        city: addr.city,
        zip: addr.zip,
        country: addr.country
    });

    beforeAll(() => {
        // Save original
        global._originalFormatAddress = shopifyClient.formatAddress;
        shopifyClient.formatAddress = mockFormatAddress;
    });

    afterAll(() => {
        // Restore
        shopifyClient.formatAddress = global._originalFormatAddress;
    });

    it('should build customer data from Shopify customer', () => {
        const shopifyCustomer = {
            id: 12345,
            email: 'John@Example.com',
            phone: '+1234567890',
            first_name: 'John',
            last_name: 'Doe',
            tags: 'VIP, Repeat',
            accepts_marketing: true
        };
        const data = buildCustomerData(shopifyCustomer);

        expect(data.shopifyCustomerId).toBe('12345');
        expect(data.email).toBe('john@example.com'); // lowercase
        expect(data.phone).toBe('+1234567890');
        expect(data.firstName).toBe('John');
        expect(data.lastName).toBe('Doe');
        expect(data.tags).toBe('VIP, Repeat');
        expect(data.acceptsMarketing).toBe(true);
    });

    it('should throw error when customer has no email', () => {
        const shopifyCustomer = {
            id: 99999,
            email: null,
            phone: null,
            first_name: null,
            last_name: null
        };

        expect(() => buildCustomerData(shopifyCustomer)).toThrow('Customer 99999 has no email address');
    });

    it('should handle customer without other optional fields', () => {
        const shopifyCustomer = {
            id: 99999,
            email: 'test@example.com',
            phone: null,
            first_name: null,
            last_name: null
        };
        const data = buildCustomerData(shopifyCustomer);

        expect(data.shopifyCustomerId).toBe('99999');
        expect(data.email).toBe('test@example.com');
        expect(data.phone).toBeNull();
        expect(data.firstName).toBeNull();
        expect(data.lastName).toBeNull();
        expect(data.acceptsMarketing).toBe(false);
    });

    it('should stringify default address when present', () => {
        const shopifyCustomer = {
            id: 11111,
            email: 'test@test.com',
            default_address: {
                address1: '123 Main St',
                city: 'Mumbai',
                zip: '400001',
                country: 'India'
            }
        };
        const data = buildCustomerData(shopifyCustomer);

        expect(data.defaultAddress).not.toBeNull();
        const parsed = JSON.parse(data.defaultAddress);
        expect(parsed.city).toBe('Mumbai');
        expect(parsed.country).toBe('India');
    });
});
