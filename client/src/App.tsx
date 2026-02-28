/**
 * App Component - Main Application Entry Point
 *
 * This file sets up the provider hierarchy for the application:
 * - ErrorBoundary for error handling
 * - QueryClientProvider for TanStack Query
 * - AuthProvider for authentication state
 * - RouterProvider for TanStack Router
 */

import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { reportError } from './utils/errorReporter';
import { router } from './router';

// QueryClient configuration
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30000,
            retry: 1,
        },
        mutations: {
            onError: (error: Error) => {
                reportError(error, { handler: 'QueryClient.mutations.onError' });
            },
        },
    },
});

/**
 * Inner component that provides router context with auth state
 * Must be inside AuthProvider to access useAuth()
 */
function InnerApp() {
    const auth = useAuth();

    // Show loading state while auth is being determined
    if (auth.isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    return (
        <RouterProvider
            router={router}
            context={{
                queryClient,
                auth: {
                    user: auth.user,
                    isAuthenticated: auth.isAuthenticated,
                    isLoading: auth.isLoading,
                },
            }}
        />
    );
}

/**
 * Main App component with provider hierarchy
 */
function App() {
    // Global error handlers for uncaught errors and unhandled rejections
    useEffect(() => {
        const handleError = (event: ErrorEvent) => {
            reportError(event.error || new Error(event.message), {
                handler: 'window.onerror',
                source: event.filename,
                line: event.lineno,
                col: event.colno,
            });
        };

        const handleRejection = (event: PromiseRejectionEvent) => {
            reportError(event.reason, { handler: 'unhandledrejection' });
        };

        window.addEventListener('error', handleError);
        window.addEventListener('unhandledrejection', handleRejection);
        return () => {
            window.removeEventListener('error', handleError);
            window.removeEventListener('unhandledrejection', handleRejection);
        };
    }, []);

    return (
        <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <InnerApp />
                </AuthProvider>
            </QueryClientProvider>
            <Toaster
                position="bottom-right"
                toastOptions={{
                    className: 'text-sm',
                }}
            />
        </ErrorBoundary>
    );
}

export default App;
