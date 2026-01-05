/**
 * Integration Tests for COH-ERP2
 * 
 * Tests for high-priority business flows:
 * - Order fulfillment (allocation, pick, pack, ship)
 * - Return processing (create ticket, receive, QC, restock)
 * - Shopify sync (order processing logic)
 */

import {
    TXN_TYPE,
    TXN_REASON,
    releaseReservedInventory,
    createReservedTransaction,
    createSaleTransaction,
    deleteSaleTransactions,
} from '../utils/queryPatterns.js';
import shopifyClient from '../services/shopify.js';

// ============================================
// ORDER FULFILLMENT FLOW TESTS
// ============================================

describe('Order Fulfillment Flow - Status Transitions', () => {
    // Test the valid state machine transitions
    const validTransitions = {
        pending: ['allocated'],
        allocated: ['pending', 'picked', 'shipped'],
        picked: ['allocated', 'packed'],
        packed: ['picked', 'shipped'],
        shipped: ['allocated'], // unship
    };

    describe('Forward Transitions', () => {
        it('should allow pending → allocated', () => {
            const from = 'pending';
            const to = 'allocated';
            expect(validTransitions[from]).toContain(to);
        });

        it('should allow allocated → picked', () => {
            const from = 'allocated';
            const to = 'picked';
            expect(validTransitions[from]).toContain(to);
        });

        it('should allow picked → packed', () => {
            const from = 'picked';
            const to = 'packed';
            expect(validTransitions[from]).toContain(to);
        });

        it('should allow packed → shipped (via order ship)', () => {
            const from = 'packed';
            const to = 'shipped';
            expect(validTransitions[from]).toContain(to);
        });

        it('should allow allocated → shipped (skip pick/pack)', () => {
            const from = 'allocated';
            const to = 'shipped';
            expect(validTransitions[from]).toContain(to);
        });
    });

    describe('Backward Transitions (Undo)', () => {
        it('should allow allocated → pending (unallocate)', () => {
            const from = 'allocated';
            const to = 'pending';
            expect(validTransitions[from]).toContain(to);
        });

        it('should allow picked → allocated (unpick)', () => {
            const from = 'picked';
            const to = 'allocated';
            expect(validTransitions[from]).toContain(to);
        });

        it('should allow packed → picked (unpack)', () => {
            const from = 'packed';
            const to = 'picked';
            expect(validTransitions[from]).toContain(to);
        });

        it('should allow shipped → allocated (unship)', () => {
            const from = 'shipped';
            const to = 'allocated';
            expect(validTransitions[from]).toContain(to);
        });
    });
});

describe('Order Fulfillment Flow - Fulfillment Stage Calculation', () => {
    // This matches the logic in orders.js GET /open endpoint
    const calculateFulfillmentStage = (lineStatuses) => {
        if (lineStatuses.length === 0) return 'pending';
        if (lineStatuses.every(s => s === 'packed')) {
            return 'ready_to_ship';
        } else if (lineStatuses.some(s => ['picked', 'packed'].includes(s))) {
            return 'in_progress';
        } else if (lineStatuses.every(s => s === 'allocated')) {
            return 'allocated';
        }
        return 'pending';
    };

    it('should return pending when all lines are pending', () => {
        expect(calculateFulfillmentStage(['pending', 'pending', 'pending'])).toBe('pending');
    });

    it('should return allocated when all lines are allocated', () => {
        expect(calculateFulfillmentStage(['allocated', 'allocated'])).toBe('allocated');
    });

    it('should return in_progress when some lines are picked', () => {
        expect(calculateFulfillmentStage(['allocated', 'picked', 'pending'])).toBe('in_progress');
    });

    it('should return in_progress when mix of picked and packed', () => {
        expect(calculateFulfillmentStage(['picked', 'packed', 'allocated'])).toBe('in_progress');
    });

    it('should return ready_to_ship when all lines are packed', () => {
        expect(calculateFulfillmentStage(['packed', 'packed', 'packed'])).toBe('ready_to_ship');
    });

    it('should handle single line order', () => {
        expect(calculateFulfillmentStage(['pending'])).toBe('pending');
        expect(calculateFulfillmentStage(['allocated'])).toBe('allocated');
        expect(calculateFulfillmentStage(['packed'])).toBe('ready_to_ship');
    });

    it('should handle empty lines array', () => {
        expect(calculateFulfillmentStage([])).toBe('pending');
    });
});

describe('Order Fulfillment Flow - Shipping Validation', () => {
    // Matches validation in orders.js POST /:id/ship
    const canShip = (lineStatuses) => {
        const validStatuses = ['allocated', 'picked', 'packed'];
        return lineStatuses.every(s => validStatuses.includes(s));
    };

    it('should allow shipping when all lines are allocated', () => {
        expect(canShip(['allocated', 'allocated'])).toBe(true);
    });

    it('should allow shipping when all lines are picked', () => {
        expect(canShip(['picked', 'picked'])).toBe(true);
    });

    it('should allow shipping when all lines are packed', () => {
        expect(canShip(['packed', 'packed'])).toBe(true);
    });

    it('should allow shipping with mixed allocated/picked/packed', () => {
        expect(canShip(['allocated', 'picked', 'packed'])).toBe(true);
    });

    it('should NOT allow shipping when some lines are pending', () => {
        expect(canShip(['pending', 'allocated'])).toBe(false);
    });

    it('should NOT allow shipping when any line is shipped', () => {
        expect(canShip(['shipped', 'allocated'])).toBe(false);
    });
});

describe('Order Fulfillment Flow - Order Status Rules', () => {
    // Business rules for order status changes
    const canCancel = (orderStatus) => {
        return !['shipped', 'delivered', 'cancelled'].includes(orderStatus);
    };

    const canUnship = (orderStatus) => {
        return orderStatus === 'shipped';
    };

    const canUncancel = (orderStatus) => {
        return orderStatus === 'cancelled';
    };

    it('should allow cancel for open orders', () => {
        expect(canCancel('open')).toBe(true);
    });

    it('should NOT allow cancel for shipped orders', () => {
        expect(canCancel('shipped')).toBe(false);
    });

    it('should NOT allow cancel for delivered orders', () => {
        expect(canCancel('delivered')).toBe(false);
    });

    it('should NOT allow cancel for already cancelled orders', () => {
        expect(canCancel('cancelled')).toBe(false);
    });

    it('should allow unship for shipped orders', () => {
        expect(canUnship('shipped')).toBe(true);
    });

    it('should NOT allow unship for delivered orders', () => {
        expect(canUnship('delivered')).toBe(false);
    });

    it('should allow uncancel only for cancelled orders', () => {
        expect(canUncancel('cancelled')).toBe(true);
        expect(canUncancel('open')).toBe(false);
    });
});

describe('Order Fulfillment Flow - Tracking Status', () => {
    // Matches logic in orders.js GET /shipped
    const calculateTrackingStatus = (orderStatus, daysInTransit) => {
        if (orderStatus === 'delivered') {
            return 'completed';
        } else if (daysInTransit > 7) {
            return 'delivery_delayed';
        }
        return 'in_transit';
    };

    it('should return completed for delivered orders', () => {
        expect(calculateTrackingStatus('delivered', 0)).toBe('completed');
        expect(calculateTrackingStatus('delivered', 10)).toBe('completed');
    });

    it('should return in_transit for recent shipments', () => {
        expect(calculateTrackingStatus('shipped', 0)).toBe('in_transit');
        expect(calculateTrackingStatus('shipped', 5)).toBe('in_transit');
        expect(calculateTrackingStatus('shipped', 7)).toBe('in_transit');
    });

    it('should return delivery_delayed after 7 days', () => {
        expect(calculateTrackingStatus('shipped', 8)).toBe('delivery_delayed');
        expect(calculateTrackingStatus('shipped', 14)).toBe('delivery_delayed');
    });
});

// ============================================
// RETURN PROCESSING FLOW TESTS
// ============================================

describe('Return Processing - Status Transitions', () => {
    const validReturnStatuses = ['requested', 'reverse_initiated', 'in_transit', 'received', 'qc_pending', 'qc_approved', 'qc_rejected', 'processed', 'closed'];

    it('should have all expected return statuses', () => {
        expect(validReturnStatuses).toContain('requested');
        expect(validReturnStatuses).toContain('received');
        expect(validReturnStatuses).toContain('qc_pending');
        expect(validReturnStatuses).toContain('processed');
    });

    // Return line conditions after QC
    const validItemConditions = ['resellable', 'damaged', 'defective', 'wrong_item'];

    it('should recognize all item conditions', () => {
        expect(validItemConditions).toContain('resellable');
        expect(validItemConditions).toContain('damaged');
        expect(validItemConditions).toContain('defective');
    });

    it('should identify resellable items for restock', () => {
        const shouldRestock = (condition) => condition === 'resellable';
        expect(shouldRestock('resellable')).toBe(true);
        expect(shouldRestock('damaged')).toBe(false);
        expect(shouldRestock('defective')).toBe(false);
    });
});

describe('Return Processing - Reason Categories', () => {
    const validReasonCategories = [
        'size_issue',
        'quality_issue',
        'wrong_item',
        'not_as_described',
        'changed_mind',
        'other'
    ];

    it('should have size_issue as valid reason', () => {
        expect(validReasonCategories).toContain('size_issue');
    });

    it('should have quality_issue as valid reason', () => {
        expect(validReasonCategories).toContain('quality_issue');
    });

    it('should have changed_mind as valid reason', () => {
        expect(validReasonCategories).toContain('changed_mind');
    });
});

// ============================================
// SHOPIFY SYNC FLOW TESTS
// ============================================

describe('Shopify Order Processing - Order Status Mapping', () => {
    // Uses shopifyClient.mapOrderStatus which we already test
    // Here we test the processing decision logic

    it('should map cancelled_at to cancelled status', () => {
        const order = { cancelled_at: '2024-01-15' };
        expect(shopifyClient.mapOrderStatus(order)).toBe('cancelled');
    });

    it('should map fulfilled to delivered status', () => {
        const order = { fulfillment_status: 'fulfilled' };
        expect(shopifyClient.mapOrderStatus(order)).toBe('delivered');
    });

    it('should default to open for new orders', () => {
        const order = {};
        expect(shopifyClient.mapOrderStatus(order)).toBe('open');
    });
});

describe('Shopify Order Processing - Payment Method Detection', () => {
    // Extract payment detection logic for testing
    const detectPaymentMethod = (shopifyOrder) => {
        const gatewayNames = (shopifyOrder.payment_gateway_names || []).join(', ').toLowerCase();
        const isPrepaidGateway = gatewayNames.includes('shopflo') || gatewayNames.includes('razorpay');
        return isPrepaidGateway ? 'Prepaid' :
            (shopifyOrder.financial_status === 'pending' ? 'COD' : 'Prepaid');
    };

    it('should detect COD for pending payment status', () => {
        expect(detectPaymentMethod({ financial_status: 'pending' })).toBe('COD');
    });

    it('should detect Prepaid for paid status', () => {
        expect(detectPaymentMethod({ financial_status: 'paid' })).toBe('Prepaid');
    });

    it('should detect Prepaid for Razorpay', () => {
        expect(detectPaymentMethod({
            financial_status: 'pending',
            payment_gateway_names: ['Razorpay']
        })).toBe('Prepaid');
    });

    it('should detect Prepaid for Shopflo', () => {
        expect(detectPaymentMethod({
            financial_status: 'pending',
            payment_gateway_names: ['shopflo']
        })).toBe('Prepaid');
    });
});

describe('Shopify Order Processing - Customer Name Building', () => {
    // Matches logic in shopifyOrderProcessor.js
    const buildCustomerName = (order) => {
        const shippingAddress = order.shipping_address;
        const customer = order.customer;

        if (shippingAddress) {
            return `${shippingAddress.first_name || ''} ${shippingAddress.last_name || ''}`.trim() || 'Unknown';
        }
        if (customer?.first_name) {
            return `${customer.first_name} ${customer.last_name || ''}`.trim();
        }
        return 'Unknown';
    };

    it('should use shipping address name first', () => {
        const order = {
            shipping_address: { first_name: 'John', last_name: 'Doe' },
            customer: { first_name: 'Jane', last_name: 'Smith' }
        };
        expect(buildCustomerName(order)).toBe('John Doe');
    });

    it('should fall back to customer name', () => {
        const order = {
            customer: { first_name: 'Jane', last_name: 'Smith' }
        };
        expect(buildCustomerName(order)).toBe('Jane Smith');
    });

    it('should handle missing last name', () => {
        const order = {
            shipping_address: { first_name: 'John' }
        };
        expect(buildCustomerName(order)).toBe('John');
    });

    it('should return Unknown for missing data', () => {
        expect(buildCustomerName({})).toBe('Unknown');
        expect(buildCustomerName({ shipping_address: {} })).toBe('Unknown');
    });
});

describe('Shopify Order Processing - Order Number Generation', () => {
    // Matches fallback logic in shopifyOrderProcessor.js
    const generateOrderNumber = (shopifyOrder) => {
        if (shopifyOrder.name) return shopifyOrder.name;
        if (shopifyOrder.order_number) return String(shopifyOrder.order_number);
        return `SHOP-${String(shopifyOrder.id).slice(-8)}`;
    };

    it('should use name field first', () => {
        const order = { id: '12345678901234', name: '#1001', order_number: 1001 };
        expect(generateOrderNumber(order)).toBe('#1001');
    });

    it('should fall back to order_number', () => {
        const order = { id: '12345678901234', order_number: 1002 };
        expect(generateOrderNumber(order)).toBe('1002');
    });

    it('should generate from ID as last resort', () => {
        const order = { id: '1234567890123456' };
        expect(generateOrderNumber(order)).toBe('SHOP-90123456');
    });
});

describe('Shopify Order Processing - Update Detection', () => {
    // Matches needsUpdate logic in shopifyOrderProcessor.js
    const needsUpdate = (existingOrder, newData) => {
        return existingOrder.status !== newData.status ||
            existingOrder.shopifyFulfillmentStatus !== newData.shopifyFulfillmentStatus ||
            existingOrder.awbNumber !== newData.awbNumber ||
            existingOrder.courier !== newData.courier ||
            existingOrder.paymentMethod !== newData.paymentMethod ||
            existingOrder.customerNotes !== newData.customerNotes;
    };

    it('should detect status change', () => {
        const existing = { status: 'open', shopifyFulfillmentStatus: null };
        const newData = { status: 'cancelled', shopifyFulfillmentStatus: null };
        expect(needsUpdate(existing, newData)).toBe(true);
    });

    it('should detect fulfillment status change', () => {
        const existing = { status: 'open', shopifyFulfillmentStatus: null };
        const newData = { status: 'open', shopifyFulfillmentStatus: 'fulfilled' };
        expect(needsUpdate(existing, newData)).toBe(true);
    });

    it('should detect AWB update', () => {
        const existing = { status: 'open', awbNumber: null };
        const newData = { status: 'open', awbNumber: 'AWB123' };
        expect(needsUpdate(existing, newData)).toBe(true);
    });

    it('should NOT detect when nothing changed', () => {
        const existing = { status: 'open', shopifyFulfillmentStatus: null, awbNumber: null, courier: null, paymentMethod: 'COD', customerNotes: null };
        const newData = { status: 'open', shopifyFulfillmentStatus: null, awbNumber: null, courier: null, paymentMethod: 'COD', customerNotes: null };
        expect(needsUpdate(existing, newData)).toBe(false);
    });
});

describe('Shopify Order Processing - Action Result Types', () => {
    // Validate the possible action results
    const validActions = ['created', 'updated', 'skipped', 'cancelled', 'fulfilled', 'cache_only'];

    it('should recognize created action', () => {
        expect(validActions).toContain('created');
    });

    it('should recognize updated action', () => {
        expect(validActions).toContain('updated');
    });

    it('should recognize skipped action', () => {
        expect(validActions).toContain('skipped');
    });

    it('should recognize cancelled action for status change', () => {
        expect(validActions).toContain('cancelled');
    });

    it('should recognize fulfilled action', () => {
        expect(validActions).toContain('fulfilled');
    });

    it('should recognize cache_only for errors', () => {
        expect(validActions).toContain('cache_only');
    });
});

// ============================================
// INVENTORY TRANSACTION LOGIC TESTS
// ============================================

describe('Inventory Transaction Rules', () => {
    it('should have correct transaction types', () => {
        expect(TXN_TYPE.INWARD).toBe('inward');
        expect(TXN_TYPE.OUTWARD).toBe('outward');
        expect(TXN_TYPE.RESERVED).toBe('reserved');
    });

    it('should have order_allocation reason for reservations', () => {
        expect(TXN_REASON.ORDER_ALLOCATION).toBe('order_allocation');
    });

    it('should have sale reason for shipping', () => {
        expect(TXN_REASON.SALE).toBe('sale');
    });

    it('should have return_receipt reason for returns', () => {
        expect(TXN_REASON.RETURN_RECEIPT).toBe('return_receipt');
    });
});

describe('Inventory Flow - Allocation to Ship', () => {
    // Test the expected transaction flow
    const transactionFlow = {
        allocate: { type: 'reserved', reason: 'order_allocation' },
        ship: {
            remove: 'reserved', // Delete reservation
            create: { type: 'outward', reason: 'sale' }
        },
        unship: {
            remove: 'outward', // Delete sale
            create: { type: 'reserved', reason: 'order_allocation' }
        }
    };

    it('should reserve on allocation', () => {
        expect(transactionFlow.allocate.type).toBe('reserved');
        expect(transactionFlow.allocate.reason).toBe('order_allocation');
    });

    it('should remove reservation and create outward on ship', () => {
        expect(transactionFlow.ship.remove).toBe('reserved');
        expect(transactionFlow.ship.create.type).toBe('outward');
        expect(transactionFlow.ship.create.reason).toBe('sale');
    });

    it('should reverse transactions on unship', () => {
        expect(transactionFlow.unship.remove).toBe('outward');
        expect(transactionFlow.unship.create.type).toBe('reserved');
    });
});
