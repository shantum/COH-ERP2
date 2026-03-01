/**
 * Email Campaigns Server Functions
 *
 * CRUD, preview, send, and analytics for marketing email campaigns.
 * Uses Prisma for DB access, Resend for sending.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { getPrisma } from '@coh/shared/services/db';
import { adminMiddleware } from '../middleware/auth';
import { serverLog } from './serverLog';

// ============================================
// INPUT SCHEMAS
// ============================================

const campaignListInputSchema = z.object({
  status: z.enum(['all', 'draft', 'scheduled', 'sending', 'sent', 'cancelled']).optional().default('all'),
  limit: z.number().int().positive().max(100).optional().default(50),
  offset: z.number().int().nonnegative().optional().default(0),
});

const campaignIdSchema = z.object({
  id: z.string().uuid(),
});

const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().max(200).default(''),
  preheaderText: z.string().max(200).optional(),
  sourceId: z.string().uuid().optional(), // Copy HTML from a previous campaign
  shopifyProductIds: z.array(z.string()).optional(),
  audienceFilter: z.object({
    tiers: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    lastPurchaseDays: z.number().int().positive().optional(),
  }).optional(),
  utmSource: z.string().optional().default('email'),
  utmMedium: z.string().optional().default('campaign'),
  utmCampaign: z.string().optional(),
  utmContent: z.string().optional(),
  utmTerm: z.string().optional(),
});

const updateCampaignSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(200).optional(),
  preheaderText: z.string().max(200).optional(),
  htmlContent: z.string().optional(), // Full email HTML (AI-generated or manually edited)
  shopifyProductIds: z.array(z.string()).optional(),
  audienceFilter: z.object({
    tiers: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    lastPurchaseDays: z.number().int().positive().optional(),
  }).optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  utmContent: z.string().optional(),
  utmTerm: z.string().optional(),
});

const audiencePreviewSchema = z.object({
  audienceFilter: z.object({
    tiers: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    lastPurchaseDays: z.number().int().positive().optional(),
  }),
});

const sendTestSchema = z.object({
  campaignId: z.string().uuid(),
  toEmail: z.string().email(),
});

const sendCampaignSchema = z.object({
  id: z.string().uuid(),
  scheduledAt: z.string().datetime().optional(), // ISO string for scheduling
});

// ============================================
// TYPES
// ============================================

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export interface CampaignListItem {
  id: string;
  name: string;
  subject: string;
  status: string;
  recipientCount: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  bounceCount: number;
  scheduledAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface CampaignDetail extends CampaignListItem {
  preheaderText: string | null;
  htmlContent: string | null;
  sourceId: string | null;
  shopifyProductIds: string[] | null;
  audienceFilter: { tiers?: string[]; tags?: string[]; lastPurchaseDays?: number } | null;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  deliveredCount: number;
  unsubscribeCount: number;
  updatedAt: Date;
}

export interface AudiencePreviewResult {
  count: number;
  sample: Array<{ id: string; email: string; firstName: string | null; lastName: string | null; tier: string }>;
}

// ============================================
// HELPERS
// ============================================

/** Build a Prisma where clause from audience filter */
function buildAudienceWhere(filter: { tiers?: string[]; tags?: string[]; lastPurchaseDays?: number }): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = {
    emailOptOut: false,
    email: { not: '' },
  };

  if (filter.tiers && filter.tiers.length > 0) {
    where.tier = { in: filter.tiers };
  }

  if (filter.tags && filter.tags.length > 0) {
    // Tags is a comma-separated string field — match any
    where.OR = filter.tags.map(tag => ({
      tags: { contains: tag, mode: 'insensitive' as const },
    }));
  }

  if (filter.lastPurchaseDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filter.lastPurchaseDays);
    where.lastOrderDate = { gte: cutoff };
  }

  return where;
}

/** Slugify a campaign name for UTM */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** Append UTM params to all links in HTML pointing to COH domains */
export function appendUtmParams(
  html: string,
  utm: { source: string; medium: string; campaign: string; content?: string; term?: string }
): string {
  const cohDomains = ['creaturesofhabit.in', 'coh.one'];
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (match, url: string) => {
    try {
      const parsed = new URL(url);
      const isCoh = cohDomains.some(d => parsed.hostname.endsWith(d));
      if (!isCoh) return match;

      parsed.searchParams.set('utm_source', utm.source);
      parsed.searchParams.set('utm_medium', utm.medium);
      parsed.searchParams.set('utm_campaign', utm.campaign);
      if (utm.content) parsed.searchParams.set('utm_content', utm.content);
      if (utm.term) parsed.searchParams.set('utm_term', utm.term);

      return `href="${parsed.toString()}"`;
    } catch {
      return match;
    }
  });
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/** List campaigns with pagination */
export const getCampaignsList = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => campaignListInputSchema.parse(input))
  .handler(async ({ data }): Promise<{ campaigns: CampaignListItem[]; pagination: { total: number; limit: number; offset: number; hasMore: boolean } }> => {
    try {
      const prisma = await getPrisma();

      const where: Prisma.EmailCampaignWhereInput = {};
      if (data.status !== 'all') {
        where.status = data.status;
      }

      const [total, campaigns] = await Promise.all([
        prisma.emailCampaign.count({ where }),
        prisma.emailCampaign.findMany({
          where,
          select: {
            id: true, name: true, subject: true, status: true,
            recipientCount: true, sentCount: true, openCount: true, clickCount: true, bounceCount: true,
            scheduledAt: true, sentAt: true, createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: data.limit,
          skip: data.offset,
        }),
      ]);

      return {
        campaigns,
        pagination: { total, limit: data.limit, offset: data.offset, hasMore: data.offset + data.limit < total },
      };
    } catch (error: unknown) {
      serverLog.error({ domain: 'campaigns', fn: 'getCampaignsList' }, 'Failed to list campaigns', error);
      throw error;
    }
  });

/** Get full campaign detail */
export const getCampaignDetail = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => campaignIdSchema.parse(input))
  .handler(async ({ data }): Promise<CampaignDetail> => {
    try {
      const prisma = await getPrisma();
      const campaign = await prisma.emailCampaign.findUniqueOrThrow({
        where: { id: data.id },
      });

      return {
        ...campaign,
        shopifyProductIds: campaign.shopifyProductIds as string[] | null,
        audienceFilter: campaign.audienceFilter as CampaignDetail['audienceFilter'],
      };
    } catch (error: unknown) {
      serverLog.error({ domain: 'campaigns', fn: 'getCampaignDetail' }, 'Failed to get campaign', error);
      throw error;
    }
  });

/** Create a new campaign (draft) */
export const createCampaign = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => createCampaignSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    try {
      const prisma = await getPrisma();
      const utmCampaign = data.utmCampaign || slugify(data.name);

      // If starting from a previous campaign, copy its HTML
      let htmlContent: string | null = null;
      if (data.sourceId) {
        const source = await prisma.emailCampaign.findUnique({
          where: { id: data.sourceId },
          select: { htmlContent: true },
        });
        htmlContent = source?.htmlContent ?? null;
      }

      const campaign = await prisma.emailCampaign.create({
        data: {
          name: data.name,
          subject: data.subject,
          preheaderText: data.preheaderText,
          ...(htmlContent ? { htmlContent } : {}),
          ...(data.sourceId ? { sourceId: data.sourceId } : {}),
          shopifyProductIds: data.shopifyProductIds ?? [],
          audienceFilter: data.audienceFilter ?? {},
          utmSource: data.utmSource,
          utmMedium: data.utmMedium,
          utmCampaign: utmCampaign,
          utmContent: data.utmContent,
          utmTerm: data.utmTerm,
          createdById: context.user.id,
        },
        select: { id: true },
      });

      return { id: campaign.id };
    } catch (error: unknown) {
      serverLog.error({ domain: 'campaigns', fn: 'createCampaign' }, 'Failed to create campaign', error);
      throw error;
    }
  });

/** Update a draft campaign */
export const updateCampaign = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => updateCampaignSchema.parse(input))
  .handler(async ({ data }): Promise<{ success: true }> => {
    try {
      const prisma = await getPrisma();
      const { id, ...updates } = data;

      // Only allow editing drafts
      const campaign = await prisma.emailCampaign.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (campaign.status !== 'draft') {
        throw new Error(`Cannot edit campaign in '${campaign.status}' status`);
      }

      // Auto-generate UTM campaign slug if name changed
      const updateData: Prisma.EmailCampaignUpdateInput = {};
      if (updates.name !== undefined) {
        updateData.name = updates.name;
        if (!updates.utmCampaign) {
          updateData.utmCampaign = slugify(updates.name);
        }
      }
      if (updates.subject !== undefined) updateData.subject = updates.subject;
      if (updates.preheaderText !== undefined) updateData.preheaderText = updates.preheaderText;
      if (updates.htmlContent !== undefined) updateData.htmlContent = updates.htmlContent;
      if (updates.shopifyProductIds !== undefined) updateData.shopifyProductIds = updates.shopifyProductIds;
      if (updates.audienceFilter !== undefined) updateData.audienceFilter = updates.audienceFilter;
      if (updates.utmSource !== undefined) updateData.utmSource = updates.utmSource;
      if (updates.utmMedium !== undefined) updateData.utmMedium = updates.utmMedium;
      if (updates.utmCampaign !== undefined) updateData.utmCampaign = updates.utmCampaign;
      if (updates.utmContent !== undefined) updateData.utmContent = updates.utmContent;
      if (updates.utmTerm !== undefined) updateData.utmTerm = updates.utmTerm;

      await prisma.emailCampaign.update({ where: { id }, data: updateData });
      return { success: true };
    } catch (error: unknown) {
      serverLog.error({ domain: 'campaigns', fn: 'updateCampaign' }, 'Failed to update campaign', error);
      throw error;
    }
  });

/** Preview audience count + sample based on filters */
export const getAudiencePreview = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => audiencePreviewSchema.parse(input))
  .handler(async ({ data }): Promise<AudiencePreviewResult> => {
    try {
      const prisma = await getPrisma();
      const where = buildAudienceWhere(data.audienceFilter);

      const [count, sample] = await Promise.all([
        prisma.customer.count({ where }),
        prisma.customer.findMany({
          where,
          select: { id: true, email: true, firstName: true, lastName: true, tier: true },
          take: 10,
          orderBy: { ltv: 'desc' },
        }),
      ]);

      return { count, sample };
    } catch (error: unknown) {
      serverLog.error({ domain: 'campaigns', fn: 'getAudiencePreview' }, 'Failed to preview audience', error);
      throw error;
    }
  });

/** Send a test email for a campaign */
export const sendTestEmail = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => sendTestSchema.parse(input))
  .handler(async ({ data }): Promise<{ success: true; messageId?: string }> => {
    try {
      const prisma = await getPrisma();
      const campaign = await prisma.emailCampaign.findUniqueOrThrow({
        where: { id: data.campaignId },
      });

      // Dynamically import services (server-only)
      const { sendCustomerEmail } = await import('../../../../server/src/services/email/index.js');

      let html = campaign.htmlContent || '';
      if (!html) {
        throw new Error('Campaign has no email content. Generate or write HTML first.');
      }

      // Apply UTM params
      html = appendUtmParams(html, {
        source: campaign.utmSource,
        medium: campaign.utmMedium,
        campaign: campaign.utmCampaign || slugify(campaign.name),
        ...(campaign.utmContent ? { content: campaign.utmContent } : {}),
        ...(campaign.utmTerm ? { term: campaign.utmTerm } : {}),
      });

      const result = await sendCustomerEmail({
        to: data.toEmail,
        subject: `[TEST] ${campaign.subject}`,
        html,
        templateKey: 'campaign-test',
        entityType: 'EmailCampaign',
        entityId: data.campaignId,
        configurationSetName: 'coh-campaigns',
      });

      return { success: true, messageId: result.messageId };
    } catch (error: unknown) {
      serverLog.error({ domain: 'campaigns', fn: 'sendTestEmail' }, 'Failed to send test email', error);
      throw error;
    }
  });

/** Send or schedule a campaign */
export const sendCampaign = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => sendCampaignSchema.parse(input))
  .handler(async ({ data }): Promise<{ success: true; recipientCount: number }> => {
    try {
      const prisma = await getPrisma();
      const campaign = await prisma.emailCampaign.findUniqueOrThrow({
        where: { id: data.id },
      });

      if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
        throw new Error(`Cannot send campaign in '${campaign.status}' status`);
      }

      if (!campaign.htmlContent) {
        throw new Error('Campaign has no HTML content. Preview and save before sending.');
      }

      // Build audience
      const audienceFilter = (campaign.audienceFilter as { tiers?: string[]; tags?: string[]; lastPurchaseDays?: number }) || {};
      const where = buildAudienceWhere(audienceFilter);
      const customers = await prisma.customer.findMany({
        where,
        select: { id: true, email: true },
      });

      if (customers.length === 0) {
        throw new Error('No recipients match the audience filter');
      }

      // If scheduling for later, just update status
      if (data.scheduledAt) {
        await prisma.emailCampaign.update({
          where: { id: data.id },
          data: {
            status: 'scheduled',
            scheduledAt: new Date(data.scheduledAt),
            recipientCount: customers.length,
          },
        });
        return { success: true, recipientCount: customers.length };
      }

      // Mark as sending
      await prisma.emailCampaign.update({
        where: { id: data.id },
        data: { status: 'sending', recipientCount: customers.length },
      });

      // Create recipient records
      await prisma.emailCampaignRecipient.createMany({
        data: customers.map(c => ({
          campaignId: data.id,
          customerId: c.id,
          email: c.email,
        })),
        skipDuplicates: true,
      });

      const { sendCustomerEmail } = await import('../../../../server/src/services/email/index.js');
      const rawHtml = campaign.htmlContent || '';

      const utmCampaign = campaign.utmCampaign || slugify(campaign.name);
      const html = appendUtmParams(rawHtml, {
        source: campaign.utmSource,
        medium: campaign.utmMedium,
        campaign: utmCampaign,
        ...(campaign.utmContent ? { content: campaign.utmContent } : {}),
        ...(campaign.utmTerm ? { term: campaign.utmTerm } : {}),
      });

      // Send in batches (fire-and-forget, update status async)
      const BATCH_SIZE = 50;

      // Process async — don't block the response
      (async () => {
        let sentCount = 0;
        for (let i = 0; i < customers.length; i += BATCH_SIZE) {
          const batch = customers.slice(i, i + BATCH_SIZE);
          await Promise.allSettled(
            batch.map(async (customer) => {
              try {
                const result = await sendCustomerEmail({
                  to: customer.email,
                  subject: campaign.subject,
                  html,
                  templateKey: 'campaign',
                  entityType: 'EmailCampaign',
                  entityId: data.id,
                  metadata: { customerId: customer.id },
                  configurationSetName: 'coh-campaigns',
                });

                if (result.success) {
                  await prisma.emailCampaignRecipient.update({
                    where: { campaignId_customerId: { campaignId: data.id, customerId: customer.id } },
                    data: { status: 'sent', sentAt: new Date(), emailLogId: result.emailLogId },
                  });
                  sentCount++;
                } else {
                  await prisma.emailCampaignRecipient.update({
                    where: { campaignId_customerId: { campaignId: data.id, customerId: customer.id } },
                    data: { status: 'bounced' },
                  }).catch(() => {});
                }
              } catch {
                await prisma.emailCampaignRecipient.update({
                  where: { campaignId_customerId: { campaignId: data.id, customerId: customer.id } },
                  data: { status: 'bounced' },
                }).catch(() => {});
              }
            })
          );
        }

        // Finalize campaign
        await prisma.emailCampaign.update({
          where: { id: data.id },
          data: {
            status: 'sent',
            sentAt: new Date(),
            sentCount,
          },
        });
      })().catch(err => {
        serverLog.error({ domain: 'campaigns', fn: 'sendCampaign:async' }, 'Batch send failed', err);
      });

      return { success: true, recipientCount: customers.length };
    } catch (error: unknown) {
      serverLog.error({ domain: 'campaigns', fn: 'sendCampaign' }, 'Failed to send campaign', error);
      throw error;
    }
  });

/** Get campaign analytics — recipient breakdown */
export const getCampaignRecipients = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => z.object({
    campaignId: z.string().uuid(),
    status: z.enum(['all', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed']).optional().default('all'),
    limit: z.number().int().positive().max(200).optional().default(50),
    offset: z.number().int().nonnegative().optional().default(0),
  }).parse(input))
  .handler(async ({ data }) => {
    try {
      const prisma = await getPrisma();

      const where: Prisma.EmailCampaignRecipientWhereInput = {
        campaignId: data.campaignId,
      };
      if (data.status !== 'all') {
        where.status = data.status;
      }

      const [total, recipients] = await Promise.all([
        prisma.emailCampaignRecipient.count({ where }),
        prisma.emailCampaignRecipient.findMany({
          where,
          select: {
            id: true,
            email: true,
            status: true,
            sentAt: true,
            deliveredAt: true,
            openedAt: true,
            clickedAt: true,
            customer: {
              select: { id: true, firstName: true, lastName: true, tier: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: data.limit,
          skip: data.offset,
        }),
      ]);

      return {
        recipients,
        pagination: { total, limit: data.limit, offset: data.offset, hasMore: data.offset + data.limit < total },
      };
    } catch (error: unknown) {
      serverLog.error({ domain: 'campaigns', fn: 'getCampaignRecipients' }, 'Failed to get recipients', error);
      throw error;
    }
  });

/** Delete a draft campaign */
export const deleteCampaign = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => campaignIdSchema.parse(input))
  .handler(async ({ data }): Promise<{ success: true }> => {
    try {
      const prisma = await getPrisma();
      const campaign = await prisma.emailCampaign.findUniqueOrThrow({
        where: { id: data.id },
        select: { status: true },
      });

      if (campaign.status !== 'draft') {
        throw new Error(`Cannot delete campaign in '${campaign.status}' status. Cancel it first.`);
      }

      await prisma.emailCampaign.delete({ where: { id: data.id } });
      return { success: true };
    } catch (error: unknown) {
      serverLog.error({ domain: 'campaigns', fn: 'deleteCampaign' }, 'Failed to delete campaign', error);
      throw error;
    }
  });

/** Cancel a scheduled campaign */
export const cancelCampaign = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => campaignIdSchema.parse(input))
  .handler(async ({ data }): Promise<{ success: true }> => {
    try {
      const prisma = await getPrisma();
      const campaign = await prisma.emailCampaign.findUniqueOrThrow({
        where: { id: data.id },
        select: { status: true },
      });

      if (campaign.status !== 'scheduled' && campaign.status !== 'sending') {
        throw new Error(`Cannot cancel campaign in '${campaign.status}' status`);
      }

      await prisma.emailCampaign.update({
        where: { id: data.id },
        data: { status: 'cancelled' },
      });

      return { success: true };
    } catch (error: unknown) {
      serverLog.error({ domain: 'campaigns', fn: 'cancelCampaign' }, 'Failed to cancel campaign', error);
      throw error;
    }
  });

/** Get sent campaigns for "start from" picker */
export const getSentCampaigns = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async (): Promise<Array<{ id: string; name: string; subject: string; sentAt: Date | null }>> => {
    try {
      const prisma = await getPrisma();
      return prisma.emailCampaign.findMany({
        where: { status: 'sent', htmlContent: { not: null } },
        select: { id: true, name: true, subject: true, sentAt: true },
        orderBy: { sentAt: 'desc' },
        take: 20,
      });
    } catch (error: unknown) {
      serverLog.error({ domain: 'campaigns', fn: 'getSentCampaigns' }, 'Failed to get sent campaigns', error);
      throw error;
    }
  });

/** Get aggregate stats for the campaign list page */
export const getCampaignStats = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async (): Promise<{ totalSent: number; avgOpenRate: number; avgClickRate: number; avgBounceRate: number }> => {
    try {
      const prisma = await getPrisma();
      const sentCampaigns = await prisma.emailCampaign.findMany({
        where: { status: 'sent' },
        select: { sentCount: true, openCount: true, clickCount: true, bounceCount: true },
      });

      if (sentCampaigns.length === 0) {
        return { totalSent: 0, avgOpenRate: 0, avgClickRate: 0, avgBounceRate: 0 };
      }

      const totalSent = sentCampaigns.reduce((sum, c) => sum + c.sentCount, 0);
      const totalOpens = sentCampaigns.reduce((sum, c) => sum + c.openCount, 0);
      const totalClicks = sentCampaigns.reduce((sum, c) => sum + c.clickCount, 0);
      const totalBounces = sentCampaigns.reduce((sum, c) => sum + c.bounceCount, 0);

      return {
        totalSent,
        avgOpenRate: totalSent > 0 ? Math.round((totalOpens / totalSent) * 1000) / 10 : 0,
        avgClickRate: totalSent > 0 ? Math.round((totalClicks / totalSent) * 1000) / 10 : 0,
        avgBounceRate: totalSent > 0 ? Math.round((totalBounces / totalSent) * 1000) / 10 : 0,
      };
    } catch (error: unknown) {
      serverLog.error({ domain: 'campaigns', fn: 'getCampaignStats' }, 'Failed to get campaign stats', error);
      throw error;
    }
  });
