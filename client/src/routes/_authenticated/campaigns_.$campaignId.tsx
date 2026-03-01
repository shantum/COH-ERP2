/**
 * Campaign Detail Route - /campaigns/:campaignId
 *
 * Shows campaign builder (for drafts) or analytics (for sent campaigns).
 */
import { createFileRoute } from '@tanstack/react-router';
import CampaignDetail from '../../pages/campaigns/CampaignDetail';

export const Route = createFileRoute('/_authenticated/campaigns_/$campaignId')({
    component: CampaignDetail,
});
