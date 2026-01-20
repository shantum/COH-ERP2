/**
 * Login Route - /login
 *
 * Auth check happens in component (not beforeLoad) to handle SSR properly.
 */
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useAuth } from '../hooks/useAuth';

const LoginPage = lazy(() => import('../pages/Login'));

function LoadingSpinner() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
    );
}

function LoginRoute() {
    const auth = useAuth();

    // Show loading spinner while auth is being determined
    if (auth.isLoading) {
        return <LoadingSpinner />;
    }

    // Redirect to home if already authenticated (declarative redirect)
    if (auth.isAuthenticated) {
        return <Navigate to="/" />;
    }

    return (
        <Suspense fallback={<LoadingSpinner />}>
            <LoginPage />
        </Suspense>
    );
}

export const Route = createFileRoute('/login')({
    component: LoginRoute,
});
