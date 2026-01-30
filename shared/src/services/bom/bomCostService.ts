/**
 * BOM Cost Service
 *
 * Recalculates and stores pre-computed BOM costs on Sku and Variation models.
 * Uses dynamic imports to prevent client bundling issues.
 *
 * The stored costs enable:
 * - O(1) cost lookups in product listings
 * - No need for complex JOINs/SUMs at query time
 * - Cost columns in VariationsDataTable
 *
 * Call these functions after any BOM line changes:
 * - Create/update/delete SkuBomLine
 * - Create/update/delete VariationBomLine
 * - Catalog cost changes (FabricColour, TrimItem, ServiceItem)
 */

import { getPrisma, type PrismaTransaction } from '../db/index.js';

// Type for Prisma client (from dynamic import)
type PrismaClient = Awaited<ReturnType<typeof getPrisma>>;

/**
 * Calculate BOM cost for a single SKU using resolved BOM lines.
 * Uses 3-level cascade: Product → Variation → SKU
 */
async function calculateSkuBomCost(prisma: PrismaClient, skuId: string): Promise<number | null> {
  // Load SKU with variation and product
  const sku = await prisma.sku.findUnique({
    where: { id: skuId },
    include: {
      variation: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!sku) {
    return null;
  }

  const { variation } = sku;
  const { product } = variation;

  // Load all 3 levels of BOM data
  const [productTemplates, variationLines, skuLines] = await Promise.all([
    prisma.productBomTemplate.findMany({
      where: { productId: product.id },
      include: {
        role: { include: { type: true } },
        trimItem: true,
        serviceItem: true,
      },
    }),
    prisma.variationBomLine.findMany({
      where: { variationId: variation.id },
      include: {
        role: { include: { type: true } },
        fabricColour: { include: { fabric: true } },
        trimItem: true,
        serviceItem: true,
      },
    }),
    prisma.skuBomLine.findMany({
      where: { skuId },
      include: {
        role: { include: { type: true } },
        fabricColour: { include: { fabric: true } },
        trimItem: true,
        serviceItem: true,
      },
    }),
  ]);

  // No BOM templates = no cost
  if (productTemplates.length === 0) {
    return null;
  }

  // Build lookup maps for quick access
  type VariationLine = typeof variationLines[number];
  type SkuLine = typeof skuLines[number];
  const variationLinesByRole = new Map<string, VariationLine>(variationLines.map((l) => [l.roleId, l]));
  const skuLinesByRole = new Map<string, SkuLine>(skuLines.map((l) => [l.roleId, l]));

  let totalCost = 0;

  for (const productTemplate of productTemplates) {
    const { role } = productTemplate;
    const variationLine = variationLinesByRole.get(role.id);
    const skuLine = skuLinesByRole.get(role.id);

    // Resolve quantity: SKU → Variation → Product
    const quantity = skuLine?.quantity ?? variationLine?.quantity ?? productTemplate.defaultQuantity;
    const wastagePercent = skuLine?.wastagePercent ?? variationLine?.wastagePercent ?? productTemplate.wastagePercent;
    const effectiveQty = quantity * (1 + wastagePercent / 100);

    // Resolve cost based on component type
    let unitCost: number | null = null;

    // Check for override cost first
    if (skuLine?.overrideCost != null) {
      unitCost = skuLine.overrideCost;
    } else {
      const typeCode = role.type.code;

      if (typeCode === 'FABRIC') {
        // Fabric: SKU → Variation fabric colour
        const fabricColour = skuLine?.fabricColour ?? variationLine?.fabricColour;
        if (fabricColour) {
          unitCost = fabricColour.costPerUnit ?? fabricColour.fabric.costPerUnit ?? null;
        }
      } else if (typeCode === 'TRIM') {
        // Trim: SKU → Variation → Product
        const trimItem = skuLine?.trimItem ?? variationLine?.trimItem ?? productTemplate.trimItem;
        if (trimItem) {
          unitCost = trimItem.costPerUnit;
        }
      } else if (typeCode === 'SERVICE') {
        // Service: SKU → Variation → Product
        const serviceItem = skuLine?.serviceItem ?? variationLine?.serviceItem ?? productTemplate.serviceItem;
        if (serviceItem) {
          unitCost = serviceItem.costPerJob;
        }
      }
    }

    // Add to total if we have a cost
    if (unitCost != null) {
      totalCost += unitCost * effectiveQty;
    }
  }

  return totalCost > 0 ? totalCost : null;
}

/**
 * Recalculate and store BOM cost for a single SKU.
 * Call this after SkuBomLine changes.
 *
 * @param prisma - Prisma client instance
 * @param skuId - The SKU to recalculate cost for
 */
export async function recalculateSkuBomCost(
  prisma: PrismaClient | PrismaTransaction,
  skuId: string
): Promise<void> {
  try {
    // Type cast for Prisma transaction compatibility
    const bomCost = await calculateSkuBomCost(prisma as PrismaClient, skuId);

    await prisma.sku.update({
      where: { id: skuId },
      data: { bomCost },
    });
  } catch (error) {
    // SKU not found or error - set to null
    console.warn(`[bomCostService] Failed to calculate BOM cost for SKU ${skuId}:`, error);
  }
}

/**
 * Recalculate Variation.bomCost as the average of its SKU costs.
 * Call this after all SKUs in a variation have been recalculated.
 *
 * @param prisma - Prisma client instance
 * @param variationId - The variation to recalculate cost for
 */
export async function recalculateVariationBomCost(
  prisma: PrismaClient | PrismaTransaction,
  variationId: string
): Promise<void> {
  // Get average of non-null SKU bomCosts
  const result = await prisma.sku.aggregate({
    where: {
      variationId,
      isActive: true,
      bomCost: { not: null },
    },
    _avg: { bomCost: true },
    _count: { bomCost: true },
  });

  // Use average cost if we have any SKUs with costs
  const bomCost = result._count.bomCost > 0 ? result._avg.bomCost : null;

  await prisma.variation.update({
    where: { id: variationId },
    data: { bomCost },
  });
}

/**
 * Recalculate all SKUs for a variation, then the variation average.
 * Call this after VariationBomLine changes (affects all SKUs).
 *
 * @param prisma - Prisma client instance
 * @param variationId - The variation to recalculate
 */
export async function recalculateVariationAndSkuBomCosts(
  prisma: PrismaClient | PrismaTransaction,
  variationId: string
): Promise<void> {
  // Get all active SKUs for this variation
  const skus = await prisma.sku.findMany({
    where: { variationId, isActive: true },
    select: { id: true },
  });

  // Recalculate each SKU
  for (const sku of skus) {
    await recalculateSkuBomCost(prisma, sku.id);
  }

  // Recalculate variation average
  await recalculateVariationBomCost(prisma, variationId);
}

/**
 * Get the variationId for a given SKU.
 * Helper for getting the parent variation when only skuId is known.
 */
export async function getVariationIdForSku(
  prisma: PrismaClient | PrismaTransaction,
  skuId: string
): Promise<string | null> {
  const sku = await prisma.sku.findUnique({
    where: { id: skuId },
    select: { variationId: true },
  });
  return sku?.variationId ?? null;
}

/**
 * Get all variationIds for a given product.
 * Helper for getting all variations when productId is known.
 */
export async function getVariationIdsForProduct(
  prisma: PrismaClient | PrismaTransaction,
  productId: string
): Promise<string[]> {
  const variations = await prisma.variation.findMany({
    where: { productId, isActive: true },
    select: { id: true },
  });
  return variations.map((v: { id: string }) => v.id);
}
