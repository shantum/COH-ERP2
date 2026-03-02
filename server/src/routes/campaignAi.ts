/**
 * Campaign AI — SSE endpoint for AI-powered email generation.
 *
 * POST /api/campaigns/ai/generate
 *   - Takes a user prompt + optional current HTML
 *   - Streams back generated email HTML via SSE
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'campaignAi' });
const router = Router();

// ============================================
// VALIDATION
// ============================================

const GenerateSchema = z.object({
  prompt: z.string().min(1).max(2000),
  currentHtml: z.string().optional(),
});

// ============================================
// SYSTEM PROMPT
// ============================================

const SYSTEM_PROMPT = `You are an expert email designer for Creatures of Habit, a sustainable apparel brand based in Goa, India. You generate beautiful, production-ready marketing email HTML.

BRAND IDENTITY:
- Brand: Creatures of Habit (COH)
- Aesthetic: Warm, earthy, minimalist. Think linen textures, muted earth tones, confident typography.
- Colors: Stone/warm neutrals (#1c1917, #292524, #faf9f7), accent red (#b91c1c), amber (#92400e), muted greens
- Voice: Warm but confident. Not salesy. Speaks to people who value quality and intention.
- Based in Goa, India. Sustainable, thoughtful apparel.

EMAIL HTML RULES (critical — emails break without these):
- Use ONLY inline styles. No <style> tags, no CSS classes.
- Use table-based layout for maximum email client compatibility.
- All images must use absolute URLs (use placeholder https://placehold.co/ URLs).
- No JavaScript, no forms, no iframes.
- Max width: 600px, centered.
- Use web-safe fonts with fallbacks: font-family: Georgia, 'Times New Roman', serif for headings; font-family: Arial, Helvetica, sans-serif for body.
- Background colors are safe. Gradients are NOT safe in email.
- Always include an unsubscribe link placeholder: {{unsubscribe_url}}
- Always include the brand header "CREATURES OF HABIT" at the top.
- Include a footer with: Creatures of Habit · Goa, India · Unsubscribe link.

PRODUCT PLACEHOLDERS:
- Use {{product_1_image}}, {{product_1_title}}, {{product_1_price}}, {{product_1_url}} etc.
- These will be replaced with real Shopify product data at send time.

OUTPUT:
- Return ONLY the complete HTML email markup. No explanations, no markdown, no code fences.
- Start with <!DOCTYPE html> or directly with the HTML.
- The email should be complete and ready to send.`;

// ============================================
// POST /generate — Stream AI email HTML (SSE)
// ============================================

router.post('/generate', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Anthropic API key not configured' });
    return;
  }

  const validation = GenerateSchema.safeParse(req.body);
  if (!validation.success) {
    res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid request' });
    return;
  }

  const { prompt, currentHtml } = validation.data;
  const userId = req.user!.id;

  log.info({ userId, promptLength: prompt.length, hasCurrentHtml: !!currentHtml }, 'AI email generation requested');

  // Build user message
  let userMessage = prompt;
  if (currentHtml) {
    userMessage = `Here is the current email HTML I want you to modify:\n\n${currentHtml}\n\nInstructions: ${prompt}`;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'text_delta', text })}\n\n`);
    });

    await stream.finalMessage();

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'AI generation failed';
    log.error({ error: message }, 'Campaign AI generation failed');
    res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  }

  res.end();
}));

// ============================================
// POST /audience — AI-powered audience filter generation
// ============================================

const AudiencePromptSchema = z.object({
  prompt: z.string().min(1).max(1000),
});

const AUDIENCE_SYSTEM_PROMPT = `You are an audience segmentation expert for Creatures of Habit (COH), a sustainable apparel brand based in Goa, India.

Given a natural language description of a target audience, return a JSON object matching the AudienceFilters schema below. Return ONLY valid JSON, no explanations or markdown.

SCHEMA:
{
  "tiers": string[],              // Customer tiers: "gold", "silver", "bronze", "platinum", "new"
  "orderCountMin": number,        // Minimum number of orders
  "orderCountMax": number,        // Maximum number of orders
  "ltvMin": number,               // Minimum lifetime value in INR
  "ltvMax": number,               // Maximum lifetime value in INR
  "lastPurchaseWithin": number,   // Purchased within N days (active customers)
  "lastPurchaseBefore": number,   // Haven't purchased in N+ days (churned)
  "firstPurchaseWithin": number,  // First order within N days (new customers)
  "tagsInclude": string[],        // Has any of these tags
  "tagsExclude": string[],        // Does NOT have these tags
  "returnCountMin": number,       // Minimum return count
  "returnCountMax": number,       // Maximum return count
  "states": string[],             // Indian states (e.g. "Goa", "Maharashtra", "Karnataka")
  "acceptsMarketing": boolean,    // Opted into marketing emails
  "hasStoreCredit": boolean,      // Has store credit balance > 0
  "customerSince": number         // Account created within N days
}

Only include fields that are relevant to the description. Omit fields that aren't mentioned or implied.

COH CONTEXT:
- Tiers: gold (top spenders, LTV usually 15000+), silver (regular buyers, LTV 5000-15000), bronze (occasional, LTV 1000-5000), platinum (VIP/wholesale), new (first-time)
- Typical order value: 1500-4000 INR
- "Repeat buyer" = orderCountMin: 2
- "Loyal" usually means gold/silver tiers or orderCountMin: 3+
- "Churned" or "inactive" = lastPurchaseBefore: 90 or 180
- "Recent" = lastPurchaseWithin: 30 or 60
- "High value" = gold tier or ltvMin: 10000
- Major customer states: Maharashtra, Delhi, Karnataka, Goa, Tamil Nadu, Telangana

Return a JSON object with TWO keys:
1. "filters": the AudienceFilters object
2. "explanation": a brief 1-2 sentence explanation of how you interpreted the request`;

router.post('/audience', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Anthropic API key not configured' });
    return;
  }

  const validation = AudiencePromptSchema.safeParse(req.body);
  if (!validation.success) {
    res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid request' });
    return;
  }

  const { prompt } = validation.data;
  const userId = req.user!.id;

  log.info({ userId, promptLength: prompt.length }, 'AI audience generation requested');

  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: AUDIENCE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract text from response
    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      res.status(500).json({ error: 'No text response from AI' });
      return;
    }

    // Parse JSON from response (handle potential markdown code fences)
    let jsonStr = textBlock.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }

    const parsed = JSON.parse(jsonStr);
    res.json({
      filters: parsed.filters || parsed,
      explanation: parsed.explanation || 'Audience filters generated from your description.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'AI audience generation failed';
    log.error({ error: message }, 'Audience AI generation failed');
    res.status(500).json({ error: message });
  }
}));

export default router;
