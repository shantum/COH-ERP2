/**
 * Catalog Redirect - /catalog -> /products
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/catalog')({
    beforeLoad: () => {
        throw redirect({ to: '/products', search: { tab: 'products', view: 'tree' } });
    },
});
