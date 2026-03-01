/**
 * Campaigns Route - /campaigns
 *
 * Email marketing campaigns — list, create, send, track.
 */
import { createFileRoute } from '@tanstack/react-router';
import Campaigns from '../../pages/Campaigns';

export const Route = createFileRoute('/_authenticated/campaigns')({
    component: Campaigns,
});
