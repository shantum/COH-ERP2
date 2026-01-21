/**
 * Stub for @tanstack/react-start in SPA mode
 *
 * FALLBACK ONLY: This is used when running in SPA mode (npm run dev:spa / build:spa).
 * Production uses SSR mode with real TanStack Start.
 */

// Server function stub - returns a chainable builder that produces a no-op function
export function createServerFn(_options?: unknown) {
  const noopFn = () => {
    throw new Error('Server Functions are not available in SPA mode. Use tRPC instead.');
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    inputValidator: (_validator: unknown) => builder,
    validator: (_validator: unknown) => builder,
    middleware: (_middlewares: unknown[]) => builder,
    handler: (_handler: unknown) => noopFn,
  };

  return builder;
}

export function createMiddleware() {
  return {
    server: () => ({ middleware: [] }),
  };
}

export function useServerFn(_serverFn: unknown) {
  return () => {
    throw new Error('Server Functions are not available in SPA mode. Use tRPC instead.');
  };
}

export function StartClient() {
  return null;
}

export function createServerEntry() {
  return {};
}

export default {
  fetch: () => Promise.resolve(new Response('Not available in SPA mode')),
};
