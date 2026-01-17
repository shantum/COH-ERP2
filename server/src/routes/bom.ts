/**
 * BOM Routes - Bill of Materials management
 *
 * 3-level cascade hierarchy:
 *   Product (template defaults)
 *     → Variation (colour-specific fabric assignments)
 *       → SKU (size-specific quantity overrides)
 *
 * Resolution rules:
 *   - Lower levels override higher levels
 *   - Fabric colour MUST be set at Variation level
 *   - Quantity can be overridden at SKU level for size-specific consumption
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { resolveSkuBom, getSkuCostBreakdown } from '../services/bomResolutionService.js';
import { COMPONENT_TYPES, COMPONENT_ROLES } from '../config/bom/componentTypes.js';

const router = express.Router();

// Apply auth to all routes
router.use(authenticateToken);

// Async handler wrapper
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ============================================
// CONFIG ENDPOINTS
// ============================================

/**
 * GET /bom/component-roles
 * Returns all component roles from config (for dropdown selection)
 */
router.get('/component-roles', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;

  const roles = await prisma.componentRole.findMany({
    include: {
      type: true,
    },
    orderBy: [{ type: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
  });

  return res.json(roles);
}));

/**
 * GET /bom/available-components
 * Returns all available components for BOM selection (fabrics, trims, services)
 */
router.get('/available-components', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;

  const [fabricColours, trims, services] = await Promise.all([
    prisma.fabricColour.findMany({
      include: {
        fabric: {
          include: {
            material: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ fabric: { name: 'asc' } }, { colourName: 'asc' }],
    }),
    prisma.trimItem.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
    prisma.serviceItem.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
  ]);

  // Format fabric colours for selection
  const fabrics = fabricColours.map((c) => ({
    id: c.id,
    type: 'FABRIC',
    name: `${c.fabric.name} - ${c.colourName}`,
    fabricId: c.fabricId,
    fabricName: c.fabric.name,
    colourName: c.colourName,
    materialName: c.fabric.material?.name,
    costPerUnit: c.costPerUnit ?? c.fabric.costPerUnit,
    colourHex: c.colourHex,
  }));

  return res.json({
    fabrics,
    trims: trims.map((t) => ({
      id: t.id,
      type: 'TRIM',
      code: t.code,
      name: t.name,
      category: t.category,
      costPerUnit: t.costPerUnit,
      unit: t.unit,
    })),
    services: services.map((s) => ({
      id: s.id,
      type: 'SERVICE',
      code: s.code,
      name: s.name,
      category: s.category,
      costPerJob: s.costPerJob,
      costUnit: s.costUnit,
    })),
  });
}));

// ============================================
// PRODUCT BOM (Full view)
// ============================================

/**
 * GET /bom/products/:productId
 * Returns full BOM for a product (template + all variations + all SKUs)
 */
router.get('/products/:productId', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const productId = req.params.productId as string;

  // Get product with all variations and SKUs
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variations: {
        include: {
          skus: {
            orderBy: { size: 'asc' },
          },
        },
        orderBy: { colorName: 'asc' },
      },
    },
  });

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  // Get BOM templates
  const templates = await prisma.productBomTemplate.findMany({
    where: { productId: productId as string },
    include: {
      role: { include: { type: true } },
      trimItem: true,
      serviceItem: true,
    },
    orderBy: { role: { sortOrder: 'asc' } },
  });

  // Get all variation BOM lines
  const variationIds = product.variations.map((v: { id: string }) => v.id);
  const variationLines = await prisma.variationBomLine.findMany({
    where: { variationId: { in: variationIds } },
    include: {
      role: { include: { type: true } },
      fabricColour: {
        include: { fabric: true },
      },
      trimItem: true,
      serviceItem: true,
    },
  });

  // Get all SKU BOM lines
  const skuIds = product.variations.flatMap((v: { skus: { id: string }[] }) => v.skus.map((s: { id: string }) => s.id));
  const skuLines = await prisma.skuBomLine.findMany({
    where: { skuId: { in: skuIds } },
    include: {
      role: { include: { type: true } },
      fabricColour: {
        include: { fabric: true },
      },
      trimItem: true,
      serviceItem: true,
    },
  });

  // Group by variation and SKU
  const variationLinesMap = new Map<string, typeof variationLines>();
  for (const line of variationLines) {
    const existing = variationLinesMap.get(line.variationId) || [];
    existing.push(line);
    variationLinesMap.set(line.variationId, existing);
  }

  const skuLinesMap = new Map<string, typeof skuLines>();
  for (const line of skuLines) {
    const existing = skuLinesMap.get(line.skuId) || [];
    existing.push(line);
    skuLinesMap.set(line.skuId, existing);
  }

  return res.json({
    product: {
      id: product.id,
      name: product.name,
      defaultFabricConsumption: product.defaultFabricConsumption,
    },
    templates: templates.map((t: typeof templates[number]) => ({
      id: t.id,
      roleId: t.roleId,
      roleCode: t.role.code,
      roleName: t.role.name,
      typeCode: t.role.type.code,
      typeName: t.role.type.name,
      defaultQuantity: t.defaultQuantity,
      quantityUnit: t.quantityUnit,
      wastagePercent: t.wastagePercent,
      trimItemId: t.trimItemId,
      trimItem: t.trimItem,
      serviceItemId: t.serviceItemId,
      serviceItem: t.serviceItem,
    })),
    variations: product.variations.map((v: typeof product.variations[number]) => ({
      id: v.id,
      colorName: v.colorName,
      fabricId: v.fabricId,
      hasLining: v.hasLining,
      bomLines: (variationLinesMap.get(v.id) || []).map((l) => ({
        id: l.id,
        roleId: l.roleId,
        roleCode: l.role.code,
        roleName: l.role.name,
        typeCode: l.role.type.code,
        fabricColourId: l.fabricColourId,
        fabricColour: l.fabricColour ? {
          id: l.fabricColour.id,
          name: `${l.fabricColour.fabric.name} - ${l.fabricColour.colourName}`,
          colourHex: l.fabricColour.colourHex,
        } : null,
        trimItemId: l.trimItemId,
        trimItem: l.trimItem,
        serviceItemId: l.serviceItemId,
        serviceItem: l.serviceItem,
        quantity: l.quantity,
        wastagePercent: l.wastagePercent,
      })),
      skus: v.skus.map((s: typeof v.skus[number]) => ({
        id: s.id,
        skuCode: s.skuCode,
        size: s.size,
        fabricConsumption: s.fabricConsumption,
        bomLines: (skuLinesMap.get(s.id) || []).map((l) => ({
          id: l.id,
          roleId: l.roleId,
          roleCode: l.role.code,
          quantity: l.quantity,
          wastagePercent: l.wastagePercent,
          overrideCost: l.overrideCost,
        })),
      })),
    })),
  });
}));

/**
 * PUT /bom/products/:productId
 * Update full BOM for a product (template, variations, SKUs)
 */
router.put('/products/:productId', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const productId = req.params.productId as string;
  const { templates, variations } = req.body;

  await prisma.$transaction(async (tx) => {
    // Update templates
    if (templates) {
      for (const template of templates) {
        if (template.id) {
          await tx.productBomTemplate.update({
            where: { id: template.id },
            data: {
              defaultQuantity: template.defaultQuantity,
              quantityUnit: template.quantityUnit,
              wastagePercent: template.wastagePercent,
              trimItemId: template.trimItemId || null,
              serviceItemId: template.serviceItemId || null,
            },
          });
        } else {
          await tx.productBomTemplate.create({
            data: {
              productId,
              roleId: template.roleId,
              defaultQuantity: template.defaultQuantity,
              quantityUnit: template.quantityUnit || 'meter',
              wastagePercent: template.wastagePercent || 0,
              trimItemId: template.trimItemId || null,
              serviceItemId: template.serviceItemId || null,
            },
          });
        }
      }
    }

    // Update variation lines
    if (variations) {
      for (const variation of variations) {
        if (variation.bomLines) {
          for (const line of variation.bomLines) {
            if (line.id) {
              await tx.variationBomLine.update({
                where: { id: line.id },
                data: {
                  fabricColourId: line.fabricColourId || null,
                  trimItemId: line.trimItemId || null,
                  serviceItemId: line.serviceItemId || null,
                  quantity: line.quantity,
                  wastagePercent: line.wastagePercent,
                },
              });
            } else if (line.roleId) {
              await tx.variationBomLine.create({
                data: {
                  variationId: variation.id,
                  roleId: line.roleId,
                  fabricColourId: line.fabricColourId || null,
                  trimItemId: line.trimItemId || null,
                  serviceItemId: line.serviceItemId || null,
                  quantity: line.quantity,
                  wastagePercent: line.wastagePercent,
                },
              });
            }
          }
        }

        // Update SKU lines
        if (variation.skus) {
          for (const sku of variation.skus) {
            if (sku.bomLines) {
              for (const line of sku.bomLines) {
                if (line.id) {
                  await tx.skuBomLine.update({
                    where: { id: line.id },
                    data: {
                      quantity: line.quantity,
                      wastagePercent: line.wastagePercent,
                      overrideCost: line.overrideCost,
                    },
                  });
                } else if (line.roleId && line.quantity != null) {
                  await tx.skuBomLine.create({
                    data: {
                      skuId: sku.id,
                      roleId: line.roleId,
                      quantity: line.quantity,
                      wastagePercent: line.wastagePercent,
                      overrideCost: line.overrideCost,
                    },
                  });
                }
              }
            }
          }
        }
      }
    }
  });

  return res.json({ success: true });
}));

// ============================================
// TEMPLATE ENDPOINTS
// ============================================

/**
 * GET /bom/products/:productId/template
 * Returns BOM template for a product
 */
router.get('/products/:productId/template', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const productId = req.params.productId as string;

  const templates = await prisma.productBomTemplate.findMany({
    where: { productId: productId as string },
    include: {
      role: { include: { type: true } },
      trimItem: true,
      serviceItem: true,
    },
    orderBy: { role: { sortOrder: 'asc' } },
  });

  return res.json(templates);
}));

/**
 * PUT /bom/products/:productId/template
 * Update BOM template for a product
 */
router.put('/products/:productId/template', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const productId = req.params.productId as string;
  const { lines } = req.body;

  if (!lines || !Array.isArray(lines)) {
    return res.status(400).json({ error: 'lines array is required' });
  }

  await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      if (line.id) {
        // Update existing
        await tx.productBomTemplate.update({
          where: { id: line.id },
          data: {
            defaultQuantity: line.defaultQuantity,
            quantityUnit: line.quantityUnit,
            wastagePercent: line.wastagePercent,
            trimItemId: line.trimItemId || null,
            serviceItemId: line.serviceItemId || null,
          },
        });
      } else if (line.roleId) {
        // Create new
        await tx.productBomTemplate.upsert({
          where: {
            productId_roleId: { productId: productId as string, roleId: line.roleId },
          },
          update: {
            defaultQuantity: line.defaultQuantity,
            quantityUnit: line.quantityUnit || 'meter',
            wastagePercent: line.wastagePercent || 0,
            trimItemId: line.trimItemId || null,
            serviceItemId: line.serviceItemId || null,
          },
          create: {
            productId,
            roleId: line.roleId,
            defaultQuantity: line.defaultQuantity,
            quantityUnit: line.quantityUnit || 'meter',
            wastagePercent: line.wastagePercent || 0,
            trimItemId: line.trimItemId || null,
            serviceItemId: line.serviceItemId || null,
          },
        });
      }
    }
  });

  return res.json({ success: true });
}));

/**
 * POST /bom/products/:productId/apply-to-all
 * Apply template to all variations (create missing variation BOM lines)
 */
router.post('/products/:productId/apply-to-all', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const productId = req.params.productId as string;

  // Get product with variations
  const product = await prisma.product.findUnique({
    where: { id: productId as string },
    include: {
      variations: true,
    },
  });

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  // Get templates
  const templates = await prisma.productBomTemplate.findMany({
    where: { productId: productId as string },
    include: { role: true },
  });

  // Create missing variation lines
  let created = 0;
  await prisma.$transaction(async (tx) => {
    for (const variation of product.variations) {
      for (const template of templates) {
        // Check if line exists
        const existing = await tx.variationBomLine.findUnique({
          where: {
            variationId_roleId: {
              variationId: variation.id,
              roleId: template.roleId,
            },
          },
        });

        if (!existing) {
          await tx.variationBomLine.create({
            data: {
              variationId: variation.id,
              roleId: template.roleId,
              quantity: null, // Inherit from template
              wastagePercent: null,
            },
          });
          created++;
        }
      }
    }
  });

  return res.json({ success: true, created });
}));

// ============================================
// VARIATION BOM ENDPOINTS
// ============================================

/**
 * GET /bom/variations/search
 * Search variations by product name or color name for linking
 * NOTE: This route MUST be defined before /variations/:variationId to avoid route conflict
 */
router.get('/variations/search', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const { q, fabricId, limit = '50' } = req.query;

  const searchQuery = (q as string || '').trim();
  const limitNum = Math.min(parseInt(limit as string) || 50, 100);

  const variations = await prisma.variation.findMany({
    where: {
      isActive: true,
      ...(searchQuery && {
        OR: [
          { colorName: { contains: searchQuery, mode: 'insensitive' } },
          { product: { name: { contains: searchQuery, mode: 'insensitive' } } },
          { product: { styleCode: { contains: searchQuery, mode: 'insensitive' } } },
        ],
      }),
      // Optionally filter by fabric type (if we want to match fabric)
      ...(fabricId && { fabricId: fabricId as string }),
    },
    include: {
      product: {
        select: { id: true, name: true, styleCode: true },
      },
      fabric: {
        select: { id: true, name: true },
      },
      // Check if already has a main fabric BOM line
      bomLines: {
        where: {
          role: { code: 'main', type: { code: 'FABRIC' } },
        },
        include: {
          fabricColour: {
            select: { id: true, colourName: true },
          },
        },
      },
    },
    orderBy: [
      { product: { name: 'asc' } },
      { colorName: 'asc' },
    ],
    take: limitNum,
  });

  // Transform to include current fabric assignment info
  const result = variations.map(v => ({
    id: v.id,
    colorName: v.colorName,
    imageUrl: v.imageUrl,
    product: v.product,
    currentFabric: v.fabric ? { id: v.fabric.id, name: v.fabric.name } : null,
    currentFabricColour: v.bomLines[0]?.fabricColour || null,
    hasMainFabricAssignment: v.bomLines.length > 0,
  }));

  return res.json(result);
}));

/**
 * GET /bom/variations/:variationId
 * Returns BOM for a variation
 */
router.get('/variations/:variationId', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const variationId = req.params.variationId as string;

  const lines = await prisma.variationBomLine.findMany({
    where: { variationId: variationId as string },
    include: {
      role: { include: { type: true } },
      fabricColour: {
        include: { fabric: true },
      },
      trimItem: true,
      serviceItem: true,
    },
    orderBy: { role: { sortOrder: 'asc' } },
  });

  return res.json(lines);
}));

/**
 * PUT /bom/variations/:variationId
 * Update BOM for a variation
 */
router.put('/variations/:variationId', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const variationId = req.params.variationId as string;
  const { lines } = req.body;

  if (!lines || !Array.isArray(lines)) {
    return res.status(400).json({ error: 'lines array is required' });
  }

  await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      if (line.id) {
        await tx.variationBomLine.update({
          where: { id: line.id },
          data: {
            fabricColourId: line.fabricColourId || null,
            trimItemId: line.trimItemId || null,
            serviceItemId: line.serviceItemId || null,
            quantity: line.quantity,
            wastagePercent: line.wastagePercent,
          },
        });
      } else if (line.roleId) {
        await tx.variationBomLine.upsert({
          where: {
            variationId_roleId: { variationId: variationId as string, roleId: line.roleId },
          },
          update: {
            fabricColourId: line.fabricColourId || null,
            trimItemId: line.trimItemId || null,
            serviceItemId: line.serviceItemId || null,
            quantity: line.quantity,
            wastagePercent: line.wastagePercent,
          },
          create: {
            variationId,
            roleId: line.roleId,
            fabricColourId: line.fabricColourId || null,
            trimItemId: line.trimItemId || null,
            serviceItemId: line.serviceItemId || null,
            quantity: line.quantity,
            wastagePercent: line.wastagePercent,
          },
        });
      }
    }
  });

  return res.json({ success: true });
}));

// ============================================
// SKU BOM ENDPOINTS
// ============================================

/**
 * GET /bom/skus/:skuId
 * Returns BOM overrides for a SKU
 */
router.get('/skus/:skuId', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const skuId = req.params.skuId as string;

  const lines = await prisma.skuBomLine.findMany({
    where: { skuId: skuId as string },
    include: {
      role: { include: { type: true } },
      fabricColour: {
        include: { fabric: true },
      },
      trimItem: true,
      serviceItem: true,
    },
    orderBy: { role: { sortOrder: 'asc' } },
  });

  return res.json(lines);
}));

/**
 * PUT /bom/skus/:skuId
 * Update BOM overrides for a SKU
 */
router.put('/skus/:skuId', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const skuId = req.params.skuId as string;
  const { lines } = req.body;

  if (!lines || !Array.isArray(lines)) {
    return res.status(400).json({ error: 'lines array is required' });
  }

  await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      if (line.id) {
        if (line.quantity == null && line.wastagePercent == null && line.overrideCost == null) {
          // Delete if all values are null (remove override)
          await tx.skuBomLine.delete({ where: { id: line.id } });
        } else {
          await tx.skuBomLine.update({
            where: { id: line.id },
            data: {
              quantity: line.quantity,
              wastagePercent: line.wastagePercent,
              overrideCost: line.overrideCost,
            },
          });
        }
      } else if (line.roleId && (line.quantity != null || line.wastagePercent != null || line.overrideCost != null)) {
        await tx.skuBomLine.upsert({
          where: {
            skuId_roleId: { skuId: skuId as string, roleId: line.roleId },
          },
          update: {
            quantity: line.quantity,
            wastagePercent: line.wastagePercent,
            overrideCost: line.overrideCost,
          },
          create: {
            skuId,
            roleId: line.roleId,
            quantity: line.quantity,
            wastagePercent: line.wastagePercent,
            overrideCost: line.overrideCost,
          },
        });
      }
    }
  });

  return res.json({ success: true });
}));

/**
 * GET /bom/skus/:skuId/cost
 * Returns resolved cost breakdown for a SKU
 */
router.get('/skus/:skuId/cost', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const skuId = req.params.skuId as string;

  try {
    const bom = await resolveSkuBom(prisma, skuId as string);
    return res.json({
      skuId: bom.skuId,
      skuCode: bom.skuCode,
      lines: bom.lines,
      totals: bom.totals,
    });
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
}));

// ============================================
// FABRIC COLOUR LINKING ENDPOINTS
// ============================================

/**
 * POST /bom/fabric-colours/:colourId/link-variations
 * Bulk link product variations to a fabric colour
 * Creates VariationBomLine records for the main fabric role
 */
router.post('/fabric-colours/:colourId/link-variations', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const colourId = req.params.colourId as string;
  const { variationIds, roleId } = req.body;

  if (!variationIds || !Array.isArray(variationIds) || variationIds.length === 0) {
    return res.status(400).json({ error: 'variationIds array is required' });
  }

  // Verify the colour exists
  const colour = await prisma.fabricColour.findUnique({
    where: { id: colourId },
    include: { fabric: true },
  });

  if (!colour) {
    return res.status(404).json({ error: 'Fabric colour not found' });
  }

  // Get the main fabric role if not specified
  let targetRoleId = roleId;
  if (!targetRoleId) {
    const mainFabricRole = await prisma.componentRole.findFirst({
      where: {
        code: 'main',
        type: { code: 'FABRIC' },
      },
    });
    if (!mainFabricRole) {
      return res.status(500).json({ error: 'Main fabric role not configured' });
    }
    targetRoleId = mainFabricRole.id;
  }

  // Verify variations exist
  const variations = await prisma.variation.findMany({
    where: { id: { in: variationIds } },
    select: { id: true, colorName: true, product: { select: { name: true } } },
  });

  if (variations.length !== variationIds.length) {
    return res.status(400).json({ error: 'One or more variations not found' });
  }

  // HIERARCHICAL CONSISTENCY:
  // When linking at colour level, we automatically link at fabric level too.
  // This ensures: Variation → Fabric → FabricColour chain is always consistent.
  // - BOM line (fabricColourId) links to the specific colour
  // - Variation.fabricId links to the colour's parent fabric

  // Create/update BOM lines AND update variation.fabricId in a transaction
  // Use upsert for better performance and increase timeout for bulk operations
  const results = await prisma.$transaction(async (tx) => {
    const updated: string[] = [];

    for (const variation of variations) {
      // 1. Create/update the BOM line with the fabric colour
      await tx.variationBomLine.upsert({
        where: {
          variationId_roleId: {
            variationId: variation.id,
            roleId: targetRoleId,
          },
        },
        update: { fabricColourId: colourId },
        create: {
          variationId: variation.id,
          roleId: targetRoleId,
          fabricColourId: colourId,
        },
      });

      // 2. Also update the variation's fabricId to match the colour's parent fabric
      await tx.variation.update({
        where: { id: variation.id },
        data: { fabricId: colour.fabricId },
      });

      updated.push(variation.id);
    }

    return { updated };
  }, {
    timeout: 30000, // 30 second timeout for bulk operations
  });

  return res.json({
    success: true,
    fabricColour: {
      id: colour.id,
      name: colour.colourName,
      fabricName: colour.fabric.name,
    },
    linked: {
      total: results.updated.length,
    },
  });
}));

export default router;
