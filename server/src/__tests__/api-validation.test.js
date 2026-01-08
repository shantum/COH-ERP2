/**
 * API Validation Tests
 * 
 * Tests for:
 * - Zod schema validation patterns
 * - Order creation validation
 * - Inventory transaction validation
 * - Error message formatting
 */

// ============================================
// SECTION 1: BASIC VALIDATION PATTERNS
// ============================================

describe('Validation - Required Fields', () => {
    const validateRequired = (value, fieldName) => {
        if (value === undefined || value === null || value === '') {
            return { valid: false, error: `${fieldName} is required` };
        }
        return { valid: true };
    };

    it('should fail for undefined value', () => {
        expect(validateRequired(undefined, 'skuId').valid).toBe(false);
    });

    it('should fail for null value', () => {
        expect(validateRequired(null, 'skuId').valid).toBe(false);
    });

    it('should fail for empty string', () => {
        expect(validateRequired('', 'orderNumber').valid).toBe(false);
    });

    it('should pass for valid value', () => {
        expect(validateRequired('sku-123', 'skuId').valid).toBe(true);
    });
});

describe('Validation - Numeric Range', () => {
    const validatePositiveNumber = (value, fieldName) => {
        const num = Number(value);
        if (isNaN(num)) {
            return { valid: false, error: `${fieldName} must be a number` };
        }
        if (num <= 0) {
            return { valid: false, error: `${fieldName} must be positive` };
        }
        return { valid: true, value: num };
    };

    it('should reject non-numeric value', () => {
        expect(validatePositiveNumber('abc', 'qty').valid).toBe(false);
    });

    it('should reject zero', () => {
        expect(validatePositiveNumber(0, 'qty').valid).toBe(false);
    });

    it('should reject negative number', () => {
        expect(validatePositiveNumber(-5, 'qty').valid).toBe(false);
    });

    it('should accept positive number', () => {
        const result = validatePositiveNumber(10, 'qty');
        expect(result.valid).toBe(true);
        expect(result.value).toBe(10);
    });

    it('should convert string to number', () => {
        const result = validatePositiveNumber('10', 'qty');
        expect(result.valid).toBe(true);
        expect(result.value).toBe(10);
    });
});

// ============================================
// SECTION 2: ENUM VALIDATION
// ============================================

describe('Validation - Enum Values', () => {
    const validateEnum = (value, allowedValues, fieldName) => {
        if (!allowedValues.includes(value)) {
            return {
                valid: false,
                error: `${fieldName} must be one of: ${allowedValues.join(', ')}`
            };
        }
        return { valid: true };
    };

    it('should accept valid enum value', () => {
        const result = validateEnum('inward', ['inward', 'outward', 'reserved'], 'txnType');
        expect(result.valid).toBe(true);
    });

    it('should reject invalid enum value', () => {
        const result = validateEnum('invalid', ['inward', 'outward', 'reserved'], 'txnType');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('must be one of');
    });
});

describe('Validation - Order Status Enum', () => {
    const validOrderStatuses = ['open', 'shipped', 'delivered', 'cancelled', 'returned'];

    const isValidOrderStatus = (status) => validOrderStatuses.includes(status);

    it('should accept open status', () => {
        expect(isValidOrderStatus('open')).toBe(true);
    });

    it('should accept shipped status', () => {
        expect(isValidOrderStatus('shipped')).toBe(true);
    });

    it('should reject invalid status', () => {
        expect(isValidOrderStatus('invalid')).toBe(false);
    });
});

describe('Validation - Line Status Enum', () => {
    const validLineStatuses = ['pending', 'allocated', 'picked', 'packed', 'shipped'];

    const isValidLineStatus = (status) => validLineStatuses.includes(status);

    it('should accept pending status', () => {
        expect(isValidLineStatus('pending')).toBe(true);
    });

    it('should accept shipped status', () => {
        expect(isValidLineStatus('shipped')).toBe(true);
    });

    it('should reject invalid status', () => {
        expect(isValidLineStatus('completed')).toBe(false);
    });
});

// ============================================
// SECTION 3: ORDER CREATION VALIDATION
// ============================================

describe('Order Creation - Required Fields', () => {
    const requiredOrderFields = ['orderNumber', 'customerName', 'orderDate'];

    const validateOrderCreation = (data) => {
        const errors = [];
        requiredOrderFields.forEach(field => {
            if (!data[field]) {
                errors.push(`${field} is required`);
            }
        });
        return { valid: errors.length === 0, errors };
    };

    it('should pass with all required fields', () => {
        const order = {
            orderNumber: 'ORD-001',
            customerName: 'John Doe',
            orderDate: new Date()
        };
        expect(validateOrderCreation(order).valid).toBe(true);
    });

    it('should fail without orderNumber', () => {
        const order = { customerName: 'John', orderDate: new Date() };
        const result = validateOrderCreation(order);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('orderNumber is required');
    });
});

describe('Order Creation - Order Lines', () => {
    const validateOrderLine = (line) => {
        const errors = [];
        if (!line.skuId) errors.push('skuId is required');
        if (!line.qty || line.qty <= 0) errors.push('qty must be positive');
        if (!line.unitPrice || line.unitPrice < 0) errors.push('unitPrice must be non-negative');
        return { valid: errors.length === 0, errors };
    };

    it('should validate complete line', () => {
        const line = { skuId: 'sku-1', qty: 2, unitPrice: 100 };
        expect(validateOrderLine(line).valid).toBe(true);
    });

    it('should fail without skuId', () => {
        const line = { qty: 2, unitPrice: 100 };
        expect(validateOrderLine(line).valid).toBe(false);
    });

    it('should fail with zero qty', () => {
        const line = { skuId: 'sku-1', qty: 0, unitPrice: 100 };
        expect(validateOrderLine(line).valid).toBe(false);
    });
});

// ============================================
// SECTION 4: INVENTORY TRANSACTION VALIDATION
// ============================================

describe('Inventory Transaction - Schema', () => {
    const validateInventoryTransaction = (data) => {
        const errors = [];

        if (!data.skuId) errors.push('skuId is required');
        if (!data.txnType) errors.push('txnType is required');
        if (!['inward', 'outward', 'reserved'].includes(data.txnType)) {
            errors.push('txnType must be inward, outward, or reserved');
        }
        if (!data.qty || data.qty <= 0) errors.push('qty must be positive');
        if (!data.reason) errors.push('reason is required');

        return { valid: errors.length === 0, errors };
    };

    it('should pass for valid inward transaction', () => {
        const txn = {
            skuId: 'sku-1',
            txnType: 'inward',
            qty: 10,
            reason: 'production'
        };
        expect(validateInventoryTransaction(txn).valid).toBe(true);
    });

    it('should fail without reason', () => {
        const txn = {
            skuId: 'sku-1',
            txnType: 'inward',
            qty: 10
        };
        expect(validateInventoryTransaction(txn).valid).toBe(false);
    });

    it('should fail with invalid txnType', () => {
        const txn = {
            skuId: 'sku-1',
            txnType: 'transfer',
            qty: 10,
            reason: 'move'
        };
        const result = validateInventoryTransaction(txn);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('txnType must be inward, outward, or reserved');
    });
});

describe('Inventory Transaction - Reason Validation', () => {
    const validReasons = {
        inward: ['production', 'return_receipt', 'rto_received', 'adjustment'],
        outward: ['sale', 'adjustment', 'return_damaged', 'write_off'],
        reserved: ['order_allocation']
    };

    const isValidReason = (txnType, reason) => {
        return validReasons[txnType]?.includes(reason) || false;
    };

    it('should accept production for inward', () => {
        expect(isValidReason('inward', 'production')).toBe(true);
    });

    it('should accept sale for outward', () => {
        expect(isValidReason('outward', 'sale')).toBe(true);
    });

    it('should accept order_allocation for reserved', () => {
        expect(isValidReason('reserved', 'order_allocation')).toBe(true);
    });

    it('should reject mismatched reason', () => {
        expect(isValidReason('inward', 'sale')).toBe(false);
    });
});

// ============================================
// SECTION 5: RETURN REQUEST VALIDATION
// ============================================

describe('Return Request - Schema', () => {
    const validateReturnRequest = (data) => {
        const errors = [];

        if (!data.orderId) errors.push('orderId is required');
        if (!data.returnType || !['refund', 'exchange'].includes(data.returnType)) {
            errors.push('returnType must be refund or exchange');
        }
        if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
            errors.push('items array is required and must not be empty');
        }

        return { valid: errors.length === 0, errors };
    };

    it('should pass for valid return request', () => {
        const request = {
            orderId: 'order-1',
            returnType: 'refund',
            items: [{ orderLineId: 'line-1', qty: 1 }]
        };
        expect(validateReturnRequest(request).valid).toBe(true);
    });

    it('should fail without orderId', () => {
        const request = {
            returnType: 'refund',
            items: [{ orderLineId: 'line-1', qty: 1 }]
        };
        expect(validateReturnRequest(request).valid).toBe(false);
    });

    it('should fail with empty items array', () => {
        const request = {
            orderId: 'order-1',
            returnType: 'refund',
            items: []
        };
        expect(validateReturnRequest(request).valid).toBe(false);
    });
});

describe('Return Request - Item Validation', () => {
    const validateReturnItem = (item) => {
        const errors = [];
        if (!item.orderLineId) errors.push('orderLineId is required');
        if (!item.qty || item.qty <= 0) errors.push('qty must be positive');
        if (!item.reasonCode) errors.push('reasonCode is required');
        return { valid: errors.length === 0, errors };
    };

    it('should pass for valid return item', () => {
        const item = { orderLineId: 'line-1', qty: 1, reasonCode: 'SIZE_ISSUE' };
        expect(validateReturnItem(item).valid).toBe(true);
    });

    it('should fail without reasonCode', () => {
        const item = { orderLineId: 'line-1', qty: 1 };
        expect(validateReturnItem(item).valid).toBe(false);
    });
});

// ============================================
// SECTION 6: SHIPPING DATA VALIDATION
// ============================================

describe('Shipping Data - AWB Validation', () => {
    const validateAwb = (awb) => {
        if (!awb) return { valid: false, error: 'AWB number is required' };
        const trimmed = awb.trim();
        if (trimmed.length < 8) {
            return { valid: false, error: 'AWB number must be at least 8 characters' };
        }
        return { valid: true, value: trimmed };
    };

    it('should accept valid AWB', () => {
        const result = validateAwb('AWB12345678');
        expect(result.valid).toBe(true);
    });

    it('should reject short AWB', () => {
        const result = validateAwb('ABC123');
        expect(result.valid).toBe(false);
    });

    it('should trim whitespace', () => {
        const result = validateAwb('  AWB12345678  ');
        expect(result.value).toBe('AWB12345678');
    });
});

describe('Shipping Data - Courier Validation', () => {
    const validCouriers = ['delhivery', 'bluedart', 'dtdc', 'xpressbees', 'other'];

    const validateCourier = (courier) => {
        const normalized = courier?.toLowerCase();
        if (!validCouriers.includes(normalized)) {
            return { valid: false, error: `Invalid courier: ${courier}` };
        }
        return { valid: true, value: normalized };
    };

    it('should accept valid courier', () => {
        expect(validateCourier('Delhivery').valid).toBe(true);
    });

    it('should normalize to lowercase', () => {
        expect(validateCourier('BLUEDART').value).toBe('bluedart');
    });

    it('should reject invalid courier', () => {
        expect(validateCourier('unknown').valid).toBe(false);
    });
});

// ============================================
// SECTION 7: ERROR MESSAGE FORMATTING
// ============================================

describe('Error Formatting - Single Error', () => {
    const formatError = (fieldName, message) => ({
        field: fieldName,
        message: message
    });

    it('should format error with field and message', () => {
        const error = formatError('qty', 'must be positive');
        expect(error.field).toBe('qty');
        expect(error.message).toBe('must be positive');
    });
});

describe('Error Formatting - Multiple Errors', () => {
    const formatValidationErrors = (errors) => ({
        success: false,
        error: 'Validation failed',
        details: errors
    });

    it('should format multiple errors', () => {
        const errors = [
            { field: 'qty', message: 'required' },
            { field: 'skuId', message: 'invalid' }
        ];
        const result = formatValidationErrors(errors);
        expect(result.success).toBe(false);
        expect(result.details.length).toBe(2);
    });
});

describe('Error Formatting - Response Structure', () => {
    const createValidationErrorResponse = (errors) => ({
        statusCode: 400,
        body: {
            error: 'Validation Error',
            message: errors.length === 1 ? errors[0] : 'Multiple validation errors',
            errors: errors
        }
    });

    it('should use 400 status code', () => {
        const response = createValidationErrorResponse(['Field is required']);
        expect(response.statusCode).toBe(400);
    });

    it('should show single error message directly', () => {
        const response = createValidationErrorResponse(['qty is required']);
        expect(response.body.message).toBe('qty is required');
    });

    it('should indicate multiple errors', () => {
        const response = createValidationErrorResponse(['error1', 'error2']);
        expect(response.body.message).toBe('Multiple validation errors');
    });
});

// ============================================
// SECTION 8: OPTIONAL FIELD VALIDATION
// ============================================

describe('Optional Fields - Default Values', () => {
    const applyDefaults = (data, defaults) => {
        return { ...defaults, ...data };
    };

    it('should use default when field missing', () => {
        const defaults = { priority: 'normal', status: 'pending' };
        const data = { name: 'Test' };
        const result = applyDefaults(data, defaults);
        expect(result.priority).toBe('normal');
    });

    it('should override default when field provided', () => {
        const defaults = { priority: 'normal' };
        const data = { priority: 'high' };
        const result = applyDefaults(data, defaults);
        expect(result.priority).toBe('high');
    });
});

describe('Optional Fields - Nullable Handling', () => {
    const sanitizeNullable = (value, emptyAsNull = true) => {
        if (value === undefined || value === null) return null;
        if (emptyAsNull && value === '') return null;
        return value;
    };

    it('should convert undefined to null', () => {
        expect(sanitizeNullable(undefined)).toBeNull();
    });

    it('should convert empty string to null by default', () => {
        expect(sanitizeNullable('')).toBeNull();
    });

    it('should keep empty string when emptyAsNull is false', () => {
        expect(sanitizeNullable('', false)).toBe('');
    });

    it('should keep valid value', () => {
        expect(sanitizeNullable('test')).toBe('test');
    });
});

// ============================================
// SECTION 9: DATE VALIDATION
// ============================================

describe('Date Validation - ISO Format', () => {
    const validateISODate = (dateStr) => {
        if (!dateStr) return { valid: false, error: 'Date is required' };
        const parsed = new Date(dateStr);
        if (isNaN(parsed.getTime())) {
            return { valid: false, error: 'Invalid date format' };
        }
        return { valid: true, value: parsed };
    };

    it('should accept ISO date string', () => {
        const result = validateISODate('2026-01-08');
        expect(result.valid).toBe(true);
    });

    it('should accept ISO datetime string', () => {
        const result = validateISODate('2026-01-08T10:30:00Z');
        expect(result.valid).toBe(true);
    });

    it('should reject invalid date', () => {
        const result = validateISODate('not-a-date');
        expect(result.valid).toBe(false);
    });
});

describe('Date Validation - Future Date Check', () => {
    const isNotInPast = (dateStr, referenceDate = new Date()) => {
        const target = new Date(dateStr);
        target.setHours(0, 0, 0, 0);
        const reference = new Date(referenceDate);
        reference.setHours(0, 0, 0, 0);
        return target >= reference;
    };

    it('should accept today', () => {
        const today = new Date().toISOString().split('T')[0];
        expect(isNotInPast(today)).toBe(true);
    });

    it('should accept future date', () => {
        const future = new Date();
        future.setDate(future.getDate() + 7);
        expect(isNotInPast(future.toISOString())).toBe(true);
    });

    it('should reject past date', () => {
        const past = new Date();
        past.setDate(past.getDate() - 7);
        expect(isNotInPast(past.toISOString())).toBe(false);
    });
});
