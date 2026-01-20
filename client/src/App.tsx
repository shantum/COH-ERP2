/**
 * App Component - Main Application Entry Point
 *
 * This file sets up the provider hierarchy for the application:
 * - ErrorBoundary for error handling
 * - QueryClientProvider for TanStack Query
 * - TRPCProvider for tRPC client
 * - AuthProvider for authentication state
 * - RouterProvider for TanStack Router
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { TRPCProvider } from './providers/TRPCProvider';
import { router } from './router';
import { trpc } from './services/trpc';
import './index.css';

// QueryClient configuration
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30000,
            retry: 1,
        },
    },
});

/**
 * Inner component that provides router context with auth state
 * Must be inside AuthProvider to access useAuth()
 */
function InnerApp() {
    console.log('[InnerApp] rendering');
    const auth = useAuth();
    console.log('[InnerApp] auth state:', { isLoading: auth.isLoading, isAuthenticated: auth.isAuthenticated, user: auth.user?.email });

    // Show loading state while auth is being determined
    if (auth.isLoading) {
        console.log('[InnerApp] showing loading spinner');
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    console.log('[InnerApp] rendering RouterProvider');
    return (
        <RouterProvider
            router={router}
            context={{
                queryClient,
                trpc,
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
    return (
        <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
                <TRPCProvider queryClient={queryClient}>
                    <AuthProvider>
                        <InnerApp />
                    </AuthProvider>
                </TRPCProvider>
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
