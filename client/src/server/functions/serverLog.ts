/**
 * Structured logging for server functions.
 *
 * Server functions can't import from @server/ (TanStack Start build constraint).
 * This utility wraps console methods with structured metadata that the
 * console interception in server/src/utils/logger.ts captures into LogBuffer.
 *
 * Usage:
 *   import { serverLog } from './serverLog';
 *   serverLog.error({ domain: 'orders', fn: 'createOrder' }, 'Failed to create', error);
 */

interface LogContext {
  domain: string;
  fn: string;
  [key: string]: unknown;
}

function extractError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { errorMessage: error.message, errorName: error.name, stack: error.stack };
  }
  if (error !== undefined && error !== null) {
    return { errorMessage: String(error) };
  }
  return {};
}

export const serverLog = {
  error(ctx: LogContext, message: string, error?: unknown) {
    const meta = { _structured: true, ...ctx, ...extractError(error) };
    console.error(`[${ctx.domain}] ${ctx.fn}: ${message}`, meta);
  },

  warn(ctx: LogContext, message: string, data?: Record<string, unknown>) {
    const meta = { _structured: true, ...ctx, ...data };
    console.warn(`[${ctx.domain}] ${ctx.fn}: ${message}`, meta);
  },

  info(ctx: LogContext, message: string, data?: Record<string, unknown>) {
    const meta = { _structured: true, ...ctx, ...data };
    console.info(`[${ctx.domain}] ${ctx.fn}: ${message}`, meta);
  },
};
