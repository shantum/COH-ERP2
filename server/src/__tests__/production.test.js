/**
 * Production Batch Tests
 * 
 * Tests for:
 * - Batch code generation (YYYYMMDD-XXX format)
 * - Status transitions: planned → in_progress → completed
 * - Quantity validation
 * - Fabric consumption calculation
 * - Date locking logic
 */

// ============================================
// SECTION 1: BATCH CODE GENERATION
// ============================================

describe('Batch Code - Generation Format', () => {
    const generateBatchCode = (dateStr, serialNumber) => {
        const serial = String(serialNumber).padStart(3, '0');
        return `${dateStr}-${serial}`;
    };

    it('should generate batch code in YYYYMMDD-XXX format', () => {
        const code = generateBatchCode('20260108', 1);
        expect(code).toBe('20260108-001');
    });

    it('should pad serial numbers to 3 digits', () => {
        expect(generateBatchCode('20260108', 1)).toBe('20260108-001');
        expect(generateBatchCode('20260108', 10)).toBe('20260108-010');
        expect(generateBatchCode('20260108', 100)).toBe('20260108-100');
    });

    it('should handle serial numbers above 999', () => {
        expect(generateBatchCode('20260108', 1000)).toBe('20260108-1000');
    });
});

describe('Batch Code - Serial Extraction', () => {
    const extractSerialFromCode = (batchCode) => {
        const match = batchCode.match(/-(\d+)$/);
        return match ? parseInt(match[1], 10) : null;
    };

    it('should extract serial number from batch code', () => {
        expect(extractSerialFromCode('20260108-001')).toBe(1);
        expect(extractSerialFromCode('20260108-042')).toBe(42);
        expect(extractSerialFromCode('20260108-100')).toBe(100);
    });

    it('should return null for invalid code', () => {
        expect(extractSerialFromCode('invalid')).toBeNull();
        expect(extractSerialFromCode('')).toBeNull();
    });
});

describe('Batch Code - Date Formatting', () => {
    const formatDateForBatchCode = (date) => {
        return date.toISOString().split('T')[0].replace(/-/g, '');
    };

    it('should format date as YYYYMMDD', () => {
        const date = new Date('2026-01-08');
        expect(formatDateForBatchCode(date)).toBe('20260108');
    });

    it('should handle end of month dates', () => {
        const date = new Date('2026-12-31');
        expect(formatDateForBatchCode(date)).toBe('20261231');
    });
});

// ============================================
// SECTION 2: BATCH STATUS TRANSITIONS
// ============================================

describe('Batch Status - Valid Transitions', () => {
    const validStatuses = ['planned', 'in_progress', 'completed', 'cancelled'];

    const statusTransitions = {
        planned: ['in_progress', 'cancelled'],
        in_progress: ['completed', 'planned', 'cancelled'],
        completed: ['planned'], // Can uncomplete
        cancelled: ['planned'], // Can reactivate
    };

    it('should recognize all valid batch statuses', () => {
        expect(validStatuses).toContain('planned');
        expect(validStatuses).toContain('in_progress');
        expect(validStatuses).toContain('completed');
    });

    it('should allow planned → in_progress transition', () => {
        expect(statusTransitions.planned).toContain('in_progress');
    });

    it('should allow in_progress → completed transition', () => {
        expect(statusTransitions.in_progress).toContain('completed');
    });

    it('should allow uncomplete: completed → planned', () => {
        expect(statusTransitions.completed).toContain('planned');
    });
});

describe('Batch Status - Auto-Determination', () => {
    const determineBatchStatus = (qtyPlanned, qtyCompleted, currentStatus) => {
        if (qtyCompleted >= qtyPlanned && qtyCompleted > 0) {
            return currentStatus !== 'completed' ? 'completed' : null;
        }
        if (qtyCompleted > 0 && qtyCompleted < qtyPlanned) {
            return currentStatus !== 'in_progress' ? 'in_progress' : null;
        }
        if (qtyCompleted === 0 && currentStatus === 'completed') {
            return 'planned';
        }
        return null;
    };

    it('should return completed when qtyCompleted >= qtyPlanned', () => {
        expect(determineBatchStatus(10, 10, 'in_progress')).toBe('completed');
        expect(determineBatchStatus(10, 15, 'in_progress')).toBe('completed'); // Over-production
    });

    it('should return in_progress when partially completed', () => {
        expect(determineBatchStatus(10, 5, 'planned')).toBe('in_progress');
    });

    it('should return planned when uncompleted (qtyCompleted = 0)', () => {
        expect(determineBatchStatus(10, 0, 'completed')).toBe('planned');
    });

    it('should return null when no change needed', () => {
        expect(determineBatchStatus(10, 10, 'completed')).toBeNull();
        expect(determineBatchStatus(10, 5, 'in_progress')).toBeNull();
    });
});

// ============================================
// SECTION 3: QUANTITY VALIDATION
// ============================================

describe('Batch Quantity - Validation Rules', () => {
    const validateQtyCompleted = (qtyCompleted, qtyPlanned) => {
        if (!qtyCompleted || qtyCompleted <= 0) {
            return { valid: false, error: 'qtyCompleted must be a positive number' };
        }
        if (qtyCompleted > qtyPlanned * 1.5) {
            return { valid: false, error: 'qtyCompleted exceeds 150% of planned' };
        }
        return { valid: true };
    };

    it('should reject zero or negative qty', () => {
        expect(validateQtyCompleted(0, 10).valid).toBe(false);
        expect(validateQtyCompleted(-5, 10).valid).toBe(false);
    });

    it('should accept qty within plan', () => {
        expect(validateQtyCompleted(10, 10).valid).toBe(true);
        expect(validateQtyCompleted(5, 10).valid).toBe(true);
    });

    it('should accept slight over-production (up to 150%)', () => {
        expect(validateQtyCompleted(15, 10).valid).toBe(true);
    });

    it('should reject extreme over-production', () => {
        expect(validateQtyCompleted(20, 10).valid).toBe(false);
    });
});

describe('Batch Quantity - Progress Calculation', () => {
    const calculateProgress = (qtyCompleted, qtyPlanned) => {
        if (!qtyPlanned || qtyPlanned <= 0) return 0;
        return Math.round((qtyCompleted / qtyPlanned) * 100);
    };

    it('should calculate progress percentage', () => {
        expect(calculateProgress(5, 10)).toBe(50);
        expect(calculateProgress(10, 10)).toBe(100);
    });

    it('should handle over-production', () => {
        expect(calculateProgress(15, 10)).toBe(150);
    });

    it('should return 0 for invalid planned qty', () => {
        expect(calculateProgress(5, 0)).toBe(0);
        expect(calculateProgress(5, null)).toBe(0);
    });
});

// ============================================
// SECTION 4: FABRIC CONSUMPTION CALCULATION
// ============================================

describe('Fabric Consumption - Total Calculation', () => {
    const calculateTotalFabricConsumption = (consumptionPerUnit, quantity) => {
        return consumptionPerUnit * quantity;
    };

    it('should calculate total fabric needed', () => {
        expect(calculateTotalFabricConsumption(1.5, 10)).toBe(15);
        expect(calculateTotalFabricConsumption(2.0, 5)).toBe(10);
    });

    it('should handle fractional consumption', () => {
        expect(calculateTotalFabricConsumption(1.75, 4)).toBe(7);
    });
});

describe('Fabric Balance - Validation', () => {
    const canCompleteBatch = (fabricBalance, requiredFabric) => {
        return fabricBalance >= requiredFabric;
    };

    it('should allow completion when sufficient fabric', () => {
        expect(canCompleteBatch(20, 15)).toBe(true);
        expect(canCompleteBatch(15, 15)).toBe(true);
    });

    it('should NOT allow completion when insufficient fabric', () => {
        expect(canCompleteBatch(10, 15)).toBe(false);
    });
});

// ============================================
// SECTION 5: DATE LOCKING LOGIC
// ============================================

describe('Date Locking - Validation', () => {
    const isDateLocked = (dateStr, lockedDates) => {
        return lockedDates.includes(dateStr);
    };

    it('should detect locked date', () => {
        const locked = ['2026-01-08', '2026-01-09'];
        expect(isDateLocked('2026-01-08', locked)).toBe(true);
    });

    it('should allow unlocked date', () => {
        const locked = ['2026-01-08', '2026-01-09'];
        expect(isDateLocked('2026-01-10', locked)).toBe(false);
    });

    it('should handle empty locked list', () => {
        expect(isDateLocked('2026-01-08', [])).toBe(false);
    });
});

describe('Date Locking - Date Normalization', () => {
    const normalizeDateString = (date) => {
        if (typeof date === 'string') {
            return date.split('T')[0];
        }
        return date.toISOString().split('T')[0];
    };

    it('should normalize ISO datetime to date', () => {
        expect(normalizeDateString('2026-01-08T10:30:00Z')).toBe('2026-01-08');
    });

    it('should accept already normalized date', () => {
        expect(normalizeDateString('2026-01-08')).toBe('2026-01-08');
    });

    it('should convert Date object to string', () => {
        const date = new Date('2026-01-08');
        expect(normalizeDateString(date)).toBe('2026-01-08');
    });
});

describe('Date Validation - Past Dates', () => {
    const canScheduleForDate = (targetDate, today) => {
        const targetNormalized = new Date(targetDate);
        targetNormalized.setHours(0, 0, 0, 0);
        const todayNormalized = new Date(today);
        todayNormalized.setHours(0, 0, 0, 0);
        return targetNormalized >= todayNormalized;
    };

    it('should allow scheduling for today', () => {
        const today = new Date('2026-01-08');
        expect(canScheduleForDate('2026-01-08', today)).toBe(true);
    });

    it('should allow scheduling for future', () => {
        const today = new Date('2026-01-08');
        expect(canScheduleForDate('2026-01-10', today)).toBe(true);
    });

    it('should NOT allow scheduling for past', () => {
        const today = new Date('2026-01-08');
        expect(canScheduleForDate('2026-01-07', today)).toBe(false);
    });
});

// ============================================
// SECTION 6: CUSTOM SKU BATCH HANDLING
// ============================================

describe('Custom SKU Batch - Detection', () => {
    const isCustomSkuBatch = (batch) => {
        return Boolean(batch.sku?.isCustomSku && batch.sourceOrderLineId);
    };

    it('should detect custom SKU batch with order line', () => {
        const batch = {
            sku: { isCustomSku: true },
            sourceOrderLineId: 'line-123'
        };
        expect(isCustomSkuBatch(batch)).toBe(true);
    });

    it('should NOT detect custom SKU without order line', () => {
        const batch = {
            sku: { isCustomSku: true },
            sourceOrderLineId: null
        };
        expect(isCustomSkuBatch(batch)).toBe(false);
    });

    it('should NOT detect standard SKU batch', () => {
        const batch = {
            sku: { isCustomSku: false },
            sourceOrderLineId: 'line-123'
        };
        expect(isCustomSkuBatch(batch)).toBe(false);
    });
});

describe('Custom SKU Batch - Auto-Allocation Eligibility', () => {
    const shouldAutoAllocate = (batch) => {
        return Boolean(batch.sku?.isCustomSku && batch.sourceOrderLineId);
    };

    it('should auto-allocate custom SKU batch', () => {
        const batch = {
            sku: { isCustomSku: true },
            sourceOrderLineId: 'line-123'
        };
        expect(shouldAutoAllocate(batch)).toBe(true);
    });

    it('should NOT auto-allocate standard production batch', () => {
        const batch = {
            sku: { isCustomSku: false },
            sourceOrderLineId: 'line-123'
        };
        expect(shouldAutoAllocate(batch)).toBe(false);
    });
});

describe('Custom SKU Batch - Uncomplete Eligibility', () => {
    const canUncomplete = (batch, orderLine) => {
        if (!batch.sku?.isCustomSku) return true; // Standard batch can always uncomplete
        if (!orderLine) return true;
        const progressedStatuses = ['picked', 'packed', 'shipped'];
        return !progressedStatuses.includes(orderLine.lineStatus);
    };

    it('should allow uncomplete when order line is allocated', () => {
        const batch = { sku: { isCustomSku: true } };
        const orderLine = { lineStatus: 'allocated' };
        expect(canUncomplete(batch, orderLine)).toBe(true);
    });

    it('should NOT allow uncomplete when order line is picked', () => {
        const batch = { sku: { isCustomSku: true } };
        const orderLine = { lineStatus: 'picked' };
        expect(canUncomplete(batch, orderLine)).toBe(false);
    });

    it('should NOT allow uncomplete when order line is shipped', () => {
        const batch = { sku: { isCustomSku: true } };
        const orderLine = { lineStatus: 'shipped' };
        expect(canUncomplete(batch, orderLine)).toBe(false);
    });

    it('should allow uncomplete for standard batches', () => {
        const batch = { sku: { isCustomSku: false } };
        expect(canUncomplete(batch, null)).toBe(true);
    });
});

// ============================================
// SECTION 7: PRIORITY LEVELS
// ============================================

describe('Batch Priority - Valid Values', () => {
    const validPriorities = ['low', 'normal', 'high', 'urgent'];

    it('should recognize all priority levels', () => {
        expect(validPriorities).toContain('low');
        expect(validPriorities).toContain('normal');
        expect(validPriorities).toContain('high');
        expect(validPriorities).toContain('urgent');
    });

    it('should use normal as default', () => {
        const prioritizeDefault = (priority) => priority || 'normal';
        expect(prioritizeDefault(null)).toBe('normal');
        expect(prioritizeDefault(undefined)).toBe('normal');
    });
});

describe('Batch Priority - Sorting', () => {
    const priorityWeight = {
        urgent: 4,
        high: 3,
        normal: 2,
        low: 1
    };

    const sortByPriority = (batches) => {
        return [...batches].sort((a, b) =>
            (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0)
        );
    };

    it('should sort urgent before high', () => {
        const batches = [
            { id: 1, priority: 'high' },
            { id: 2, priority: 'urgent' }
        ];
        const sorted = sortByPriority(batches);
        expect(sorted[0].id).toBe(2);
    });

    it('should sort high before normal', () => {
        const batches = [
            { id: 1, priority: 'normal' },
            { id: 2, priority: 'high' }
        ];
        const sorted = sortByPriority(batches);
        expect(sorted[0].id).toBe(2);
    });
});

// ============================================
// SECTION 8: CAPACITY CALCULATION
// ============================================

describe('Capacity - Utilization Calculation', () => {
    const calculateUtilization = (allocatedMins, dailyCapacityMins) => {
        if (!dailyCapacityMins || dailyCapacityMins <= 0) return 0;
        return Math.round((allocatedMins / dailyCapacityMins) * 100);
    };

    it('should calculate utilization percentage', () => {
        expect(calculateUtilization(240, 480)).toBe(50);
        expect(calculateUtilization(480, 480)).toBe(100);
    });

    it('should handle over-capacity', () => {
        expect(calculateUtilization(600, 480)).toBe(125);
    });

    it('should return 0 for invalid capacity', () => {
        expect(calculateUtilization(240, 0)).toBe(0);
    });
});

describe('Capacity - Available Time', () => {
    const calculateAvailable = (dailyCapacity, allocated) => {
        return Math.max(0, dailyCapacity - allocated);
    };

    it('should calculate available minutes', () => {
        expect(calculateAvailable(480, 200)).toBe(280);
    });

    it('should return 0 when over-capacity', () => {
        expect(calculateAvailable(480, 600)).toBe(0);
    });
});

// ============================================
// SECTION 9: BATCH DELETION RULES
// ============================================

describe('Batch Deletion - Safety Checks', () => {
    const canDeleteBatch = (inventoryTxnCount, fabricTxnCount) => {
        return inventoryTxnCount === 0 && fabricTxnCount === 0;
    };

    it('should allow deletion when no transactions exist', () => {
        expect(canDeleteBatch(0, 0)).toBe(true);
    });

    it('should NOT allow deletion with inventory transactions', () => {
        expect(canDeleteBatch(1, 0)).toBe(false);
    });

    it('should NOT allow deletion with fabric transactions', () => {
        expect(canDeleteBatch(0, 1)).toBe(false);
    });
});

describe('Batch Deletion - Idempotency Check', () => {
    const hasBeenCompleted = (batch) => {
        return batch.completedAt !== null;
    };

    it('should detect completed batch', () => {
        const batch = { completedAt: new Date() };
        expect(hasBeenCompleted(batch)).toBe(true);
    });

    it('should detect incomplete batch', () => {
        const batch = { completedAt: null };
        expect(hasBeenCompleted(batch)).toBe(false);
    });
});
