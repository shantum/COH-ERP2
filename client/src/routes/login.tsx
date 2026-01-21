/**
 * Login Route - /login
 *
 * Accepts ?redirect=path to redirect after successful login.
 * Also handles beforeLoad to check if already authenticated via cookie.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { z } from 'zod';

const LoginPage = lazy(() => import('../pages/Login'));

// Search param validation
const loginSearchSchema = z.object({
    redirect: z.string().optional(),
});

function LoadingSpinner() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
    );
}

function LoginRoute() {
    const navigate = useNavigate();
    const { redirect: redirectTo } = Route.useSearch();

    // Callback to handle successful login - navigate to redirect target
    const onLoginSuccess = () => {
        navigate({ to: redirectTo || '/' });
    };

    return (
        <Suspense fallback={<LoadingSpinner />}>
            <LoginPage onLoginSuccess={onLoginSuccess} />
        </Suspense>
    );
}

export const Route = createFileRoute('/login')({
    validateSearch: (search) => loginSearchSchema.parse(search),
    // Note: Removed beforeLoad auth check to prevent redirect loops in SSR.
    // If user is already logged in and visits /login, the Login component
    // can handle redirecting them via useEffect or the auth context.
    component: LoginRoute,
});
