/**
 * Comprehensive Tests for ShipOrderService
 *
 * Tests the unified shipping service that handles all shipping operations.
 * This service consolidates inventory management, status updates, and validation.
 */

import { jest } from '@jest/globals';
import { mockDeep, mockReset } from 'jest-mock-extended';

// Mock queryPatterns module before importing the service
jest.unstable_mockModule('../utils/queryPatterns.js', () => ({
    TXN_TYPE: {
        INWARD: 'inward',
        OUTWARD: 'outward',
        RESERVED: 'reserved',
    },
    TXN_REASON: {
        ORDER_ALLOCATION: 'order_allocation',
        SALE: 'sale',
    },
    releaseReservedInventory: jest.fn(),
    createSaleTransaction: jest.fn(),
}));

// Import after mocking
const { shipOrderLines, shipOrder, validateShipment } = await import('../services/shipOrderService.js');
const queryPatterns = await import('../utils/queryPatterns.js');

describe('ShipOrderService', () => {
    let mockPrisma;
    let mockTx;
    const userId = 'user-123';
    const awbNumber = 'AWB12345';
    const courier = 'Delhivery';

    beforeEach(() => {
        // Create fresh mocks for each test
        mockPrisma = mockDeep();
        mockTx = mockDeep();

        // Clear mock call history and reset mock implementations
        jest.clearAllMocks();

        // Reset the mocked queryPatterns functions
        queryPatterns.releaseReservedInventory.mockReset();
        queryPatterns.createSaleTransaction.mockReset();
    });

    // ============================================
    // shipOrderLines - Parameter Validation Tests
    // ============================================

    describe('shipOrderLines - Parameter Validation', () => {
        it('should throw when orderLineIds is empty', async () => {
            await expect(
                shipOrderLines(mockTx, {
                    orderLineIds: [],
                    awbNumber,
                    courier,
                    userId,
                })
            ).rejects.toThrow('orderLineIds array is required and must not be empty');
        });

        it('should throw when orderLineIds is missing', async () => {
            await expect(
                shipOrderLines(mockTx, {
                    awbNumber,
                    courier,
                    userId,
                })
            ).rejects.toThrow('orderLineIds array is required and must not be empty');
        });

        it('should throw when awbNumber is missing', async () => {
            await expect(
                shipOrderLines(mockTx, {
                    orderLineIds: ['line-1'],
                    courier,
                    userId,
                })
            ).rejects.toThrow('awbNumber is required');
        });

        it('should throw when awbNumber is empty string', async () => {
            await expect(
                shipOrderLines(mockTx, {
                    orderLineIds: ['line-1'],
                    awbNumber: '   ',
                    courier,
                    userId,
                })
            ).rejects.toThrow('awbNumber is required');
        });

        it('should throw when courier is missing', async () => {
            await expect(
                shipOrderLines(mockTx, {
                    orderLineIds: ['line-1'],
                    awbNumber,
                    userId,
                })
            ).rejects.toThrow('courier is required');
        });

        it('should throw when courier is empty string', async () => {
            await expect(
                shipOrderLines(mockTx, {
                    orderLineIds: ['line-1'],
                    awbNumber,
                    courier: '   ',
                    userId,
                })
            ).rejects.toThrow('courier is required');
        });

        it('should throw when userId is missing', async () => {
            await expect(
                shipOrderLines(mockTx, {
                    orderLineIds: ['line-1'],
                    awbNumber,
                    courier,
                })
            ).rejects.toThrow('userId is required');
        });
    });

    // ============================================
    // shipOrderLines - Line Processing Tests
    // ============================================

    describe('shipOrderLines - Line Processing', () => {
        it('should ship lines in packed status', async () => {
            const lineId = 'line-1';
            const lines = [
                {
                    id: lineId,
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 2,
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'LMD-M-S' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue(lines[0]);
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce([]); // second call for remaining lines check
            mockTx.order.update.mockResolvedValue({});

            const result = await shipOrderLines(mockTx, {
                orderLineIds: [lineId],
                awbNumber,
                courier,
                userId,
            });

            expect(result.shipped).toHaveLength(1);
            expect(result.shipped[0]).toMatchObject({
                lineId,
                skuCode: 'LMD-M-S',
                qty: 2,
            });
            expect(result.skipped).toHaveLength(0);
            expect(result.errors).toHaveLength(0);
            expect(queryPatterns.releaseReservedInventory).toHaveBeenCalledWith(mockTx, lineId);
            expect(queryPatterns.createSaleTransaction).toHaveBeenCalledWith(mockTx, {
                skuId: 'sku-1',
                qty: 2,
                orderLineId: lineId,
                userId,
            });
        });

        it('should ship lines in marked_shipped status', async () => {
            const lineId = 'line-2';
            const lines = [
                {
                    id: lineId,
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'marked_shipped',
                    order: { id: 'order-1', orderNumber: 'ORD-002', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'LMD-L-S' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue(lines[0]);
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce([]);
            mockTx.order.update.mockResolvedValue({});

            const result = await shipOrderLines(mockTx, {
                orderLineIds: [lineId],
                awbNumber,
                courier,
                userId,
            });

            expect(result.shipped).toHaveLength(1);
            expect(result.shipped[0].lineId).toBe(lineId);
        });

        it('should skip already-shipped lines (idempotency)', async () => {
            const lineId = 'line-3';
            const lines = [
                {
                    id: lineId,
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'shipped',
                    order: { id: 'order-1', orderNumber: 'ORD-003', status: 'shipped' },
                    sku: { id: 'sku-1', skuCode: 'LMD-M-S' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);

            const result = await shipOrderLines(mockTx, {
                orderLineIds: [lineId],
                awbNumber,
                courier,
                userId,
            });

            expect(result.shipped).toHaveLength(0);
            expect(result.skipped).toHaveLength(1);
            expect(result.skipped[0]).toMatchObject({
                lineId,
                skuCode: 'LMD-M-S',
                qty: 1,
                reason: 'Already shipped',
            });
            expect(queryPatterns.releaseReservedInventory).not.toHaveBeenCalled();
            expect(queryPatterns.createSaleTransaction).not.toHaveBeenCalled();
        });

        it('should skip cancelled lines with reason', async () => {
            const lineId = 'line-4';
            const lines = [
                {
                    id: lineId,
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'cancelled',
                    order: { id: 'order-1', orderNumber: 'ORD-004', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'LMD-S-S' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);

            const result = await shipOrderLines(mockTx, {
                orderLineIds: [lineId],
                awbNumber,
                courier,
                userId,
            });

            expect(result.shipped).toHaveLength(0);
            expect(result.skipped).toHaveLength(1);
            expect(result.skipped[0]).toMatchObject({
                lineId,
                reason: 'Line is cancelled',
            });
            expect(queryPatterns.releaseReservedInventory).not.toHaveBeenCalled();
        });

        it('should error for invalid status (pending)', async () => {
            const lineId = 'line-5';
            const lines = [
                {
                    id: lineId,
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'pending',
                    order: { id: 'order-1', orderNumber: 'ORD-005', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'LMD-M-S' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);

            const result = await shipOrderLines(mockTx, {
                orderLineIds: [lineId],
                awbNumber,
                courier,
                userId,
            });

            expect(result.shipped).toHaveLength(0);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                lineId,
                skuCode: 'LMD-M-S',
                code: 'INVALID_STATUS',
                currentStatus: 'pending',
            });
            expect(result.errors[0].error).toContain('Line must be packed before shipping');
        });

        it('should error for invalid status (allocated)', async () => {
            const lineId = 'line-6';
            const lines = [
                {
                    id: lineId,
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'allocated',
                    order: { id: 'order-1', orderNumber: 'ORD-006', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'LMD-L-S' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);

            const result = await shipOrderLines(mockTx, {
                orderLineIds: [lineId],
                awbNumber,
                courier,
                userId,
            });

            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].currentStatus).toBe('allocated');
        });

        it('should error for invalid status (picked)', async () => {
            const lineId = 'line-7';
            const lines = [
                {
                    id: lineId,
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'picked',
                    order: { id: 'order-1', orderNumber: 'ORD-007', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'LMD-XL-S' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);

            const result = await shipOrderLines(mockTx, {
                orderLineIds: [lineId],
                awbNumber,
                courier,
                userId,
            });

            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].currentStatus).toBe('picked');
        });

        it('should deduplicate line IDs', async () => {
            const lineId = 'line-8';
            const lines = [
                {
                    id: lineId,
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 2,
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-008', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'LMD-M-S' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue(lines[0]);
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce([]);
            mockTx.order.update.mockResolvedValue({});

            // Pass same line ID multiple times
            const result = await shipOrderLines(mockTx, {
                orderLineIds: [lineId, lineId, lineId],
                awbNumber,
                courier,
                userId,
            });

            // Should only ship once
            expect(result.shipped).toHaveLength(1);
            expect(mockTx.orderLine.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: { in: [lineId] } },
                })
            );
        });

        it('should report errors for non-existent lines', async () => {
            mockTx.orderLine.findMany.mockResolvedValue([]);

            const result = await shipOrderLines(mockTx, {
                orderLineIds: ['non-existent-line'],
                awbNumber,
                courier,
                userId,
            });

            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                lineId: 'non-existent-line',
                error: 'Line not found',
                code: 'NOT_FOUND',
            });
        });
    });

    // ============================================
    // shipOrderLines - Inventory Transaction Tests
    // ============================================

    describe('shipOrderLines - Inventory Transactions', () => {
        it('should call releaseReservedInventory for each line', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 2,
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
                {
                    id: 'line-2',
                    orderId: 'order-1',
                    skuId: 'sku-2',
                    qty: 1,
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-2', skuCode: 'SKU-2' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue({});
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce([]);
            mockTx.order.update.mockResolvedValue({});

            await shipOrderLines(mockTx, {
                orderLineIds: ['line-1', 'line-2'],
                awbNumber,
                courier,
                userId,
            });

            expect(queryPatterns.releaseReservedInventory).toHaveBeenCalledTimes(2);
            expect(queryPatterns.releaseReservedInventory).toHaveBeenCalledWith(mockTx, 'line-1');
            expect(queryPatterns.releaseReservedInventory).toHaveBeenCalledWith(mockTx, 'line-2');
        });

        it('should call createSaleTransaction for each line', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 3,
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue({});
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce([]);
            mockTx.order.update.mockResolvedValue({});

            await shipOrderLines(mockTx, {
                orderLineIds: ['line-1'],
                awbNumber,
                courier,
                userId,
            });

            expect(queryPatterns.createSaleTransaction).toHaveBeenCalledWith(mockTx, {
                skuId: 'sku-1',
                qty: 3,
                orderLineId: 'line-1',
                userId,
            });
        });

        it('should skip inventory when skipInventory=true', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 2,
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue({});
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce([]);
            mockTx.order.update.mockResolvedValue({});

            const result = await shipOrderLines(mockTx, {
                orderLineIds: ['line-1'],
                awbNumber,
                courier,
                userId,
                skipInventory: true,
            });

            expect(result.shipped).toHaveLength(1);
            expect(queryPatterns.releaseReservedInventory).not.toHaveBeenCalled();
            expect(queryPatterns.createSaleTransaction).not.toHaveBeenCalled();
        });

        it('should handle inventory transaction errors', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 2,
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            queryPatterns.releaseReservedInventory.mockRejectedValue(new Error('Inventory error'));

            const result = await shipOrderLines(mockTx, {
                orderLineIds: ['line-1'],
                awbNumber,
                courier,
                userId,
            });

            expect(result.shipped).toHaveLength(0);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                lineId: 'line-1',
                skuCode: 'SKU-1',
                error: 'Inventory error',
                code: 'PROCESSING_ERROR',
            });
        });
    });

    // ============================================
    // shipOrderLines - Status Update Tests
    // ============================================

    describe('shipOrderLines - Status Updates', () => {
        it('should update lineStatus to shipped', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue({});
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce([]);
            mockTx.order.update.mockResolvedValue({});

            await shipOrderLines(mockTx, {
                orderLineIds: ['line-1'],
                awbNumber,
                courier,
                userId,
            });

            expect(mockTx.orderLine.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'line-1' },
                    data: expect.objectContaining({
                        lineStatus: 'shipped',
                    }),
                })
            );
        });

        it('should set shippedAt timestamp', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue({});
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce([]);
            mockTx.order.update.mockResolvedValue({});

            await shipOrderLines(mockTx, {
                orderLineIds: ['line-1'],
                awbNumber,
                courier,
                userId,
            });

            const updateCall = mockTx.orderLine.update.mock.calls[0][0];
            expect(updateCall.data.shippedAt).toBeInstanceOf(Date);
        });

        it('should set awbNumber and courier', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue({});
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce([]);
            mockTx.order.update.mockResolvedValue({});

            await shipOrderLines(mockTx, {
                orderLineIds: ['line-1'],
                awbNumber: '  AWB123  ',
                courier: '  BlueDart  ',
                userId,
            });

            expect(mockTx.orderLine.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        awbNumber: 'AWB123',
                        courier: 'BlueDart',
                        trackingStatus: 'in_transit',
                    }),
                })
            );
        });

        it('should update order.status when all lines shipped', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue({});
            // First call: fetch lines to ship, Second call: check remaining lines (none)
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce([]);
            mockTx.order.update.mockResolvedValue({});

            const result = await shipOrderLines(mockTx, {
                orderLineIds: ['line-1'],
                awbNumber,
                courier,
                userId,
            });

            expect(result.orderUpdated).toBe(true);
            expect(mockTx.order.update).toHaveBeenCalledWith({
                where: { id: 'order-1' },
                data: { status: 'shipped' },
            });
        });

        it('should not update order.status when lines remain', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
            ];

            const remainingLines = [
                { id: 'line-2', lineStatus: 'pending' },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue({});
            // First call: fetch lines to ship, Second call: check remaining lines (has one)
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce(remainingLines);

            const result = await shipOrderLines(mockTx, {
                orderLineIds: ['line-1'],
                awbNumber,
                courier,
                userId,
            });

            expect(result.orderUpdated).toBe(false);
            expect(mockTx.order.update).not.toHaveBeenCalled();
        });

        it('should ignore cancelled lines when checking if order fully shipped', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue({});
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce([]);
            mockTx.order.update.mockResolvedValue({});

            const result = await shipOrderLines(mockTx, {
                orderLineIds: ['line-1'],
                awbNumber,
                courier,
                userId,
            });

            expect(result.orderUpdated).toBe(true);

            // Verify the remaining lines query excludes cancelled and shipped
            const remainingLinesCall = mockTx.orderLine.findMany.mock.calls[1][0];
            expect(remainingLinesCall.where.lineStatus).toEqual({ notIn: ['cancelled', 'shipped'] });
        });
    });

    // ============================================
    // shipOrderLines - Migration Mode Tests
    // ============================================

    describe('shipOrderLines - Migration Mode', () => {
        it('should accept any status with skipStatusValidation=true', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'pending', // Would normally fail
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue({});
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce([]);
            mockTx.order.update.mockResolvedValue({});

            const result = await shipOrderLines(mockTx, {
                orderLineIds: ['line-1'],
                awbNumber,
                courier,
                userId,
                skipStatusValidation: true,
            });

            expect(result.shipped).toHaveLength(1);
            expect(result.errors).toHaveLength(0);
        });

        it('should skip inventory with skipInventory=true', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'pending',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValue(lines);
            mockTx.orderLine.update.mockResolvedValue({});
            mockTx.orderLine.findMany.mockResolvedValueOnce(lines).mockResolvedValueOnce([]);
            mockTx.order.update.mockResolvedValue({});

            const result = await shipOrderLines(mockTx, {
                orderLineIds: ['line-1'],
                awbNumber,
                courier,
                userId,
                skipStatusValidation: true,
                skipInventory: true,
            });

            expect(result.shipped).toHaveLength(1);
            expect(queryPatterns.releaseReservedInventory).not.toHaveBeenCalled();
            expect(queryPatterns.createSaleTransaction).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // shipOrder - Convenience Wrapper Tests
    // ============================================

    describe('shipOrder - Convenience Wrapper', () => {
        it('should throw when orderId is missing', async () => {
            await expect(
                shipOrder(mockTx, {
                    awbNumber,
                    courier,
                    userId,
                })
            ).rejects.toThrow('orderId is required');
        });

        it('should ship all non-cancelled non-shipped lines', async () => {
            const orderId = 'order-1';
            const lines = [
                { id: 'line-1' },
                { id: 'line-2' },
            ];

            const fullLines = [
                {
                    id: 'line-1',
                    orderId,
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'packed',
                    order: { id: orderId, orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
                {
                    id: 'line-2',
                    orderId,
                    skuId: 'sku-2',
                    qty: 1,
                    lineStatus: 'packed',
                    order: { id: orderId, orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-2', skuCode: 'SKU-2' },
                },
            ];

            // Setup mock calls in order
            mockTx.orderLine.findMany
                .mockResolvedValueOnce(lines)      // shipOrder: get eligible lines
                .mockResolvedValueOnce(fullLines)  // shipOrderLines: get full line details
                .mockResolvedValueOnce([]);        // shipOrderLines: check remaining lines
            mockTx.orderLine.update.mockResolvedValue({});
            mockTx.order.update.mockResolvedValue({});

            const result = await shipOrder(mockTx, {
                orderId,
                awbNumber,
                courier,
                userId,
            });

            expect(result.shipped).toHaveLength(2);
            expect(mockTx.orderLine.findMany).toHaveBeenCalledWith({
                where: {
                    orderId,
                    lineStatus: { notIn: ['cancelled', 'shipped'] },
                },
                select: { id: true },
            });
        });

        it('should return message when no eligible lines', async () => {
            mockTx.orderLine.findMany.mockResolvedValue([]);

            const result = await shipOrder(mockTx, {
                orderId: 'order-1',
                awbNumber,
                courier,
                userId,
            });

            expect(result.shipped).toHaveLength(0);
            expect(result.message).toBe('No eligible lines to ship');
            expect(result.orderId).toBe('order-1');
        });

        it('should pass through skipStatusValidation option', async () => {
            const orderId = 'order-1';
            const lines = [{ id: 'line-1' }];
            const fullLines = [
                {
                    id: 'line-1',
                    orderId,
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'pending', // Would fail without skipStatusValidation
                    order: { id: orderId, orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
            ];

            // Setup mock calls in order
            mockTx.orderLine.findMany
                .mockResolvedValueOnce(lines)      // shipOrder: get eligible lines
                .mockResolvedValueOnce(fullLines)  // shipOrderLines: get full line details
                .mockResolvedValueOnce([]);        // shipOrderLines: check remaining lines
            mockTx.orderLine.update.mockResolvedValue({});
            mockTx.order.update.mockResolvedValue({});

            const result = await shipOrder(mockTx, {
                orderId,
                awbNumber,
                courier,
                userId,
                skipStatusValidation: true,
            });

            expect(result.shipped).toHaveLength(1);
        });

        it('should pass through skipInventory option', async () => {
            const orderId = 'order-1';
            const lines = [{ id: 'line-1' }];
            const fullLines = [
                {
                    id: 'line-1',
                    orderId,
                    skuId: 'sku-1',
                    qty: 1,
                    lineStatus: 'packed',
                    order: { id: orderId, orderNumber: 'ORD-001', status: 'open' },
                    sku: { id: 'sku-1', skuCode: 'SKU-1' },
                },
            ];

            mockTx.orderLine.findMany.mockResolvedValueOnce(lines);
            mockTx.orderLine.findMany.mockResolvedValueOnce(fullLines);
            mockTx.orderLine.findMany.mockResolvedValueOnce([]);
            mockTx.orderLine.update.mockResolvedValue({});
            mockTx.order.update.mockResolvedValue({});

            await shipOrder(mockTx, {
                orderId,
                awbNumber,
                courier,
                userId,
                skipInventory: true,
            });

            expect(queryPatterns.releaseReservedInventory).not.toHaveBeenCalled();
            expect(queryPatterns.createSaleTransaction).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // validateShipment - Pre-check Tests
    // ============================================

    describe('validateShipment - Pre-check', () => {
        it('should return valid=true for shippable lines', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { skuCode: 'SKU-1' },
                },
            ];

            mockPrisma.orderLine.findMany.mockResolvedValue(lines);
            mockPrisma.orderLine.findFirst.mockResolvedValue(null);

            const result = await validateShipment(mockPrisma, ['line-1'], { awbNumber });

            expect(result.valid).toBe(true);
            expect(result.issues).toHaveLength(0);
            expect(result.lineCount).toBe(1);
            expect(result.shippableCount).toBe(1);
        });

        it('should detect missing lines', async () => {
            mockPrisma.orderLine.findMany.mockResolvedValue([]);

            const result = await validateShipment(mockPrisma, ['missing-line']);

            expect(result.valid).toBe(false);
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0]).toMatchObject({
                lineId: 'missing-line',
                issue: 'Line not found',
                code: 'NOT_FOUND',
            });
        });

        it('should detect cancelled lines', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    lineStatus: 'cancelled',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { skuCode: 'SKU-1' },
                },
            ];

            mockPrisma.orderLine.findMany.mockResolvedValue(lines);

            const result = await validateShipment(mockPrisma, ['line-1']);

            expect(result.valid).toBe(false);
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0]).toMatchObject({
                lineId: 'line-1',
                issue: 'Cannot ship cancelled line',
                code: 'LINE_CANCELLED',
            });
        });

        it('should detect unpacked lines', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    lineStatus: 'pending',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { skuCode: 'SKU-1' },
                },
            ];

            mockPrisma.orderLine.findMany.mockResolvedValue(lines);

            const result = await validateShipment(mockPrisma, ['line-1']);

            expect(result.valid).toBe(false);
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0]).toMatchObject({
                lineId: 'line-1',
                issue: 'Line must be packed (current: pending)',
                code: 'INVALID_STATUS',
                currentStatus: 'pending',
            });
        });

        it('should accept marked_shipped status', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    lineStatus: 'marked_shipped',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { skuCode: 'SKU-1' },
                },
            ];

            mockPrisma.orderLine.findMany.mockResolvedValue(lines);
            mockPrisma.orderLine.findFirst.mockResolvedValue(null);

            const result = await validateShipment(mockPrisma, ['line-1'], { awbNumber });

            expect(result.valid).toBe(true);
            expect(result.shippableCount).toBe(1);
        });

        it('should detect duplicate AWB on other orders', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { skuCode: 'SKU-1' },
                },
            ];

            mockPrisma.orderLine.findMany.mockResolvedValue(lines);
            mockPrisma.orderLine.findFirst.mockResolvedValue({
                id: 'other-line',
                order: { orderNumber: 'ORD-999' },
            });

            const result = await validateShipment(mockPrisma, ['line-1'], { awbNumber: 'DUP123' });

            expect(result.valid).toBe(false);
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0]).toMatchObject({
                issue: 'AWB number already used on order ORD-999',
                code: 'DUPLICATE_AWB',
                existingOrderNumber: 'ORD-999',
            });
        });

        it('should not flag duplicate AWB for same order', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { skuCode: 'SKU-1' },
                },
                {
                    id: 'line-2',
                    orderId: 'order-1',
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { skuCode: 'SKU-2' },
                },
            ];

            mockPrisma.orderLine.findMany.mockResolvedValue(lines);
            // AWB exists but on same order
            mockPrisma.orderLine.findFirst.mockResolvedValue(null);

            const result = await validateShipment(mockPrisma, ['line-1', 'line-2'], { awbNumber: 'AWB123' });

            expect(result.valid).toBe(true);
            // Verify the query excluded the same order
            expect(mockPrisma.orderLine.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        orderId: { notIn: ['order-1'] },
                    }),
                })
            );
        });

        it('should skip status validation when skipStatusValidation=true', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    lineStatus: 'pending',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { skuCode: 'SKU-1' },
                },
            ];

            mockPrisma.orderLine.findMany.mockResolvedValue(lines);

            const result = await validateShipment(mockPrisma, ['line-1'], { skipStatusValidation: true });

            expect(result.valid).toBe(true);
            expect(result.shippableCount).toBe(1);
        });

        it('should not report already-shipped lines as errors', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    lineStatus: 'shipped',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'shipped' },
                    sku: { skuCode: 'SKU-1' },
                },
            ];

            mockPrisma.orderLine.findMany.mockResolvedValue(lines);

            const result = await validateShipment(mockPrisma, ['line-1']);

            expect(result.valid).toBe(true);
            expect(result.shippableCount).toBe(0); // Not shippable but not an error
        });

        it('should deduplicate line IDs before validation', async () => {
            const lines = [
                {
                    id: 'line-1',
                    orderId: 'order-1',
                    lineStatus: 'packed',
                    order: { id: 'order-1', orderNumber: 'ORD-001', status: 'open' },
                    sku: { skuCode: 'SKU-1' },
                },
            ];

            mockPrisma.orderLine.findMany.mockResolvedValue(lines);
            mockPrisma.orderLine.findFirst.mockResolvedValue(null);

            const result = await validateShipment(mockPrisma, ['line-1', 'line-1', 'line-1']);

            expect(result.lineCount).toBe(1);
            expect(mockPrisma.orderLine.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: { in: ['line-1'] } },
                })
            );
        });
    });
});
