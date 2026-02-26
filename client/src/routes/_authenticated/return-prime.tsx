/**
 * Return Prime Route - /return-prime
 *
 * Redirects to unified /returns page.
 * Kept for backwards compatibility with bookmarks/links.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/return-prime')({
    beforeLoad: () => {
        throw redirect({
            to: '/returns',
            search: {
                status: 'all' as const,
                view: 'returns' as const,
                datePreset: '30d' as const,
                page: 1,
                requestType: 'all' as const,
            },
        });
    },
    component: () => null,
});
