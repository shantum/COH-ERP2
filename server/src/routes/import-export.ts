/**
 * @fileoverview Import/Export Routes - Handles CSV import and export for products, fabrics, and inventory
 *
 * Export Features:
 * - Products: Flattened hierarchy (Product -> Variation -> SKU)
 * - Fabrics: Fabric types with supplier info
 * - Inventory: Last 10k transaction history
 *
 * Import Features:
 * - Products: Creates/updates Products, Variations, and SKUs from CSV
 * - Fabrics: Creates/updates FabricTypes, Suppliers, and Fabrics from CSV
 *
 * Key Patterns:
 * - Streaming CSV exports (no asyncHandler to avoid response issues)
 * - Multer memory storage for file uploads (5MB limit)
 * - Row-by-row processing with error collection
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { parse, format } from 'fast-csv';
import multer from 'multer';
import { Readable } from 'stream';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Result structure for import operations
 */
interface ImportResults {
    created: Record<string, number>;
    updated: Record<string, number>;
    skipped: number;
    errors: string[];
}

/**
 * CSV row for product export/import
 * Note: skuCode is also used as barcode for scanning (no separate barcode field)
 */
interface ProductCsvRow {
    productName: string;
    category?: string;
    productType?: string;
    gender?: string;
    productionTimeMins?: string;
    colorName?: string;
    standardColor?: string;
    colorHex?: string;
    fabricTypeName?: string;
    fabricColorName?: string;
    skuCode: string;
    size: string;
    mrp?: string;
    targetStockQty?: string;
    isActive?: string;
}

/**
 * CSV row for fabric export/import
 * Supports both old format (fabricTypeName, colorName) and new format (materialName, colourName)
 */
interface FabricCsvRow {
    // New format (3-tier: Material > Fabric > FabricColour)
    materialName?: string;
    fabricName?: string;
    fabricUnit?: string;
    colourName?: string;
    standardColour?: string;
    colourHex?: string;
    // Legacy format (backward compatibility)
    fabricTypeName?: string;
    fabricTypeComposition?: string;
    fabricTypeUnit?: string;
    colorName?: string;
    standardColor?: string;
    colorHex?: string;
    // Common fields
    costPerUnit?: string;
    supplierName?: string;
    leadTimeDays?: string;
    minOrderQty?: string;
    isActive?: string;
}

// Configure multer for file uploads (memory storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    },
});

// ============================================
// PRODUCT EXPORT
// ============================================

router.get('/export/products', authenticateToken, async (req: Request, res: Response) => {
    try {
        // NOTE: fabric/fabricType removed from schema - fabric assignment now via BOM
        const products = await req.prisma.product.findMany({
            include: {
                variations: {
                    include: {
                        skus: true,
                    },
                },
            },
            orderBy: { name: 'asc' },
        });

        // Flatten the hierarchy into rows
        const rows: Record<string, string | number>[] = [];
        for (const product of products) {
            for (const variation of product.variations) {
                for (const sku of variation.skus) {
                    rows.push({
                        productName: product.name,
                        category: product.category,
                        productType: product.productType,
                        gender: product.gender,
                        productionTimeMins: product.baseProductionTimeMins,
                        colorName: variation.colorName,
                        standardColor: variation.standardColor || '',
                        colorHex: variation.colorHex || '',
                        fabricTypeName: '',  // Removed - fabric assignment now via BOM
                        fabricColorName: '',  // Removed - fabric assignment now via BOM
                        skuCode: sku.skuCode,
                        size: sku.size,
                        mrp: sku.mrp,
                        targetStockQty: sku.targetStockQty,
                        isActive: sku.isActive ? 'true' : 'false',
                    });
                }
            }
        }

        // Set headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=products-export.csv');

        // Stream CSV response
        const csvStream = format({ headers: true });
        csvStream.pipe(res);
        rows.forEach((row) => csvStream.write(row));
        csvStream.end();
    } catch (error) {
        console.error('Export products error:', error);
        res.status(500).json({ error: 'Failed to export products' });
    }
});

// ============================================
// PRODUCT IMPORT
// ============================================

router.post('/import/products', authenticateToken, upload.single('file'), async (req: Request, res: Response) => {
    try {
        const file = req.file as Express.Multer.File | undefined;
        if (!file) {
            res.status(400).json({ error: 'No file uploaded' });
            return;
        }

        const results: ImportResults = {
            created: { products: 0, variations: 0, skus: 0 },
            updated: { skus: 0 },
            skipped: 0,
            errors: [],
        };

        // Parse CSV from buffer
        const rows: ProductCsvRow[] = [];
        await new Promise<void>((resolve, reject) => {
            const stream = Readable.from(file.buffer.toString());
            stream
                .pipe(parse({ headers: true, trim: true }))
                .on('data', (row: ProductCsvRow) => rows.push(row))
                .on('end', resolve)
                .on('error', reject);
        });

        // Process each row
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2; // Account for header row

            try {
                // Validate required fields
                if (!row.productName || !row.skuCode || !row.size) {
                    results.errors.push(`Row ${rowNum}: Missing required fields (productName, skuCode, size)`);
                    results.skipped++;
                    continue;
                }

                // Find or create product
                let product = await req.prisma.product.findFirst({
                    where: { name: row.productName },
                });

                if (!product) {
                    product = await req.prisma.product.create({
                        data: {
                            name: row.productName,
                            category: row.category || 'dress',
                            productType: row.productType || 'basic',
                            gender: row.gender || 'unisex',
                            baseProductionTimeMins: parseInt(row.productionTimeMins || '60') || 60,
                        },
                    });
                    results.created.products++;
                }

                // NOTE: fabric/fabricType removed from variation - fabric assignment now via BOM

                // Find or create variation
                let variation = await req.prisma.variation.findFirst({
                    where: {
                        productId: product.id,
                        colorName: row.colorName || 'Default',
                    },
                });

                if (!variation) {
                    variation = await req.prisma.variation.create({
                        data: {
                            productId: product.id,
                            colorName: row.colorName || 'Default',
                            standardColor: row.standardColor || null,
                            colorHex: row.colorHex || null,
                        },
                    });
                    results.created.variations++;
                }

                // Find or create SKU
                const sku = await req.prisma.sku.findUnique({
                    where: { skuCode: row.skuCode },
                });

                if (sku) {
                    // Update existing SKU
                    await req.prisma.sku.update({
                        where: { id: sku.id },
                        data: {
                            mrp: parseFloat(row.mrp || '0') || sku.mrp,
                            targetStockQty: parseInt(row.targetStockQty || '0') || sku.targetStockQty,
                            isActive: row.isActive === 'false' ? false : true,
                        },
                    });
                    results.updated.skus++;
                } else {
                    // Create new SKU
                    await req.prisma.sku.create({
                        data: {
                            variationId: variation.id,
                            skuCode: row.skuCode,
                            size: row.size,
                            mrp: parseFloat(row.mrp || '0') || 0,
                            targetStockQty: parseInt(row.targetStockQty || '10') || 10,
                            isActive: row.isActive === 'false' ? false : true,
                        },
                    });
                    results.created.skus++;
                }
            } catch (rowError) {
                const errorMessage = rowError instanceof Error ? rowError.message : 'Unknown error';
                results.errors.push(`Row ${rowNum}: ${errorMessage}`);
                results.skipped++;
            }
        }

        res.json({
            message: 'Import completed',
            totalRows: rows.length,
            results,
        });
    } catch (error) {
        console.error('Import products error:', error);
        res.status(500).json({ error: 'Failed to import products' });
    }
});

// ============================================
// FABRIC EXPORT
// ============================================

router.get('/export/fabrics', authenticateToken, async (req: Request, res: Response) => {
    try {
        // NOTE: FabricType removed - now using Material > Fabric > FabricColour hierarchy
        // Export FabricColour with parent Fabric and Material info
        const fabricColours = await req.prisma.fabricColour.findMany({
            include: {
                fabric: {
                    include: {
                        material: true,
                    },
                },
                party: true,
            },
            orderBy: { colourName: 'asc' },
        });

        const rows = fabricColours.map((fc) => ({
            materialName: fc.fabric?.material?.name || '',
            fabricName: fc.fabric?.name || '',
            fabricUnit: fc.fabric?.unit || 'meters',
            colourName: fc.colourName,
            standardColour: fc.standardColour || '',
            colourHex: fc.colourHex || '',
            costPerUnit: fc.costPerUnit ?? fc.fabric?.costPerUnit ?? 0,
            supplierName: fc.party?.name || '',
            leadTimeDays: fc.leadTimeDays ?? fc.fabric?.defaultLeadTimeDays ?? 14,
            minOrderQty: fc.minOrderQty ?? fc.fabric?.defaultMinOrderQty ?? 10,
            isActive: fc.isActive ? 'true' : 'false',
        }));

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=fabrics-export.csv');

        const csvStream = format({ headers: true });
        csvStream.pipe(res);
        rows.forEach((row) => csvStream.write(row));
        csvStream.end();
    } catch (error) {
        console.error('Export fabrics error:', error);
        res.status(500).json({ error: 'Failed to export fabrics' });
    }
});

// ============================================
// FABRIC IMPORT
// ============================================

router.post('/import/fabrics', authenticateToken, upload.single('file'), async (req: Request, res: Response) => {
    try {
        const file = req.file as Express.Multer.File | undefined;
        if (!file) {
            res.status(400).json({ error: 'No file uploaded' });
            return;
        }

        // NOTE: FabricType removed - now using Material > Fabric > FabricColour hierarchy
        const results: ImportResults = {
            created: { materials: 0, fabrics: 0, fabricColours: 0, suppliers: 0 },
            updated: { fabricColours: 0 },
            skipped: 0,
            errors: [],
        };

        const rows: FabricCsvRow[] = [];
        await new Promise<void>((resolve, reject) => {
            const stream = Readable.from(file.buffer.toString());
            stream
                .pipe(parse({ headers: true, trim: true }))
                .on('data', (row: FabricCsvRow) => rows.push(row))
                .on('end', resolve)
                .on('error', reject);
        });

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2;

            try {
                // Support both old format (fabricTypeName) and new format (materialName)
                const materialName = row.materialName || row.fabricTypeName;
                const fabricName = row.fabricName || materialName;  // Default fabric name = material name
                const colourName = row.colourName || row.colorName;

                if (!materialName || !colourName) {
                    results.errors.push(`Row ${rowNum}: Missing required fields (materialName/fabricTypeName, colourName/colorName)`);
                    results.skipped++;
                    continue;
                }

                // Find or create material
                let material = await req.prisma.material.findFirst({
                    where: { name: materialName },
                });

                if (!material) {
                    material = await req.prisma.material.create({
                        data: { name: materialName },
                    });
                    results.created.materials++;
                }

                // Find or create fabric
                const fabricNameFinal = fabricName || materialName;  // Ensure non-undefined
                let fabric = await req.prisma.fabric.findFirst({
                    where: {
                        materialId: material.id,
                        name: fabricNameFinal,
                    },
                });

                if (!fabric) {
                    fabric = await req.prisma.fabric.create({
                        data: {
                            materialId: material.id,
                            name: fabricNameFinal,
                            colorName: colourName,  // Required field on Fabric model
                            unit: row.fabricUnit || row.fabricTypeUnit || 'meters',
                            costPerUnit: parseFloat(row.costPerUnit || '0') || null,
                            defaultLeadTimeDays: parseInt(row.leadTimeDays || '14') || 14,
                            defaultMinOrderQty: parseFloat(row.minOrderQty || '10') || 10,
                        },
                    });
                    results.created.fabrics++;
                }

                // Find or create party (fabric supplier)
                let partyId: string | null = null;
                if (row.supplierName) {
                    let party = await req.prisma.party.findFirst({
                        where: { name: row.supplierName },
                    });

                    if (!party) {
                        party = await req.prisma.party.create({
                            data: { name: row.supplierName, category: 'fabric' },
                        });
                        results.created.suppliers++;
                    }
                    partyId = party.id;
                }

                // Find or create fabric colour
                const fabricColour = await req.prisma.fabricColour.findFirst({
                    where: {
                        fabricId: fabric.id,
                        colourName: colourName,
                    },
                });

                if (fabricColour) {
                    await req.prisma.fabricColour.update({
                        where: { id: fabricColour.id },
                        data: {
                            standardColour: row.standardColour || row.standardColor || fabricColour.standardColour,
                            colourHex: row.colourHex || row.colorHex || fabricColour.colourHex,
                            costPerUnit: parseFloat(row.costPerUnit || '0') || fabricColour.costPerUnit,
                            partyId: partyId || fabricColour.partyId,
                            leadTimeDays: parseInt(row.leadTimeDays || '0') || fabricColour.leadTimeDays,
                            minOrderQty: parseFloat(row.minOrderQty || '0') || fabricColour.minOrderQty,
                            isActive: row.isActive === 'false' ? false : true,
                        },
                    });
                    results.updated.fabricColours++;
                } else {
                    await req.prisma.fabricColour.create({
                        data: {
                            fabricId: fabric.id,
                            colourName: colourName,
                            standardColour: row.standardColour || row.standardColor || null,
                            colourHex: row.colourHex || row.colorHex || null,
                            costPerUnit: parseFloat(row.costPerUnit || '0') || null,
                            partyId,
                            leadTimeDays: parseInt(row.leadTimeDays || '14') || null,
                            minOrderQty: parseFloat(row.minOrderQty || '10') || null,
                            isActive: row.isActive === 'false' ? false : true,
                        },
                    });
                    results.created.fabricColours++;
                }
            } catch (rowError) {
                const errorMessage = rowError instanceof Error ? rowError.message : 'Unknown error';
                results.errors.push(`Row ${rowNum}: ${errorMessage}`);
                results.skipped++;
            }
        }

        res.json({
            message: 'Import completed',
            totalRows: rows.length,
            results,
        });
    } catch (error) {
        console.error('Import fabrics error:', error);
        res.status(500).json({ error: 'Failed to import fabrics' });
    }
});

// ============================================
// INVENTORY EXPORT
// ============================================

router.get('/export/inventory', authenticateToken, async (req: Request, res: Response) => {
    try {
        const transactions = await req.prisma.inventoryTransaction.findMany({
            include: {
                sku: {
                    include: {
                        variation: {
                            include: { product: true },
                        },
                    },
                },
                createdBy: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 10000, // Limit to last 10k transactions
        });

        const rows = transactions.map((txn) => ({
            skuCode: txn.sku?.skuCode || '',
            productName: txn.sku?.variation?.product?.name || '',
            colorName: txn.sku?.variation?.colorName || '',
            size: txn.sku?.size || '',
            txnType: txn.txnType,
            qty: txn.qty,
            reason: txn.reason,
            referenceId: txn.referenceId || '',
            notes: txn.notes || '',
            warehouseLocation: txn.warehouseLocation || '',
            createdBy: txn.createdBy?.name || 'System',
            createdAt: txn.createdAt.toISOString(),
        }));

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=inventory-transactions.csv');

        const csvStream = format({ headers: true });
        csvStream.pipe(res);
        rows.forEach((row) => csvStream.write(row));
        csvStream.end();
    } catch (error) {
        console.error('Export inventory error:', error);
        res.status(500).json({ error: 'Failed to export inventory' });
    }
});

export default router;
