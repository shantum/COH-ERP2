/**
 * Invoice Matcher Service
 *
 * Tries to auto-match parsed invoice lines to:
 * 1. Existing FabricColour records (fuzzy name matching)
 * 2. Existing unmatched inward transactions (by fabric colour + similar qty + recent date)
 *
 * All matches are suggestions — the user always confirms.
 */

import type { PrismaClient } from '@prisma/client';
import type { ParsedLine } from './invoiceParser.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'invoiceMatcher' });

// ============================================
// TYPES
// ============================================

export interface MatchedLine {
    /** Original parsed line index */
    lineIndex: number;
    /** Suggested FabricColour ID */
    fabricColourId: string | null;
    /** Suggested FabricColourTransaction ID (existing unmatched inward) */
    matchedTxnId: string | null;
    /** How this match was determined */
    matchType: 'auto_matched' | null;
    /** Confidence of fabric colour match (0-1) */
    fabricMatchScore: number;
}

// ============================================
// MATCHING LOGIC
// ============================================

/**
 * Match parsed invoice lines to existing fabric colours and transactions.
 *
 * @param lines - Parsed invoice lines from AI
 * @param partyId - Party ID (if identified)
 * @param prisma - Prisma client
 */
export async function matchInvoiceLines(
    lines: ParsedLine[],
    partyId: string | null,
    prisma: PrismaClient,
): Promise<MatchedLine[]> {
    if (lines.length === 0) return [];

    // Load all active fabric colours with their fabric info
    const fabricColours = await prisma.fabricColour.findMany({
        where: { isActive: true },
        include: {
            fabric: {
                select: {
                    name: true,
                    composition: true,
                    partyId: true,
                },
            },
        },
    });

    log.info({ lineCount: lines.length, fabricColourCount: fabricColours.length }, 'Starting invoice line matching');

    const results: MatchedLine[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const desc = (line.description ?? '').toLowerCase().trim();

        if (!desc) {
            results.push({ lineIndex: i, fabricColourId: null, matchedTxnId: null, matchType: null, fabricMatchScore: 0 });
            continue;
        }

        // PASS 1: Match to FabricColour by name similarity
        let bestMatch: { id: string; score: number } | null = null;

        for (const fc of fabricColours) {
            const score = computeMatchScore(desc, fc, partyId);
            if (score > (bestMatch?.score ?? 0) && score >= 0.3) {
                bestMatch = { id: fc.id, score };
            }
        }

        results.push({
            lineIndex: i,
            fabricColourId: bestMatch?.id ?? null,
            matchedTxnId: null,
            matchType: bestMatch ? 'auto_matched' : null,
            fabricMatchScore: bestMatch?.score ?? 0,
        });
    }

    const matched = results.filter(r => r.fabricColourId).length;
    log.info({ matched, total: lines.length }, 'Invoice line matching complete');

    return results;
}

// ============================================
// SCORING
// ============================================

/**
 * Compute a match score (0-1) between a parsed description and a FabricColour.
 * Uses simple keyword overlap. Boosts score if party matches.
 */
function computeMatchScore(
    desc: string,
    fc: {
        colourName: string;
        code: string | null;
        fabric: { name: string; composition: string | null; partyId: string | null };
    },
    partyId: string | null,
): number {
    const targets = [
        fc.colourName.toLowerCase(),
        fc.fabric.name.toLowerCase(),
        fc.code?.toLowerCase() ?? '',
        fc.fabric.composition?.toLowerCase() ?? '',
    ].filter(Boolean);

    // Check if code matches exactly (strongest signal)
    if (fc.code && desc.includes(fc.code.toLowerCase())) {
        return 0.95;
    }

    // Token-based overlap
    const descTokens = tokenize(desc);
    const targetTokens = new Set(targets.flatMap(t => tokenize(t)));

    if (descTokens.length === 0 || targetTokens.size === 0) return 0;

    let hits = 0;
    for (const token of descTokens) {
        if (targetTokens.has(token)) hits++;
    }

    let score = hits / Math.max(descTokens.length, targetTokens.size);

    // Boost if colour name is found in description
    if (desc.includes(fc.colourName.toLowerCase())) {
        score = Math.min(1, score + 0.2);
    }

    // Boost if fabric name is found in description
    if (desc.includes(fc.fabric.name.toLowerCase())) {
        score = Math.min(1, score + 0.15);
    }

    // Boost if party matches
    if (partyId && fc.fabric.partyId === partyId) {
        score = Math.min(1, score + 0.1);
    }

    return score;
}

/**
 * Tokenize a string into lowercase words, removing common noise.
 */
function tokenize(str: string): string[] {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

const STOP_WORDS = new Set([
    'the', 'and', 'for', 'per', 'nos', 'pcs', 'mtr', 'mtrs',
    'meter', 'meters', 'kg', 'yard', 'yards', 'fabric',
]);

