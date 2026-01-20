/**
 * Root Route Component - TanStack Router
 *
 * This component wraps all routes and provides:
 * - Route loading indicator (top bar during navigation)
 * - Devtools in development
 */

import { Outlet } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { RouteLoadingBar } from '../components/ui/RouteLoadingBar';
import { CommandPalette } from '../components/CommandPalette';

// Lazy load devtools for development only
const TanStackRouterDevtools = import.meta.env.DEV
    ? lazy(() =>
          import('@tanstack/router-devtools').then((res) => ({
              default: res.TanStackRouterDevtools,
          }))
      )
    : () => null;

export function RootComponent() {
    return (
        <>
            <RouteLoadingBar />
            <CommandPalette />
            <Outlet />
            {import.meta.env.DEV && (
                <Suspense fallback={null}>
                    <TanStackRouterDevtools position="bottom-right" />
                </Suspense>
            )}
        </>
    );
}
