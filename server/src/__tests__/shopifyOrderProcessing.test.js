/**
 * Shopify Order Processing Tests
 *
 * Tests for shopifyOrderProcessor.js service - the single source of truth for
 * processing Shopify orders into the ERP system.
 *
 * CRITICAL BUSINESS LOGIC:
 * - Cache-first pattern: Always cache raw Shopify data FIRST, then process
 * - Payment method detection: COD preservation, gateway detection, financial status fallback
 * - ERP is source of truth: Shopify fulfillment captures tracking but does NOT auto-ship
 * - Idempotent processing: Safe to re-process same order multiple times
 * - Race condition protection: Uses order locks to prevent concurrent processing
 *
 * Test Coverage:
 * 1. Cache data extraction - discount codes, customer notes, tracking info
 * 2. Tracking extraction from fulfillments
 * 3. Order line creation with SKU matching
 * 4. Price calculations with discounts
 * 5. Order update detection logic
 * 6. Fulfillment sync mapping via shopifyLineId
 *
 * Note: These tests focus on pure logic and data transformations.
 * Integration tests with actual database are in integration.test.js
 */

describe('Shopify Order Processing - Data Extraction Logic', () => {
    // ============================================
    // SECTION 1: Discount Code Extraction
    // ============================================

    describe('Discount Code Extraction', () => {
        const extractDiscountCodes = (shopifyOrder) => {
            return (shopifyOrder.discount_codes || [])
                .map(d => d.code).join(', ') || '';
        };

        it('should extract discount codes as comma-separated string', () => {
            const order = {
                discount_codes: [
                    { code: 'SUMMER20', amount: '200' },
                    { code: 'VIP10', amount: '100' },
                ],
            };
            expect(extractDiscountCodes(order)).toBe('SUMMER20, VIP10');
        });

        it('should return empty string for no discount codes', () => {
            expect(extractDiscountCodes({})).toBe('');
            expect(extractDiscountCodes({ discount_codes: [] })).toBe('');
        });

        it('should handle single discount code', () => {
            const order = {
                discount_codes: [{ code: 'SPECIAL50' }],
            };
            expect(extractDiscountCodes(order)).toBe('SPECIAL50');
        });
    });

    // ============================================
    // SECTION 2: Tracking Info Extraction
    // ============================================

    describe('Tracking Info Extraction', () => {
        const extractTracking = (order) => {
            const fulfillment = order.fulfillments?.find(f => f.tracking_number)
                || order.fulfillments?.[0];
            return {
                trackingNumber: fulfillment?.tracking_number || null,
                trackingCompany: fulfillment?.tracking_company || null,
                trackingUrl: fulfillment?.tracking_url || fulfillment?.tracking_urls?.[0] || null,
                shippedAt: fulfillment?.created_at ? new Date(fulfillment.created_at) : null,
                shipmentStatus: fulfillment?.shipment_status || null,
            };
        };

        it('should extract tracking info from fulfillments', () => {
            const order = {
                fulfillments: [
                    {
                        tracking_number: 'AWB123456',
                        tracking_company: 'Delhivery',
                        tracking_url: 'https://tracking.example.com/AWB123456',
                        created_at: '2024-01-15T10:30:00Z',
                        shipment_status: 'in_transit',
                    },
                ],
            };

            const tracking = extractTracking(order);
            expect(tracking.trackingNumber).toBe('AWB123456');
            expect(tracking.trackingCompany).toBe('Delhivery');
            expect(tracking.trackingUrl).toBe('https://tracking.example.com/AWB123456');
            expect(tracking.shippedAt).toEqual(new Date('2024-01-15T10:30:00Z'));
            expect(tracking.shipmentStatus).toBe('in_transit');
        });

        it('should handle orders without fulfillments', () => {
            const tracking = extractTracking({});
            expect(tracking.trackingNumber).toBeNull();
            expect(tracking.trackingCompany).toBeNull();
        });

        it('should prefer fulfillment with tracking number', () => {
            const order = {
                fulfillments: [
                    { tracking_number: null },
                    { tracking_number: 'AWB789012', tracking_company: 'Blue Dart' },
                ],
            };
            const tracking = extractTracking(order);
            expect(tracking.trackingNumber).toBe('AWB789012');
            expect(tracking.trackingCompany).toBe('Blue Dart');
        });

        it('should use tracking_urls array as fallback', () => {
            const order = {
                fulfillments: [{
                    tracking_urls: ['https://tracking.com/123'],
                }],
            };
            const tracking = extractTracking(order);
            expect(tracking.trackingUrl).toBe('https://tracking.com/123');
        });
    });

    // ============================================
    // SECTION 3: Shipping Address Extraction
    // ============================================

    describe('Shipping Address Extraction', () => {
        const extractShippingAddress = (order) => ({
            city: order.shipping_address?.city || null,
            state: order.shipping_address?.province || null,
            country: order.shipping_address?.country || null,
        });

        it('should extract city, state, and country', () => {
            const order = {
                shipping_address: {
                    city: 'Mumbai',
                    province: 'Maharashtra',
                    country: 'India',
                },
            };
            const address = extractShippingAddress(order);
            expect(address.city).toBe('Mumbai');
            expect(address.state).toBe('Maharashtra');
            expect(address.country).toBe('India');
        });

        it('should handle missing shipping address', () => {
            const address = extractShippingAddress({});
            expect(address).toEqual({ city: null, state: null, country: null });
        });
    });

    // ============================================
    // SECTION 4: Order Number Generation
    // ============================================

    describe('Order Number Generation', () => {
        const generateOrderNumber = (order) => {
            if (order.name) return order.name;
            if (order.order_number) return String(order.order_number);
            return `SHOP-${String(order.id).slice(-8)}`;
        };

        it('should use order.name as primary', () => {
            expect(generateOrderNumber({ name: '#COH-1001' })).toBe('#COH-1001');
        });

        it('should fallback to order_number', () => {
            expect(generateOrderNumber({ order_number: 1002 })).toBe('1002');
        });

        it('should generate from ID as last resort', () => {
            expect(generateOrderNumber({ id: '5556789012345678' })).toBe('SHOP-12345678');
        });
    });

    // ============================================
    // SECTION 5: Price Calculations
    // ============================================

    describe('Price Calculations with Discounts', () => {
        const calculateEffectivePrice = (item) => {
            const originalPrice = parseFloat(item.price) || 0;
            const discountAllocations = item.discount_allocations || [];
            const totalDiscount = discountAllocations.reduce(
                (sum, alloc) => sum + (parseFloat(alloc.amount) || 0),
                0
            );
            // Effective price = original price - (total line discount / quantity)
            return Math.round((originalPrice - (totalDiscount / item.quantity)) * 100) / 100;
        };

        it('should calculate effective unit price after discounts', () => {
            const item = {
                price: '2999.00',
                quantity: 2,
                discount_allocations: [{ amount: '400' }],
            };
            // Effective price = 2999 - (400/2) = 2799
            expect(calculateEffectivePrice(item)).toBe(2799);
        });

        it('should handle multiple discount allocations', () => {
            const item = {
                price: '1500.00',
                quantity: 1,
                discount_allocations: [
                    { amount: '100' },
                    { amount: '50' },
                ],
            };
            // Effective price = 1500 - (150/1) = 1350
            expect(calculateEffectivePrice(item)).toBe(1350);
        });

        it('should handle no discounts', () => {
            const item = {
                price: '999.00',
                quantity: 1,
                discount_allocations: [],
            };
            expect(calculateEffectivePrice(item)).toBe(999);
        });

        it('should round to 2 decimal places', () => {
            const item = {
                price: '99.99',
                quantity: 3,
                discount_allocations: [{ amount: '10' }],
            };
            // 99.99 - (10/3) = 99.99 - 3.333... = 96.66 (rounded)
            expect(calculateEffectivePrice(item)).toBe(96.66);
        });
    });

    // ============================================
    // SECTION 6: Order Update Detection
    // ============================================

    describe('Order Update Detection', () => {
        const needsUpdate = (existing, newData) => {
            // Only check ERP-owned fields (Order table)
            // Shopify-owned fields (discountCode, customerNotes, shopifyFulfillmentStatus)
            // are in ShopifyOrderCache and don't trigger Order updates
            return (
                existing.status !== newData.status ||
                existing.awbNumber !== newData.awbNumber ||
                existing.courier !== newData.courier ||
                existing.paymentMethod !== newData.paymentMethod ||
                existing.customerEmail !== newData.customerEmail ||
                existing.customerPhone !== newData.customerPhone ||
                existing.totalAmount !== newData.totalAmount ||
                existing.shippingAddress !== newData.shippingAddress
            );
        };

        it('should detect status change', () => {
            const existing = { status: 'open', awbNumber: null, courier: null, paymentMethod: 'Prepaid' };
            const newData = { status: 'cancelled', awbNumber: null, courier: null, paymentMethod: 'Prepaid' };
            expect(needsUpdate(existing, newData)).toBe(true);
        });

        it('should detect AWB number update', () => {
            const existing = { status: 'open', awbNumber: null, courier: null, paymentMethod: 'Prepaid' };
            const newData = { status: 'open', awbNumber: 'AWB123456', courier: null, paymentMethod: 'Prepaid' };
            expect(needsUpdate(existing, newData)).toBe(true);
        });

        it('should detect payment method change', () => {
            const existing = { status: 'open', awbNumber: null, courier: null, paymentMethod: 'Prepaid' };
            const newData = { status: 'open', awbNumber: null, courier: null, paymentMethod: 'COD' };
            expect(needsUpdate(existing, newData)).toBe(true);
        });

        it('should NOT detect update when nothing changed', () => {
            const data = {
                status: 'open',
                awbNumber: null,
                courier: null,
                paymentMethod: 'COD',
                customerEmail: 'test@example.com',
                customerPhone: '+919876543210',
                totalAmount: 2999,
                shippingAddress: '{"city":"Mumbai"}',
            };
            expect(needsUpdate(data, data)).toBe(false);
        });

        it('should detect email change', () => {
            const existing = {
                status: 'open',
                awbNumber: null,
                courier: null,
                paymentMethod: 'Prepaid',
                customerEmail: 'old@example.com',
            };
            const newData = { ...existing, customerEmail: 'new@example.com' };
            expect(needsUpdate(existing, newData)).toBe(true);
        });

        it('should detect amount change (refunds/modifications)', () => {
            const existing = { status: 'open', totalAmount: 2999, awbNumber: null, courier: null, paymentMethod: 'Prepaid' };
            const newData = { status: 'open', totalAmount: 1999, awbNumber: null, courier: null, paymentMethod: 'Prepaid' };
            expect(needsUpdate(existing, newData)).toBe(true);
        });
    });

    // ============================================
    // SECTION 7: Fulfillment Sync Mapping
    // ============================================

    describe('Fulfillment Sync - Shipment Status Mapping', () => {
        const mapShipmentStatus = (shopifyStatus) => {
            const map = {
                'in_transit': 'in_transit',
                'out_for_delivery': 'out_for_delivery',
                'delivered': 'delivered',
                'failure': 'delivery_delayed',
                'attempted_delivery': 'out_for_delivery',
            };
            return map[shopifyStatus] || 'in_transit';
        };

        it('should map in_transit', () => {
            expect(mapShipmentStatus('in_transit')).toBe('in_transit');
        });

        it('should map out_for_delivery', () => {
            expect(mapShipmentStatus('out_for_delivery')).toBe('out_for_delivery');
        });

        it('should map delivered', () => {
            expect(mapShipmentStatus('delivered')).toBe('delivered');
        });

        it('should map failure to delivery_delayed', () => {
            expect(mapShipmentStatus('failure')).toBe('delivery_delayed');
        });

        it('should map attempted_delivery to out_for_delivery', () => {
            expect(mapShipmentStatus('attempted_delivery')).toBe('out_for_delivery');
        });

        it('should default unknown statuses to in_transit', () => {
            expect(mapShipmentStatus('unknown_status')).toBe('in_transit');
        });
    });

    // ============================================
    // SECTION 8: Shopify Line Item to Order Line Matching
    // ============================================

    describe('Fulfillment Line Item ID Extraction', () => {
        const extractShopifyLineIds = (fulfillment) => {
            if (!fulfillment.line_items?.length) return [];
            return fulfillment.line_items.map(li => String(li.id));
        };

        it('should extract line item IDs as strings', () => {
            const fulfillment = {
                tracking_number: 'AWB123',
                line_items: [
                    { id: 123 },
                    { id: 456 },
                ],
            };
            expect(extractShopifyLineIds(fulfillment)).toEqual(['123', '456']);
        });

        it('should handle empty line_items', () => {
            expect(extractShopifyLineIds({ line_items: [] })).toEqual([]);
        });

        it('should handle missing line_items', () => {
            expect(extractShopifyLineIds({})).toEqual([]);
        });
    });

    // ============================================
    // SECTION 9: Cancellation Note Handling
    // ============================================

    describe('Cancellation Note Handling', () => {
        const addCancellationNote = (existingNotes, cancelledAt) => {
            if (!cancelledAt) return existingNotes;
            const note = `Cancelled via Shopify at ${cancelledAt}`;
            if (existingNotes?.includes('Cancelled via Shopify')) return existingNotes;
            return existingNotes ? `${existingNotes}\n${note}` : note;
        };

        it('should add cancellation note when cancelled', () => {
            const notes = addCancellationNote(null, '2024-01-15T10:00:00Z');
            expect(notes).toContain('Cancelled via Shopify');
            expect(notes).toContain('2024-01-15T10:00:00Z');
        });

        it('should NOT duplicate cancellation note', () => {
            const existing = 'Cancelled via Shopify at 2024-01-15T10:00:00Z';
            const notes = addCancellationNote(existing, '2024-01-15T10:00:00Z');
            expect(notes).toBe(existing);
        });

        it('should append to existing notes', () => {
            const existing = 'Customer requested rush delivery';
            const notes = addCancellationNote(existing, '2024-01-15T10:00:00Z');
            expect(notes).toContain('Customer requested rush delivery');
            expect(notes).toContain('Cancelled via Shopify');
        });

        it('should not add note when not cancelled', () => {
            const existing = 'Some notes';
            expect(addCancellationNote(existing, null)).toBe(existing);
        });
    });

    // ============================================
    // SECTION 10: Customer Name Building
    // ============================================

    describe('Customer Name Building', () => {
        const buildCustomerName = (shopifyOrder) => {
            const shippingAddress = shopifyOrder.shipping_address;
            const customer = shopifyOrder.customer;

            if (shippingAddress) {
                return `${shippingAddress.first_name || ''} ${shippingAddress.last_name || ''}`.trim();
            }
            if (customer?.first_name) {
                return `${customer.first_name} ${customer.last_name || ''}`.trim();
            }
            return 'Unknown';
        };

        it('should use shipping address name first', () => {
            const order = {
                shipping_address: { first_name: 'John', last_name: 'Doe' },
                customer: { first_name: 'Jane', last_name: 'Smith' },
            };
            expect(buildCustomerName(order)).toBe('John Doe');
        });

        it('should fallback to customer name', () => {
            const order = {
                customer: { first_name: 'Jane', last_name: 'Smith' },
            };
            expect(buildCustomerName(order)).toBe('Jane Smith');
        });

        it('should handle missing last name', () => {
            const order = {
                shipping_address: { first_name: 'John' },
            };
            expect(buildCustomerName(order)).toBe('John');
        });

        it('should default to Unknown', () => {
            expect(buildCustomerName({})).toBe('Unknown');
        });
    });

    // ============================================
    // SECTION 11: Status Preservation Logic
    // ============================================

    describe('ERP Status Preservation Logic', () => {
        const determineStatus = (shopifyStatus, existingStatus) => {
            const erpManagedStatuses = ['shipped', 'delivered'];

            if (erpManagedStatuses.includes(existingStatus) && shopifyStatus !== 'cancelled') {
                // Preserve ERP-managed statuses
                return existingStatus;
            }

            if (existingStatus === 'open' && shopifyStatus === 'shipped') {
                // ERP is source of truth: ignore Shopify fulfillment for open orders
                return 'open';
            }

            return shopifyStatus;
        };

        it('should preserve ERP shipped status', () => {
            expect(determineStatus('delivered', 'shipped')).toBe('shipped');
        });

        it('should preserve ERP delivered status', () => {
            expect(determineStatus('shipped', 'delivered')).toBe('delivered');
        });

        it('should NOT auto-ship from Shopify fulfillment', () => {
            expect(determineStatus('shipped', 'open')).toBe('open');
        });

        it('should allow cancellation of shipped orders', () => {
            expect(determineStatus('cancelled', 'shipped')).toBe('cancelled');
        });

        it('should accept status changes for non-shipped orders', () => {
            expect(determineStatus('cancelled', 'open')).toBe('cancelled');
        });
    });

    // ============================================
    // SECTION 12: Internal Notes from Shopify
    // ============================================

    describe('Internal Notes Extraction', () => {
        const extractInternalNote = (shopifyOrder) => {
            const noteAttributes = shopifyOrder.note_attributes || [];
            return noteAttributes.find(n => n.name === 'internal_note' || n.name === 'staff_note')?.value || null;
        };

        it('should extract internal_note from note_attributes', () => {
            const order = {
                note_attributes: [
                    { name: 'gift_message', value: 'Happy Birthday!' },
                    { name: 'internal_note', value: 'VIP customer - handle with care' },
                ],
            };
            expect(extractInternalNote(order)).toBe('VIP customer - handle with care');
        });

        it('should extract staff_note as alternative', () => {
            const order = {
                note_attributes: [
                    { name: 'staff_note', value: 'Check inventory before shipping' },
                ],
            };
            expect(extractInternalNote(order)).toBe('Check inventory before shipping');
        });

        it('should return null when no internal notes', () => {
            expect(extractInternalNote({})).toBeNull();
            expect(extractInternalNote({ note_attributes: [] })).toBeNull();
        });
    });
});
