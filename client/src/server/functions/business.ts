/**
 * Business Graph Server Functions
 *
 * TanStack Start Server Functions exposing the business graph layer.
 * Entity context resolvers + business pulse snapshot.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { serverLog } from './serverLog';

// ============================================
// INPUT SCHEMAS
// ============================================

const orderContextInputSchema = z.object({
  orderId: z.string().uuid(),
});

const productContextInputSchema = z.object({
  productId: z.string().uuid(),
});

const customerContextInputSchema = z.object({
  customerId: z.string().uuid(),
});

const recentEventsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  domain: z.string().optional(),
});

const entityTimelineInputSchema = z.object({
  entityType: z.string(),
  entityId: z.string().uuid(),
});

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get full order context — customer, lines, payments, shipping, returns
 */
export const getOrderContextFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => orderContextInputSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { getOrderContext } = await import('@coh/shared/services/business');
      return await getOrderContext(data.orderId);
    } catch (error: unknown) {
      serverLog.error({ domain: 'business', fn: 'getOrderContext' }, 'Failed to get order context', error);
      throw error;
    }
  });

/**
 * Get full product context — variations, SKUs, stock, sales velocity, return rate
 */
export const getProductContextFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => productContextInputSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { getProductContext } = await import('@coh/shared/services/business');
      return await getProductContext(data.productId);
    } catch (error: unknown) {
      serverLog.error({ domain: 'business', fn: 'getProductContext' }, 'Failed to get product context', error);
      throw error;
    }
  });

/**
 * Get full customer context — order history, return behavior, LTV
 */
export const getCustomerContextFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => customerContextInputSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { getCustomerContext } = await import('@coh/shared/services/business');
      return await getCustomerContext(data.customerId);
    } catch (error: unknown) {
      serverLog.error({ domain: 'business', fn: 'getCustomerContext' }, 'Failed to get customer context', error);
      throw error;
    }
  });

/**
 * Get business pulse — comprehensive business snapshot
 *
 * Runs ~11 queries in parallel. No cache layer here — add one
 * at the server function level if needed.
 */
export const getBusinessPulseFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    try {
      const { getBusinessPulse } = await import('@coh/shared/services/business');
      return await getBusinessPulse();
    } catch (error: unknown) {
      serverLog.error({ domain: 'business', fn: 'getBusinessPulse' }, 'Failed to get business pulse', error);
      throw error;
    }
  });

/**
 * Get recent domain events for activity feed
 */
export const getRecentEventsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => recentEventsInputSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { getRecentEvents } = await import('@coh/shared/services/eventLog');
      return await getRecentEvents(data.limit ?? 50, data.domain);
    } catch (error: unknown) {
      serverLog.error({ domain: 'business', fn: 'getRecentEvents' }, 'Failed to get recent events', error);
      throw error;
    }
  });

/**
 * Get all events for a specific entity (audit timeline)
 */
export const getEntityTimelineFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => entityTimelineInputSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { getEntityTimeline } = await import('@coh/shared/services/eventLog');
      return await getEntityTimeline(data.entityType, data.entityId);
    } catch (error: unknown) {
      serverLog.error({ domain: 'business', fn: 'getEntityTimeline' }, 'Failed to get entity timeline', error);
      throw error;
    }
  });
