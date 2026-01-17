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
  // CRITICAL: Update fabricId BEFORE creating BOM line to satisfy DB constraint
  const results = await prisma.$transaction(async (tx) => {
    const updated: string[] = [];

    for (const variation of variations) {
      // 1. FIRST update the variation's fabricId to match the colour's parent fabric
      // This must happen before the BOM line creation to satisfy the hierarchy constraint
      await tx.variation.update({
        where: { id: variation.id },
        data: { fabricId: colour.fabricId },
      });

      // 2. THEN create/update the BOM line with the fabric colour
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

/**
 * GET /bom/fabric-assignments
 * Returns all fabric assignments for variations (for Fabric Mapping view)
 * Query params:
 *   - roleId: ComponentRole ID (optional, defaults to main fabric role)
 *
 * Returns: { assignments: Array<{ variationId, colourId, fabricId, materialId, colourName, fabricName, materialName, colourHex }> }
 */
router.get('/fabric-assignments', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  let roleId = req.query.roleId as string | undefined;

  // Get the main fabric role if not specified
  if (!roleId) {
    const mainFabricRole = await prisma.componentRole.findFirst({
      where: {
        code: 'main',
        type: { code: 'FABRIC' },
      },
    });
    if (!mainFabricRole) {
      return res.status(500).json({ error: 'Main fabric role not configured' });
    }
    roleId = mainFabricRole.id;
  }

  // Fetch all variation BOM lines with fabric colour assignments
  const bomLines = await prisma.variationBomLine.findMany({
    where: {
      roleId,
      fabricColourId: { not: null },
    },
    select: {
      variationId: true,
      fabricColourId: true,
      fabricColour: {
        select: {
          id: true,
          colourName: true,
          colourHex: true,
          fabricId: true,
          fabric: {
            select: {
              id: true,
              name: true,
              materialId: true,
              material: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  // Transform to flat response
  const assignments = bomLines.map(line => ({
    variationId: line.variationId,
    colourId: line.fabricColour?.id || '',
    colourName: line.fabricColour?.colourName || '',
    colourHex: line.fabricColour?.colourHex || undefined,
    fabricId: line.fabricColour?.fabric?.id || '',
    fabricName: line.fabricColour?.fabric?.name || '',
    materialId: line.fabricColour?.fabric?.material?.id || '',
    materialName: line.fabricColour?.fabric?.material?.name || '',
  }));

  return res.json({ assignments, roleId });
}));

// ============================================
// SIZE-BASED CONSUMPTION ENDPOINTS
// ============================================

/**
 * GET /bom/products/:productId/size-consumptions
 * Returns consumption by size for a product (aggregated across all colors)
 * Query params:
 *   - roleId: ComponentRole ID (required)
 */
router.get('/products/:productId/size-consumptions', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const productId = req.params.productId as string;
  const roleId = req.query.roleId as string;

  if (!roleId) {
    return res.status(400).json({ error: 'roleId query param is required' });
  }

  // Get product with all variations and SKUs
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variations: {
        where: { isActive: true },
        include: {
          skus: {
            where: { isActive: true },
            orderBy: { size: 'asc' },
          },
        },
      },
    },
  });

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  // Get the role details
  const role = await prisma.componentRole.findUnique({
    where: { id: roleId },
    include: { type: true },
  });

  if (!role) {
    return res.status(404).json({ error: 'Component role not found' });
  }

  // Get product template for default quantity
  const template = await prisma.productBomTemplate.findFirst({
    where: { productId, roleId },
  });

  // Collect all SKU IDs
  const allSkus = product.variations.flatMap(v => v.skus);
  const skuIds = allSkus.map(s => s.id);

  // Get SKU-level BOM lines for this role
  const skuBomLines = await prisma.skuBomLine.findMany({
    where: { skuId: { in: skuIds }, roleId },
  });

  // Create a map of skuId -> quantity
  const skuQuantityMap = new Map<string, number | null>();
  for (const line of skuBomLines) {
    skuQuantityMap.set(line.skuId, line.quantity);
  }

  // Aggregate by size - get unique sizes and their consumption
  const sizeConsumptionMap = new Map<string, { quantity: number | null; skuCount: number }>();
  const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL'];

  for (const sku of allSkus) {
    const size = sku.size;
    const existing = sizeConsumptionMap.get(size);

    // Get quantity: SKU BOM line → template default → SKU fabricConsumption (legacy)
    let quantity = skuQuantityMap.get(sku.id);
    if (quantity === undefined) {
      quantity = template?.defaultQuantity ?? sku.fabricConsumption;
    }

    if (existing) {
      // Use the first non-null value found for this size
      if (existing.quantity === null && quantity !== null) {
        existing.quantity = quantity;
      }
      existing.skuCount++;
    } else {
      sizeConsumptionMap.set(size, { quantity, skuCount: 1 });
    }
  }

  // Sort sizes in standard order
  const sizes = Array.from(sizeConsumptionMap.entries())
    .sort((a, b) => {
      const indexA = sizeOrder.indexOf(a[0]);
      const indexB = sizeOrder.indexOf(b[0]);
      if (indexA === -1 && indexB === -1) return a[0].localeCompare(b[0]);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    })
    .map(([size, data]) => ({
      size,
      quantity: data.quantity,
      skuCount: data.skuCount,
    }));

  return res.json({
    productId,
    productName: product.name,
    roleId,
    roleName: role.name,
    roleType: role.type.code,
    unit: template?.quantityUnit || 'meter',
    defaultQuantity: template?.defaultQuantity ?? null,
    sizes,
    totalSkus: allSkus.length,
    totalVariations: product.variations.length,
  });
}));

/**
 * PUT /bom/products/:productId/size-consumptions
 * Bulk update consumption by size (applies to ALL SKUs of that size across all colors)
 * Body: { roleId: string, consumptions: { size: string, quantity: number }[] }
 */
router.put('/products/:productId/size-consumptions', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const productId = req.params.productId as string;
  const { roleId, consumptions } = req.body;

  if (!roleId) {
    return res.status(400).json({ error: 'roleId is required' });
  }

  if (!consumptions || !Array.isArray(consumptions)) {
    return res.status(400).json({ error: 'consumptions array is required' });
  }

  // Get product with all SKUs
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variations: {
        where: { isActive: true },
        include: {
          skus: {
            where: { isActive: true },
            select: { id: true, size: true },
          },
        },
      },
    },
  });

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  // Create size → quantity map from request
  const sizeQuantityMap = new Map<string, number>();
  for (const c of consumptions) {
    if (c.size && c.quantity !== undefined && c.quantity !== null) {
      sizeQuantityMap.set(c.size, c.quantity);
    }
  }

  // Collect all SKUs by size
  const allSkus = product.variations.flatMap(v => v.skus);
  const skusToUpdate = allSkus.filter(sku => sizeQuantityMap.has(sku.size));

  // Get role to check if it's main fabric (for backward compat)
  const role = await prisma.componentRole.findUnique({
    where: { id: roleId },
    include: { type: true },
  });

  const isMainFabric = role?.type.code === 'FABRIC' && role.code === 'main';

  // Batch update in transaction
  let updatedCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const sku of skusToUpdate) {
      const quantity = sizeQuantityMap.get(sku.size)!;

      // Upsert SKU BOM line
      await tx.skuBomLine.upsert({
        where: {
          skuId_roleId: { skuId: sku.id, roleId },
        },
        update: { quantity },
        create: {
          skuId: sku.id,
          roleId,
          quantity,
        },
      });

      // Backward compatibility: also update legacy fabricConsumption field
      if (isMainFabric) {
        await tx.sku.update({
          where: { id: sku.id },
          data: { fabricConsumption: quantity },
        });
      }

      updatedCount++;
    }
  }, {
    timeout: 30000,
  });

  return res.json({
    success: true,
    updated: updatedCount,
    sizesUpdated: consumptions.length,
  });
}));

// ============================================
// CONSUMPTION GRID ENDPOINTS
// ============================================

/**
 * GET /bom/consumption-grid
 * Returns consumption data for all products in a grid format
 * Rows = Products, Columns = Sizes
 */
router.get('/consumption-grid', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const roleCode = (req.query.role as string) || 'main';
  const typeCode = (req.query.type as string) || 'FABRIC';

  // Get the role
  const role = await prisma.componentRole.findFirst({
    where: {
      code: roleCode,
      type: { code: typeCode },
    },
    include: { type: true },
  });

  if (!role) {
    return res.status(404).json({ error: `Role ${roleCode} of type ${typeCode} not found` });
  }

  // Get all active products with their variations and SKUs
  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: {
      variations: {
        where: { isActive: true },
        include: {
          skus: {
            where: { isActive: true },
            select: { id: true, size: true, fabricConsumption: true },
          },
        },
      },
    },
    orderBy: [{ gender: 'asc' }, { category: 'asc' }, { name: 'asc' }],
  });

  // Get all SKU IDs
  const allSkuIds: string[] = [];
  for (const product of products) {
    for (const variation of product.variations) {
      for (const sku of variation.skus) {
        allSkuIds.push(sku.id);
      }
    }
  }

  // Get SKU BOM lines for this role
  const skuBomLines = await prisma.skuBomLine.findMany({
    where: { skuId: { in: allSkuIds }, roleId: role.id },
  });

  // Create map of skuId -> quantity
  const skuQuantityMap = new Map<string, number | null>();
  for (const line of skuBomLines) {
    skuQuantityMap.set(line.skuId, line.quantity);
  }

  // Get product templates for default quantities
  const productIds = products.map(p => p.id);
  const templates = await prisma.productBomTemplate.findMany({
    where: { productId: { in: productIds }, roleId: role.id },
  });
  const templateMap = new Map<string, number | null>();
  for (const t of templates) {
    templateMap.set(t.productId, t.defaultQuantity);
  }

  // Collect all unique sizes across all products
  const allSizes = new Set<string>();
  for (const product of products) {
    for (const variation of product.variations) {
      for (const sku of variation.skus) {
        allSizes.add(sku.size);
      }
    }
  }

  // Sort sizes in standard order
  const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL'];
  const sizes = Array.from(allSizes).sort((a, b) => {
    const indexA = sizeOrder.indexOf(a);
    const indexB = sizeOrder.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  // Build grid data
  const rows = products.map(product => {
    // Aggregate by size - get consumption for each size
    const sizeData: Record<string, { quantity: number | null; skuCount: number }> = {};
    const defaultQty = templateMap.get(product.id) ?? null;

    for (const size of sizes) {
      sizeData[size] = { quantity: null, skuCount: 0 };
    }

    for (const variation of product.variations) {
      for (const sku of variation.skus) {
        const bomQty = skuQuantityMap.get(sku.id);
        const qty = bomQty ?? defaultQty ?? sku.fabricConsumption;

        if (!sizeData[sku.size]) {
          sizeData[sku.size] = { quantity: null, skuCount: 0 };
        }

        // Use first non-null value for this size
        if (sizeData[sku.size].quantity === null && qty !== null) {
          sizeData[sku.size].quantity = qty;
        }
        sizeData[sku.size].skuCount++;
      }
    }

    return {
      productId: product.id,
      productName: product.name,
      styleCode: product.styleCode,
      category: product.category,
      gender: product.gender,
      imageUrl: product.imageUrl,
      variationCount: product.variations.length,
      skuCount: product.variations.reduce((sum, v) => sum + v.skus.length, 0),
      defaultQuantity: defaultQty,
      sizes: sizeData,
    };
  });

  return res.json({
    roleId: role.id,
    roleName: role.name,
    roleType: role.type.code,
    sizes,
    rows,
  });
}));

/**
 * PUT /bom/consumption-grid
 * Bulk update consumption for multiple products/sizes
 * Body: { roleId: string, updates: [{ productId, size, quantity }] }
 */
router.put('/consumption-grid', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const { roleId, updates } = req.body;

  if (!roleId) {
    return res.status(400).json({ error: 'roleId is required' });
  }

  if (!updates || !Array.isArray(updates)) {
    return res.status(400).json({ error: 'updates array is required' });
  }

  // Get role to check if main fabric (for backward compat)
  const role = await prisma.componentRole.findUnique({
    where: { id: roleId },
    include: { type: true },
  });

  if (!role) {
    return res.status(404).json({ error: 'Role not found' });
  }

  const isMainFabric = role.type.code === 'FABRIC' && role.code === 'main';

  // Group updates by productId
  const updatesByProduct = new Map<string, Map<string, number>>();
  for (const u of updates) {
    if (u.productId && u.size && u.quantity !== undefined && u.quantity !== null) {
      if (!updatesByProduct.has(u.productId)) {
        updatesByProduct.set(u.productId, new Map());
      }
      updatesByProduct.get(u.productId)!.set(u.size, u.quantity);
    }
  }

  // Get all products with their SKUs
  const productIds = Array.from(updatesByProduct.keys());
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: {
      variations: {
        where: { isActive: true },
        include: {
          skus: {
            where: { isActive: true },
            select: { id: true, size: true },
          },
        },
      },
    },
  });

  // Batch update in transaction
  let updatedCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const product of products) {
      const sizeQuantityMap = updatesByProduct.get(product.id);
      if (!sizeQuantityMap) continue;

      for (const variation of product.variations) {
        for (const sku of variation.skus) {
          const quantity = sizeQuantityMap.get(sku.size);
          if (quantity === undefined) continue;

          // Upsert SKU BOM line
          await tx.skuBomLine.upsert({
            where: {
              skuId_roleId: { skuId: sku.id, roleId },
            },
            update: { quantity },
            create: {
              skuId: sku.id,
              roleId,
              quantity,
            },
          });

          // Backward compatibility
          if (isMainFabric) {
            await tx.sku.update({
              where: { id: sku.id },
              data: { fabricConsumption: quantity },
            });
          }

          updatedCount++;
        }
      }
    }
  }, {
    timeout: 60000, // 60 second timeout for large batch
  });

  return res.json({
    success: true,
    updated: updatedCount,
    productsUpdated: productIds.length,
  });
}));

// ============================================
// CONSUMPTION IMPORT ENDPOINTS
// ============================================

/**
 * GET /bom/products-for-mapping
 * Returns all products with basic info for mapping UI
 * Includes flag for whether product has existing consumption data
 */
router.get('/products-for-mapping', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      styleCode: true,
      category: true,
      imageUrl: true,
      gender: true,
      variations: {
        where: { isActive: true },
        select: {
          skus: {
            where: { isActive: true },
            select: { fabricConsumption: true },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  // Calculate if product has non-zero consumption
  const result = products.map((p) => {
    let hasConsumption = false;
    let avgConsumption = 0;
    let skuCount = 0;

    for (const v of p.variations) {
      for (const s of v.skus) {
        skuCount++;
        if (s.fabricConsumption && s.fabricConsumption > 0) {
          hasConsumption = true;
          avgConsumption += s.fabricConsumption;
        }
      }
    }

    return {
      id: p.id,
      name: p.name,
      styleCode: p.styleCode,
      category: p.category,
      imageUrl: p.imageUrl,
      gender: p.gender,
      hasConsumption,
      avgConsumption: skuCount > 0 ? avgConsumption / skuCount : 0,
    };
  });

  return res.json(result);
}));

/**
 * POST /bom/reset-consumption
 * Reset all fabric consumption values to 0
 * Use this before importing to track what hasn't been updated
 */
router.post('/reset-consumption', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;

  // Get the main fabric role
  const mainFabricRole = await prisma.componentRole.findFirst({
    where: {
      code: 'main',
      type: { code: 'FABRIC' },
    },
  });

  if (!mainFabricRole) {
    return res.status(500).json({ error: 'Main fabric role not found' });
  }

  // Delete all SKU BOM lines for main fabric role
  const deletedBomLines = await prisma.skuBomLine.deleteMany({
    where: { roleId: mainFabricRole.id },
  });

  // Reset product template default quantities to 0
  const updatedTemplates = await prisma.productBomTemplate.updateMany({
    where: { roleId: mainFabricRole.id },
    data: { defaultQuantity: 0 },
  });

  // Reset all Sku.fabricConsumption to 0 to indicate unset
  const updatedSkus = await prisma.sku.updateMany({
    data: { fabricConsumption: 0 },
  });

  return res.json({
    success: true,
    deletedBomLines: deletedBomLines.count,
    updatedTemplates: updatedTemplates.count,
    resetSkus: updatedSkus.count,
  });
}));

/**
 * POST /bom/import-consumption
 * Import consumption data for multiple products
 * Body: { imports: [{ productId, sizes: { XS: 1.2, S: 1.3, ... } }] }
 */
router.post('/import-consumption', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const { imports } = req.body;

  console.log('[import-consumption] Received', imports?.length, 'imports');

  if (!imports || !Array.isArray(imports)) {
    return res.status(400).json({ error: 'imports array is required' });
  }

  // Validate imports data
  const validImports = imports.filter((imp: any) => {
    if (!imp.productId || typeof imp.productId !== 'string') {
      console.log('[import-consumption] Skipping invalid import - no productId:', imp);
      return false;
    }
    if (!imp.sizes || typeof imp.sizes !== 'object') {
      console.log('[import-consumption] Skipping invalid import - no sizes:', imp);
      return false;
    }
    return true;
  });

  console.log('[import-consumption] Valid imports:', validImports.length);

  if (validImports.length === 0) {
    return res.json({ success: true, productsImported: 0, skusUpdated: 0 });
  }

  try {
    // Get the main fabric role
    const mainFabricRole = await prisma.componentRole.findFirst({
      where: {
        code: 'main',
        type: { code: 'FABRIC' },
      },
    });

    if (!mainFabricRole) {
      return res.status(500).json({ error: 'Main fabric role not found' });
    }

    // Get all products with their SKUs
    const productIds = validImports.map((i: any) => i.productId);
    console.log('[import-consumption] Fetching', productIds.length, 'products');

    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: {
        variations: {
          where: { isActive: true },
          include: {
            skus: {
              where: { isActive: true },
              select: { id: true, size: true },
            },
          },
        },
      },
    });

    console.log('[import-consumption] Found', products.length, 'products');

    // Create map of productId -> product
    const productMap = new Map(products.map(p => [p.id, p]));

    // Build batch operations
    const skuUpdates: { skuId: string; quantity: number }[] = [];

    for (const imp of validImports) {
      const product = productMap.get(imp.productId);
      if (!product || !imp.sizes) continue;

      for (const variation of product.variations) {
        for (const sku of variation.skus) {
          const quantity = imp.sizes[sku.size];
          if (quantity === undefined || quantity === null || quantity === '') continue;

          const numQuantity = typeof quantity === 'number' ? quantity : parseFloat(quantity);
          if (isNaN(numQuantity)) continue;

          skuUpdates.push({ skuId: sku.id, quantity: numQuantity });
        }
      }
    }

    console.log('[import-consumption] Processing', skuUpdates.length, 'SKU updates');

    // Use raw SQL for fast batch update
    const skuIds = skuUpdates.map(u => u.skuId);

    // Build CASE statement for quantity updates
    const caseStatements = skuUpdates.map(u =>
      `WHEN id = '${u.skuId}' THEN ${u.quantity}`
    ).join(' ');

    // Batch update Sku.fabricConsumption using raw SQL
    await prisma.$executeRawUnsafe(`
      UPDATE "Sku"
      SET "fabricConsumption" = CASE ${caseStatements} END
      WHERE id IN (${skuIds.map(id => `'${id}'`).join(',')})
    `);

    console.log('[import-consumption] Updated Sku.fabricConsumption');

    // For SkuBomLine, delete existing and insert new (faster than upsert)
    await prisma.skuBomLine.deleteMany({
      where: {
        skuId: { in: skuIds },
        roleId: mainFabricRole.id,
      },
    });

    // Batch create all BOM lines
    await prisma.skuBomLine.createMany({
      data: skuUpdates.map(u => ({
        skuId: u.skuId,
        roleId: mainFabricRole.id,
        quantity: u.quantity,
      })),
    });

    const uniqueProducts = new Set(validImports.map((i: any) => i.productId)).size;
    const updatedSkus = skuUpdates.length;

    console.log('[import-consumption] Done:', uniqueProducts, 'products,', updatedSkus, 'SKUs');

    return res.json({
      success: true,
      productsImported: uniqueProducts,
      skusUpdated: updatedSkus,
    });
  } catch (error: any) {
    console.error('[import-consumption] Error:', error.message);
    return res.status(500).json({ error: error.message || 'Import failed' });
  }
}));

export default router;
