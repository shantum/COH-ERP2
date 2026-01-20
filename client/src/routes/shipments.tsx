/**
 * Shipments Redirect - /shipments -> /orders
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/shipments')({
    beforeLoad: () => {
        throw redirect({ to: '/orders', search: { view: 'shipped', page: 1, limit: 250 } });
    },
});
