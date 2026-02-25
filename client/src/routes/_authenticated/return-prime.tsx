/**
 * Return Prime Route - /return-prime
 *
 * Redirects to unified /returns page.
 * Kept for backwards compatibility with bookmarks/links.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/return-prime')({
    beforeLoad: () => {
        throw redirect({ to: '/returns', search: { tab: 'return_prime' as const, requestType: 'all' as const, datePreset: '30d' as const } });
    },
    component: () => null,
});
