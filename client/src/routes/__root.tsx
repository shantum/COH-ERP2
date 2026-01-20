/**
 * Root Route Component - TanStack Router
 *
 * This component has two modes:
 * 1. SSR Mode (TanStack Start): Provides full provider hierarchy
 * 2. SPA Mode (via App.tsx): App.tsx handles providers, this just renders content
 *
 * Detection: Check if we're already inside a QueryClientProvider
 */

import { lazy, Suspense } from 'react';
import {
    Outlet,
    createRootRouteWithContext,
    HeadContent,
    Scripts,
} from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import type { RouterContext } from '../routerContext';
import { RouteLoadingBar } from '../components/ui/RouteLoadingBar';
import { CommandPalette } from '../components/CommandPalette';
import ErrorBoundary from '../components/ErrorBoundary';
import { AuthProvider } from '../hooks/useAuth';
import { TRPCProvider } from '../providers/TRPCProvider';
import appCss from '../index.css?url';

// Lazy load devtools for development only
const TanStackRouterDevtools = import.meta.env.DEV
    ? lazy(() =>
          import('@tanstack/router-devtools').then((res) => ({
              default: res.TanStackRouterDevtools,
          }))
      )
    : () => null;

export const Route = createRootRouteWithContext<RouterContext>()({
    head: () => ({
        meta: [
            { charSet: 'utf-8' },
            { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
            { title: 'COH ERP' },
        ],
        links: [
            { rel: 'icon', type: 'image/svg+xml', href: '/vite.svg' },
            { rel: 'stylesheet', href: appCss },
        ],
    }),
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

    // Full HTML document structure for SSR
    // In SPA mode, this still works - browser ignores duplicate html/head/body
    return (
        <html lang="en">
            <head>
                <HeadContent />
            </head>
            <body>
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
                <Scripts />
            </body>
        </html>
    );
}

export { RootComponent };
