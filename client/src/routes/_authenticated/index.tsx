/**
 * Index Route - / redirects to /orders
 */
import { createFileRoute, Navigate } from '@tanstack/react-router';

function IndexRedirect() {
    return <Navigate to="/orders" search={{ view: 'open', page: 1, limit: 250 }} />;
}

export const Route = createFileRoute('/_authenticated/')({
    component: IndexRedirect,
});
