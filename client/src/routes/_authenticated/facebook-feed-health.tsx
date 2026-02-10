/**
 * Facebook Feed Health Route - /facebook-feed-health
 *
 * Monitor the Facebook catalog feed for price, stock, and
 * availability discrepancies against ERP and Shopify data.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { FacebookFeedHealthSearchParams } from '@coh/shared';

const FacebookFeedHealth = lazy(() => import('../../pages/FacebookFeedHealth'));

export const Route = createFileRoute('/_authenticated/facebook-feed-health')({
    validateSearch: (search) => FacebookFeedHealthSearchParams.parse(search),
    component: FacebookFeedHealth,
});
