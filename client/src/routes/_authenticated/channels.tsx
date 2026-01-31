/**
 * Channels Route - /channels
 *
 * Marketplace analytics dashboard for Myntra, Ajio, Nykaa orders.
 * Imports BT reports and provides channel-level analytics.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { ChannelsSearchParams } from '@coh/shared';

const Channels = lazy(() => import('../../pages/Channels'));

export const Route = createFileRoute('/_authenticated/channels')({
    validateSearch: (search) => ChannelsSearchParams.parse(search),
    component: Channels,
});
