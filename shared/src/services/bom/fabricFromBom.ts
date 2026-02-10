/**
 * Fabric From BOM Service
 *
 * Gets fabric information from BOM lines instead of direct Variation fields.
 * This is the canonical source of fabric assignment after the consolidation.
 *
 * Usage:
 *   import { getVariationMainFabric, getVariationsMainFabrics } from '@coh/shared/services/bom';
 *   const fabric = await getVariationMainFabric(variationId);
 */

import { getPrisma, type PrismaTransaction } from '../db/index.js';

type PrismaClient = Awaited<ReturnType<typeof getPrisma>>;

/**
 * Fabric information from BOM.
 */
export interface VariationMainFabric {
  fabricColourId: string;
  fabricColourName: string;
  fabricColourHex: string | null;
  fabricId: string;
  fabricName: string;
  fabricUnit: string | null;
  materialId: string;
  materialName: string;
  costPerUnit: number | null;
  effectiveCostPerUnit: number | null;
}

/**
 * Get the main fabric for a variation from its BOM lines.
 *
 * This is the canonical way to get a variation's fabric after the consolidation.
 * It looks up the VariationBomLine with role='main' and type='FABRIC'.
 *
 * @param prisma - Prisma client or transaction
 * @param variationId - The variation ID
 * @returns The fabric info or null if not found
 */
export async function getVariationMainFabric(
  prisma: PrismaClient | PrismaTransaction,
  variationId: string
): Promise<VariationMainFabric | null> {
  const bomLine = await prisma.variationBomLine.findFirst({
    where: {
      variationId,
      role: {
        code: 'main',
        type: { code: 'FABRIC' },
      },
      fabricColourId: { not: null },
    },
    include: {
      fabricColour: {
        include: {
          fabric: {
            include: {
              material: true,
            },
          },
        },
      },
    },
  });

  if (!bomLine?.fabricColour) {
    return null;
  }

  const { fabricColour } = bomLine;
  const { fabric } = fabricColour;
  const { material } = fabric;

  if (!material) {
    return null;
  }

  // Calculate effective cost (colour override or fabric default)
  const effectiveCostPerUnit = fabricColour.costPerUnit ?? fabric.costPerUnit ?? null;

  return {
    fabricColourId: fabricColour.id,
    fabricColourName: fabricColour.colourName,
    fabricColourHex: fabricColour.colourHex,
    fabricId: fabric.id,
    fabricName: fabric.name,
    fabricUnit: fabric.unit ?? null,
    materialId: material.id,
    materialName: material.name,
    costPerUnit: fabricColour.costPerUnit,
    effectiveCostPerUnit,
  };
}

/**
 * Get main fabrics for multiple variations in a single query.
 * More efficient than calling getVariationMainFabric in a loop.
 *
 * @param prisma - Prisma client or transaction
 * @param variationIds - Array of variation IDs
 * @returns Map of variationId to fabric info (null if not found)
 */
export async function getVariationsMainFabrics(
  prisma: PrismaClient | PrismaTransaction,
  variationIds: string[]
): Promise<Map<string, VariationMainFabric | null>> {
  if (variationIds.length === 0) {
    return new Map();
  }

  // Get all BOM lines for these variations in one query
  const bomLines = await prisma.variationBomLine.findMany({
    where: {
      variationId: { in: variationIds },
      role: {
        code: 'main',
        type: { code: 'FABRIC' },
      },
      fabricColourId: { not: null },
    },
    include: {
      fabricColour: {
        include: {
          fabric: {
            include: {
              material: true,
            },
          },
        },
      },
    },
  });

  // Build result map
  const result = new Map<string, VariationMainFabric | null>();

  // Initialize all IDs with null
  for (const id of variationIds) {
    result.set(id, null);
  }

  // Fill in found values
  for (const bomLine of bomLines) {
    const fabricColour = bomLine.fabricColour;
    if (!fabricColour?.fabric?.material) {
      continue;
    }

    const { fabric } = fabricColour;
    const material = fabric.material;

    // material is guaranteed non-null after the guard above
    const effectiveCostPerUnit = fabricColour.costPerUnit ?? fabric.costPerUnit ?? null;

    result.set(bomLine.variationId, {
      fabricColourId: fabricColour.id,
      fabricColourName: fabricColour.colourName,
      fabricColourHex: fabricColour.colourHex,
      fabricId: fabric.id,
      fabricName: fabric.name,
      fabricUnit: fabric.unit ?? null,
      materialId: material!.id,
      materialName: material!.name,
      costPerUnit: fabricColour.costPerUnit,
      effectiveCostPerUnit,
    });
  }

  return result;
}

/**
 * Get main fabrics for all variations of a product.
 *
 * @param prisma - Prisma client or transaction
 * @param productId - The product ID
 * @returns Map of variationId to fabric info
 */
export async function getProductVariationsFabrics(
  prisma: PrismaClient | PrismaTransaction,
  productId: string
): Promise<Map<string, VariationMainFabric | null>> {
  // Get all variation IDs for this product
  const variations = await prisma.variation.findMany({
    where: { productId, isActive: true },
    select: { id: true },
  });

  const variationIds = variations.map((v: { id: string }) => v.id);
  return getVariationsMainFabrics(prisma, variationIds);
}

/**
 * Check if a variation has a main fabric assigned via BOM.
 *
 * @param prisma - Prisma client or transaction
 * @param variationId - The variation ID
 * @returns true if main fabric BOM line exists with fabricColourId
 */
export async function hasMainFabricBom(
  prisma: PrismaClient | PrismaTransaction,
  variationId: string
): Promise<boolean> {
  const count = await prisma.variationBomLine.count({
    where: {
      variationId,
      role: {
        code: 'main',
        type: { code: 'FABRIC' },
      },
      fabricColourId: { not: null },
    },
  });

  return count > 0;
}
