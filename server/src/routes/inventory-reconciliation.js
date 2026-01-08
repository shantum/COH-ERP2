/**
 * Inventory Reconciliation Routes
 *
 * Physical inventory count reconciliation workflow:
 * 1. Start count - creates reconciliation with all active SKUs + system balances
 * 2. Enter physical quantities (manual or CSV upload)
 * 3. Save progress
 * 4. Submit - creates InventoryTransaction for each variance
 */

import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { authenticateToken } from '../middleware/auth.js';
import { calculateAllInventoryBalances } from '../utils/queryPatterns.js';

const router = express.Router();

// Configure multer for CSV upload
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'), false);
        }
    },
});

// ============================================
// RECONCILIATION ENDPOINTS
// ============================================

/**
 * GET /reconciliation/history
 * Get history of past reconciliations
 */
router.get('/reconciliation/history', authenticateToken, async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const reconciliations = await req.prisma.inventoryReconciliation.findMany({
            include: { items: true },
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
        });

        const history = reconciliations.map(r => ({
            id: r.id,
            date: r.reconcileDate,
            status: r.status,
            itemsCount: r.items.length,
            adjustments: r.items.filter(i => i.variance !== 0 && i.variance !== null).length,
            createdBy: r.createdBy,
            createdAt: r.createdAt,
        }));

        res.json(history);
    } catch (error) {
        console.error('Get inventory reconciliation history error:', error);
        res.status(500).json({ error: 'Failed to fetch reconciliation history' });
    }
});

/**
 * POST /reconciliation/start
 * Start a new reconciliation with all active, non-custom SKUs
 */
router.post('/reconciliation/start', authenticateToken, async (req, res) => {
    try {
        // Get all active, non-custom SKUs
        const skus = await req.prisma.sku.findMany({
            where: {
                isActive: true,
                isCustomSku: false,
            },
            include: {
                variation: {
                    include: { product: true },
                },
            },
            orderBy: { skuCode: 'asc' },
        });

        // Calculate all balances efficiently in one query
        const balanceMap = await calculateAllInventoryBalances(
            req.prisma,
            skus.map(s => s.id),
            { excludeCustomSkus: true }
        );

        // Create reconciliation with items
        const reconciliation = await req.prisma.inventoryReconciliation.create({
            data: {
                createdBy: req.user?.id || null,
                items: {
                    create: skus.map(sku => ({
                        skuId: sku.id,
                        systemQty: balanceMap.get(sku.id)?.currentBalance || 0,
                    })),
                },
            },
            include: {
                items: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true } },
                            },
                        },
                    },
                },
            },
        });

        // Format response
        const response = {
            id: reconciliation.id,
            status: reconciliation.status,
            createdAt: reconciliation.createdAt,
            items: reconciliation.items.map(item => ({
                id: item.id,
                skuId: item.skuId,
                skuCode: item.sku.skuCode,
                productName: item.sku.variation?.product?.name || '',
                colorName: item.sku.variation?.colorName || '',
                size: item.sku.size,
                systemQty: item.systemQty,
                physicalQty: item.physicalQty,
                variance: item.variance,
                adjustmentReason: item.adjustmentReason,
                notes: item.notes,
            })),
        };

        res.status(201).json(response);
    } catch (error) {
        console.error('Start inventory reconciliation error:', error);
        res.status(500).json({ error: 'Failed to start reconciliation' });
    }
});

/**
 * GET /reconciliation/:id
 * Get a specific reconciliation with items
 */
router.get('/reconciliation/:id', authenticateToken, async (req, res) => {
    try {
        const reconciliation = await req.prisma.inventoryReconciliation.findUnique({
            where: { id: req.params.id },
            include: {
                items: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true } },
                            },
                        },
                    },
                },
            },
        });

        if (!reconciliation) {
            return res.status(404).json({ error: 'Reconciliation not found' });
        }

        const response = {
            id: reconciliation.id,
            status: reconciliation.status,
            notes: reconciliation.notes,
            createdAt: reconciliation.createdAt,
            items: reconciliation.items.map(item => ({
                id: item.id,
                skuId: item.skuId,
                skuCode: item.sku.skuCode,
                productName: item.sku.variation?.product?.name || '',
                colorName: item.sku.variation?.colorName || '',
                size: item.sku.size,
                systemQty: item.systemQty,
                physicalQty: item.physicalQty,
                variance: item.variance,
                adjustmentReason: item.adjustmentReason,
                notes: item.notes,
            })),
        };

        res.json(response);
    } catch (error) {
        console.error('Get inventory reconciliation error:', error);
        res.status(500).json({ error: 'Failed to fetch reconciliation' });
    }
});

/**
 * PUT /reconciliation/:id
 * Update reconciliation items (physical quantities, reasons, notes)
 */
router.put('/reconciliation/:id', authenticateToken, async (req, res) => {
    try {
        const { items } = req.body;

        const reconciliation = await req.prisma.inventoryReconciliation.findUnique({
            where: { id: req.params.id },
        });

        if (!reconciliation) {
            return res.status(404).json({ error: 'Reconciliation not found' });
        }

        if (reconciliation.status !== 'draft') {
            return res.status(400).json({ error: 'Cannot update submitted reconciliation' });
        }

        // Update each item
        for (const item of items) {
            const variance = item.physicalQty !== null && item.physicalQty !== undefined
                ? item.physicalQty - item.systemQty
                : null;

            await req.prisma.inventoryReconciliationItem.update({
                where: { id: item.id },
                data: {
                    physicalQty: item.physicalQty,
                    variance,
                    adjustmentReason: item.adjustmentReason || null,
                    notes: item.notes || null,
                },
            });
        }

        // Return updated reconciliation
        const updated = await req.prisma.inventoryReconciliation.findUnique({
            where: { id: req.params.id },
            include: {
                items: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true } },
                            },
                        },
                    },
                },
            },
        });

        res.json({
            id: updated.id,
            status: updated.status,
            items: updated.items.map(item => ({
                id: item.id,
                skuId: item.skuId,
                skuCode: item.sku.skuCode,
                productName: item.sku.variation?.product?.name || '',
                colorName: item.sku.variation?.colorName || '',
                size: item.sku.size,
                systemQty: item.systemQty,
                physicalQty: item.physicalQty,
                variance: item.variance,
                adjustmentReason: item.adjustmentReason,
                notes: item.notes,
            })),
        });
    } catch (error) {
        console.error('Update inventory reconciliation error:', error);
        res.status(500).json({ error: 'Failed to update reconciliation' });
    }
});

/**
 * POST /reconciliation/:id/submit
 * Submit reconciliation and create adjustment transactions
 */
router.post('/reconciliation/:id/submit', authenticateToken, async (req, res) => {
    try {
        const reconciliation = await req.prisma.inventoryReconciliation.findUnique({
            where: { id: req.params.id },
            include: {
                items: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true } },
                            },
                        },
                    },
                },
            },
        });

        if (!reconciliation) {
            return res.status(404).json({ error: 'Reconciliation not found' });
        }

        if (reconciliation.status !== 'draft') {
            return res.status(400).json({ error: 'Reconciliation already submitted' });
        }

        const transactions = [];

        // Create adjustment transactions for variances
        for (const item of reconciliation.items) {
            if (item.variance === null || item.variance === 0) continue;

            if (item.physicalQty === null) {
                return res.status(400).json({
                    error: `Physical quantity not entered for ${item.sku.skuCode}`,
                });
            }

            if (!item.adjustmentReason && item.variance !== 0) {
                return res.status(400).json({
                    error: `Adjustment reason required for ${item.sku.skuCode} (variance: ${item.variance})`,
                });
            }

            // Positive variance (overage) = inward, Negative variance (shortage) = outward
            const txnType = item.variance > 0 ? 'inward' : 'outward';
            const qty = Math.abs(item.variance);
            const reason = `reconciliation_${item.adjustmentReason}`;

            const txn = await req.prisma.inventoryTransaction.create({
                data: {
                    skuId: item.skuId,
                    txnType,
                    qty,
                    reason,
                    referenceId: reconciliation.id,
                    notes: item.notes || `Reconciliation adjustment: ${item.adjustmentReason}`,
                    createdById: req.user.id,
                },
            });

            transactions.push({
                skuId: item.skuId,
                skuCode: item.sku.skuCode,
                txnType,
                qty,
                reason: item.adjustmentReason,
            });

            // Link transaction to item
            await req.prisma.inventoryReconciliationItem.update({
                where: { id: item.id },
                data: { txnId: txn.id },
            });
        }

        // Mark reconciliation as submitted
        await req.prisma.inventoryReconciliation.update({
            where: { id: req.params.id },
            data: { status: 'submitted' },
        });

        res.json({
            id: reconciliation.id,
            status: 'submitted',
            adjustmentsMade: transactions.length,
            transactions,
        });
    } catch (error) {
        console.error('Submit inventory reconciliation error:', error);
        res.status(500).json({ error: 'Failed to submit reconciliation' });
    }
});

/**
 * DELETE /reconciliation/:id
 * Delete a draft reconciliation
 */
router.delete('/reconciliation/:id', authenticateToken, async (req, res) => {
    try {
        const reconciliation = await req.prisma.inventoryReconciliation.findUnique({
            where: { id: req.params.id },
        });

        if (!reconciliation) {
            return res.status(404).json({ error: 'Reconciliation not found' });
        }

        if (reconciliation.status !== 'draft') {
            return res.status(400).json({ error: 'Cannot delete submitted reconciliation' });
        }

        await req.prisma.inventoryReconciliation.delete({
            where: { id: req.params.id },
        });

        res.json({ message: 'Reconciliation deleted' });
    } catch (error) {
        console.error('Delete inventory reconciliation error:', error);
        res.status(500).json({ error: 'Failed to delete reconciliation' });
    }
});

/**
 * POST /reconciliation/:id/upload-csv
 * Upload CSV with physical counts to update reconciliation items
 * Expected format: SKU Code, Physical Qty
 */
router.post('/reconciliation/:id/upload-csv', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const reconciliation = await req.prisma.inventoryReconciliation.findUnique({
            where: { id: req.params.id },
            include: {
                items: {
                    include: { sku: true },
                },
            },
        });

        if (!reconciliation) {
            return res.status(404).json({ error: 'Reconciliation not found' });
        }

        if (reconciliation.status !== 'draft') {
            return res.status(400).json({ error: 'Cannot update submitted reconciliation' });
        }

        // Parse CSV - handle BOM
        let csvContent = req.file.buffer.toString('utf-8');
        if (csvContent.charCodeAt(0) === 0xFEFF) {
            csvContent = csvContent.slice(1);
        }

        let records;
        try {
            records = parse(csvContent, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                bom: true,
            });
        } catch (parseError) {
            return res.status(400).json({ error: `CSV parsing error: ${parseError.message}` });
        }

        // Build SKU code -> item mapping (case-insensitive)
        const skuMap = new Map();
        for (const item of reconciliation.items) {
            skuMap.set(item.sku.skuCode.toLowerCase(), item);
        }

        const results = {
            total: records.length,
            matched: 0,
            updated: 0,
            notFound: [],
            errors: [],
        };

        // Process each row - flexible column name matching
        for (const record of records) {
            const skuCode = (
                record['SKU Code'] ||
                record['skuCode'] ||
                record['sku_code'] ||
                record['SKU'] ||
                record['sku'] ||
                ''
            ).trim();

            const physicalQtyStr = (
                record['Physical Qty'] ||
                record['physicalQty'] ||
                record['physical_qty'] ||
                record['Qty'] ||
                record['qty'] ||
                record['Quantity'] ||
                record['quantity'] ||
                ''
            ).toString().trim();

            if (!skuCode) {
                results.errors.push({ record, error: 'Missing SKU Code' });
                continue;
            }

            const item = skuMap.get(skuCode.toLowerCase());
            if (!item) {
                results.notFound.push(skuCode);
                continue;
            }

            results.matched++;

            const physicalQty = parseInt(physicalQtyStr, 10);
            if (isNaN(physicalQty) || physicalQty < 0) {
                results.errors.push({ skuCode, error: 'Invalid physical quantity' });
                continue;
            }

            const variance = physicalQty - item.systemQty;

            await req.prisma.inventoryReconciliationItem.update({
                where: { id: item.id },
                data: { physicalQty, variance },
            });

            results.updated++;
        }

        res.json({
            success: true,
            message: `Processed ${results.total} rows from CSV`,
            results,
        });
    } catch (error) {
        console.error('Upload CSV error:', error);
        res.status(500).json({ error: 'Failed to process CSV upload' });
    }
});

export default router;
