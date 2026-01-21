/**
 * Stub for @tanstack/react-start in SPA mode
 *
 * TanStack Start requires Node.js APIs (AsyncLocalStorage, etc.)
 * which don't work in browsers. This stub provides empty implementations
 * so the SPA build doesn't fail.
 *
 * Real implementations are used in SSR mode (npm run build:ssr)
 */

// Server function stub - returns a chainable builder that produces a no-op function
export function createServerFn(_options?: unknown) {
  const noopFn = () => {
    throw new Error('Server Functions are not available in SPA mode. Use tRPC instead.');
  };

  // Chainable builder pattern matching TanStack Start API
  const builder = {
    inputValidator: (_validator: unknown) => builder,
    validator: (_validator: unknown) => builder,
    handler: (_handler: unknown) => noopFn,
  };

  return builder;
}

// Middleware stub
export function createMiddleware() {
  return {
    server: () => ({ middleware: [] }),
  };
}

// Hook stub for client-side usage
export function useServerFn(_serverFn: unknown) {
  // In SPA mode, return a function that throws an error
  return () => {
    throw new Error('Server Functions are not available in SPA mode. Use tRPC instead.');
  };
}

// Client entry stub
export function StartClient() {
  return null;
}

// Server entry stub
export function createServerEntry() {
  return {};
}

export default {
  fetch: () => Promise.resolve(new Response('Not available in SPA mode')),
};
