/**
 * Common Zod Schemas
 *
 * Base schemas used by other domain schemas.
 * This file should NOT import from index.ts to avoid circular dependencies.
 */

import { z } from 'zod';

// Common validation schemas
export const uuidSchema = z.string().uuid();

export const dateStringSchema = z.string().datetime();

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const sortOrderSchema = z.enum(['asc', 'desc']);

// Order status schema
export const orderStatusSchema = z.enum([
  'pending',
  'allocated',
  'picked',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
]);

// Line status schema
export const lineStatusSchema = z.enum([
  'pending',
  'allocated',
  'picked',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
]);

// Payment method schema
export const paymentMethodSchema = z.enum(['cod', 'prepaid', 'credit']);

// Customer tier schema
export const customerTierSchema = z.enum(['new', 'bronze', 'silver', 'gold', 'platinum']);

// Transaction type schema
export const transactionTypeSchema = z.enum([
  'inward',
  'outward',
  'adjustment',
  'reserved',
  'unreserved',
]);
