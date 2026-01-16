/**
 * Admin Ship Service
 *
 * Isolated admin-only shipping service for force-shipping orders that bypass
 * normal status validation. This is primarily used for migration and data
 * correction scenarios.
 *
 * FEATURE FLAG: ENABLE_ADMIN_SHIP (env var)
 * - true (default): Admin ship enabled
 * - false: Throws error, feature disabled
 *
 * This service:
 * - Enforces admin role at service level
 * - Checks feature flag before processing
 * - Wraps shipOrderLines with skipStatusValidation: true
 * - Provides a single, auditable path for admin ship operations
 *
 * @module services/adminShipService
 */

import { shipOrderLines, type ShipResult } from './shipOrderService.js';
import type { PrismaTransactionClient } from '../utils/queryPatterns.js';
import { ForbiddenError, BusinessLogicError } from '../utils/errors.js';
import { shippingLogger } from '../utils/logger.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface AdminShipOptions {
    orderLineIds: string[];
    awbNumber: string;
    courier: string;
    userId: string;
    userRole: string;
}

// ============================================
// FEATURE FLAG
// ============================================

/**
 * Check if admin ship feature is enabled
 * Defaults to true for backward compatibility
 */
export function isAdminShipEnabled(): boolean {
    const envValue = process.env.ENABLE_ADMIN_SHIP;
    // Default to true if not set
    if (envValue === undefined || envValue === '') {
        return true;
    }
    // Explicit false check
    return envValue.toLowerCase() !== 'false';
}

// ============================================
// AUTHORIZATION
// ============================================

/**
 * Validate that user has admin role
 * @throws ForbiddenError if user is not admin
 */
export function validateAdminAuth(userRole: string): void {
    if (userRole !== 'admin') {
        throw new ForbiddenError('Admin ship requires admin role');
    }
}

// ============================================
// ADMIN SHIP SERVICE
// ============================================

/**
 * Admin-only shipping that bypasses status validation
 *
 * This function is isolated from the core shipping path to:
 * 1. Make it easy to control via feature flag
 * 2. Provide clear audit trail for admin operations
 * 3. Allow easy removal when no longer needed
 *
 * @param tx - Prisma transaction client
 * @param options - Admin ship options including user role for auth
 * @returns Ship result from underlying service
 *
 * @throws ForbiddenError if user is not admin
 * @throws BusinessLogicError if feature is disabled
 *
 * @example
 * const result = await prisma.$transaction(async (tx) => {
 *   return await adminShipOrderLines(tx, {
 *     orderLineIds: ['line1', 'line2'],
 *     awbNumber: 'AWB123',
 *     courier: 'Delhivery',
 *     userId: 'user123',
 *     userRole: 'admin',
 *   });
 * });
 */
export async function adminShipOrderLines(
    tx: PrismaTransactionClient,
    options: AdminShipOptions
): Promise<ShipResult> {
    const { orderLineIds, awbNumber, courier, userId, userRole } = options;

    // Check feature flag
    if (!isAdminShipEnabled()) {
        throw new BusinessLogicError(
            'Admin ship feature is disabled. Set ENABLE_ADMIN_SHIP=true to enable.',
            'FEATURE_DISABLED'
        );
    }

    // Validate admin authorization
    validateAdminAuth(userRole);

    // Log the admin ship operation for audit
    shippingLogger.info({
        action: 'admin_ship',
        userId,
        orderLineIds,
        awbNumber,
        courier,
    }, 'Admin ship initiated');

    // Delegate to core shipping service with status validation skipped
    const result = await shipOrderLines(tx, {
        orderLineIds,
        awbNumber,
        courier,
        userId,
        skipStatusValidation: true,
    });

    // Log result
    shippingLogger.info({
        action: 'admin_ship_complete',
        userId,
        shipped: result.shipped.length,
        skipped: result.skipped.length,
        errors: result.errors.length,
    }, 'Admin ship completed');

    return result;
}
