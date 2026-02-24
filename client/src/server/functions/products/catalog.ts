/**
 * Catalog Filters Server Function
 *
 * Fetches filter data for product forms (fabrics, fabricColours, categories, genders).
 * Used by UnifiedProductEditModal for dropdown options.
 */

import { createServerFn } from '@tanstack/react-start';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import { GENDERS, GENDER_LABELS } from '@coh/shared/config/product';

/**
 * Catalog filters response for dropdowns
 */
export interface CatalogFiltersResponse {
    fabricTypes: { id: string; name: string }[];  // Empty array for backward compatibility
    fabrics: {
        id: string;
        name: string;
        fabricTypeId: string;  // materialId for backward compatibility
        colorName: string | null;
        colorHex: string | null;
        costPerUnit: number | null;
    }[];
    fabricColours: {
        id: string;
        code: string | null;
        name: string;
        hex: string | null;
        fabricId: string;
        fabricName: string;
        materialId: string;
        materialName: string;
        costPerUnit: number | null;
    }[];
    categories: string[];
    genders: string[];
}

/**
 * Server Function: Get catalog filters
 *
 * Fetches filter data for product forms (fabric types, fabrics, fabricColours, categories, genders).
 * Used by UnifiedProductEditModal for dropdown options.
 */
export const getCatalogFilters = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<CatalogFiltersResponse> => {
        try {
            const prisma = await getPrisma();

            // FabricType removed - return empty array for backward compatibility
            const fabricTypes: { id: string; name: string }[] = [];

            // Fetch fabric colours (3-tier hierarchy: Material > Fabric > FabricColour)
            const fabricColoursRaw = await prisma.fabricColour.findMany({
                where: { isActive: true },
                include: {
                    fabric: {
                        include: {
                            material: true,
                        },
                    },
                },
                orderBy: [
                    { fabric: { material: { name: 'asc' } } },
                    { fabric: { name: 'asc' } },
                    { colourName: 'asc' },
                ],
            });

            // Transform fabricColours for the "fabrics" response (backward compatibility)
            const fabrics = fabricColoursRaw.map((fc) => ({
                id: fc.id,
                name: `${fc.fabric?.name ?? ''} - ${fc.colourName}`,
                fabricTypeId: fc.fabric?.materialId ?? '',
                colorName: fc.colourName,
                colorHex: fc.colourHex,
                costPerUnit: fc.costPerUnit ?? fc.fabric?.costPerUnit ?? null,
            }));

            // Transform fabricColours to expected format
            const fabricColours = fabricColoursRaw.map((fc) => ({
                id: fc.id,
                code: fc.code ?? null,
                name: fc.colourName,
                hex: fc.colourHex,
                fabricId: fc.fabricId,
                fabricName: fc.fabric?.name ?? '',
                materialId: fc.fabric?.materialId ?? '',
                materialName: fc.fabric?.material?.name ?? '',
                costPerUnit: fc.costPerUnit ?? fc.fabric?.costPerUnit ?? null,
            }));

            // Get distinct categories from products
            const categoriesResult = await prisma.product.findMany({
                where: { isActive: true },
                select: { category: true },
                distinct: ['category'],
                orderBy: { category: 'asc' },
            });
            const categories = categoriesResult.map((c: { category: string }) => c.category).filter(Boolean);

            // Gender options from canonical source (display labels)
            const genders = GENDERS.map(g => GENDER_LABELS[g]);

            return {
                fabricTypes,
                fabrics,
                fabricColours,
                categories,
                genders,
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getCatalogFilters:', error);
            throw error;
        }
    });
