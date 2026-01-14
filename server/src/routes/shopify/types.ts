import type { PrismaClient } from '@prisma/client';

// Backfill result types
export interface BackfillResult {
  updated: number;
  errors: string[];
  total: number;
  remaining?: number;
}

export interface BackfillPaymentMethodResult extends BackfillResult {
  skipped: number;
  noCache: number;
}

export interface BackfillOrderFieldsResult {
  updated: number;
  errors: Array<{ orderId: string; orderNumber: string | null; error: string }>;
  total: number;
  remaining: number;
}

// Raw query result for orders with null totalAmount
export interface OrderToBackfill {
  id: string;
  shopifyOrderId: string;
  orderNumber: string | null;
}

// Cleanup options for cache
export interface CleanupOptions {
  orderCacheRetentionDays?: number;
  productCacheRetentionDays?: number;
  webhookLogRetentionDays?: number;
  failedSyncRetentionDays?: number;
  syncJobRetentionDays?: number;
}

// Axios error type for Shopify API errors
export interface AxiosErrorLike {
  response?: {
    status?: number;
    data?: {
      errors?: string | Record<string, unknown>;
    };
  };
  message: string;
}

// Preview result type
export interface PreviewResult<T> {
  totalAvailable: number;
  previewCount: number;
  items: T[];
}

// Generic backfill function type
export type BackfillFn<T extends BackfillResult> = (
  prisma: PrismaClient,
  batchSize: number
) => Promise<T>;
