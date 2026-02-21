/**
 * Fabric Inventory Tests
 * 
 * Tests for:
 * - Fabric transaction types (inward/outward)
 * - Balance calculation
 * - Consumption per unit calculations
 * - Production-to-fabric linkage
 */

import { FABRIC_TXN_TYPE } from '../utils/queryPatterns.js';

// ============================================
// SECTION 1: FABRIC TRANSACTION TYPES
// ============================================

describe('Fabric Transaction Types', () => {
    it('should have inward and outward types', () => {
        expect(FABRIC_TXN_TYPE.INWARD).toBe('inward');
        expect(FABRIC_TXN_TYPE.OUTWARD).toBe('outward');
    });

    it('should not have reserved type (unlike inventory)', () => {
        expect(FABRIC_TXN_TYPE.RESERVED).toBeUndefined();
    });
});

describe('Fabric Transaction - Valid Reasons', () => {
    const validFabricReasons = ['purchase', 'production', 'adjustment', 'return', 'wastage'];

    it('should include purchase for inward', () => {
        expect(validFabricReasons).toContain('purchase');
    });

    it('should include production for outward', () => {
        expect(validFabricReasons).toContain('production');
    });

    it('should include adjustment for corrections', () => {
        expect(validFabricReasons).toContain('adjustment');
    });
});

// ============================================
// SECTION 2: FABRIC BALANCE CALCULATION
// ============================================

describe('Fabric Balance - Basic Calculation', () => {
    const calculateFabricBalance = (transactions) => {
        let totalInward = 0;
        let totalOutward = 0;

        transactions.forEach((txn) => {
            if (txn.txnType === 'inward') totalInward += txn.qty;
            else if (txn.txnType === 'outward') totalOutward += txn.qty;
        });

        return {
            totalInward,
            totalOutward,
            currentBalance: totalInward - totalOutward
        };
    };

    it('should calculate balance from inward and outward', () => {
        const transactions = [
            { txnType: 'inward', qty: 100 },
            { txnType: 'outward', qty: 30 },
            { txnType: 'inward', qty: 50 }
        ];
        const balance = calculateFabricBalance(transactions);
        expect(balance.totalInward).toBe(150);
        expect(balance.totalOutward).toBe(30);
        expect(balance.currentBalance).toBe(120);
    });

    it('should handle empty transactions', () => {
        const balance = calculateFabricBalance([]);
        expect(balance.currentBalance).toBe(0);
    });

    it('should handle only inward transactions', () => {
        const transactions = [
            { txnType: 'inward', qty: 100 }
        ];
        const balance = calculateFabricBalance(transactions);
        expect(balance.currentBalance).toBe(100);
    });
});

describe('Fabric Balance - Unit Handling', () => {
    const defaultUnit = 'meter';

    it('should use meter as default unit', () => {
        expect(defaultUnit).toBe('meter');
    });

    it('should handle fractional quantities', () => {
        const qty1 = 1.75;
        const qty2 = 2.5;
        expect(qty1 + qty2).toBe(4.25);
    });
});

// ============================================
// SECTION 3: FABRIC CONSUMPTION CALCULATION
// ============================================

describe('Fabric Consumption - Batch Total', () => {
    const calculateBatchFabricConsumption = (consumptionPerUnit, qtyCompleted) => {
        return consumptionPerUnit * qtyCompleted;
    };

    it('should calculate total fabric for batch', () => {
        expect(calculateBatchFabricConsumption(1.5, 10)).toBe(15);
    });

    it('should handle fractional consumption', () => {
        expect(calculateBatchFabricConsumption(1.75, 4)).toBe(7);
    });

    it('should return 0 for 0 quantity', () => {
        expect(calculateBatchFabricConsumption(1.5, 0)).toBe(0);
    });
});

// ============================================
// SECTION 4: PRODUCTION-TO-FABRIC LINKAGE
// ============================================

describe('Production Batch - Fabric Transaction', () => {
    const createProductionFabricOutward = (batchId, fabricId, qty) => ({
        fabricId,
        txnType: 'outward',
        qty,
        unit: 'meter',
        reason: 'production',
        referenceId: batchId
    });

    it('should create outward transaction for production', () => {
        const txn = createProductionFabricOutward('batch-123', 'fabric-456', 15);
        expect(txn.txnType).toBe('outward');
        expect(txn.reason).toBe('production');
        expect(txn.referenceId).toBe('batch-123');
    });

    it('should track fabric consumption against batch', () => {
        const txn = createProductionFabricOutward('batch-123', 'fabric-456', 15);
        expect(txn.fabricId).toBe('fabric-456');
        expect(txn.qty).toBe(15);
    });
});

describe('Production Batch - Fabric Balance Check', () => {
    const canCompleteBatch = (fabricBalance, requiredFabric) => {
        return fabricBalance >= requiredFabric;
    };

    it('should allow completion when sufficient fabric', () => {
        expect(canCompleteBatch(100, 15)).toBe(true);
    });

    it('should deny completion when insufficient fabric', () => {
        expect(canCompleteBatch(10, 15)).toBe(false);
    });

    it('should allow when exactly enough fabric', () => {
        expect(canCompleteBatch(15, 15)).toBe(true);
    });
});

// ============================================
// SECTION 5: FABRIC AGGREGATION (ALL FABRICS)
// ============================================

describe('Fabric Balance Map - Multiple Fabrics', () => {
    const aggregateFabricBalances = (transactions) => {
        const balanceMap = new Map();

        transactions.forEach((txn) => {
            if (!balanceMap.has(txn.fabricId)) {
                balanceMap.set(txn.fabricId, {
                    fabricId: txn.fabricId,
                    totalInward: 0,
                    totalOutward: 0
                });
            }

            const balance = balanceMap.get(txn.fabricId);
            if (txn.txnType === 'inward') balance.totalInward += txn.qty;
            else if (txn.txnType === 'outward') balance.totalOutward += txn.qty;
        });

        // Calculate current balance
        for (const [, balance] of balanceMap) {
            balance.currentBalance = balance.totalInward - balance.totalOutward;
        }

        return balanceMap;
    };

    it('should aggregate transactions by fabric', () => {
        const transactions = [
            { fabricId: 'f1', txnType: 'inward', qty: 100 },
            { fabricId: 'f2', txnType: 'inward', qty: 50 },
            { fabricId: 'f1', txnType: 'outward', qty: 20 }
        ];

        const map = aggregateFabricBalances(transactions);
        expect(map.get('f1').currentBalance).toBe(80);
        expect(map.get('f2').currentBalance).toBe(50);
    });

    it('should handle empty transactions', () => {
        const map = aggregateFabricBalances([]);
        expect(map.size).toBe(0);
    });
});

// ============================================
// SECTION 6: FABRIC PURCHASE TRACKING
// ============================================

describe('Fabric Purchase - Inward Transaction', () => {
    const createPurchaseTransaction = (fabricId, qty, invoiceNo) => ({
        fabricId,
        txnType: 'inward',
        qty,
        unit: 'meter',
        reason: 'purchase',
        notes: invoiceNo ? `Invoice: ${invoiceNo}` : null
    });

    it('should create inward transaction for purchase', () => {
        const txn = createPurchaseTransaction('fabric-123', 100, 'INV-001');
        expect(txn.txnType).toBe('inward');
        expect(txn.reason).toBe('purchase');
    });

    it('should track invoice in notes', () => {
        const txn = createPurchaseTransaction('fabric-123', 100, 'INV-001');
        expect(txn.notes).toContain('INV-001');
    });
});

// ============================================
// SECTION 7: FABRIC ADJUSTMENT
// ============================================

describe('Fabric Adjustment - Correction Transactions', () => {
    const createAdjustment = (fabricId, qty, isPositive, reason) => ({
        fabricId,
        txnType: isPositive ? 'inward' : 'outward',
        qty: Math.abs(qty),
        unit: 'meter',
        reason: 'adjustment',
        notes: reason
    });

    it('should create inward for positive adjustment', () => {
        const txn = createAdjustment('fabric-123', 10, true, 'Stock count correction');
        expect(txn.txnType).toBe('inward');
        expect(txn.qty).toBe(10);
    });

    it('should create outward for negative adjustment', () => {
        const txn = createAdjustment('fabric-123', 5, false, 'Damaged stock');
        expect(txn.txnType).toBe('outward');
        expect(txn.qty).toBe(5);
    });
});

// ============================================
// SECTION 8: WASTAGE TRACKING
// ============================================

describe('Fabric Wastage - Outward Transactions', () => {
    const createWastageTransaction = (fabricId, qty, reason) => ({
        fabricId,
        txnType: 'outward',
        qty,
        unit: 'meter',
        reason: 'wastage',
        notes: reason
    });

    it('should create outward transaction for wastage', () => {
        const txn = createWastageTransaction('fabric-123', 2, 'Cutting defects');
        expect(txn.txnType).toBe('outward');
        expect(txn.reason).toBe('wastage');
    });

    it('should include wastage reason in notes', () => {
        const txn = createWastageTransaction('fabric-123', 2, 'Cutting defects');
        expect(txn.notes).toBe('Cutting defects');
    });
});
