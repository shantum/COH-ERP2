/**
 * Order Line Customization
 * Create and remove custom SKUs for order lines
 */

import { Router } from 'express';
import type { Request, Response, RequestHandler } from 'express';
import { authenticateToken } from '../../../middleware/auth.js';
import { asyncHandler } from '../../../middleware/asyncHandler.js';
import { createCustomSku, removeCustomization } from '../../../utils/queryPatterns.js';
import { validate } from '../../../utils/validation.js';
import { CustomizeLineSchema } from '@coh/shared';
import { NotFoundError, BusinessLogicError } from '../../../utils/errors.js';
import { orderLogger } from '../../../utils/logger.js';

const router: Router = Router();

const validateMiddleware = validate as (schema: unknown) => RequestHandler;

// ============================================
// TYPE DEFINITIONS
// ============================================

interface CustomizeLineBody {
    type: 'length' | 'size' | 'measurements' | 'other';
    value: string;
    notes?: string;
}

// ============================================
// HELPER FUNCTION
// ============================================

function getParamString(param: string | string[] | undefined): string {
    if (Array.isArray(param)) return param[0];
    return param ?? '';
}

// ============================================
// ORDER LINE CUSTOMIZATION
// ============================================

/**
 * Customize an order line - create custom SKU
 * POST /lines/:lineId/customize
 *
 * Creates a custom SKU for the order line with customization details.
 * Line must be in 'pending' status and not already customized.
 * The custom SKU code is generated as {BASE_SKU}-C{XX}.
 */
router.post(
    '/lines/:lineId/customize',
    authenticateToken,
    validateMiddleware(CustomizeLineSchema),
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);
        const customizationData = req.validatedBody as unknown as CustomizeLineBody;
        const userId = req.user!.id;

        // Get order line to find the base SKU
        const line = await req.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { sku: true, order: { select: { orderNumber: true, status: true } } },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }

        // Use the current SKU as the base SKU
        const baseSkuId = line.skuId;

        try {
            const result = await createCustomSku(
                req.prisma,
                baseSkuId,
                customizationData,
                lineId,
                userId
            );

            // Access nested properties with type assertions
            const orderLine = result.orderLine as { id: string; qty: number; order: { orderNumber: string } };
            const customSku = result.customSku as {
                id: string;
                skuCode: string;
                customizationType: string;
                customizationValue: string;
                customizationNotes: string | null;
            };

            orderLogger.info({
                orderNumber: orderLine.order.orderNumber,
                customSkuCode: customSku.skuCode,
                lineId
            }, 'Custom SKU created for order line');

            res.json({
                id: orderLine.id,
                customSkuCode: customSku.skuCode,
                customSkuId: customSku.id,
                isCustomized: true,
                isNonReturnable: true,
                originalSkuCode: result.originalSkuCode,
                qty: orderLine.qty,
                customizationType: customSku.customizationType,
                customizationValue: customSku.customizationValue,
                customizationNotes: customSku.customizationNotes,
            });
        } catch (error) {
            // Handle specific error codes from createCustomSku
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (errorMessage === 'ORDER_LINE_NOT_FOUND') {
                throw new NotFoundError('Order line not found', 'OrderLine', lineId);
            }
            if (errorMessage === 'LINE_NOT_PENDING') {
                throw new BusinessLogicError(
                    'Cannot customize an allocated/picked/packed line. Unallocate first.',
                    'LINE_NOT_PENDING'
                );
            }
            if (errorMessage === 'ALREADY_CUSTOMIZED') {
                throw new BusinessLogicError('Order line is already customized', 'ALREADY_CUSTOMIZED');
            }
            throw error;
        }
    })
);

/**
 * Remove customization from an order line
 * DELETE /lines/:lineId/customize?force=true
 *
 * Reverts the order line to the original SKU and deletes the custom SKU.
 * Only allowed if no inventory transactions or production batches exist.
 * Pass force=true to delete any existing inventory transactions and production batches.
 */
router.delete(
    '/lines/:lineId/customize',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const lineId = getParamString(req.params.lineId);
        const force = req.query.force === 'true';

        try {
            const result = await removeCustomization(req.prisma, lineId, { force });

            // Access nested properties with type assertions
            const orderLine = result.orderLine as {
                id: string;
                order: { orderNumber: string };
                sku: { id: string; skuCode: string };
            };

            const forceMsg = result.forcedCleanup
                ? ` (force-deleted ${result.deletedTransactions} inventory txns, ${result.deletedBatches} batches)`
                : '';
            orderLogger.info({
                orderNumber: orderLine.order.orderNumber,
                deletedCustomSkuCode: result.deletedCustomSkuCode,
                lineId,
                forcedCleanup: result.forcedCleanup,
                deletedTransactions: result.deletedTransactions,
                deletedBatches: result.deletedBatches
            }, 'Custom SKU removed from order line');

            res.json({
                id: orderLine.id,
                skuCode: orderLine.sku.skuCode,
                skuId: orderLine.sku.id,
                isCustomized: false,
                deletedCustomSkuCode: result.deletedCustomSkuCode,
                forcedCleanup: result.forcedCleanup,
                deletedTransactions: result.deletedTransactions,
                deletedBatches: result.deletedBatches,
            });
        } catch (error) {
            // Handle specific error codes from removeCustomization
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (errorMessage === 'ORDER_LINE_NOT_FOUND') {
                throw new NotFoundError('Order line not found', 'OrderLine', lineId);
            }
            if (errorMessage === 'NOT_CUSTOMIZED') {
                throw new BusinessLogicError('Order line is not customized', 'NOT_CUSTOMIZED');
            }
            if (errorMessage === 'CANNOT_UNDO_HAS_INVENTORY') {
                throw new BusinessLogicError(
                    'Cannot undo customization - inventory transactions exist for custom SKU',
                    'CANNOT_UNDO_HAS_INVENTORY'
                );
            }
            if (errorMessage === 'CANNOT_UNDO_HAS_PRODUCTION') {
                throw new BusinessLogicError(
                    'Cannot undo customization - production batch exists for custom SKU',
                    'CANNOT_UNDO_HAS_PRODUCTION'
                );
            }
            throw error;
        }
    })
);

// ============================================
// DATA MIGRATION: Copy order tracking to lines
// One-time migration for line-centric architecture
// NOTE: Migration completed - tracking fields now only exist on OrderLine
// ============================================

/**
 * @deprecated Migration completed - tracking data now lives on OrderLine only.
 * This endpoint is retained for backward compatibility but returns a no-op message.
 */
router.post(
    '/migrate-tracking-to-lines',
    authenticateToken,
    asyncHandler(async (_req: Request, res: Response): Promise<void> => {
        // Migration has been completed - tracking fields are now on OrderLine only
        res.json({
            message: 'Migration already completed. Tracking data now lives on OrderLine.',
            migrated: 0,
        });
    })
);

export default router;
