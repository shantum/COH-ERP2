/**
 * Root Route Component - TanStack Router
 *
 * SSR Mode: Renders full HTML document with HeadContent/Scripts
 * SPA Mode: Also works - HeadContent/Scripts handle both cases
 */

import { lazy, Suspense, type ReactNode } from 'react';
import {
    Outlet,
    HeadContent,
    Scripts,
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
            { name: 'viewport', content: 'width=device-width, initial-scale=1' },
            { title: 'COH ERP' },
        ],
        links: [
            { rel: 'stylesheet', href: appCss },
            { rel: 'icon', type: 'image/svg+xml', href: '/vite.svg' },
        ],
    }),
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
});

function NotFoundComponent() {
    return (
        <RootDocument>
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <h1 className="text-4xl font-bold text-gray-900 mb-4">404</h1>
                    <p className="text-gray-600 mb-4">Page not found</p>
                    <a href="/" className="text-blue-600 hover:underline">Go home</a>
                </div>
            </div>
        </RootDocument>
    );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <html lang="en">
            <head>
                <HeadContent />
            </head>
            <body>
                {children}
                <Scripts />
            </body>
        </html>
    );
}

function RootComponent() {
    const { queryClient } = Route.useRouteContext();

    return (
        <RootDocument>
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
                {/* Client-only devtools - SSR doesn't have router context */}
                {import.meta.env.DEV && typeof window !== 'undefined' && (
                    <Suspense fallback={null}>
                        <TanStackRouterDevtools position="bottom-right" />
                    </Suspense>
                )}
            </ErrorBoundary>
        </RootDocument>
    );
}

export { RootComponent };
