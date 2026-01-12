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
    fabricConsumption?: string;
    targetStockQty?: string;
    isActive?: string;
}

/**
 * CSV row for fabric export/import
 */
interface FabricCsvRow {
    fabricTypeName: string;
    fabricTypeComposition?: string;
    fabricTypeUnit?: string;
    colorName: string;
    standardColor?: string;
    colorHex?: string;
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
        const products = await req.prisma.product.findMany({
            include: {
                variations: {
                    include: {
                        fabric: { include: { fabricType: true } },
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
                        fabricTypeName: variation.fabric?.fabricType?.name || '',
                        fabricColorName: variation.fabric?.colorName || '',
                        skuCode: sku.skuCode,
                        size: sku.size,
                        mrp: sku.mrp,
                        fabricConsumption: sku.fabricConsumption,
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

                // Find fabric by type and color name
                let fabricId: string | null = null;
                if (row.fabricTypeName && row.fabricColorName) {
                    const fabric = await req.prisma.fabric.findFirst({
                        where: {
                            colorName: row.fabricColorName,
                            fabricType: { name: row.fabricTypeName },
                        },
                    });
                    fabricId = fabric?.id ?? null;
                }

                // Find or create variation
                let variation = await req.prisma.variation.findFirst({
                    where: {
                        productId: product.id,
                        colorName: row.colorName || 'Default',
                    },
                });

                if (!variation) {
                    // Need a fabric for variation - use first available if not specified
                    if (!fabricId) {
                        const anyFabric = await req.prisma.fabric.findFirst();
                        fabricId = anyFabric?.id ?? null;
                    }

                    if (!fabricId) {
                        results.errors.push(`Row ${rowNum}: No fabric available for variation`);
                        results.skipped++;
                        continue;
                    }

                    variation = await req.prisma.variation.create({
                        data: {
                            productId: product.id,
                            colorName: row.colorName || 'Default',
                            standardColor: row.standardColor || null,
                            colorHex: row.colorHex || null,
                            fabricId,
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
                            fabricConsumption: parseFloat(row.fabricConsumption || '0') || sku.fabricConsumption,
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
                            fabricConsumption: parseFloat(row.fabricConsumption || '1.5') || 1.5,
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
        const fabrics = await req.prisma.fabric.findMany({
            include: {
                fabricType: true,
                supplier: true,
            },
            orderBy: { name: 'asc' },
        });

        const rows = fabrics.map((fabric) => ({
            fabricTypeName: fabric.fabricType?.name || '',
            fabricTypeComposition: fabric.fabricType?.composition || '',
            fabricTypeUnit: fabric.fabricType?.unit || 'meter',
            colorName: fabric.colorName,
            standardColor: fabric.standardColor || '',
            colorHex: fabric.colorHex || '',
            costPerUnit: fabric.costPerUnit,
            supplierName: fabric.supplier?.name || '',
            leadTimeDays: fabric.leadTimeDays,
            minOrderQty: fabric.minOrderQty,
            isActive: fabric.isActive ? 'true' : 'false',
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

        const results: ImportResults = {
            created: { fabricTypes: 0, fabrics: 0, suppliers: 0 },
            updated: { fabrics: 0 },
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
                if (!row.fabricTypeName || !row.colorName) {
                    results.errors.push(`Row ${rowNum}: Missing required fields (fabricTypeName, colorName)`);
                    results.skipped++;
                    continue;
                }

                // Find or create fabric type
                let fabricType = await req.prisma.fabricType.findFirst({
                    where: { name: row.fabricTypeName },
                });

                if (!fabricType) {
                    fabricType = await req.prisma.fabricType.create({
                        data: {
                            name: row.fabricTypeName,
                            composition: row.fabricTypeComposition || null,
                            unit: row.fabricTypeUnit || 'meter',
                            avgShrinkagePct: 0,
                        },
                    });
                    results.created.fabricTypes++;
                }

                // Find or create supplier
                let supplierId: string | null = null;
                if (row.supplierName) {
                    let supplier = await req.prisma.supplier.findFirst({
                        where: { name: row.supplierName },
                    });

                    if (!supplier) {
                        supplier = await req.prisma.supplier.create({
                            data: { name: row.supplierName },
                        });
                        results.created.suppliers++;
                    }
                    supplierId = supplier.id;
                }

                // Find or create fabric
                const fabric = await req.prisma.fabric.findFirst({
                    where: {
                        fabricTypeId: fabricType.id,
                        colorName: row.colorName,
                    },
                });

                if (fabric) {
                    await req.prisma.fabric.update({
                        where: { id: fabric.id },
                        data: {
                            standardColor: row.standardColor || fabric.standardColor,
                            colorHex: row.colorHex || fabric.colorHex,
                            costPerUnit: parseFloat(row.costPerUnit || '0') || fabric.costPerUnit,
                            supplierId: supplierId || fabric.supplierId,
                            leadTimeDays: parseInt(row.leadTimeDays || '0') || fabric.leadTimeDays,
                            minOrderQty: parseFloat(row.minOrderQty || '0') || fabric.minOrderQty,
                            isActive: row.isActive === 'false' ? false : true,
                        },
                    });
                    results.updated.fabrics++;
                } else {
                    await req.prisma.fabric.create({
                        data: {
                            fabricTypeId: fabricType.id,
                            name: `${row.fabricTypeName} - ${row.colorName}`,
                            colorName: row.colorName,
                            standardColor: row.standardColor || null,
                            colorHex: row.colorHex || null,
                            costPerUnit: parseFloat(row.costPerUnit || '0') || 0,
                            supplierId,
                            leadTimeDays: parseInt(row.leadTimeDays || '14') || 14,
                            minOrderQty: parseFloat(row.minOrderQty || '10') || 10,
                            isActive: row.isActive === 'false' ? false : true,
                        },
                    });
                    results.created.fabrics++;
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
