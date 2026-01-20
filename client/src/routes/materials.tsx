/**
 * Materials Redirect - /materials -> /products
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/materials')({
    beforeLoad: () => {
        throw redirect({ to: '/products', search: { tab: 'materials', view: 'tree' } });
    },
});
