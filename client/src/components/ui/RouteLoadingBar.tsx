/**
 * Route Loading Bar Component
 *
 * Displays a top loading bar when routes are loading (during navigation).
 * Uses TanStack Router's status to detect pending navigation with loaders.
 *
 * IMPORTANT: Uses ClientOnly to prevent SSR hydration mismatch.
 * During SSR, router is 'pending' but on client it may be 'idle'.
 * Without ClientOnly, the server-rendered loading bar would persist.
 *
 * Usage: Place in __root.tsx or Layout component
 *   <RouteLoadingBar />
 */

import { useRouterState, ClientOnly } from '@tanstack/react-router';

function LoadingBarContent() {
  const isLoading = useRouterState({
    select: (s) => s.status === 'pending',
  });

  if (!isLoading) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-1 bg-gray-200/50">
      <div
        className="h-full bg-primary-500 animate-pulse"
        style={{
          width: '100%',
          animation: 'loading-bar 1.5s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes loading-bar {
          0% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(0%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </div>
  );
}

export function RouteLoadingBar() {
  // Wrap in ClientOnly to avoid SSR hydration mismatch
  // Server renders null, client renders based on actual router state
  return (
    <ClientOnly fallback={null}>
      <LoadingBarContent />
    </ClientOnly>
  );
}
