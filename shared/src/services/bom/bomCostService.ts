/**
 * BOM Cost Service
 *
 * Read-only BOM cost calculation for diagnostics and reporting.
 *
 * IMPORTANT: BOM cost recalculation (writing to Sku.bomCost / Variation.bomCost)
 * is handled exclusively by PostgreSQL triggers. Do NOT add app-level recalc
 * functions here — the `pg_trigger_depth() = 0` guard will block them.
 */

import { getPrisma } from '../db/index.js';

// Type for Prisma client (from dynamic import)
type PrismaClient = Awaited<ReturnType<typeof getPrisma>>;

/**
 * Calculate BOM cost for a single SKU using resolved BOM lines.
 * Uses 3-level cascade: Product → Variation → SKU
 *
 * This is a READ-ONLY calculation — useful for diagnostics, audits,
 * and verifying that DB triggers are computing costs correctly.
 */
export async function calculateSkuBomCost(prisma: PrismaClient, skuId: string): Promise<number | null> {
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
