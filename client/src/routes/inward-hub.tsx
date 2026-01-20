/**
 * Inward Hub Redirect - /inward-hub -> /inventory-inward
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/inward-hub')({
    beforeLoad: () => {
        throw redirect({ to: '/inventory-inward' });
    },
});
