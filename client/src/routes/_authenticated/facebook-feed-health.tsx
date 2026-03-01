/**
 * Facebook Feed Health Route - /facebook-feed-health
 *
 * Monitor the Facebook catalog feed for price, stock, and
 * availability discrepancies against ERP and Shopify data.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazy } from 'react';
import { FacebookFeedHealthSearchParams } from '@coh/shared';
import { isAdminUser, type AuthUser } from '../../types';

const FacebookFeedHealth = lazy(() => import('../../pages/FacebookFeedHealth'));

export const Route = createFileRoute('/_authenticated/facebook-feed-health')({
    validateSearch: (search) => FacebookFeedHealthSearchParams.parse(search),
    beforeLoad: ({ context }) => {
        if (!isAdminUser((context as { user?: AuthUser }).user)) {
            throw redirect({ to: '/' });
        }
    },
    component: FacebookFeedHealth,
});
