/**
 * Unit tests for GST Calculator (shared domain)
 */

import {
    computeOrderGst,
    getGstRateForMrp,
    determineGstType,
    type GstLineInput,
} from '../gst.js';

describe('getGstRateForMrp', () => {
    it('returns 5% for MRP below ₹1000', () => {
        expect(getGstRateForMrp(0)).toBe(5);
        expect(getGstRateForMrp(500)).toBe(5);
        expect(getGstRateForMrp(999)).toBe(5);
        expect(getGstRateForMrp(999.99)).toBe(5);
    });

    it('returns 12% for MRP at or above ₹1000', () => {
        expect(getGstRateForMrp(1000)).toBe(12);
        expect(getGstRateForMrp(1001)).toBe(12);
        expect(getGstRateForMrp(2500)).toBe(12);
        expect(getGstRateForMrp(5000)).toBe(12);
    });
});

describe('determineGstType', () => {
    it('returns cgst_sgst for Maharashtra (intra-state)', () => {
        expect(determineGstType('Maharashtra')).toBe('cgst_sgst');
    });

    it('is case-insensitive for state comparison', () => {
        expect(determineGstType('maharashtra')).toBe('cgst_sgst');
        expect(determineGstType('MAHARASHTRA')).toBe('cgst_sgst');
        expect(determineGstType('  Maharashtra  ')).toBe('cgst_sgst');
    });

    it('returns igst for other states (inter-state)', () => {
        expect(determineGstType('Karnataka')).toBe('igst');
        expect(determineGstType('Delhi')).toBe('igst');
        expect(determineGstType('Tamil Nadu')).toBe('igst');
        expect(determineGstType('Gujarat')).toBe('igst');
    });

    it('defaults to igst for null/undefined state', () => {
        expect(determineGstType(null)).toBe('igst');
        expect(determineGstType(undefined)).toBe('igst');
        expect(determineGstType('')).toBe('igst');
    });
});

describe('computeOrderGst', () => {
    describe('basic computation', () => {
        it('computes GST for a single line below threshold (5%)', () => {
            const lines: GstLineInput[] = [
                { amount: 525, mrp: 800, qty: 1 },
            ];
            const result = computeOrderGst(lines, 'Maharashtra');

            // B2C: ₹525 inclusive of 5% GST
            // taxableValue = 525 / 1.05 = 500
            // gstAmount = 525 - 500 = 25
            expect(result.lines[0].gstRate).toBe(5);
            expect(result.lines[0].taxableValue).toBe(500);
            expect(result.lines[0].gstAmount).toBe(25);
            expect(result.subtotal).toBe(500);
            expect(result.gstAmount).toBe(25);
            expect(result.total).toBe(525);
        });

        it('computes GST for a single line at/above threshold (12%)', () => {
            const lines: GstLineInput[] = [
                { amount: 1120, mrp: 1500, qty: 1 },
            ];
            const result = computeOrderGst(lines, 'Maharashtra');

            // B2C: ₹1120 inclusive of 12% GST
            // taxableValue = 1120 / 1.12 = 1000
            // gstAmount = 1120 - 1000 = 120
            expect(result.lines[0].gstRate).toBe(12);
            expect(result.lines[0].taxableValue).toBe(1000);
            expect(result.lines[0].gstAmount).toBe(120);
            expect(result.subtotal).toBe(1000);
            expect(result.gstAmount).toBe(120);
            expect(result.total).toBe(1120);
        });
    });

    describe('intra-state (Maharashtra → CGST + SGST)', () => {
        it('splits GST 50/50 into CGST and SGST', () => {
            const lines: GstLineInput[] = [
                { amount: 1120, mrp: 1500, qty: 1 },
            ];
            const result = computeOrderGst(lines, 'Maharashtra');

            expect(result.gstType).toBe('cgst_sgst');
            expect(result.cgstAmount).toBe(60);
            expect(result.sgstAmount).toBe(60);
            expect(result.igstAmount).toBe(0);
            expect(result.cgstAmount + result.sgstAmount).toBe(result.gstAmount);
        });
    });

    describe('inter-state (other state → IGST)', () => {
        it('puts full GST into IGST', () => {
            const lines: GstLineInput[] = [
                { amount: 1120, mrp: 1500, qty: 1 },
            ];
            const result = computeOrderGst(lines, 'Karnataka');

            expect(result.gstType).toBe('igst');
            expect(result.cgstAmount).toBe(0);
            expect(result.sgstAmount).toBe(0);
            expect(result.igstAmount).toBe(120);
        });
    });

    describe('multiple lines with mixed rates', () => {
        it('handles lines with different GST rates', () => {
            const lines: GstLineInput[] = [
                { amount: 525, mrp: 800, qty: 1, hsnCode: '6109' },   // 5% GST
                { amount: 1120, mrp: 1500, qty: 1, hsnCode: '6109' }, // 12% GST
            ];
            const result = computeOrderGst(lines, 'Delhi');

            expect(result.lines[0].gstRate).toBe(5);
            expect(result.lines[1].gstRate).toBe(12);
            expect(result.lines[0].taxableValue).toBe(500);
            expect(result.lines[1].taxableValue).toBe(1000);
            expect(result.subtotal).toBe(1500);
            expect(result.gstAmount).toBe(145); // 25 + 120
            expect(result.total).toBe(1645);
            expect(result.gstType).toBe('igst');
            expect(result.igstAmount).toBe(145);
        });
    });

    describe('multi-quantity lines', () => {
        it('uses total amount (unitPrice * qty already applied)', () => {
            // 2 units at ₹525 each = ₹1050 total
            const lines: GstLineInput[] = [
                { amount: 1050, mrp: 800, qty: 2, hsnCode: '6109' },
            ];
            const result = computeOrderGst(lines, 'Maharashtra');

            // taxableValue = 1050 / 1.05 = 1000
            // gstAmount = 1050 - 1000 = 50
            expect(result.lines[0].taxableValue).toBe(1000);
            expect(result.lines[0].gstAmount).toBe(50);
            expect(result.subtotal).toBe(1000);
            expect(result.gstAmount).toBe(50);
            expect(result.total).toBe(1050);
        });
    });

    describe('edge cases', () => {
        it('handles empty lines array', () => {
            const result = computeOrderGst([], 'Maharashtra');
            expect(result.lines).toEqual([]);
            expect(result.subtotal).toBe(0);
            expect(result.gstAmount).toBe(0);
            expect(result.total).toBe(0);
            expect(result.effectiveGstRate).toBe(0);
        });

        it('defaults to IGST when customer state is null', () => {
            const lines: GstLineInput[] = [
                { amount: 525, mrp: 800, qty: 1 },
            ];
            const result = computeOrderGst(lines, null);
            expect(result.gstType).toBe('igst');
            expect(result.igstAmount).toBe(25);
        });

        it('uses default HSN code when not provided', () => {
            const lines: GstLineInput[] = [
                { amount: 525, mrp: 800, qty: 1 },
            ];
            const result = computeOrderGst(lines, 'Maharashtra');
            expect(result.lines[0].hsnCode).toBe('6109');
        });

        it('uses provided HSN code when specified', () => {
            const lines: GstLineInput[] = [
                { amount: 525, mrp: 800, qty: 1, hsnCode: '6110' },
            ];
            const result = computeOrderGst(lines, 'Maharashtra');
            expect(result.lines[0].hsnCode).toBe('6110');
        });

        it('handles zero amount lines', () => {
            const lines: GstLineInput[] = [
                { amount: 0, mrp: 800, qty: 1 },
            ];
            const result = computeOrderGst(lines, 'Maharashtra');
            expect(result.subtotal).toBe(0);
            expect(result.gstAmount).toBe(0);
            expect(result.total).toBe(0);
        });

        it('CGST + SGST always equals total GST (no rounding loss)', () => {
            // Test with an odd GST amount that doesn't split evenly
            const lines: GstLineInput[] = [
                { amount: 105, mrp: 800, qty: 1 }, // 5% → taxable=100, gst=5 → cgst=2.5, sgst=2.5
            ];
            const result = computeOrderGst(lines, 'Maharashtra');
            expect(result.cgstAmount + result.sgstAmount).toBe(result.gstAmount);
        });

        it('handles MRP exactly at threshold boundary', () => {
            const lines: GstLineInput[] = [
                { amount: 1000, mrp: 1000, qty: 1 }, // MRP = 1000, should be 12%
            ];
            const result = computeOrderGst(lines, 'Maharashtra');
            expect(result.lines[0].gstRate).toBe(12);
        });
    });

    describe('effectiveGstRate', () => {
        it('calculates weighted average rate correctly for single rate', () => {
            const lines: GstLineInput[] = [
                { amount: 1120, mrp: 1500, qty: 1 },
            ];
            const result = computeOrderGst(lines, 'Maharashtra');
            expect(result.effectiveGstRate).toBe(12);
        });

        it('calculates weighted average for mixed rates', () => {
            const lines: GstLineInput[] = [
                { amount: 525, mrp: 800, qty: 1 },   // 5% → taxable=500, gst=25
                { amount: 1120, mrp: 1500, qty: 1 }, // 12% → taxable=1000, gst=120
            ];
            const result = computeOrderGst(lines, 'Maharashtra');
            // weighted avg = 145/1500 * 100 = 9.67%
            expect(result.effectiveGstRate).toBeCloseTo(9.67, 1);
        });
    });

    describe('real-world scenarios', () => {
        it('typical COH order: 3 t-shirts, MRP ₹799, selling at ₹599 each, Mumbai customer', () => {
            const lines: GstLineInput[] = [
                { amount: 599, mrp: 799, qty: 1, hsnCode: '6109' },
                { amount: 599, mrp: 799, qty: 1, hsnCode: '6109' },
                { amount: 599, mrp: 799, qty: 1, hsnCode: '6109' },
            ];
            const result = computeOrderGst(lines, 'Maharashtra');

            expect(result.gstType).toBe('cgst_sgst');
            expect(result.lines.every(l => l.gstRate === 5)).toBe(true);
            // Each line: taxableValue = 599/1.05 = 570.48, gstAmount = 28.52
            expect(result.subtotal).toBeCloseTo(1711.43, 1);
            expect(result.gstAmount).toBeCloseTo(85.57, 1);
            expect(result.total).toBe(1797); // 599*3
            // CGST = SGST = ~42.79 each
            expect(result.cgstAmount + result.sgstAmount).toBeCloseTo(result.gstAmount, 2);
        });

        it('typical COH order: premium tee MRP ₹1299, shipped to Delhi', () => {
            const lines: GstLineInput[] = [
                { amount: 1099, mrp: 1299, qty: 1, hsnCode: '6109' },
            ];
            const result = computeOrderGst(lines, 'Delhi');

            expect(result.gstType).toBe('igst');
            expect(result.lines[0].gstRate).toBe(12);
            // taxableValue = 1099/1.12 = 981.25
            // gstAmount = 1099 - 981.25 = 117.75
            expect(result.lines[0].taxableValue).toBeCloseTo(981.25, 1);
            expect(result.igstAmount).toBeCloseTo(117.75, 1);
            expect(result.cgstAmount).toBe(0);
            expect(result.sgstAmount).toBe(0);
        });
    });
});
