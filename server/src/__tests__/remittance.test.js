/**
 * COD Remittance Tests
 * 
 * Tests for:
 * - CSV date parsing (multiple formats)
 * - Column name normalization
 * - Amount mismatch detection
 * - Sync status determination
 * - Order matching logic
 */

// ============================================
// SECTION 1: DATE PARSING
// ============================================

describe('Date Parsing - DD-Mon-YY Format', () => {
    const monthMap = {
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
        'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };

    const parseDateDDMonYY = (dateStr) => {
        if (!dateStr) return null;
        const match = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
        if (!match) return null;

        const day = parseInt(match[1]);
        const month = monthMap[match[2].toLowerCase()];
        let year = parseInt(match[3]);
        year = year < 50 ? 2000 + year : 1900 + year;
        return new Date(year, month, day);
    };

    it('should parse "06-Jan-26" format', () => {
        const date = parseDateDDMonYY('06-Jan-26');
        expect(date.getFullYear()).toBe(2026);
        expect(date.getMonth()).toBe(0); // January
        expect(date.getDate()).toBe(6);
    });

    it('should parse "15-Dec-99" as 1999', () => {
        const date = parseDateDDMonYY('15-Dec-99');
        expect(date.getFullYear()).toBe(1999);
    });

    it('should parse "01-Feb-25" as 2025', () => {
        const date = parseDateDDMonYY('01-Feb-25');
        expect(date.getFullYear()).toBe(2025);
        expect(date.getMonth()).toBe(1); // February
    });

    it('should handle case-insensitive month', () => {
        const date = parseDateDDMonYY('06-JAN-26');
        expect(date.getMonth()).toBe(0);
    });

    it('should return null for invalid format', () => {
        expect(parseDateDDMonYY('2026-01-06')).toBeNull();
        expect(parseDateDDMonYY('invalid')).toBeNull();
        expect(parseDateDDMonYY('')).toBeNull();
    });
});

describe('Date Parsing - ISO Format', () => {
    const parseISODate = (dateStr) => {
        if (!dateStr) return null;
        const parsed = new Date(dateStr);
        return isNaN(parsed.getTime()) ? null : parsed;
    };

    it('should parse ISO date "2026-01-06"', () => {
        const date = parseISODate('2026-01-06');
        expect(date.getFullYear()).toBe(2026);
        expect(date.getMonth()).toBe(0);
    });

    it('should parse ISO datetime "2026-01-06T10:30:00Z"', () => {
        const date = parseISODate('2026-01-06T10:30:00Z');
        expect(date.getFullYear()).toBe(2026);
    });

    it('should return null for invalid date', () => {
        expect(parseISODate('not-a-date')).toBeNull();
    });
});

describe('Date Parsing - Combined', () => {
    const monthMap = {
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
        'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };

    const parseDate = (dateStr) => {
        if (!dateStr) return null;

        // Try DD-Mon-YY format first
        const match = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
        if (match) {
            const day = parseInt(match[1]);
            const month = monthMap[match[2].toLowerCase()];
            let year = parseInt(match[3]);
            year = year < 50 ? 2000 + year : 1900 + year;
            return new Date(year, month, day);
        }

        // Try ISO format
        const parsed = new Date(dateStr);
        return isNaN(parsed.getTime()) ? null : parsed;
    };

    it('should parse DD-Mon-YY format', () => {
        const date = parseDate('06-Jan-26');
        expect(date).not.toBeNull();
    });

    it('should parse ISO format', () => {
        const date = parseDate('2026-01-06');
        expect(date).not.toBeNull();
    });

    it('should return null for unparseable string', () => {
        expect(parseDate('random-text')).toBeNull();
    });
});

// ============================================
// SECTION 2: COLUMN NAME NORMALIZATION
// ============================================

describe('Column Normalization - Standard Mappings', () => {
    const normalizeColumnName = (name) => {
        const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const mappings = {
            'awbno': 'awb',
            'awbnumber': 'awb',
            'orderno': 'orderNumber',
            'ordernumber': 'orderNumber',
            'price': 'amount',
            'codamount': 'amount',
            'remittancedate': 'remittanceDate',
            'remittanceutr': 'utr',
            'utr': 'utr',
        };
        return mappings[normalized] || normalized;
    };

    it('should normalize "AWB NO." to "awb"', () => {
        expect(normalizeColumnName('AWB NO.')).toBe('awb');
    });

    it('should normalize "Order No." to "orderNumber"', () => {
        expect(normalizeColumnName('Order No.')).toBe('orderNumber');
        expect(normalizeColumnName('Order No')).toBe('orderNumber');
    });

    it('should normalize "Price" to "amount"', () => {
        expect(normalizeColumnName('Price')).toBe('amount');
        expect(normalizeColumnName('COD Amount')).toBe('amount');
    });

    it('should normalize "Remittance Date" to "remittanceDate"', () => {
        expect(normalizeColumnName('Remittance Date')).toBe('remittanceDate');
        expect(normalizeColumnName('remittance date')).toBe('remittanceDate');
    });

    it('should normalize "Remittance UTR" to "utr"', () => {
        expect(normalizeColumnName('Remittance UTR')).toBe('utr');
        expect(normalizeColumnName('UTR')).toBe('utr');
    });

    it('should keep unknown columns as-is (lowercase, no special chars)', () => {
        expect(normalizeColumnName('Customer Name')).toBe('customername');
    });
});

describe('Column Normalization - Edge Cases', () => {
    const normalizeColumnName = (name) => {
        const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normalized;
    };

    it('should handle columns with underscores', () => {
        expect(normalizeColumnName('order_number')).toBe('ordernumber');
    });

    it('should handle columns with extra spaces', () => {
        expect(normalizeColumnName('Order   Number')).toBe('ordernumber');
    });

    it('should handle mixed case', () => {
        expect(normalizeColumnName('OrderNumber')).toBe('ordernumber');
        expect(normalizeColumnName('ORDERNUMBER')).toBe('ordernumber');
    });
});

// ============================================
// SECTION 3: AMOUNT MISMATCH DETECTION
// ============================================

describe('Amount Mismatch - Tolerance Check', () => {
    const AMOUNT_MISMATCH_TOLERANCE = 5; // 5%

    const checkAmountMismatch = (csvAmount, orderAmount) => {
        if (!csvAmount || !orderAmount) return { mismatch: false };

        const diff = Math.abs(csvAmount - orderAmount);
        const percentDiff = (diff / orderAmount) * 100;

        if (percentDiff > AMOUNT_MISMATCH_TOLERANCE) {
            return {
                mismatch: true,
                percentDiff: percentDiff.toFixed(1),
                message: `Amount mismatch: CSV=${csvAmount}, Order=${orderAmount}`
            };
        }
        return { mismatch: false };
    };

    it('should pass when amounts are equal', () => {
        const result = checkAmountMismatch(1000, 1000);
        expect(result.mismatch).toBe(false);
    });

    it('should pass when within 5% tolerance', () => {
        const result = checkAmountMismatch(1040, 1000); // 4% diff
        expect(result.mismatch).toBe(false);
    });

    it('should fail when exceeding 5% tolerance', () => {
        const result = checkAmountMismatch(1100, 1000); // 10% diff
        expect(result.mismatch).toBe(true);
    });

    it('should handle missing CSV amount', () => {
        const result = checkAmountMismatch(null, 1000);
        expect(result.mismatch).toBe(false);
    });

    it('should handle missing order amount', () => {
        const result = checkAmountMismatch(1000, null);
        expect(result.mismatch).toBe(false);
    });
});

describe('Amount Mismatch - Percentage Calculation', () => {
    const calculatePercentDiff = (amount1, amount2) => {
        if (!amount2 || amount2 === 0) return 0;
        const diff = Math.abs(amount1 - amount2);
        return (diff / amount2) * 100;
    };

    it('should calculate 0% for equal amounts', () => {
        expect(calculatePercentDiff(1000, 1000)).toBe(0);
    });

    it('should calculate 10% for 100 diff on 1000', () => {
        expect(calculatePercentDiff(1100, 1000)).toBe(10);
    });

    it('should calculate 50% for 50 diff on 100', () => {
        expect(calculatePercentDiff(150, 100)).toBe(50);
    });

    it('should return 0 for zero denominator', () => {
        expect(calculatePercentDiff(100, 0)).toBe(0);
    });
});

// ============================================
// SECTION 4: SYNC STATUS DETERMINATION
// ============================================

describe('Sync Status - Initial Determination', () => {
    const validSyncStatuses = ['pending', 'synced', 'failed', 'manual_review'];

    const determineSyncStatus = (hasMismatch, hasShopifyId) => {
        if (!hasShopifyId) return 'pending'; // No Shopify to sync
        if (hasMismatch) return 'manual_review';
        return 'pending'; // Ready for auto-sync
    };

    it('should recognize all sync statuses', () => {
        expect(validSyncStatuses).toContain('pending');
        expect(validSyncStatuses).toContain('synced');
        expect(validSyncStatuses).toContain('failed');
        expect(validSyncStatuses).toContain('manual_review');
    });

    it('should return pending when no mismatch', () => {
        expect(determineSyncStatus(false, true)).toBe('pending');
    });

    it('should return manual_review when mismatch detected', () => {
        expect(determineSyncStatus(true, true)).toBe('manual_review');
    });

    it('should return pending when no Shopify ID', () => {
        expect(determineSyncStatus(false, false)).toBe('pending');
    });
});

describe('Sync Status - Post-Sync Update', () => {
    const updateSyncStatus = (success, error) => {
        if (success) {
            return { status: 'synced', error: null, syncedAt: new Date() };
        }
        return { status: 'failed', error: error || 'Unknown error' };
    };

    it('should return synced on success', () => {
        const result = updateSyncStatus(true, null);
        expect(result.status).toBe('synced');
        expect(result.error).toBeNull();
    });

    it('should return failed with error on failure', () => {
        const result = updateSyncStatus(false, 'API timeout');
        expect(result.status).toBe('failed');
        expect(result.error).toBe('API timeout');
    });

    it('should set default error when none provided', () => {
        const result = updateSyncStatus(false, null);
        expect(result.error).toBe('Unknown error');
    });
});

// ============================================
// SECTION 5: ORDER MATCHING
// ============================================

describe('Order Matching - By Order Number', () => {
    const normalizeOrderNumber = (orderNum) => {
        if (!orderNum) return null;
        const trimmed = String(orderNum).trim();
        return trimmed || null;
    };

    it('should normalize string order number', () => {
        expect(normalizeOrderNumber('ORD-1001')).toBe('ORD-1001');
    });

    it('should normalize numeric order number', () => {
        expect(normalizeOrderNumber(1001)).toBe('1001');
    });

    it('should trim whitespace', () => {
        expect(normalizeOrderNumber('  ORD-1001  ')).toBe('ORD-1001');
    });

    it('should return null for empty input', () => {
        expect(normalizeOrderNumber('')).toBeNull();
        expect(normalizeOrderNumber(null)).toBeNull();
    });
});

describe('Order Matching - Already Paid Check', () => {
    const isAlreadyPaid = (order) => {
        return order.codRemittedAt !== null;
    };

    it('should detect already paid order', () => {
        const order = { codRemittedAt: new Date() };
        expect(isAlreadyPaid(order)).toBe(true);
    });

    it('should detect unpaid order', () => {
        const order = { codRemittedAt: null };
        expect(isAlreadyPaid(order)).toBe(false);
    });
});

describe('Order Matching - Valid for Sync Check', () => {
    const canSyncToShopify = (order) => {
        return order.shopifyOrderId !== null &&
            order.codRemittedAt !== null &&
            order.codShopifySyncStatus !== 'synced';
    };

    it('should allow sync when all conditions met', () => {
        const order = {
            shopifyOrderId: '12345',
            codRemittedAt: new Date(),
            codShopifySyncStatus: 'pending'
        };
        expect(canSyncToShopify(order)).toBe(true);
    });

    it('should NOT allow sync when no Shopify ID', () => {
        const order = {
            shopifyOrderId: null,
            codRemittedAt: new Date(),
            codShopifySyncStatus: 'pending'
        };
        expect(canSyncToShopify(order)).toBe(false);
    });

    it('should NOT allow sync when already synced', () => {
        const order = {
            shopifyOrderId: '12345',
            codRemittedAt: new Date(),
            codShopifySyncStatus: 'synced'
        };
        expect(canSyncToShopify(order)).toBe(false);
    });
});

// ============================================
// SECTION 6: CSV VALIDATION
// ============================================

describe('CSV Validation - File Type', () => {
    const isValidCSV = (mimetype, filename) => {
        return mimetype === 'text/csv' || filename?.endsWith('.csv');
    };

    it('should accept text/csv mimetype', () => {
        expect(isValidCSV('text/csv', 'file.txt')).toBe(true);
    });

    it('should accept .csv extension', () => {
        expect(isValidCSV('application/octet-stream', 'remittance.csv')).toBe(true);
    });

    it('should reject non-CSV files', () => {
        expect(isValidCSV('application/pdf', 'file.pdf')).toBe(false);
        expect(isValidCSV('text/plain', 'file.txt')).toBe(false);
    });
});

describe('CSV Validation - Empty Check', () => {
    const isEmptyCSV = (records) => {
        return !records || records.length === 0;
    };

    it('should detect empty array', () => {
        expect(isEmptyCSV([])).toBe(true);
    });

    it('should detect null records', () => {
        expect(isEmptyCSV(null)).toBe(true);
    });

    it('should pass for non-empty records', () => {
        expect(isEmptyCSV([{ orderNumber: '1001' }])).toBe(false);
    });
});

describe('CSV Validation - BOM Handling', () => {
    const removeBOM = (content) => {
        if (content.charCodeAt(0) === 0xFEFF) {
            return content.slice(1);
        }
        return content;
    };

    it('should remove UTF-8 BOM', () => {
        const withBOM = '\uFEFFOrder,Amount';
        expect(removeBOM(withBOM)).toBe('Order,Amount');
    });

    it('should leave content without BOM unchanged', () => {
        const noBOM = 'Order,Amount';
        expect(removeBOM(noBOM)).toBe('Order,Amount');
    });
});

// ============================================
// SECTION 7: AMOUNT PARSING
// ============================================

describe('Amount Parsing - Float Conversion', () => {
    const parseAmount = (amountStr) => {
        if (!amountStr) return null;
        const parsed = parseFloat(amountStr);
        return isNaN(parsed) ? null : parsed;
    };

    it('should parse integer string', () => {
        expect(parseAmount('1000')).toBe(1000);
    });

    it('should parse decimal string', () => {
        expect(parseAmount('1000.50')).toBe(1000.50);
    });

    it('should return null for empty string', () => {
        expect(parseAmount('')).toBeNull();
    });

    it('should return null for non-numeric', () => {
        expect(parseAmount('invalid')).toBeNull();
    });
});

describe('Amount Parsing - Currency Cleaning', () => {
    const cleanAmount = (amountStr) => {
        if (!amountStr) return null;
        // Remove currency symbols, commas
        const cleaned = String(amountStr).replace(/[₹$,\s]/g, '');
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? null : parsed;
    };

    it('should remove rupee symbol', () => {
        expect(cleanAmount('₹1000')).toBe(1000);
    });

    it('should remove commas', () => {
        expect(cleanAmount('1,000.50')).toBe(1000.50);
    });

    it('should handle combined symbols', () => {
        expect(cleanAmount('₹ 1,000.50')).toBe(1000.50);
    });
});

// ============================================
// SECTION 8: RESULT AGGREGATION
// ============================================

describe('Result Tracking - Counters', () => {
    const createResultsTracker = () => ({
        total: 0,
        matched: 0,
        updated: 0,
        alreadyPaid: 0,
        notFound: [],
        errors: [],
    });

    it('should initialize with zeros', () => {
        const results = createResultsTracker();
        expect(results.total).toBe(0);
        expect(results.matched).toBe(0);
    });

    it('should maintain empty arrays', () => {
        const results = createResultsTracker();
        expect(results.notFound).toEqual([]);
        expect(results.errors).toEqual([]);
    });
});

describe('Result Tracking - Summary Calculation', () => {
    const calculateSummary = (results) => {
        return {
            successRate: results.total > 0
                ? ((results.updated / results.total) * 100).toFixed(1)
                : '0.0',
            matchRate: results.total > 0
                ? ((results.matched / results.total) * 100).toFixed(1)
                : '0.0',
        };
    };

    it('should calculate success rate', () => {
        const results = { total: 100, updated: 80, matched: 90 };
        const summary = calculateSummary(results);
        expect(summary.successRate).toBe('80.0');
    });

    it('should calculate match rate', () => {
        const results = { total: 100, updated: 80, matched: 90 };
        const summary = calculateSummary(results);
        expect(summary.matchRate).toBe('90.0');
    });

    it('should handle zero total', () => {
        const results = { total: 0, updated: 0, matched: 0 };
        const summary = calculateSummary(results);
        expect(summary.successRate).toBe('0.0');
    });
});

// ============================================
// SECTION 9: PENDING REMITTANCE QUERIES
// ============================================

describe('Pending Remittance - Query Conditions', () => {
    const isPendingRemittance = (order) => {
        return order.paymentMethod === 'COD' &&
            order.trackingStatus === 'delivered' &&
            order.codRemittedAt === null &&
            !order.isArchived;
    };

    it('should identify pending COD remittance', () => {
        const order = {
            paymentMethod: 'COD',
            trackingStatus: 'delivered',
            codRemittedAt: null,
            isArchived: false
        };
        expect(isPendingRemittance(order)).toBe(true);
    });

    it('should exclude prepaid orders', () => {
        const order = {
            paymentMethod: 'Prepaid',
            trackingStatus: 'delivered',
            codRemittedAt: null,
            isArchived: false
        };
        expect(isPendingRemittance(order)).toBe(false);
    });

    it('should exclude non-delivered orders', () => {
        const order = {
            paymentMethod: 'COD',
            trackingStatus: 'shipped',
            codRemittedAt: null,
            isArchived: false
        };
        expect(isPendingRemittance(order)).toBe(false);
    });

    it('should exclude already remitted orders', () => {
        const order = {
            paymentMethod: 'COD',
            trackingStatus: 'delivered',
            codRemittedAt: new Date(),
            isArchived: false
        };
        expect(isPendingRemittance(order)).toBe(false);
    });
});

describe('Pending Remittance - Amount Aggregation', () => {
    const calculatePendingAmount = (orders) => {
        return orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    };

    it('should sum order amounts', () => {
        const orders = [
            { totalAmount: 1000 },
            { totalAmount: 2000 },
            { totalAmount: 1500 }
        ];
        expect(calculatePendingAmount(orders)).toBe(4500);
    });

    it('should handle null amounts', () => {
        const orders = [
            { totalAmount: 1000 },
            { totalAmount: null },
            { totalAmount: 2000 }
        ];
        expect(calculatePendingAmount(orders)).toBe(3000);
    });

    it('should return 0 for empty array', () => {
        expect(calculatePendingAmount([])).toBe(0);
    });
});

// ============================================
// SECTION 10: SHOPIFY MARK AS PAID
// ============================================

describe('Shopify Sync - Payload Building', () => {
    const buildTransactionPayload = (amount, utr, date) => {
        return {
            transaction: {
                amount: String(amount),
                kind: 'capture',
                status: 'success',
                gateway: 'COD Remittance',
                source_name: 'web',
                message: utr ? `UTR: ${utr}` : 'COD Payment Received',
                processed_at: date?.toISOString() || new Date().toISOString()
            }
        };
    };

    it('should build transaction with amount', () => {
        const payload = buildTransactionPayload(1000, null, new Date());
        expect(payload.transaction.amount).toBe('1000');
    });

    it('should include UTR in message', () => {
        const payload = buildTransactionPayload(1000, 'UTR123456', new Date());
        expect(payload.transaction.message).toBe('UTR: UTR123456');
    });

    it('should use default message when no UTR', () => {
        const payload = buildTransactionPayload(1000, null, new Date());
        expect(payload.transaction.message).toBe('COD Payment Received');
    });
});

describe('Shopify Sync - Retry Eligibility', () => {
    const canRetrySync = (syncStatus) => {
        return ['failed', 'pending', 'manual_review'].includes(syncStatus);
    };

    it('should allow retry for failed status', () => {
        expect(canRetrySync('failed')).toBe(true);
    });

    it('should allow retry for pending status', () => {
        expect(canRetrySync('pending')).toBe(true);
    });

    it('should allow retry for manual_review status', () => {
        expect(canRetrySync('manual_review')).toBe(true);
    });

    it('should NOT allow retry for synced status', () => {
        expect(canRetrySync('synced')).toBe(false);
    });
});
