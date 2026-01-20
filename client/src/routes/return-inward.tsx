/**
 * Return Inward Redirect - /return-inward -> /returns-rto
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/return-inward')({
    beforeLoad: () => {
        throw redirect({ to: '/returns-rto' });
    },
});
