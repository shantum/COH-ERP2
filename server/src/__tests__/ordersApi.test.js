/**
 * Orders API Tests
 *
 * Comprehensive tests for the Unified Orders API and order view configuration system.
 *
 * Test Coverage:
 * 1. View Configuration (getViewConfig, getValidViewNames)
 * 2. Where Clause Building (buildViewWhereClause with filters)
 * 3. View-Specific Behavior (open, shipped, rto, cod_pending, archived)
 * 4. Pagination and Search
 *
 * NOTE: These tests focus on configuration logic and where clause building,
 * not database queries (uses mocked Prisma client).
 */

import {
    ORDER_VIEWS,
    buildViewWhereClause,
    getValidViewNames,
    getViewConfig,
} from '../utils/orderViews.js';

// ============================================
// VIEW CONFIGURATION TESTS
// ============================================

describe('Order View Configuration', () => {
    describe('getViewConfig', () => {
        it('should return config for valid view name', () => {
            const config = getViewConfig('open');
            expect(config).toBeDefined();
            expect(config.name).toBe('Open Orders');
            expect(config.where).toBeDefined();
            expect(config.orderBy).toBeDefined();
        });

        it('should return config for all valid view names', () => {
            const validViews = ['open', 'shipped', 'rto', 'cod_pending', 'archived', 'cancelled', 'all'];
            validViews.forEach(view => {
                const config = getViewConfig(view);
                expect(config).toBeDefined();
                expect(config.name).toBeTruthy();
            });
        });

        it('should return null for invalid view name', () => {
            expect(getViewConfig('nonexistent')).toBeNull();
            expect(getViewConfig('')).toBeNull();
            expect(getViewConfig(null)).toBeNull();
        });

        it('should return config for action-oriented views', () => {
            const actionViews = ['ready_to_ship', 'needs_attention', 'watch_list', 'in_transit', 'pending_payment', 'completed'];
            actionViews.forEach(view => {
                const config = getViewConfig(view);
                expect(config).toBeDefined();
                expect(config.where).toBeDefined();
            });
        });
    });

    describe('getValidViewNames', () => {
        it('should return array of all valid view names', () => {
            const viewNames = getValidViewNames();
            expect(Array.isArray(viewNames)).toBe(true);
            expect(viewNames.length).toBeGreaterThan(0);
        });

        it('should include core views', () => {
            const viewNames = getValidViewNames();
            expect(viewNames).toContain('open');
            expect(viewNames).toContain('shipped');
            expect(viewNames).toContain('rto');
            expect(viewNames).toContain('cod_pending');
            expect(viewNames).toContain('archived');
        });

        it('should include action-oriented views', () => {
            const viewNames = getValidViewNames();
            expect(viewNames).toContain('ready_to_ship');
            expect(viewNames).toContain('needs_attention');
            expect(viewNames).toContain('watch_list');
        });
    });

    describe('VIEW Configuration Structure', () => {
        it('should have all required fields for open view', () => {
            const config = ORDER_VIEWS.open;
            expect(config.name).toBe('Open Orders');
            expect(config.description).toBeTruthy();
            expect(config.where).toEqual({
                status: 'open',
                isArchived: false,
            });
            expect(config.orderBy).toEqual({ orderDate: 'asc' });
            expect(config.enrichment).toContain('fulfillmentStage');
            expect(config.defaultLimit).toBe(10000);
        });

        it('should have all required fields for shipped view', () => {
            const config = ORDER_VIEWS.shipped;
            expect(config.where.status).toEqual({ in: ['shipped', 'delivered'] });
            expect(config.excludeWhere).toBeDefined();
            expect(config.excludeCodPending).toBe(true);
            expect(config.orderBy).toEqual({ shippedAt: 'desc' });
            expect(config.dateFilter).toBeDefined();
        });

        it('should have all required fields for rto view', () => {
            const config = ORDER_VIEWS.rto;
            expect(config.where.trackingStatus).toEqual({ in: ['rto_in_transit', 'rto_delivered'] });
            expect(config.orderBy).toEqual({ rtoInitiatedAt: 'desc' });
            expect(config.defaultLimit).toBe(200);
        });

        it('should have all required fields for cod_pending view', () => {
            const config = ORDER_VIEWS.cod_pending;
            expect(config.where.paymentMethod).toBe('COD');
            expect(config.where.trackingStatus).toBe('delivered');
            expect(config.where.codRemittedAt).toBeNull();
            expect(config.orderBy).toEqual({ deliveredAt: 'desc' });
        });

        it('should have all required fields for archived view', () => {
            const config = ORDER_VIEWS.archived;
            expect(config.where.isArchived).toBe(true);
            expect(config.orderBy).toEqual({ archivedAt: 'desc' });
            expect(config.defaultLimit).toBe(100);
        });
    });
});

// ============================================
// WHERE CLAUSE BUILDING TESTS
// ============================================

describe('buildViewWhereClause', () => {
    describe('Base Where Clause', () => {
        it('should return base where clause for view without filters', () => {
            const where = buildViewWhereClause('open', {});
            expect(where.status).toBe('open');
            expect(where.isArchived).toBe(false);
        });

        it('should throw error for unknown view', () => {
            expect(() => buildViewWhereClause('unknown')).toThrow('Unknown view: unknown');
        });

        it('should clone base where clause without mutating original', () => {
            const originalWhere = ORDER_VIEWS.open.where;
            const where = buildViewWhereClause('open', {});
            where.extraField = 'test';
            expect(originalWhere.extraField).toBeUndefined();
        });
    });

    describe('Date Filter', () => {
        it('should apply days filter when view has dateFilter config', () => {
            const where = buildViewWhereClause('shipped', { days: 7 });
            expect(where.shippedAt).toBeDefined();
            expect(where.shippedAt.gte).toBeInstanceOf(Date);

            // Verify it's approximately 7 days ago (within 1 minute tolerance)
            const expectedDate = new Date();
            expectedDate.setDate(expectedDate.getDate() - 7);
            const diff = Math.abs(where.shippedAt.gte - expectedDate);
            expect(diff).toBeLessThan(60000); // Less than 1 minute
        });

        it('should apply default days filter when days not specified', () => {
            const where = buildViewWhereClause('shipped', {});
            expect(where.shippedAt).toBeDefined();
            expect(where.shippedAt.gte).toBeInstanceOf(Date);

            // Shipped view has defaultDays: 30
            const expectedDate = new Date();
            expectedDate.setDate(expectedDate.getDate() - 30);
            const diff = Math.abs(where.shippedAt.gte - expectedDate);
            expect(diff).toBeLessThan(60000);
        });

        it('should not apply date filter for views without dateFilter config', () => {
            const where = buildViewWhereClause('open', { days: 30 });
            expect(where.orderDate).toBeUndefined();
            expect(where.shippedAt).toBeUndefined();
        });

        it('should not apply default date filter for "all" view', () => {
            const where = buildViewWhereClause('all', {});
            expect(where.orderDate).toBeUndefined();
            expect(where.shippedAt).toBeUndefined();
        });

        it('should handle days as string', () => {
            const where = buildViewWhereClause('shipped', { days: '14' });
            expect(where.shippedAt).toBeDefined();
            const expectedDate = new Date();
            expectedDate.setDate(expectedDate.getDate() - 14);
            const diff = Math.abs(where.shippedAt.gte - expectedDate);
            expect(diff).toBeLessThan(60000);
        });
    });

    describe('Search Filter', () => {
        it('should apply search across multiple fields', () => {
            const where = buildViewWhereClause('open', { search: 'test123' });
            expect(where.OR).toBeDefined();
            expect(Array.isArray(where.OR)).toBe(true);

            // Check that search is applied to all fields
            const searchFields = where.OR.map(clause => Object.keys(clause)[0]);
            expect(searchFields).toContain('orderNumber');
            expect(searchFields).toContain('customerName');
            expect(searchFields).toContain('awbNumber');
            expect(searchFields).toContain('customerEmail');
            expect(searchFields).toContain('customerPhone');
        });

        it('should apply case-insensitive search for text fields', () => {
            const where = buildViewWhereClause('open', { search: 'John' });
            const orderNumberClause = where.OR.find(clause => clause.orderNumber);
            const customerNameClause = where.OR.find(clause => clause.customerName);

            expect(orderNumberClause.orderNumber.mode).toBe('insensitive');
            expect(customerNameClause.customerName.mode).toBe('insensitive');
        });

        it('should trim search term', () => {
            const where = buildViewWhereClause('open', { search: '  test  ' });
            const orderNumberClause = where.OR.find(clause => clause.orderNumber);
            expect(orderNumberClause.orderNumber.contains).toBe('test');
        });

        it('should not apply search filter for empty string', () => {
            const where = buildViewWhereClause('open', { search: '' });
            expect(where.orderNumber).toBeUndefined();
            expect(where.customerName).toBeUndefined();
        });

        it('should not apply search filter for whitespace-only string', () => {
            const where = buildViewWhereClause('open', { search: '   ' });
            expect(where.orderNumber).toBeUndefined();
        });

        it('should combine search with existing OR clause from excludeWhere', () => {
            const where = buildViewWhereClause('shipped', { search: 'test' });
            // Shipped view has excludeWhere which creates an OR clause
            // Search should add to this OR clause
            expect(where.OR).toBeDefined();
            expect(where.OR.length).toBeGreaterThan(2); // trackingStatus exclusion + search fields
        });
    });

    describe('Exclusion Filters (shipped view)', () => {
        it('should exclude RTO orders from shipped view', () => {
            const where = buildViewWhereClause('shipped', {});
            expect(where.OR).toBeDefined();

            // Should have OR clause to handle null trackingStatus or exclude RTO statuses
            const hasTrackingStatusExclusion = where.OR.some(clause =>
                clause.trackingStatus && clause.trackingStatus.notIn
            );
            expect(hasTrackingStatusExclusion).toBe(true);
        });

        it('should exclude COD pending orders from shipped view', () => {
            const where = buildViewWhereClause('shipped', {});
            expect(where.NOT).toBeDefined();
            expect(where.NOT.AND).toBeDefined();
            expect(Array.isArray(where.NOT.AND)).toBe(true);

            // Check for COD + delivered + not remitted exclusion
            const hasCodExclusion = where.NOT.AND.some(clause =>
                clause.paymentMethod === 'COD'
            );
            const hasDeliveredExclusion = where.NOT.AND.some(clause =>
                clause.trackingStatus === 'delivered'
            );
            const hasNotRemittedExclusion = where.NOT.AND.some(clause =>
                clause.codRemittedAt === null
            );

            expect(hasCodExclusion).toBe(true);
            expect(hasDeliveredExclusion).toBe(true);
            expect(hasNotRemittedExclusion).toBe(true);
        });

        it('should not apply exclusions for non-shipped views', () => {
            const openWhere = buildViewWhereClause('open', {});
            const rtoWhere = buildViewWhereClause('rto', {});

            // These views should not have complex OR/NOT clauses for exclusions
            // (they may have OR from search, but not from excludeWhere/excludeCodPending)
            expect(openWhere.NOT).toBeUndefined();
            expect(rtoWhere.NOT).toBeUndefined();
        });
    });

    describe('Additional Filters', () => {
        it('should apply additional filters to where clause', () => {
            const where = buildViewWhereClause('open', {
                additionalFilters: { customerId: 'cust-123' }
            });
            expect(where.customerId).toBe('cust-123');
        });

        it('should apply multiple additional filters', () => {
            const where = buildViewWhereClause('open', {
                additionalFilters: {
                    customerId: 'cust-123',
                    channel: 'shopify',
                    paymentMethod: 'COD'
                }
            });
            expect(where.customerId).toBe('cust-123');
            expect(where.channel).toBe('shopify');
            expect(where.paymentMethod).toBe('COD');
        });

        it('should skip undefined additional filters', () => {
            const where = buildViewWhereClause('open', {
                additionalFilters: { customerId: undefined }
            });
            expect(where.customerId).toBeUndefined();
        });

        it('should skip null additional filters', () => {
            const where = buildViewWhereClause('open', {
                additionalFilters: { customerId: null }
            });
            expect(where.customerId).toBeUndefined();
        });

        it('should skip empty string additional filters', () => {
            const where = buildViewWhereClause('open', {
                additionalFilters: { customerId: '' }
            });
            expect(where.customerId).toBeUndefined();
        });

        it('should apply falsy but valid additional filters (0, false)', () => {
            const where = buildViewWhereClause('open', {
                additionalFilters: { qty: 0, isArchived: false }
            });
            expect(where.qty).toBe(0);
            expect(where.isArchived).toBe(false);
        });
    });

    describe('Combined Filters', () => {
        it('should apply days, search, and additional filters together', () => {
            const where = buildViewWhereClause('shipped', {
                days: 7,
                search: 'test',
                additionalFilters: { customerId: 'cust-123' }
            });

            expect(where.shippedAt).toBeDefined(); // date filter
            expect(where.OR).toBeDefined(); // search + exclusions
            expect(where.customerId).toBe('cust-123'); // additional filter
        });

        it('should preserve base where clause when applying all filters', () => {
            const where = buildViewWhereClause('open', {
                days: 30,
                search: 'test',
                additionalFilters: { channel: 'shopify' }
            });

            // Base where should still be present
            expect(where.status).toBe('open');
            expect(where.isArchived).toBe(false);
            expect(where.channel).toBe('shopify');
        });
    });
});

// ============================================
// VIEW-SPECIFIC BEHAVIOR TESTS
// ============================================

describe('View-Specific Behavior', () => {
    describe('Open View', () => {
        it('should filter status=open and isArchived=false', () => {
            const config = ORDER_VIEWS.open;
            expect(config.where.status).toBe('open');
            expect(config.where.isArchived).toBe(false);
        });

        it('should sort by orderDate ASC (FIFO)', () => {
            const config = ORDER_VIEWS.open;
            expect(config.orderBy).toEqual({ orderDate: 'asc' });
        });

        it('should include fulfillmentStage enrichment', () => {
            const config = ORDER_VIEWS.open;
            expect(config.enrichment).toContain('fulfillmentStage');
            expect(config.enrichment).toContain('lineStatusCounts');
            expect(config.enrichment).toContain('customerStats');
        });

        it('should have high default limit (10000)', () => {
            const config = ORDER_VIEWS.open;
            expect(config.defaultLimit).toBe(10000);
        });
    });

    describe('Shipped View', () => {
        it('should filter status in [shipped, delivered]', () => {
            const config = ORDER_VIEWS.shipped;
            expect(config.where.status).toEqual({ in: ['shipped', 'delivered'] });
            expect(config.where.isArchived).toBe(false);
        });

        it('should exclude RTO orders via excludeWhere', () => {
            const config = ORDER_VIEWS.shipped;
            expect(config.excludeWhere).toBeDefined();
            expect(config.excludeWhere.trackingStatus).toEqual({
                in: ['rto_in_transit', 'rto_delivered']
            });
        });

        it('should exclude COD pending orders', () => {
            const config = ORDER_VIEWS.shipped;
            expect(config.excludeCodPending).toBe(true);
        });

        it('should sort by shippedAt DESC (most recent first)', () => {
            const config = ORDER_VIEWS.shipped;
            expect(config.orderBy).toEqual({ shippedAt: 'desc' });
        });

        it('should have dateFilter with shippedAt field', () => {
            const config = ORDER_VIEWS.shipped;
            expect(config.dateFilter).toBeDefined();
            expect(config.dateFilter.field).toBe('shippedAt');
            expect(config.dateFilter.defaultDays).toBe(30);
        });

        it('should include tracking enrichments', () => {
            const config = ORDER_VIEWS.shipped;
            expect(config.enrichment).toContain('daysInTransit');
            expect(config.enrichment).toContain('trackingStatus');
            expect(config.enrichment).toContain('shopifyTracking');
        });
    });

    describe('RTO View', () => {
        it('should filter trackingStatus in rto states', () => {
            const config = ORDER_VIEWS.rto;
            expect(config.where.trackingStatus).toEqual({
                in: ['rto_in_transit', 'rto_delivered']
            });
            expect(config.where.isArchived).toBe(false);
        });

        it('should sort by rtoInitiatedAt DESC', () => {
            const config = ORDER_VIEWS.rto;
            expect(config.orderBy).toEqual({ rtoInitiatedAt: 'desc' });
        });

        it('should include RTO-specific enrichments', () => {
            const config = ORDER_VIEWS.rto;
            expect(config.enrichment).toContain('daysInTransit');
            expect(config.enrichment).toContain('rtoStatus');
        });

        it('should have moderate default limit (200)', () => {
            const config = ORDER_VIEWS.rto;
            expect(config.defaultLimit).toBe(200);
        });
    });

    describe('COD Pending View', () => {
        it('should filter COD + delivered + not remitted', () => {
            const config = ORDER_VIEWS.cod_pending;
            expect(config.where.paymentMethod).toBe('COD');
            expect(config.where.trackingStatus).toBe('delivered');
            expect(config.where.codRemittedAt).toBeNull();
            expect(config.where.isArchived).toBe(false);
        });

        it('should sort by deliveredAt DESC', () => {
            const config = ORDER_VIEWS.cod_pending;
            expect(config.orderBy).toEqual({ deliveredAt: 'desc' });
        });

        it('should include daysSinceDelivery enrichment', () => {
            const config = ORDER_VIEWS.cod_pending;
            expect(config.enrichment).toContain('daysSinceDelivery');
        });
    });

    describe('Archived View', () => {
        it('should filter isArchived=true', () => {
            const config = ORDER_VIEWS.archived;
            expect(config.where.isArchived).toBe(true);
        });

        it('should sort by archivedAt DESC', () => {
            const config = ORDER_VIEWS.archived;
            expect(config.orderBy).toEqual({ archivedAt: 'desc' });
        });

        it('should have minimal enrichments', () => {
            const config = ORDER_VIEWS.archived;
            expect(config.enrichment).toEqual(['customerStats']);
        });
    });

    describe('Cancelled View', () => {
        it('should be marked as line-level view', () => {
            const config = ORDER_VIEWS.cancelled;
            expect(config.isLineView).toBe(true);
        });

        it('should filter status=cancelled', () => {
            const config = ORDER_VIEWS.cancelled;
            expect(config.where.status).toBe('cancelled');
            expect(config.where.isArchived).toBe(false);
        });

        it('should sort by createdAt DESC', () => {
            const config = ORDER_VIEWS.cancelled;
            expect(config.orderBy).toEqual({ createdAt: 'desc' });
        });
    });

    describe('All View', () => {
        it('should have empty where clause', () => {
            const config = ORDER_VIEWS.all;
            expect(config.where).toEqual({});
        });

        it('should sort by orderDate DESC (most recent first)', () => {
            const config = ORDER_VIEWS.all;
            expect(config.orderBy).toEqual({ orderDate: 'desc' });
        });

        it('should have low default limit (50)', () => {
            const config = ORDER_VIEWS.all;
            expect(config.defaultLimit).toBe(50);
        });
    });
});

// ============================================
// ACTION-ORIENTED VIEWS TESTS
// ============================================

describe('Action-Oriented Views (Zen Philosophy)', () => {
    describe('Ready to Ship View', () => {
        it('should filter open orders not on hold', () => {
            const config = ORDER_VIEWS.ready_to_ship;
            expect(config.where.status).toBe('open');
            expect(config.where.isOnHold).toBe(false);
            expect(config.where.isArchived).toBe(false);
        });

        it('should sort by FIFO (orderDate asc)', () => {
            const config = ORDER_VIEWS.ready_to_ship;
            expect(config.orderBy).toEqual({ orderDate: 'asc' });
        });
    });

    describe('Needs Attention View', () => {
        it('should filter orders on hold OR RTO delivered awaiting processing', () => {
            const config = ORDER_VIEWS.needs_attention;
            expect(config.where.OR).toBeDefined();
            expect(config.where.OR).toContainEqual({ isOnHold: true });
            expect(config.where.OR).toContainEqual({
                trackingStatus: 'rto_delivered',
                terminalStatus: null
            });
        });

        it('should exclude archived orders', () => {
            const config = ORDER_VIEWS.needs_attention;
            expect(config.where.isArchived).toBe(false);
        });
    });

    describe('Watch List View', () => {
        it('should filter RTO in progress', () => {
            const config = ORDER_VIEWS.watch_list;
            expect(config.where.OR).toBeDefined();
            expect(config.where.OR).toContainEqual({
                trackingStatus: { in: ['rto_initiated', 'rto_in_transit'] }
            });
        });

        it('should have runtime filters for COD at risk', () => {
            const config = ORDER_VIEWS.watch_list;
            expect(config.runtimeFilters).toContain('codAtRisk');
        });

        it('should sort by oldest at-risk first', () => {
            const config = ORDER_VIEWS.watch_list;
            expect(config.orderBy).toEqual({ shippedAt: 'asc' });
        });
    });

    describe('In Transit View', () => {
        it('should filter shipped orders without terminal status', () => {
            const config = ORDER_VIEWS.in_transit;
            expect(config.where.status).toBe('shipped');
            expect(config.where.terminalStatus).toBeNull();
            expect(config.where.isArchived).toBe(false);
        });

        it('should exclude RTO orders', () => {
            const config = ORDER_VIEWS.in_transit;
            expect(config.excludeWhere).toBeDefined();
            expect(config.excludeWhere.trackingStatus).toEqual({
                in: ['rto_initiated', 'rto_in_transit', 'rto_delivered']
            });
        });
    });

    describe('Pending Payment View', () => {
        it('should filter delivered COD awaiting remittance', () => {
            const config = ORDER_VIEWS.pending_payment;
            expect(config.where.terminalStatus).toBe('delivered');
            expect(config.where.paymentMethod).toBe('COD');
            expect(config.where.codRemittedAt).toBeNull();
        });

        it('should sort by oldest pending first', () => {
            const config = ORDER_VIEWS.pending_payment;
            expect(config.orderBy).toEqual({ terminalAt: 'asc' });
        });
    });

    describe('Completed View', () => {
        it('should filter orders with terminal status', () => {
            const config = ORDER_VIEWS.completed;
            expect(config.where.terminalStatus).toEqual({ not: null });
            expect(config.where.isArchived).toBe(false);
        });

        it('should sort by most recent terminal date', () => {
            const config = ORDER_VIEWS.completed;
            expect(config.orderBy).toEqual({ terminalAt: 'desc' });
        });
    });
});

// ============================================
// EDGE CASES & ERROR HANDLING
// ============================================

describe('Edge Cases & Error Handling', () => {
    describe('buildViewWhereClause Edge Cases', () => {
        it('should handle options with undefined values', () => {
            const where = buildViewWhereClause('open', {
                days: undefined,
                search: undefined,
                additionalFilters: undefined
            });
            expect(where.status).toBe('open');
            expect(where.isArchived).toBe(false);
        });

        it('should handle empty options object', () => {
            const where = buildViewWhereClause('open', {});
            expect(where.status).toBe('open');
            expect(where.isArchived).toBe(false);
        });

        it('should handle no options parameter', () => {
            // Function uses default parameter {} if not provided
            const where = buildViewWhereClause('open');
            expect(where.status).toBe('open');
            expect(where.isArchived).toBe(false);
        });

        it('should handle very large days value', () => {
            const where = buildViewWhereClause('shipped', { days: 365 });
            expect(where.shippedAt).toBeDefined();
            const expectedDate = new Date();
            expectedDate.setDate(expectedDate.getDate() - 365);
            const diff = Math.abs(where.shippedAt.gte - expectedDate);
            expect(diff).toBeLessThan(60000);
        });

        it('should handle search with special characters', () => {
            const where = buildViewWhereClause('open', { search: 'ORD-123!@#' });
            const orderNumberClause = where.OR.find(clause => clause.orderNumber);
            expect(orderNumberClause.orderNumber.contains).toBe('ORD-123!@#');
        });

        it('should handle search with unicode characters', () => {
            const where = buildViewWhereClause('open', { search: 'José García' });
            const customerNameClause = where.OR.find(clause => clause.customerName);
            expect(customerNameClause.customerName.contains).toBe('José García');
        });
    });

    describe('Configuration Integrity', () => {
        it('should have unique default limits for different views', () => {
            const limits = new Set();
            const viewNames = getValidViewNames();

            viewNames.forEach(viewName => {
                const config = getViewConfig(viewName);
                if (config.defaultLimit) {
                    limits.add(config.defaultLimit);
                }
            });

            // We expect at least a few different limit values
            expect(limits.size).toBeGreaterThan(1);
        });

        it('should have enrichments array for all views', () => {
            const viewNames = getValidViewNames();

            viewNames.forEach(viewName => {
                const config = getViewConfig(viewName);
                expect(Array.isArray(config.enrichment)).toBe(true);
            });
        });

        it('should have orderBy defined for all views', () => {
            const viewNames = getValidViewNames();

            viewNames.forEach(viewName => {
                const config = getViewConfig(viewName);
                expect(config.orderBy).toBeDefined();
                expect(typeof config.orderBy).toBe('object');
            });
        });

        it('should have description for all views', () => {
            const viewNames = getValidViewNames();

            viewNames.forEach(viewName => {
                const config = getViewConfig(viewName);
                expect(config.description).toBeTruthy();
                expect(typeof config.description).toBe('string');
            });
        });
    });

    describe('View Mutual Exclusivity', () => {
        it('shipped view should exclude orders shown in rto view', () => {
            const shippedWhere = buildViewWhereClause('shipped', {});
            const rtoWhere = buildViewWhereClause('rto', {});

            // Shipped excludes rto_in_transit and rto_delivered
            expect(shippedWhere.OR).toBeDefined();
            const hasRtoExclusion = shippedWhere.OR.some(clause =>
                clause.trackingStatus && clause.trackingStatus.notIn &&
                clause.trackingStatus.notIn.includes('rto_in_transit')
            );
            expect(hasRtoExclusion).toBe(true);

            // RTO explicitly filters for rto_in_transit and rto_delivered
            expect(rtoWhere.trackingStatus.in).toContain('rto_in_transit');
            expect(rtoWhere.trackingStatus.in).toContain('rto_delivered');
        });

        it('shipped view should exclude orders shown in cod_pending view', () => {
            const shippedWhere = buildViewWhereClause('shipped', {});
            const codPendingWhere = buildViewWhereClause('cod_pending', {});

            // Shipped has NOT clause to exclude COD delivered not remitted
            expect(shippedWhere.NOT).toBeDefined();
            expect(shippedWhere.NOT.AND).toContainEqual({ paymentMethod: 'COD' });
            expect(shippedWhere.NOT.AND).toContainEqual({ trackingStatus: 'delivered' });
            expect(shippedWhere.NOT.AND).toContainEqual({ codRemittedAt: null });

            // COD pending explicitly filters for COD + delivered + not remitted
            expect(codPendingWhere.paymentMethod).toBe('COD');
            expect(codPendingWhere.trackingStatus).toBe('delivered');
            expect(codPendingWhere.codRemittedAt).toBeNull();
        });

        it('archived view should be mutually exclusive from all other views', () => {
            const archivedWhere = buildViewWhereClause('archived', {});
            const openWhere = buildViewWhereClause('open', {});
            const shippedWhere = buildViewWhereClause('shipped', {});

            expect(archivedWhere.isArchived).toBe(true);
            expect(openWhere.isArchived).toBe(false);
            expect(shippedWhere.isArchived).toBe(false);
        });
    });
});

// ============================================
// BUSINESS LOGIC VALIDATION
// ============================================

describe('Business Logic Validation', () => {
    describe('FIFO Queue Behavior', () => {
        it('open view should use FIFO ordering (oldest first)', () => {
            const config = ORDER_VIEWS.open;
            expect(config.orderBy).toEqual({ orderDate: 'asc' });
        });

        it('ready_to_ship view should use FIFO ordering', () => {
            const config = ORDER_VIEWS.ready_to_ship;
            expect(config.orderBy).toEqual({ orderDate: 'asc' });
        });

        it('watch_list should prioritize oldest at-risk orders', () => {
            const config = ORDER_VIEWS.watch_list;
            expect(config.orderBy).toEqual({ shippedAt: 'asc' });
        });
    });

    describe('Recent-First Behavior', () => {
        it('shipped view should show most recent shipments first', () => {
            const config = ORDER_VIEWS.shipped;
            expect(config.orderBy).toEqual({ shippedAt: 'desc' });
        });

        it('rto view should show most recent RTOs first', () => {
            const config = ORDER_VIEWS.rto;
            expect(config.orderBy).toEqual({ rtoInitiatedAt: 'desc' });
        });

        it('archived view should show most recently archived first', () => {
            const config = ORDER_VIEWS.archived;
            expect(config.orderBy).toEqual({ archivedAt: 'desc' });
        });
    });

    describe('Default Limit Appropriateness', () => {
        it('should have high limit for operational queues', () => {
            expect(ORDER_VIEWS.open.defaultLimit).toBe(10000);
            expect(ORDER_VIEWS.ready_to_ship.defaultLimit).toBe(10000);
        });

        it('should have moderate limit for monitoring views', () => {
            expect(ORDER_VIEWS.shipped.defaultLimit).toBe(100);
            expect(ORDER_VIEWS.rto.defaultLimit).toBe(200);
            expect(ORDER_VIEWS.archived.defaultLimit).toBe(100);
        });

        it('should have low limit for reference views', () => {
            expect(ORDER_VIEWS.all.defaultLimit).toBe(50);
        });
    });

    describe('Enrichment Appropriateness', () => {
        it('open view should include fulfillment enrichments', () => {
            const config = ORDER_VIEWS.open;
            expect(config.enrichment).toContain('fulfillmentStage');
            expect(config.enrichment).toContain('lineStatusCounts');
        });

        it('shipped view should include tracking enrichments', () => {
            const config = ORDER_VIEWS.shipped;
            expect(config.enrichment).toContain('daysInTransit');
            expect(config.enrichment).toContain('trackingStatus');
        });

        it('cod_pending view should include payment timing enrichments', () => {
            const config = ORDER_VIEWS.cod_pending;
            expect(config.enrichment).toContain('daysSinceDelivery');
        });

        it('all views should include customer stats', () => {
            const viewNames = getValidViewNames();

            viewNames.forEach(viewName => {
                const config = getViewConfig(viewName);
                expect(config.enrichment).toContain('customerStats');
            });
        });
    });
});
