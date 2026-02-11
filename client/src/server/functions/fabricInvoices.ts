/**
 * Fabric Invoice Server Functions
 *
 * TanStack Start Server Functions for querying fabric invoices.
 * Mutations go through Express API routes (upload needs multer).
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';

// ============================================
// LIST INVOICES
// ============================================

const listInvoicesInput = z.object({
    status: z.enum(['draft', 'confirmed', 'cancelled']).optional(),
    supplierId: z.string().uuid().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
}).optional();

export const listFabricInvoices = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => listInvoicesInput.parse(input))
    .handler(async ({ data }) => {
        const prisma = await getPrisma();
        const { status, supplierId, page = 1, limit = 20 } = data ?? {};
        const skip = (page - 1) * limit;

        const where = {
            ...(status ? { status } : {}),
            ...(supplierId ? { supplierId } : {}),
        };

        const [invoices, total] = await Promise.all([
            prisma.fabricInvoice.findMany({
                where,
                select: {
                    id: true,
                    invoiceNumber: true,
                    invoiceDate: true,
                    supplierName: true,
                    totalAmount: true,
                    status: true,
                    fileName: true,
                    fileSizeBytes: true,
                    aiConfidence: true,
                    createdAt: true,
                    supplier: { select: { id: true, name: true } },
                    _count: { select: { lines: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.fabricInvoice.count({ where }),
        ]);

        return { success: true as const, invoices, total, page, limit };
    });

// ============================================
// GET SINGLE INVOICE
// ============================================

const getInvoiceInput = z.object({
    id: z.string().uuid(),
});

export const getFabricInvoice = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getInvoiceInput.parse(input))
    .handler(async ({ data }) => {
        const prisma = await getPrisma();

        const invoice = await prisma.fabricInvoice.findUnique({
            where: { id: data.id },
            select: {
                id: true,
                invoiceNumber: true,
                invoiceDate: true,
                supplierId: true,
                supplierName: true,
                subtotal: true,
                gstAmount: true,
                totalAmount: true,
                fileName: true,
                fileMimeType: true,
                fileSizeBytes: true,
                status: true,
                aiConfidence: true,
                createdAt: true,
                updatedAt: true,
                lines: {
                    select: {
                        id: true,
                        description: true,
                        hsnCode: true,
                        qty: true,
                        unit: true,
                        rate: true,
                        amount: true,
                        gstPercent: true,
                        gstAmount: true,
                        fabricColourId: true,
                        matchedTxnId: true,
                        matchType: true,
                        fabricColour: {
                            select: {
                                id: true,
                                colourName: true,
                                code: true,
                                fabric: { select: { id: true, name: true } },
                            },
                        },
                        matchedTxn: {
                            select: { id: true, qty: true, unit: true, costPerUnit: true, createdAt: true },
                        },
                    },
                },
                supplier: { select: { id: true, name: true } },
                createdBy: { select: { id: true, name: true } },
            },
        });

        if (!invoice) {
            return { success: false as const, error: 'Invoice not found' };
        }

        return { success: true as const, invoice };
    });
