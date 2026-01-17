/**
 * Materials Routes - 3-tier Material hierarchy management
 *
 * Hierarchy:
 *   Material (Linen, Cotton, etc.)
 *     → Fabric (Linen 60 Lea Plain Weave, Pima Single Jersey 180gsm)
 *       → FabricColour (Carbon Black, Deep Sea Blue - the inventory unit)
 *
 * Also handles Trims and Services catalogs.
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Apply auth to all routes
router.use(authenticateToken);

// Async handler wrapper
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ============================================
// HIERARCHY VIEW
// ============================================

/**
 * GET /materials/hierarchy
 * Returns hierarchical data based on view level
 *
 * Query params:
 *   - view: 'material' | 'fabric' | 'colour' (default: 'material')
 *   - materialId: filter by material (for fabric/colour views)
 *   - fabricId: filter by fabric (for colour view)
 */
router.get('/hierarchy', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const { view = 'material', materialId, fabricId } = req.query;

  if (view === 'material') {
    // Level 1: Materials with aggregated counts
    const materials = await prisma.material.findMany({
      where: { isActive: true },
      include: {
        _count: {
          select: { fabrics: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Get fabric colour counts per material
    const colourCounts = await prisma.fabricColour.groupBy({
      by: ['fabricId'],
      _count: true,
    });

    const fabricColourMap = new Map<string, number>();
    for (const c of colourCounts) {
      fabricColourMap.set(c.fabricId, c._count);
    }

    const fabricMaterialMap = await prisma.fabric.findMany({
      select: { id: true, materialId: true },
    });

    const materialColourCounts = new Map<string, number>();
    for (const f of fabricMaterialMap) {
      if (f.materialId) {
        const count = materialColourCounts.get(f.materialId) || 0;
        materialColourCounts.set(f.materialId, count + (fabricColourMap.get(f.id) || 0));
      }
    }

    const result = materials.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      isActive: m.isActive,
      fabricCount: m._count.fabrics,
      colourCount: materialColourCounts.get(m.id) || 0,
    }));

    return res.json({
      items: result,
      summary: { total: result.length, orderNow: 0, orderSoon: 0, ok: result.length },
    });
  }

  if (view === 'fabric') {
    // Level 2: Fabrics (optionally filtered by material)
    const fabrics = await prisma.fabric.findMany({
      where: materialId ? { materialId: materialId as string } : {},
      include: {
        material: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        _count: {
          select: { colours: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const result = fabrics.map((f) => ({
      id: f.id,
      name: f.name,
      materialId: f.materialId,
      materialName: f.material?.name,
      constructionType: f.constructionType,
      pattern: f.pattern,
      weight: f.weight,
      weightUnit: f.weightUnit,
      composition: f.composition,
      costPerUnit: f.costPerUnit,
      leadTimeDays: f.leadTimeDays,
      minOrderQty: f.minOrderQty,
      supplierId: f.supplierId,
      supplierName: f.supplier?.name,
      avgShrinkagePct: f.avgShrinkagePct,
      colourCount: f._count.colours,
    }));

    return res.json({
      items: result,
      summary: { total: result.length, orderNow: 0, orderSoon: 0, ok: result.length },
    });
  }

  if (view === 'colour') {
    // Level 3: FabricColours (optionally filtered by fabric)
    const colours = await prisma.fabricColour.findMany({
      where: fabricId ? { fabricId: fabricId as string } : {},
      include: {
        fabric: {
          select: {
            id: true,
            name: true,
            materialId: true,
            costPerUnit: true,
            leadTimeDays: true,
            minOrderQty: true,
            composition: true,
            weight: true,
            weightUnit: true,
            material: { select: { id: true, name: true } },
          },
        },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: [{ fabric: { name: 'asc' } }, { colourName: 'asc' }],
    });

    const result = colours.map((c) => ({
      id: c.id,
      colourId: c.id, // Alias for consistency
      fabricId: c.fabricId,
      fabricName: c.fabric.name, // After migration, this will be the clean fabric type name
      materialId: c.fabric.materialId,
      materialName: c.fabric.material?.name,
      colourName: c.colourName,
      standardColour: c.standardColour,
      colourHex: c.colourHex,
      // Fabric properties (for display)
      composition: c.fabric.composition,
      weight: c.fabric.weight,
      weightUnit: c.fabric.weightUnit,
      // Cost/Lead/Min - own values
      costPerUnit: c.costPerUnit,
      leadTimeDays: c.leadTimeDays,
      minOrderQty: c.minOrderQty,
      // Inherited values from fabric (for placeholder display)
      inheritedCostPerUnit: c.fabric.costPerUnit,
      inheritedLeadTimeDays: c.fabric.leadTimeDays,
      inheritedMinOrderQty: c.fabric.minOrderQty,
      // Effective values (own or inherited)
      effectiveCostPerUnit: c.costPerUnit ?? c.fabric.costPerUnit,
      effectiveLeadTimeDays: c.leadTimeDays ?? c.fabric.leadTimeDays,
      effectiveMinOrderQty: c.minOrderQty ?? c.fabric.minOrderQty,
      // Inheritance flags
      costInherited: c.costPerUnit == null && c.fabric.costPerUnit != null,
      leadTimeInherited: c.leadTimeDays == null && c.fabric.leadTimeDays != null,
      minOrderInherited: c.minOrderQty == null && c.fabric.minOrderQty != null,
      // Supplier
      supplierId: c.supplierId,
      supplierName: c.supplier?.name,
      isActive: c.isActive,
    }));

    return res.json({
      items: result,
      summary: { total: result.length, orderNow: 0, orderSoon: 0, ok: result.length },
    });
  }

  return res.status(400).json({ error: 'Invalid view parameter' });
}));

/**
 * GET /materials/tree
 * Returns fully nested hierarchical data for tree table display.
 * Material → Fabric → FabricColour (nested children array)
 *
 * Query params:
 *   - expanded: 'all' | 'none' | comma-separated materialIds to pre-expand
 *   - lazyLoad: 'true' to only return top-level materials (children fetched on expand)
 */
router.get('/tree', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const { expanded = 'none', lazyLoad = 'false' } = req.query;
  const isLazyLoad = lazyLoad === 'true';

  // Fetch all materials
  const materials = await prisma.material.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });

  // If lazy loading, only return materials with counts (no nested children)
  if (isLazyLoad) {
    // Get counts for each material
    const fabricCounts = await prisma.fabric.groupBy({
      by: ['materialId'],
      where: { materialId: { not: null } },
      _count: true,
    });
    const fabricCountMap = new Map(fabricCounts.map(f => [f.materialId!, f._count]));

    // Get colour counts per material via fabrics
    const fabrics = await prisma.fabric.findMany({
      select: { id: true, materialId: true },
    });
    const fabricToMaterial = new Map(fabrics.map(f => [f.id, f.materialId]));

    const colourCounts = await prisma.fabricColour.groupBy({
      by: ['fabricId'],
      _count: true,
    });

    const materialColourCounts = new Map<string, number>();
    for (const c of colourCounts) {
      const materialId = fabricToMaterial.get(c.fabricId);
      if (materialId) {
        materialColourCounts.set(
          materialId,
          (materialColourCounts.get(materialId) || 0) + c._count
        );
      }
    }

    const items = materials.map((m) => ({
      id: m.id,
      type: 'material' as const,
      name: m.name,
      isActive: m.isActive,
      fabricCount: fabricCountMap.get(m.id) || 0,
      colourCount: materialColourCounts.get(m.id) || 0,
      children: [], // Empty, will be fetched on expand
    }));

    return res.json({
      items,
      summary: {
        total: items.length,
        materials: items.length,
        fabrics: fabricCounts.reduce((acc, f) => acc + f._count, 0),
        colours: colourCounts.reduce((acc, c) => acc + c._count, 0),
        orderNow: 0,
        orderSoon: 0,
        ok: items.length,
      },
    });
  }

  // Full tree: fetch all data and nest it
  const [allFabrics, allColours] = await Promise.all([
    prisma.fabric.findMany({
      include: {
        material: { select: { name: true } },
        supplier: { select: { id: true, name: true } },
        _count: { select: { colours: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.fabricColour.findMany({
      include: {
        fabric: {
          select: {
            id: true,
            name: true,
            materialId: true,
            costPerUnit: true,
            leadTimeDays: true,
            minOrderQty: true,
            material: { select: { name: true } },
          },
        },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { colourName: 'asc' },
    }),
  ]);

  // Group fabrics by material
  const fabricsByMaterial = new Map<string, typeof allFabrics>();
  for (const f of allFabrics) {
    if (f.materialId) {
      const list = fabricsByMaterial.get(f.materialId) || [];
      list.push(f);
      fabricsByMaterial.set(f.materialId, list);
    }
  }

  // Group colours by fabric
  const coloursByFabric = new Map<string, typeof allColours>();
  for (const c of allColours) {
    const list = coloursByFabric.get(c.fabricId) || [];
    list.push(c);
    coloursByFabric.set(c.fabricId, list);
  }

  // Build tree
  const tree = materials.map((material) => {
    const materialFabrics = fabricsByMaterial.get(material.id) || [];
    const fabricNodes = materialFabrics.map((fabric) => {
      const fabricColours = coloursByFabric.get(fabric.id) || [];
      const colourNodes = fabricColours.map((colour) => ({
        id: colour.id,
        type: 'colour' as const,
        name: colour.colourName,
        colourName: colour.colourName,
        standardColour: colour.standardColour,
        colourHex: colour.colourHex,
        isActive: colour.isActive,
        parentId: colour.fabricId,
        fabricId: colour.fabricId,
        fabricName: colour.fabric.name,
        materialId: colour.fabric.materialId,
        materialName: colour.fabric.material?.name,
        // Own values
        costPerUnit: colour.costPerUnit,
        leadTimeDays: colour.leadTimeDays,
        minOrderQty: colour.minOrderQty,
        // Inherited values from fabric
        inheritedCostPerUnit: colour.fabric.costPerUnit,
        inheritedLeadTimeDays: colour.fabric.leadTimeDays,
        inheritedMinOrderQty: colour.fabric.minOrderQty,
        // Effective values (own or inherited)
        effectiveCostPerUnit: colour.costPerUnit ?? colour.fabric.costPerUnit,
        effectiveLeadTimeDays: colour.leadTimeDays ?? colour.fabric.leadTimeDays,
        effectiveMinOrderQty: colour.minOrderQty ?? colour.fabric.minOrderQty,
        // Inheritance flags
        costInherited: colour.costPerUnit == null && colour.fabric.costPerUnit != null,
        leadTimeInherited: colour.leadTimeDays == null && colour.fabric.leadTimeDays != null,
        minOrderInherited: colour.minOrderQty == null && colour.fabric.minOrderQty != null,
        // Supplier
        supplierId: colour.supplierId,
        supplierName: colour.supplier?.name,
        // No children for colours
        children: undefined,
      }));

      return {
        id: fabric.id,
        type: 'fabric' as const,
        name: fabric.name,
        isActive: true, // Fabrics don't have isActive field currently
        parentId: fabric.materialId,
        materialId: fabric.materialId,
        materialName: fabric.material?.name,
        constructionType: fabric.constructionType,
        pattern: fabric.pattern,
        weight: fabric.weight,
        weightUnit: fabric.weightUnit,
        composition: fabric.composition,
        avgShrinkagePct: fabric.avgShrinkagePct,
        costPerUnit: fabric.costPerUnit,
        leadTimeDays: fabric.leadTimeDays,
        minOrderQty: fabric.minOrderQty,
        supplierId: fabric.supplierId,
        supplierName: fabric.supplier?.name,
        colourCount: fabric._count.colours,
        // Quantity unit: knit fabrics use kg, woven fabrics use m
        unit: fabric.unit || (fabric.constructionType === 'knit' ? 'kg' : 'm'),
        children: colourNodes.length > 0 ? colourNodes : undefined,
      };
    });

    return {
      id: material.id,
      type: 'material' as const,
      name: material.name,
      isActive: material.isActive,
      fabricCount: materialFabrics.length,
      colourCount: materialFabrics.reduce((acc, f) => acc + (coloursByFabric.get(f.id)?.length || 0), 0),
      children: fabricNodes.length > 0 ? fabricNodes : undefined,
    };
  });

  return res.json({
    items: tree,
    summary: {
      total: materials.length + allFabrics.length + allColours.length,
      materials: materials.length,
      fabrics: allFabrics.length,
      colours: allColours.length,
      orderNow: 0,
      orderSoon: 0,
      ok: allColours.length,
    },
  });
}));

/**
 * GET /materials/tree/:parentId/children
 * Lazy-loads children for a given parent node.
 * Used when lazyLoad=true to fetch children on expand.
 */
router.get('/tree/:parentId/children', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const parentId = req.params.parentId as string;
  const { parentType } = req.query;

  if (parentType === 'material') {
    // Return fabrics for this material
    const fabrics = await prisma.fabric.findMany({
      where: { materialId: parentId },
      include: {
        material: { select: { name: true } },
        supplier: { select: { id: true, name: true } },
        _count: { select: { colours: true } },
      },
      orderBy: { name: 'asc' },
    });

    const items = fabrics.map((f) => ({
      id: f.id,
      type: 'fabric' as const,
      name: f.name,
      parentId: f.materialId,
      materialId: f.materialId,
      materialName: f.material?.name,
      constructionType: f.constructionType,
      pattern: f.pattern,
      weight: f.weight,
      weightUnit: f.weightUnit,
      composition: f.composition,
      avgShrinkagePct: f.avgShrinkagePct,
      costPerUnit: f.costPerUnit,
      leadTimeDays: f.leadTimeDays,
      minOrderQty: f.minOrderQty,
      supplierId: f.supplierId,
      supplierName: f.supplier?.name,
      colourCount: f._count.colours,
      // Quantity unit: knit fabrics use kg, woven fabrics use m
      unit: f.unit || (f.constructionType === 'knit' ? 'kg' : 'm'),
      children: [], // Will be fetched on expand
    }));

    return res.json({ items, parentId, parentType: 'material' });
  }

  if (parentType === 'fabric') {
    // Return colours for this fabric
    const colours = await prisma.fabricColour.findMany({
      where: { fabricId: parentId },
      include: {
        fabric: {
          select: {
            id: true,
            name: true,
            materialId: true,
            costPerUnit: true,
            leadTimeDays: true,
            minOrderQty: true,
            material: { select: { name: true } },
          },
        },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { colourName: 'asc' },
    });

    const items = colours.map((c) => ({
      id: c.id,
      type: 'colour' as const,
      name: c.colourName,
      colourName: c.colourName,
      standardColour: c.standardColour,
      colourHex: c.colourHex,
      isActive: c.isActive,
      parentId: c.fabricId,
      fabricId: c.fabricId,
      fabricName: c.fabric.name,
      materialId: c.fabric.materialId,
      materialName: c.fabric.material?.name,
      costPerUnit: c.costPerUnit,
      leadTimeDays: c.leadTimeDays,
      minOrderQty: c.minOrderQty,
      inheritedCostPerUnit: c.fabric.costPerUnit,
      inheritedLeadTimeDays: c.fabric.leadTimeDays,
      inheritedMinOrderQty: c.fabric.minOrderQty,
      effectiveCostPerUnit: c.costPerUnit ?? c.fabric.costPerUnit,
      effectiveLeadTimeDays: c.leadTimeDays ?? c.fabric.leadTimeDays,
      effectiveMinOrderQty: c.minOrderQty ?? c.fabric.minOrderQty,
      costInherited: c.costPerUnit == null && c.fabric.costPerUnit != null,
      leadTimeInherited: c.leadTimeDays == null && c.fabric.leadTimeDays != null,
      minOrderInherited: c.minOrderQty == null && c.fabric.minOrderQty != null,
      supplierId: c.supplierId,
      supplierName: c.supplier?.name,
      children: undefined,
    }));

    return res.json({ items, parentId, parentType: 'fabric' });
  }

  return res.status(400).json({ error: 'Invalid parentType. Use "material" or "fabric".' });
}));

/**
 * GET /materials/filters
 * Returns filter options for the materials page
 */
router.get('/filters', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;

  const [materials, suppliers] = await Promise.all([
    prisma.material.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.supplier.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return res.json({ materials, suppliers });
}));

// ============================================
// MATERIAL CRUD (Level 1)
// ============================================

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  // Check for duplicate material name
  const existingMaterial = await prisma.material.findUnique({
    where: { name },
    select: { id: true },
  });

  if (existingMaterial) {
    return res.status(409).json({
      error: `A material named "${name}" already exists.`,
      existingMaterialId: existingMaterial.id,
    });
  }

  const material = await prisma.material.create({
    data: { name, description },
  });

  return res.status(201).json(material);
}));

router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const id = req.params.id as string;
  const { name, description, isActive } = req.body;

  const material = await prisma.material.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(isActive !== undefined && { isActive }),
    },
  });

  return res.json(material);
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const id = req.params.id as string;

  // Check for dependent fabrics
  const fabricCount = await prisma.fabric.count({
    where: { materialId: id },
  });

  if (fabricCount > 0) {
    return res.status(400).json({
      error: `Cannot delete: ${fabricCount} fabrics are linked to this material`,
    });
  }

  await prisma.material.delete({ where: { id: id as string } });
  return res.json({ success: true });
}));

// ============================================
// FABRIC CRUD (Level 2)
// ============================================

router.post('/fabrics', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const {
    materialId,
    fabricTypeId,
    name,
    colorName,
    constructionType,
    pattern,
    weight,
    weightUnit,
    composition,
    defaultCostPerUnit,
    defaultLeadTimeDays,
    defaultMinOrderQty,
    avgShrinkagePct,
  } = req.body;

  // materialId and name are required; fabricTypeId and colorName are optional
  // with defaults for backward compatibility
  if (!materialId || !name) {
    return res.status(400).json({ error: 'materialId and name are required' });
  }

  // Get default fabricTypeId if not provided
  let resolvedFabricTypeId = fabricTypeId;
  if (!resolvedFabricTypeId) {
    // Find or create a default fabric type based on construction
    const defaultTypeName = constructionType === 'knit' ? 'Default Knit' : 'Default Woven';
    let defaultType = await prisma.fabricType.findUnique({
      where: { name: defaultTypeName },
    });
    if (!defaultType) {
      defaultType = await prisma.fabricType.create({
        data: { name: defaultTypeName, unit: 'meters' },
      });
    }
    resolvedFabricTypeId = defaultType.id;
  }

  // Check for duplicate fabric name under the same material
  const existingFabric = await prisma.fabric.findFirst({
    where: { materialId, name },
    select: { id: true, name: true },
  });

  if (existingFabric) {
    return res.status(409).json({
      error: `A fabric named "${name}" already exists under this material. Please use a different name or add to the existing fabric.`,
      existingFabricId: existingFabric.id,
    });
  }

  // Auto-set quantity unit based on construction type:
  // - Knit fabrics use kg (weight-based)
  // - Woven fabrics use m (length-based)
  const qtyUnit = constructionType === 'knit' ? 'kg' : 'm';

  const fabric = await prisma.fabric.create({
    data: {
      materialId,
      fabricTypeId: resolvedFabricTypeId,
      name,
      colorName: colorName || 'Default', // Default colorName for new Material→Fabric→Colour architecture
      constructionType,
      pattern,
      weight: weight != null ? parseFloat(weight) : null,
      weightUnit,
      composition,
      costPerUnit: defaultCostPerUnit != null ? parseFloat(defaultCostPerUnit) : null,
      leadTimeDays: defaultLeadTimeDays != null ? parseInt(defaultLeadTimeDays) : null,
      minOrderQty: defaultMinOrderQty != null ? parseFloat(defaultMinOrderQty) : null,
      avgShrinkagePct: avgShrinkagePct != null ? parseFloat(avgShrinkagePct) : 0,
      unit: qtyUnit,
    },
  });

  return res.status(201).json(fabric);
}));

router.put('/fabrics/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const id = req.params.id as string;
  const data = req.body;

  // Get existing fabric for comparison
  const existingFabric = await prisma.fabric.findUnique({
    where: { id },
    select: { name: true, materialId: true },
  });

  if (!existingFabric) {
    return res.status(404).json({ error: 'Fabric not found' });
  }

  // Check for duplicate if name or materialId is changing
  const newName = data.name !== undefined ? data.name : existingFabric.name;
  const newMaterialId = data.materialId !== undefined ? data.materialId : existingFabric.materialId;

  if (newName !== existingFabric.name || newMaterialId !== existingFabric.materialId) {
    const duplicate = await prisma.fabric.findFirst({
      where: {
        materialId: newMaterialId,
        name: newName,
        NOT: { id },
      },
      select: { id: true },
    });

    if (duplicate) {
      return res.status(409).json({
        error: `A fabric named "${newName}" already exists under this material.`,
        existingFabricId: duplicate.id,
      });
    }
  }

  const updateData: Record<string, unknown> = {};

  if (data.name !== undefined) updateData.name = data.name;
  if (data.materialId !== undefined) updateData.materialId = data.materialId;
  if (data.constructionType !== undefined) {
    updateData.constructionType = data.constructionType;
    // Auto-update unit when construction type changes: knit=kg, woven=m
    updateData.unit = data.constructionType === 'knit' ? 'kg' : 'm';
  }
  if (data.pattern !== undefined) updateData.pattern = data.pattern;
  if (data.weight !== undefined) updateData.weight = data.weight != null ? parseFloat(data.weight) : null;
  if (data.weightUnit !== undefined) updateData.weightUnit = data.weightUnit;
  if (data.composition !== undefined) updateData.composition = data.composition;
  if (data.costPerUnit !== undefined) updateData.costPerUnit = data.costPerUnit != null ? parseFloat(data.costPerUnit) : null;
  if (data.leadTimeDays !== undefined) updateData.leadTimeDays = data.leadTimeDays != null ? parseInt(data.leadTimeDays) : null;
  if (data.minOrderQty !== undefined) updateData.minOrderQty = data.minOrderQty != null ? parseFloat(data.minOrderQty) : null;
  if (data.avgShrinkagePct !== undefined) updateData.avgShrinkagePct = data.avgShrinkagePct != null ? parseFloat(data.avgShrinkagePct) : 0;
  if (data.supplierId !== undefined) updateData.supplierId = data.supplierId || null;

  const fabric = await prisma.fabric.update({
    where: { id },
    data: updateData,
  });

  return res.json(fabric);
}));

router.delete('/fabrics/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const id = req.params.id as string;

  // Check for dependent colours
  const colourCount = await prisma.fabricColour.count({
    where: { fabricId: id },
  });

  if (colourCount > 0) {
    return res.status(400).json({
      error: `Cannot delete: ${colourCount} colours are linked to this fabric`,
    });
  }

  await prisma.fabric.delete({ where: { id: id as string } });
  return res.json({ success: true });
}));

// ============================================
// FABRIC COLOUR CRUD (Level 3)
// ============================================

router.post('/colours', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const {
    fabricId,
    colourName,
    standardColour,
    colourHex,
    costPerUnit,
    supplierId,
    leadTimeDays,
    minOrderQty,
  } = req.body;

  if (!fabricId || !colourName) {
    return res.status(400).json({ error: 'fabricId and colourName are required' });
  }

  // Check for duplicate colour name under the same fabric
  const existingColour = await prisma.fabricColour.findFirst({
    where: { fabricId, colourName },
    select: { id: true },
  });

  if (existingColour) {
    return res.status(409).json({
      error: `A colour named "${colourName}" already exists under this fabric.`,
      existingColourId: existingColour.id,
    });
  }

  const colour = await prisma.fabricColour.create({
    data: {
      fabricId,
      colourName,
      standardColour: standardColour || null,
      colourHex: colourHex || null,
      costPerUnit: costPerUnit != null ? parseFloat(costPerUnit) : null,
      supplierId: supplierId || null,
      leadTimeDays: leadTimeDays != null ? parseInt(leadTimeDays) : null,
      minOrderQty: minOrderQty != null ? parseFloat(minOrderQty) : null,
    },
  });

  return res.status(201).json(colour);
}));

router.put('/colours/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const id = req.params.id as string;
  const data = req.body;

  const updateData: Record<string, unknown> = {};

  if (data.colourName !== undefined) updateData.colourName = data.colourName;
  if (data.standardColour !== undefined) updateData.standardColour = data.standardColour || null;
  if (data.colourHex !== undefined) updateData.colourHex = data.colourHex || null;
  if (data.costPerUnit !== undefined) updateData.costPerUnit = data.costPerUnit != null ? parseFloat(data.costPerUnit) : null;
  if (data.supplierId !== undefined) updateData.supplierId = data.supplierId || null;
  if (data.leadTimeDays !== undefined) updateData.leadTimeDays = data.leadTimeDays != null ? parseInt(data.leadTimeDays) : null;
  if (data.minOrderQty !== undefined) updateData.minOrderQty = data.minOrderQty != null ? parseFloat(data.minOrderQty) : null;

  const colour = await prisma.fabricColour.update({
    where: { id },
    data: updateData,
  });

  return res.json(colour);
}));

router.delete('/colours/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const id = req.params.id as string;

  // Check for BOM references
  const bomCount = await prisma.variationBomLine.count({
    where: { fabricColourId: id },
  });

  if (bomCount > 0) {
    return res.status(400).json({
      error: `Cannot delete: ${bomCount} BOM lines reference this colour`,
    });
  }

  await prisma.fabricColour.delete({ where: { id: id as string } });
  return res.json({ success: true });
}));

// Note: FabricColour transactions would use fabricTransaction model if inventory tracking is needed
// Currently commenting out as FabricColour doesn't have stockQty field

// ============================================
// TRIMS CATALOG
// ============================================

router.get('/trims', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const { category, search } = req.query;

  const trims = await prisma.trimItem.findMany({
    where: {
      ...(category && { category: category as string }),
      ...(search && {
        OR: [
          { name: { contains: search as string, mode: 'insensitive' } },
          { code: { contains: search as string, mode: 'insensitive' } },
        ],
      }),
    },
    include: {
      supplier: { select: { id: true, name: true } },
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  const items = trims.map((t) => ({
    ...t,
    supplierName: t.supplier?.name,
  }));

  return res.json({ items });
}));

router.post('/trims', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const { code, name, category, description, costPerUnit, unit, supplierId, leadTimeDays, minOrderQty } = req.body;

  if (!code || !name || !category || costPerUnit == null || !unit) {
    return res.status(400).json({ error: 'code, name, category, costPerUnit, and unit are required' });
  }

  const trim = await prisma.trimItem.create({
    data: {
      code,
      name,
      category,
      description: description || null,
      costPerUnit: parseFloat(costPerUnit),
      unit,
      supplierId: supplierId || null,
      leadTimeDays: leadTimeDays != null ? parseInt(leadTimeDays) : null,
      minOrderQty: minOrderQty != null ? parseFloat(minOrderQty) : null,
    },
  });

  return res.status(201).json(trim);
}));

router.put('/trims/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const id = req.params.id as string;
  const data = req.body;

  const updateData: Record<string, unknown> = {};

  if (data.code !== undefined) updateData.code = data.code;
  if (data.name !== undefined) updateData.name = data.name;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.description !== undefined) updateData.description = data.description || null;
  if (data.costPerUnit !== undefined) updateData.costPerUnit = parseFloat(data.costPerUnit);
  if (data.unit !== undefined) updateData.unit = data.unit;
  if (data.supplierId !== undefined) updateData.supplierId = data.supplierId || null;
  if (data.leadTimeDays !== undefined) updateData.leadTimeDays = data.leadTimeDays != null ? parseInt(data.leadTimeDays) : null;
  if (data.minOrderQty !== undefined) updateData.minOrderQty = data.minOrderQty != null ? parseFloat(data.minOrderQty) : null;

  const trim = await prisma.trimItem.update({
    where: { id },
    data: updateData,
  });

  return res.json(trim);
}));

router.delete('/trims/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const id = req.params.id as string;

  // Check for BOM references
  const bomCount = await prisma.productBomTemplate.count({
    where: { trimItemId: id },
  });

  if (bomCount > 0) {
    return res.status(400).json({
      error: `Cannot delete: ${bomCount} BOM templates reference this trim`,
    });
  }

  await prisma.trimItem.delete({ where: { id } });
  return res.json({ success: true });
}));

// ============================================
// SERVICES CATALOG
// ============================================

router.get('/services', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const { category, search } = req.query;

  const services = await prisma.serviceItem.findMany({
    where: {
      ...(category && { category: category as string }),
      ...(search && {
        OR: [
          { name: { contains: search as string, mode: 'insensitive' } },
          { code: { contains: search as string, mode: 'insensitive' } },
        ],
      }),
    },
    include: {
      vendor: { select: { id: true, name: true } },
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  const items = services.map((s) => ({
    ...s,
    vendorName: s.vendor?.name,
  }));

  return res.json({ items });
}));

router.post('/services', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const { code, name, category, description, costPerJob, costUnit, vendorId, leadTimeDays } = req.body;

  if (!code || !name || !category || costPerJob == null) {
    return res.status(400).json({ error: 'code, name, category, and costPerJob are required' });
  }

  const service = await prisma.serviceItem.create({
    data: {
      code,
      name,
      category,
      description: description || null,
      costPerJob: parseFloat(costPerJob),
      costUnit: costUnit || 'per_piece',
      vendorId: vendorId || null,
      leadTimeDays: leadTimeDays != null ? parseInt(leadTimeDays) : null,
    },
  });

  return res.status(201).json(service);
}));

router.put('/services/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const id = req.params.id as string;
  const data = req.body;

  const updateData: Record<string, unknown> = {};

  if (data.code !== undefined) updateData.code = data.code;
  if (data.name !== undefined) updateData.name = data.name;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.description !== undefined) updateData.description = data.description || null;
  if (data.costPerJob !== undefined) updateData.costPerJob = parseFloat(data.costPerJob);
  if (data.costUnit !== undefined) updateData.costUnit = data.costUnit;
  if (data.vendorId !== undefined) updateData.vendorId = data.vendorId || null;
  if (data.leadTimeDays !== undefined) updateData.leadTimeDays = data.leadTimeDays != null ? parseInt(data.leadTimeDays) : null;

  const service = await prisma.serviceItem.update({
    where: { id },
    data: updateData,
  });

  return res.json(service);
}));

router.delete('/services/:id', asyncHandler(async (req: Request, res: Response) => {
  const { prisma } = req;
  const id = req.params.id as string;

  // Check for BOM references
  const bomCount = await prisma.productBomTemplate.count({
    where: { serviceItemId: id },
  });

  if (bomCount > 0) {
    return res.status(400).json({
      error: `Cannot delete: ${bomCount} BOM templates reference this service`,
    });
  }

  await prisma.serviceItem.delete({ where: { id } });
  return res.json({ success: true });
}));

export default router;
