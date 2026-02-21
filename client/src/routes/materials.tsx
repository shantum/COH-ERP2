/**
 * Materials Redirect - /materials -> /fabrics
 * Materials, Trims, Services now live on the /fabrics page.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/materials')({
    beforeLoad: () => {
        throw redirect({ to: '/fabrics', search: { tab: 'overview' } });
    },
});
