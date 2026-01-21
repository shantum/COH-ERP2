/**
 * Stub for @tanstack/react-start in SPA mode
 *
 * TanStack Start requires Node.js APIs (AsyncLocalStorage, etc.)
 * which don't work in browsers. This stub provides empty implementations
 * so the SPA build doesn't fail.
 *
 * Real implementations are used in SSR mode (npm run build:ssr)
 */

// Server function stub - returns a no-op function
export function createServerFn() {
  return () => () => {
    throw new Error('Server Functions are not available in SPA mode');
  };
}

// Middleware stub
export function createMiddleware() {
  return {
    server: () => ({ middleware: [] }),
  };
}

// Hook stub for client-side usage
export function useServerFn(serverFn: unknown) {
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
