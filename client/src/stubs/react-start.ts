/**
 * Stub for @tanstack/react-start in SPA mode
 *
 * FALLBACK ONLY: This is used when running in SPA mode (npm run dev:spa / build:spa).
 * Production uses SSR mode with real TanStack Start.
 */

// Server function stub - returns a chainable builder that produces a no-op function
// In SPA mode, Server Functions return null/empty data - components should handle this gracefully
export function createServerFn(_options?: unknown) {
  // Return async function that resolves to null - components handle missing data
  const noopFn = async () => {
    console.warn('[SPA Mode] Server Function called - returning null. Data will load via client-side fetch.');
    return null;
  };

  interface ServerFnBuilder {
    inputValidator: (_validator: unknown) => ServerFnBuilder;
    validator: (_validator: unknown) => ServerFnBuilder;
    middleware: (_middlewares: unknown[]) => ServerFnBuilder;
    handler: (_handler: unknown) => typeof noopFn;
  }

  const builder: ServerFnBuilder = {
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
  return async () => {
    console.warn('[SPA Mode] useServerFn called - returning null.');
    return null;
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
