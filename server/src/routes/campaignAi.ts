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

export default router;
