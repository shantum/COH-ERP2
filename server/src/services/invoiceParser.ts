/**
 * Invoice Parser Service
 *
 * Sends invoice PDFs/photos to Claude Sonnet Vision API
 * and extracts structured invoice data (supplier, line items, totals, GST).
 *
 * Handles any Indian business invoice (fabric, service, rent, etc.)
 * with DD/MM/YYYY dates, GST, INR.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'invoiceParser' });

// ============================================
// RESPONSE SCHEMA (what AI returns)
// ============================================

const ParsedLineSchema = z.object({
    description: z.string().nullable().optional(),
    hsnCode: z.string().nullable().optional(),
    qty: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
    rate: z.number().nullable().optional(),
    amount: z.number().nullable().optional(),
    gstPercent: z.number().nullable().optional(),
    gstAmount: z.number().nullable().optional(),
});

const ParsedInvoiceSchema = z.object({
    invoiceNumber: z.string().nullable().optional(),
    invoiceDate: z.string().nullable().optional(),     // DD/MM/YYYY or ISO
    dueDate: z.string().nullable().optional(),         // DD/MM/YYYY or ISO
    billingPeriod: z.string().nullable().optional(),   // YYYY-MM
    supplierName: z.string().nullable().optional(),
    supplierGstin: z.string().nullable().optional(),
    subtotal: z.number().nullable().optional(),
    gstAmount: z.number().nullable().optional(),
    totalAmount: z.number().nullable().optional(),
    lines: z.array(ParsedLineSchema).default([]),
    confidence: z.number().min(0).max(1).default(0.5),
});

export type ParsedInvoice = z.infer<typeof ParsedInvoiceSchema>;
export type ParsedLine = z.infer<typeof ParsedLineSchema>;

// ============================================
// SYSTEM PROMPT
// ============================================

const SYSTEM_PROMPT = `You are an expert at reading Indian business invoices. Extract structured data from the invoice image or PDF.

IMPORTANT RULES:
- Dates are typically DD/MM/YYYY format (Indian standard). Return them as DD/MM/YYYY.
- Currency is INR (Indian Rupees). Return numbers without currency symbols.
- GST can be SGST+CGST (intra-state) or IGST (inter-state). Sum them for total GST.
- This could be any kind of Indian invoice: fabric, trims, services, rent, logistics, software, marketing, etc.
- For fabric invoices: "Mtr" or "Mtrs" = meters, "Kg" = kilograms, "Yds" = yards.
- For service invoices: look for SAC codes (service accounting codes) in addition to HSN codes.
- billingPeriod: If the invoice covers a specific month (e.g. "for the month of January 2026" or "Jan 2026"), return as "YYYY-MM". For recurring services (rent, software, salaries), the billing period is usually mentioned. If not clear, derive from invoiceDate as "YYYY-MM".
- dueDate: Extract if present ("due by", "payment due", "pay before", etc.). Return as DD/MM/YYYY.
- If a field is not visible or you can't read it, set it to null.
- Set confidence from 0 to 1 based on how clearly you could read the invoice.

Return ONLY valid JSON matching this structure (no markdown, no code fences):
{
  "invoiceNumber": "string or null",
  "invoiceDate": "DD/MM/YYYY or null",
  "dueDate": "DD/MM/YYYY or null",
  "billingPeriod": "YYYY-MM or null",
  "supplierName": "string or null",
  "supplierGstin": "string or null",
  "subtotal": number or null,
  "gstAmount": number or null,
  "totalAmount": number or null,
  "confidence": number between 0 and 1,
  "lines": [
    {
      "description": "item or service description",
      "hsnCode": "HSN or SAC code or null",
      "qty": number or null,
      "unit": "string or null",
      "rate": number or null,
      "amount": number or null,
      "gstPercent": number or null,
      "gstAmount": number or null
    }
  ]
}`;

// ============================================
// MODEL CONFIG
// ============================================

const AI_MODEL = 'claude-sonnet-4-5-20250929';

// ============================================
// PARSER
// ============================================

/**
 * Parse an invoice file (PDF or image) using Claude Vision API.
 *
 * @param fileBuffer - The raw file bytes
 * @param mimeType - "application/pdf", "image/jpeg", "image/png", etc.
 * @returns Parsed invoice data + raw AI response
 */
export async function parseInvoice(
    fileBuffer: Buffer,
    mimeType: string,
): Promise<{ parsed: ParsedInvoice; rawResponse: string; model: string }> {
    if (!env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is not configured. Add it to your .env file.');
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const base64Data = fileBuffer.toString('base64');

    // Build the content block based on file type
    const contentBlock = mimeType === 'application/pdf'
        ? {
            type: 'document' as const,
            source: {
                type: 'base64' as const,
                media_type: 'application/pdf' as const,
                data: base64Data,
            },
        }
        : {
            type: 'image' as const,
            source: {
                type: 'base64' as const,
                media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: base64Data,
            },
        };

    log.info({ mimeType, sizeBytes: fileBuffer.length }, 'Sending invoice to AI for parsing');

    const response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
            {
                role: 'user',
                content: [
                    contentBlock,
                    { type: 'text', text: 'Extract all invoice data from this invoice. Return JSON only.' },
                ],
            },
        ],
    });

    // Extract text from response
    const textBlock = response.content.find(block => block.type === 'text');
    const rawText = textBlock && 'text' in textBlock ? textBlock.text : '';

    log.info({ rawLength: rawText.length, model: AI_MODEL }, 'AI response received');

    // Parse the JSON response (strip code fences if present)
    const cleanJson = rawText
        .replace(/^```(?:json)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();

    let parsed: ParsedInvoice;
    try {
        const raw = JSON.parse(cleanJson);
        parsed = ParsedInvoiceSchema.parse(raw);
    } catch (parseError: unknown) {
        log.error({ rawText, error: parseError instanceof Error ? parseError.message : parseError }, 'Failed to parse AI response');
        // Return empty result with low confidence instead of throwing
        parsed = {
            invoiceNumber: null,
            invoiceDate: null,
            dueDate: null,
            billingPeriod: null,
            supplierName: null,
            supplierGstin: null,
            subtotal: null,
            gstAmount: null,
            totalAmount: null,
            lines: [],
            confidence: 0,
        };
    }

    return {
        parsed,
        rawResponse: rawText,
        model: AI_MODEL,
    };
}

/**
 * Parse a DD/MM/YYYY date string to a Date object.
 * Returns null if parsing fails.
 */
export function parseIndianDate(dateStr: string | null | undefined): Date | null {
    if (!dateStr) return null;

    // Try DD/MM/YYYY first (Indian format)
    const ddmmyyyy = dateStr.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (ddmmyyyy) {
        const [, day, month, year] = ddmmyyyy;
        const date = new Date(Number(year), Number(month) - 1, Number(day));
        if (!isNaN(date.getTime())) return date;
    }

    // Fallback to ISO / standard Date parse
    const fallback = new Date(dateStr);
    if (!isNaN(fallback.getTime())) return fallback;

    return null;
}
