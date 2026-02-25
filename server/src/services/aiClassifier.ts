/**
 * AI-powered text classifier using Claude Haiku.
 *
 * Used for classifying return reasons from free-text customer comments.
 * Falls back to regex-based classification if API key is missing or call fails.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'aiClassifier' });

const AI_MODEL = 'claude-haiku-4-5-20251001';

// ============================================
// RETURN REASON CLASSIFICATION
// ============================================

/** Valid return reason categories — must match ReturnReasonCategory */
const VALID_CATEGORIES = [
    'fit_size',
    'product_quality',
    'product_different',
    'wrong_item_sent',
    'damaged_in_transit',
    'changed_mind',
    'other',
] as const;

type ReturnReasonCategory = (typeof VALID_CATEGORIES)[number];

const SYSTEM_PROMPT = `Classify this clothing return comment into one category. Reply with ONLY the category key.

fit_size — size/fit issue, need different size, loose, tight, baggy
product_quality — defect, fabric issue, stitching, fading, uncomfortable
product_different — looks different from listing/photos, color mismatch
wrong_item_sent — received wrong item entirely
damaged_in_transit — arrived torn, broken, damaged
changed_mind — don't want it, not satisfied, ordered by mistake
other — can't determine from comment`;

/**
 * Classify a single return comment using AI.
 * Falls back to 'other' on any error.
 */
export async function classifyReturnComment(
    comment: string,
): Promise<ReturnReasonCategory> {
    if (!comment || !comment.trim()) return 'other';
    if (!env.ANTHROPIC_API_KEY) {
        log.warn('No ANTHROPIC_API_KEY — falling back to regex classifier');
        // Dynamic import to avoid circular deps
        const { mapReturnPrimeReason } = await import('../config/mappings/returnPrimeReasons.js');
        return mapReturnPrimeReason(comment);
    }

    try {
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
            model: AI_MODEL,
            max_tokens: 20,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: comment.trim() }],
        });

        const text = response.content[0]?.type === 'text'
            ? response.content[0].text.trim().toLowerCase()
            : 'other';

        // Validate the response is a valid category
        if (VALID_CATEGORIES.includes(text as ReturnReasonCategory)) {
            return text as ReturnReasonCategory;
        }

        log.warn({ comment, aiResponse: text }, 'AI returned invalid category');
        return 'other';
    } catch (error) {
        log.error({ error, comment }, 'AI classification failed');
        const { mapReturnPrimeReason } = await import('../config/mappings/returnPrimeReasons.js');
        return mapReturnPrimeReason(comment);
    }
}

/**
 * Classify multiple return comments in a single AI call.
 * More efficient than individual calls for batch operations.
 * Falls back to individual regex classification on error.
 */
export async function classifyReturnCommentsBatch(
    comments: Array<{ id: string; comment: string }>,
): Promise<Map<string, ReturnReasonCategory>> {
    const results = new Map<string, ReturnReasonCategory>();

    // Handle empties upfront
    const toClassify = comments.filter(c => c.comment?.trim());
    for (const c of comments) {
        if (!c.comment?.trim()) results.set(c.id, 'other');
    }

    if (toClassify.length === 0) return results;

    if (!env.ANTHROPIC_API_KEY) {
        log.warn('No ANTHROPIC_API_KEY — falling back to regex for batch');
        const { mapReturnPrimeReason } = await import('../config/mappings/returnPrimeReasons.js');
        for (const c of toClassify) {
            results.set(c.id, mapReturnPrimeReason(c.comment));
        }
        return results;
    }

    // Batch in groups of 50 to stay within reasonable token limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < toClassify.length; i += BATCH_SIZE) {
        const batch = toClassify.slice(i, i + BATCH_SIZE);
        try {
            const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

            const numbered = batch
                .map((c, idx) => `${idx + 1}. ${c.comment.trim()}`)
                .join('\n');

            const response = await client.messages.create({
                model: AI_MODEL,
                max_tokens: batch.length * 30,
                system: SYSTEM_PROMPT + `\n\nYou will receive numbered comments. Respond with one category per line in format: "NUMBER. category"
Example input:
1. Too tight around shoulders
2. Color looks nothing like the photo

Example output:
1. fit_size
2. product_different`,
                messages: [{ role: 'user', content: numbered }],
            });

            const text = response.content[0]?.type === 'text'
                ? response.content[0].text.trim()
                : '';

            // Parse numbered responses
            const lines = text.split('\n');
            for (const line of lines) {
                const match = line.match(/^(\d+)\.\s*(\S+)/);
                if (!match) continue;
                const idx = parseInt(match[1], 10) - 1;
                const category = match[2].toLowerCase() as ReturnReasonCategory;
                if (idx >= 0 && idx < batch.length && VALID_CATEGORIES.includes(category)) {
                    results.set(batch[idx].id, category);
                }
            }

            // Fill in any that weren't parsed
            for (const c of batch) {
                if (!results.has(c.id)) {
                    results.set(c.id, 'other');
                }
            }

            log.info({ batchSize: batch.length, offset: i }, 'AI batch classification complete');
        } catch (error) {
            log.error({ error, batchSize: batch.length }, 'AI batch classification failed, falling back to regex');
            const { mapReturnPrimeReason } = await import('../config/mappings/returnPrimeReasons.js');
            for (const c of batch) {
                if (!results.has(c.id)) {
                    results.set(c.id, mapReturnPrimeReason(c.comment));
                }
            }
        }
    }

    return results;
}
