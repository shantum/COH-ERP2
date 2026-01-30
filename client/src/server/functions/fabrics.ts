/**
 * Fabrics Query Server Functions
 *
 * NOTE: This file previously contained FabricType → Fabric → FabricTransaction queries.
 * As part of the fabric system consolidation, those models have been REMOVED.
 *
 * The new system uses:
 *   Material → Fabric → FabricColour → FabricColourTransaction
 *
 * For material/fabric queries, use:
 * - materials.ts for Material/Fabric/FabricColour hierarchy queries
 * - fabricColours.ts for FabricColour transaction queries
 *
 * This file is kept for backward compatibility with imports.
 * Most functions have been removed or deprecated.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';

// ============================================
// RESPONSE TYPES
// ============================================

/** Supplier record for getFabricSuppliers response */
interface SupplierRecord {
    id: string;
    name: string;
    isActive: boolean;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    createdAt: Date;
}

/** Response type for getFabricSuppliers */
interface GetFabricSuppliersResponse {
    success: true;
    suppliers: SupplierRecord[];
}

/** Response type for getFabricsFilters */
interface GetFabricsFiltersResponse {
    success: true;
    filters: {
        fabricTypes: Array<{ id: string; name: string }>;
        suppliers: Array<{ id: string; name: string }>;
    };
}

// ============================================
// INPUT SCHEMAS
// ============================================

const getFabricSuppliersInputSchema = z.object({
    activeOnly: z.boolean().optional().default(true),
}).optional();

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get fabric filters (suppliers only)
 *
 * NOTE: fabricTypes removed in fabric consolidation.
 * Returns empty fabricTypes array for backward compatibility.
 */
export const getFabricsFilters = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<GetFabricsFiltersResponse> => {
        const prisma = await getPrisma();
        const suppliers = await prisma.supplier.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });

        return {
            success: true,
            filters: {
                fabricTypes: [], // REMOVED in fabric consolidation
                suppliers,
            },
        };
    });

/**
 * Get all suppliers
 */
export const getFabricSuppliers = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getFabricSuppliersInputSchema.parse(input))
    .handler(async ({ data }): Promise<GetFabricSuppliersResponse> => {
        const prisma = await getPrisma();
        const suppliers = await prisma.supplier.findMany({
            where: data?.activeOnly ? { isActive: true } : {},
            orderBy: { name: 'asc' },
        });

        return {
            success: true,
            suppliers,
        };
    });

// ============================================
// DEPRECATED - REMOVED IN FABRIC CONSOLIDATION
// ============================================
// The following functions have been REMOVED:
//
// Query functions:
// - getFabrics - Use materials.ts getMaterialsTree instead
// - getFabricsFlat - Use materials.ts getMaterialsTree instead
// - getFabricById - Use materials.ts
// - getFabricTypes - REMOVED, FabricType table deleted
// - getFabricTransactions - Use fabricColours.ts getFabricColourTransactions
// - getAllFabricTransactions - Use fabricColours.ts getAllFabricColourTransactions
// - getTopFabrics - Use fabricColours.ts getTopMaterials
// - getTopFabricsForDashboard - Use fabricColours.ts getTopMaterials
// - getFabricStockAnalysis - Use fabricColours.ts getFabricColourStockAnalysis
//
// Reconciliation functions:
// - getFabricReconciliationHistory - Use fabricColours.ts getFabricColourReconciliations
// - getFabricReconciliation - Use fabricColours.ts
// - startFabricReconciliation - Use fabricColours.ts startFabricColourReconciliation
// - updateFabricReconciliationItems - Use fabricColours.ts
// - submitFabricReconciliation - Use fabricColours.ts
// - deleteFabricReconciliation - Use fabricColours.ts
//
// For fabric queries, use:
// - materials.ts for Material/Fabric/FabricColour hierarchy
// - fabricColours.ts for FabricColour transactions and reconciliation

// ============================================
// STUB EXPORTS FOR BACKWARD COMPATIBILITY
// ============================================

/**
 * @deprecated Use fabricColours.ts getFabricColourStockAnalysis instead
 */
export const getFabricStockAnalysis = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async () => {
        console.warn('getFabricStockAnalysis is deprecated. Use getFabricColourStockAnalysis from fabricColours.ts');
        return { success: true, fabrics: [] };
    });

/**
 * @deprecated Use fabricColours.ts getTopMaterials instead
 */
export const getTopFabricsForDashboard = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async () => {
        console.warn('getTopFabricsForDashboard is deprecated. Use getTopMaterials from fabricColours.ts');
        return [];
    });
