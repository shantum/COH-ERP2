/**
 * Root Route Component - TanStack Router
 *
 * SPA Mode: Providers wrap the Outlet, index.html provides document structure
 * SSR Mode: Use build:ssr which includes HeadContent/Scripts from TanStack Start
 */

import { lazy, Suspense } from 'react';
import {
    Outlet,
    createRootRouteWithContext,
} from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import type { RouterContext } from '../routerContext';
import { RouteLoadingBar } from '../components/ui/RouteLoadingBar';
import { CommandPalette } from '../components/CommandPalette';
import ErrorBoundary from '../components/ErrorBoundary';
import { AuthProvider } from '../hooks/useAuth';
import { TRPCProvider } from '../providers/TRPCProvider';
import '../index.css';

// Lazy load devtools for development only
const TanStackRouterDevtools = import.meta.env.DEV
    ? lazy(() =>
          import('@tanstack/router-devtools').then((res) => ({
              default: res.TanStackRouterDevtools,
          }))
      )
    : () => null;

export const Route = createRootRouteWithContext<RouterContext>()({
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
});

function NotFoundComponent() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="text-center">
                <h1 className="text-4xl font-bold text-gray-900 mb-4">404</h1>
                <p className="text-gray-600 mb-4">Page not found</p>
                <a href="/" className="text-blue-600 hover:underline">Go home</a>
            </div>
        </div>
    );
}

function RootComponent() {
    const { queryClient } = Route.useRouteContext();

    // SPA mode: Just providers and content, index.html provides document structure
    return (
        <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
                <TRPCProvider queryClient={queryClient}>
                    <AuthProvider>
                        <RouteLoadingBar />
                        <CommandPalette />
                        <Outlet />
                    </AuthProvider>
                </TRPCProvider>
            </QueryClientProvider>
            <Toaster
                position="bottom-right"
                toastOptions={{
                    className: 'text-sm',
                }}
            />
            {import.meta.env.DEV && (
                <Suspense fallback={null}>
                    <TanStackRouterDevtools position="bottom-right" />
                </Suspense>
            )}
        </ErrorBoundary>
    );
}

export { RootComponent };
