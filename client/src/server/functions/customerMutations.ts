/**
 * Customer Mutations - TanStack Start Server Functions
 *
 * Phase 1 mutations - Simple CRUD with NO SSE broadcasting and NO cache invalidation.
 *
 * Mutations:
 * - updateCustomer: Update customer information (name, email, phone, tags)
 */
'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import type { PrismaClient } from '@prisma/client';

// ============================================
// INPUT SCHEMAS (Zod is source of truth)
// ============================================

/**
 * Update customer input schema
 * Matches tRPC customers.update input
 * Only allows updating safe fields (name, email, phone, tags)
 */
const UpdateCustomerInputSchema = z.object({
    id: z.string().uuid(),
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(20).optional(),
    tags: z.string().max(500).optional(),
});

export type UpdateCustomerInput = z.infer<typeof UpdateCustomerInputSchema>;

// ============================================
// RESPONSE TYPES
// ============================================

/**
 * Updated customer response
 */
export interface UpdatedCustomer {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    tags: string | null;
    updatedAt: Date;
}

// ============================================
// UPDATE CUSTOMER MUTATION
// ============================================

/**
 * Update customer information
 *
 * Validates:
 * - Customer exists
 * - Email uniqueness (if being updated)
 * - At least one field to update
 *
 * @returns Updated customer record
 */
export const updateCustomer = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): UpdateCustomerInput => UpdateCustomerInputSchema.parse(input)
    )
    .handler(async ({ data }: { data: UpdateCustomerInput }): Promise<UpdatedCustomer> => {
        const { id, ...updateData } = data;

        // Dynamic Prisma import to prevent bundling into client
        const { PrismaClient } = await import('@prisma/client');
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        // Check if customer exists
        const existing = await prisma.customer.findUnique({
            where: { id },
            select: { id: true },
        });

        if (!existing) {
            throw new Error('Customer not found');
        }

        // Check for email uniqueness if email is being updated
        if (updateData.email) {
            const emailExists = await prisma.customer.findFirst({
                where: {
                    email: updateData.email,
                    id: { not: id },
                },
                select: { id: true },
            });

            if (emailExists) {
                throw new Error('A customer with this email already exists');
            }
        }

        // Filter out undefined values
        const dataToUpdate = Object.fromEntries(
            Object.entries(updateData).filter(([, v]) => v !== undefined)
        );

        if (Object.keys(dataToUpdate).length === 0) {
            throw new Error('No fields to update');
        }

        const updated = await prisma.customer.update({
            where: { id },
            data: dataToUpdate,
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
                tags: true,
                updatedAt: true,
            },
        });

        return updated;
    });
