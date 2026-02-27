/**
 * Forecast Routes
 *
 * POST /api/forecast/run          — Run forecast, save to DB, return data
 * POST /api/forecast/analyze      — Stream Claude analysis, save to DB
 * GET  /api/forecast/history      — List past forecast runs
 * GET  /api/forecast/:id          — Get a specific forecast
 * POST /api/forecast/clear-cache  — Clear in-memory cache
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import prisma from '../lib/prisma.js';

const log = logger.child({ module: 'forecastRoutes' });
const router: Router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In-memory cache (avoid re-running script on quick refreshes)
let cachedForecast: unknown = null;
let cachedAt: number | null = null;
let cachedId: string | null = null;

// ─── Run Forecast ───────────────────────────────────────────────────

router.post('/run', authenticateToken, requireAdmin, async (req: Request, res: Response): Promise<void> => {
    const userId = (req as unknown as Record<string, unknown>).userId as string | undefined;

    // Return memory cache if fresh (< 1 hour) and not force-refreshed
    const forceRefresh = req.body?.forceRefresh === true;
    if (!forceRefresh && cachedForecast && cachedAt && cachedId && (Date.now() - cachedAt < 3600_000)) {
        log.info('Returning cached forecast');
        res.json({ data: cachedForecast, id: cachedId, cached: true });
        return;
    }

    try {
        log.info({ forceRefresh }, 'Running demand forecast script...');
        const scriptPath = path.resolve(__dirname, '../../../scripts/demand-forecast.py');
        const result = await runPythonScript(scriptPath) as Record<string, unknown>;
        const fabrics = result.fabricRequirements as Array<unknown> | undefined;
        log.info({ fabricTypes: fabrics?.length ?? 0 }, 'Forecast script completed');

        // Extract summary fields for quick listing
        const summary = result.summary as Record<string, number> | undefined;

        // Save to DB
        const saved = await prisma.demandForecast.create({
            data: {
                createdById: userId ?? null,
                forecastWeeks: (result.forecastWeeks as number) ?? 8,
                data: result as object,
                totalUnits: summary?.totalForecastUnits ?? null,
                productCount: summary?.productsForecasted ?? null,
                shortfallCount: summary?.shortfallCount ?? null,
            },
        });

        log.info({ forecastId: saved.id }, 'Forecast saved to DB');

        // Update memory cache
        cachedForecast = result;
        cachedAt = Date.now();
        cachedId = saved.id;

        res.json({ data: result, id: saved.id, cached: false });
    } catch (error: unknown) {
        log.error({ error }, 'Forecast script failed');
        res.status(500).json({ error: error instanceof Error ? error.message : 'Forecast failed' });
    }
});

// ─── AI Analysis (SSE stream) ───────────────────────────────────────

router.post('/analyze', authenticateToken, requireAdmin, async (req: Request, res: Response): Promise<void> => {
    const { forecastData, forecastId } = req.body as {
        forecastData?: Record<string, unknown>;
        forecastId?: string;
    };
    if (!forecastData) {
        res.status(400).json({ error: 'forecastData is required' });
        return;
    }

    if (!env.ANTHROPIC_API_KEY) {
        res.status(500).json({ error: 'Anthropic API key not configured' });
        return;
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

        const fd = forecastData;
        const summary = fd.summary;
        const products = (fd.products as Array<Record<string, unknown>>)?.map(
            (p: Record<string, unknown>) => ({
                name: p.name,
                last12moUnits: p.last12moUnits,
                recent8wAvg: p.recent8wAvg,
                forecastTotal: p.forecastTotal,
                topColours: (p.colourBreakdown as Array<unknown>)?.slice(0, 3),
            })
        );
        const fabricShortfalls = (fd.purchaseOrders as Array<unknown>)?.slice(0, 15);
        const overall = fd.overall;
        const seasonality = (fd.overall as Record<string, unknown>)?.seasonality;

        const dataPayload = JSON.stringify(
            { overall, summary, products, fabricShortfalls, seasonality },
            null,
            2,
        );

        const stream = await client.messages.stream({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 2000,
            system: `You are the chief analyst for Creatures of Habit, a sustainable fashion brand in India.
You're analyzing demand forecast data produced by an ML model (SARIMA + XGBoost ensemble).
Give actionable business insights. Be specific with numbers. Use markdown formatting.
Structure your response as:
## Key Insights
## Product Strategy
## Fabric Procurement
## Risks & Recommendations`,
            messages: [
                {
                    role: 'user',
                    content: `Here is our demand forecast data for the next ${fd.forecastWeeks} weeks. Analyze it and give me actionable business insights.\n\n${dataPayload}`,
                },
            ],
        });

        let fullAnalysis = '';

        for await (const event of stream) {
            if (event.type === 'content_block_delta') {
                const delta = event.delta as unknown as Record<string, string>;
                if (delta?.type === 'text_delta' && delta.text) {
                    fullAnalysis += delta.text;
                    res.write(`data: ${JSON.stringify({ type: 'text', text: delta.text })}\n\n`);
                }
            }
        }

        // Save analysis to the forecast record
        if (forecastId && fullAnalysis) {
            await prisma.demandForecast.update({
                where: { id: forecastId },
                data: { aiAnalysis: fullAnalysis },
            }).catch((err: unknown) => {
                log.warn({ err, forecastId }, 'Failed to save AI analysis to forecast');
            });
        }

        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
    } catch (error: unknown) {
        log.error({ error }, 'Claude analysis failed');
        res.write(
            `data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Analysis failed' })}\n\n`,
        );
        res.end();
    }
});

// ─── History ────────────────────────────────────────────────────────

router.get('/history', authenticateToken, async (_req: Request, res: Response): Promise<void> => {
    try {
        const forecasts = await prisma.demandForecast.findMany({
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
                id: true,
                createdAt: true,
                forecastWeeks: true,
                totalUnits: true,
                productCount: true,
                shortfallCount: true,
                aiAnalysis: true,
            },
        });

        // Return hasAnalysis flag instead of full text for listing
        const items = forecasts.map(f => ({
            ...f,
            hasAnalysis: !!f.aiAnalysis,
            aiAnalysis: undefined,
        }));

        res.json({ data: items });
    } catch (error: unknown) {
        log.error({ error }, 'Failed to fetch forecast history');
        res.status(500).json({ error: 'Failed to load history' });
    }
});

// ─── Get Single Forecast ────────────────────────────────────────────

router.get('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    try {
        const forecast = await prisma.demandForecast.findUnique({
            where: { id: req.params.id as string },
        });

        if (!forecast) {
            res.status(404).json({ error: 'Forecast not found' });
            return;
        }

        res.json({ data: forecast.data, id: forecast.id, aiAnalysis: forecast.aiAnalysis, createdAt: forecast.createdAt });
    } catch (error: unknown) {
        log.error({ error }, 'Failed to fetch forecast');
        res.status(500).json({ error: 'Failed to load forecast' });
    }
});

// ─── Clear Cache ────────────────────────────────────────────────────

router.post('/clear-cache', authenticateToken, requireAdmin, (_req: Request, res: Response): void => {
    cachedForecast = null;
    cachedAt = null;
    cachedId = null;
    res.json({ ok: true });
});

// ─── Helpers ────────────────────────────────────────────────────────

function runPythonScript(scriptPath: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const proc = spawn('python3', [scriptPath, '--json'], {
            cwd: path.resolve(__dirname, '../../..'),
            timeout: 300_000, // 5 min — 70 ML models take 2-3 min
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
        proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

        proc.on('close', (code: number | null) => {
            if (code !== 0) {
                reject(new Error(`Script exited with code ${code}: ${stderr}`));
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch (e: unknown) {
                reject(new Error(`Failed to parse script output: ${e instanceof Error ? e.message : String(e)}`));
            }
        });

        proc.on('error', (err: Error) => reject(err));
    });
}

export default router;
