/**
 * Production Inward Redirect - /production-inward -> /inventory-inward
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/production-inward')({
    beforeLoad: () => {
        throw redirect({ to: '/inventory-inward' });
    },
});
