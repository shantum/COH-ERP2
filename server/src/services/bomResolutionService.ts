/**
 * BOM Resolution Service
 *
 * Resolves the effective Bill of Materials (BOM) for a SKU by cascading
 * through the 3-level hierarchy:
 *
 *   Product → Variation → SKU
 *
 * The cascade follows inheritance rules:
 *   - SKU level overrides Variation level
 *   - Variation level overrides Product level
 *   - If no override exists, inherit from parent
 *
 * For fabric components:
 *   - FabricColour MUST be set at Variation level (color-specific)
 *   - Quantity can be overridden at SKU level (size-specific)
 *
 * For trims and services:
 *   - Can be set at any level
 *   - Lower levels can override higher levels
 */

import type { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'bom-resolution' });

// ============================================
// TYPES
// ============================================

export interface ResolvedBomLine {
  /** Component role (main, accent, lining, button, etc.) */
  roleId: string;
  roleCode: string;
  roleName: string;

  /** Component type (FABRIC, TRIM, SERVICE) */
  typeCode: string;
  typeName: string;
  trackInventory: boolean;

  /** Component reference (only one will be set based on type) */
  fabricColourId: string | null;
  trimItemId: string | null;
  serviceItemId: string | null;

  /** Component details (populated from the referenced item) */
  componentName: string | null;
  componentCode: string | null;

  /** Resolved quantity and units */
  quantity: number;
  quantityUnit: string;
  wastagePercent: number;

  /** Cost (from catalog or override) */
  unitCost: number | null;
  totalCost: number | null;

  /** Source tracking (where each value came from) */
  source: {
    component: 'product' | 'variation' | 'sku';
    quantity: 'product' | 'variation' | 'sku';
    isOverridden: boolean;
  };
}

export interface ResolvedBom {
  skuId: string;
  skuCode: string;
  variationId: string;
  productId: string;

  lines: ResolvedBomLine[];

  /** Summary totals */
  totals: {
    fabricCost: number;
    trimCost: number;
    serviceCost: number;
    totalCost: number;
  };
}

// ============================================
// MAIN RESOLUTION FUNCTION
// ============================================

/**
 * Resolve the effective BOM for a specific SKU
 *
 * @param prisma - Prisma client instance
 * @param skuId - The SKU to resolve BOM for
 * @returns Fully resolved BOM with all components and costs
 */
export async function resolveSkuBom(prisma: PrismaClient, skuId: string): Promise<ResolvedBom> {
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
    throw new Error(`SKU not found: ${skuId}`);
  }

  const { variation } = sku;
  const { product } = variation;

  // Load all 3 levels of BOM data
  const [productTemplates, variationLines, skuLines] = await Promise.all([
    prisma.productBomTemplate.findMany({
      where: { productId: product.id },
      include: {
        role: {
          include: { type: true },
        },
        trimItem: true,
        serviceItem: true,
      },
    }),
    prisma.variationBomLine.findMany({
      where: { variationId: variation.id },
      include: {
        role: {
          include: { type: true },
        },
        fabricColour: {
          include: {
            fabric: true,
          },
        },
        trimItem: true,
        serviceItem: true,
      },
    }),
    prisma.skuBomLine.findMany({
      where: { skuId },
      include: {
        role: {
          include: { type: true },
        },
        fabricColour: {
          include: {
            fabric: true,
          },
        },
        trimItem: true,
        serviceItem: true,
      },
    }),
  ]);

  // Build lookup maps for quick access
  const variationLinesByRole = new Map(variationLines.map((l) => [l.roleId, l]));
  const skuLinesByRole = new Map(skuLines.map((l) => [l.roleId, l]));

  // Resolve each component role
  const resolvedLines: ResolvedBomLine[] = [];

  for (const productTemplate of productTemplates) {
    const { role } = productTemplate;
    const variationLine = variationLinesByRole.get(role.id);
    const skuLine = skuLinesByRole.get(role.id);

    // Resolve component (3-level cascade: SKU → Variation → Product)
    const resolvedComponent = resolveComponent(productTemplate, variationLine, skuLine);

    // Resolve quantity (3-level cascade: SKU → Variation → Product)
    const resolvedQuantity = resolveQuantity(productTemplate, variationLine, skuLine);

    // Get component details and cost
    const componentDetails = await getComponentDetails(prisma, resolvedComponent, role.type.code);

    // Calculate total cost
    const unitCost = skuLine?.overrideCost ?? componentDetails.cost;
    const effectiveQty = resolvedQuantity.quantity * (1 + resolvedQuantity.wastagePercent / 100);
    const totalCost = unitCost != null ? unitCost * effectiveQty : null;

    resolvedLines.push({
      roleId: role.id,
      roleCode: role.code,
      roleName: role.name,

      typeCode: role.type.code,
      typeName: role.type.name,
      trackInventory: role.type.trackInventory,

      fabricColourId: resolvedComponent.fabricColourId,
      trimItemId: resolvedComponent.trimItemId,
      serviceItemId: resolvedComponent.serviceItemId,

      componentName: componentDetails.name,
      componentCode: componentDetails.code,

      quantity: resolvedQuantity.quantity,
      quantityUnit: resolvedQuantity.unit,
      wastagePercent: resolvedQuantity.wastagePercent,

      unitCost,
      totalCost,

      source: {
        component: resolvedComponent.source,
        quantity: resolvedQuantity.source,
        isOverridden: resolvedComponent.source !== 'product' || resolvedQuantity.source !== 'product',
      },
    });
  }

  // Calculate totals by type
  const totals = {
    fabricCost: 0,
    trimCost: 0,
    serviceCost: 0,
    totalCost: 0,
  };

  for (const line of resolvedLines) {
    if (line.totalCost != null) {
      totals.totalCost += line.totalCost;

      switch (line.typeCode) {
        case 'FABRIC':
          totals.fabricCost += line.totalCost;
          break;
        case 'TRIM':
          totals.trimCost += line.totalCost;
          break;
        case 'SERVICE':
          totals.serviceCost += line.totalCost;
          break;
      }
    }
  }

  return {
    skuId: sku.id,
    skuCode: sku.skuCode,
    variationId: variation.id,
    productId: product.id,
    lines: resolvedLines,
    totals,
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

interface ResolvedComponentResult {
  fabricColourId: string | null;
  trimItemId: string | null;
  serviceItemId: string | null;
  source: 'product' | 'variation' | 'sku';
}

function resolveComponent(
  productTemplate: { trimItemId: string | null; serviceItemId: string | null },
  variationLine?: { fabricColourId: string | null; trimItemId: string | null; serviceItemId: string | null } | null,
  skuLine?: { fabricColourId: string | null; trimItemId: string | null; serviceItemId: string | null } | null
): ResolvedComponentResult {
  // Fabric: SKU → Variation (required for fabric)
  const fabricColourId = skuLine?.fabricColourId ?? variationLine?.fabricColourId ?? null;

  // Trim: SKU → Variation → Product
  const trimItemId =
    skuLine?.trimItemId ?? variationLine?.trimItemId ?? productTemplate.trimItemId ?? null;

  // Service: SKU → Variation → Product
  const serviceItemId =
    skuLine?.serviceItemId ?? variationLine?.serviceItemId ?? productTemplate.serviceItemId ?? null;

  // Determine source
  let source: 'product' | 'variation' | 'sku' = 'product';
  if (skuLine?.fabricColourId || skuLine?.trimItemId || skuLine?.serviceItemId) {
    source = 'sku';
  } else if (variationLine?.fabricColourId || variationLine?.trimItemId || variationLine?.serviceItemId) {
    source = 'variation';
  }

  return { fabricColourId, trimItemId, serviceItemId, source };
}

interface ResolvedQuantityResult {
  quantity: number;
  unit: string;
  wastagePercent: number;
  source: 'product' | 'variation' | 'sku';
}

function resolveQuantity(
  productTemplate: { defaultQuantity: number; quantityUnit: string; wastagePercent: number },
  variationLine?: { quantity: number | null; wastagePercent: number | null } | null,
  skuLine?: { quantity: number | null; wastagePercent: number | null } | null
): ResolvedQuantityResult {
  // Quantity: SKU → Variation → Product
  const quantity =
    skuLine?.quantity ?? variationLine?.quantity ?? productTemplate.defaultQuantity;

  // Wastage: SKU → Variation → Product
  const wastagePercent =
    skuLine?.wastagePercent ?? variationLine?.wastagePercent ?? productTemplate.wastagePercent;

  // Determine source
  let source: 'product' | 'variation' | 'sku' = 'product';
  if (skuLine?.quantity != null || skuLine?.wastagePercent != null) {
    source = 'sku';
  } else if (variationLine?.quantity != null || variationLine?.wastagePercent != null) {
    source = 'variation';
  }

  return {
    quantity,
    unit: productTemplate.quantityUnit,
    wastagePercent,
    source,
  };
}

interface ComponentDetails {
  name: string | null;
  code: string | null;
  cost: number | null;
}

async function getComponentDetails(
  prisma: PrismaClient,
  component: ResolvedComponentResult,
  typeCode: string
): Promise<ComponentDetails> {
  if (typeCode === 'FABRIC' && component.fabricColourId) {
    const colour = await prisma.fabricColour.findUnique({
      where: { id: component.fabricColourId },
      include: { fabric: true },
    });
    if (colour) {
      return {
        name: `${colour.fabric.name} - ${colour.colourName}`,
        code: null, // Fabric colours don't have codes
        cost: colour.costPerUnit ?? colour.fabric.costPerUnit ?? null,
      };
    }
  }

  if (typeCode === 'TRIM' && component.trimItemId) {
    const trim = await prisma.trimItem.findUnique({
      where: { id: component.trimItemId },
    });
    if (trim) {
      return {
        name: trim.name,
        code: trim.code,
        cost: trim.costPerUnit,
      };
    }
  }

  if (typeCode === 'SERVICE' && component.serviceItemId) {
    const service = await prisma.serviceItem.findUnique({
      where: { id: component.serviceItemId },
    });
    if (service) {
      return {
        name: service.name,
        code: service.code,
        cost: service.costPerJob,
      };
    }
  }

  return { name: null, code: null, cost: null };
}

// ============================================
// BATCH RESOLUTION
// ============================================

/**
 * Resolve BOMs for multiple SKUs efficiently
 *
 * @param prisma - Prisma client instance
 * @param skuIds - Array of SKU IDs
 * @returns Map of SKU ID to resolved BOM
 */
export async function resolveSkuBomsBatch(
  prisma: PrismaClient,
  skuIds: string[]
): Promise<Map<string, ResolvedBom>> {
  const results = new Map<string, ResolvedBom>();

  // Process in parallel with concurrency limit
  const CONCURRENCY = 10;
  for (let i = 0; i < skuIds.length; i += CONCURRENCY) {
    const batch = skuIds.slice(i, i + CONCURRENCY);
    const boms = await Promise.all(
      batch.map((skuId) =>
        resolveSkuBom(prisma, skuId).catch((err) => {
          log.error({ skuId, err }, 'Failed to resolve BOM for SKU');
          return null;
        })
      )
    );

    for (const bom of boms) {
      if (bom) {
        results.set(bom.skuId, bom);
      }
    }
  }

  return results;
}

// ============================================
// COSTING HELPERS
// ============================================

/**
 * Calculate total COGS for a SKU from its BOM
 *
 * @param prisma - Prisma client instance
 * @param skuId - The SKU ID
 * @returns Total cost of goods sold
 */
export async function calculateSkuCogs(prisma: PrismaClient, skuId: string): Promise<number> {
  const bom = await resolveSkuBom(prisma, skuId);
  return bom.totals.totalCost;
}

/**
 * Get cost breakdown by component type for a SKU
 *
 * @param prisma - Prisma client instance
 * @param skuId - The SKU ID
 * @returns Cost breakdown object
 */
export async function getSkuCostBreakdown(
  prisma: PrismaClient,
  skuId: string
): Promise<ResolvedBom['totals']> {
  const bom = await resolveSkuBom(prisma, skuId);
  return bom.totals;
}
