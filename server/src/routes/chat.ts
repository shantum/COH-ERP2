/**
 * Chat Agent Routes
 *
 * POST /api/chat/message  — Stream a chat response (SSE)
 * POST /api/chat/confirm  — Execute a confirmed mutating action
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { streamChat, executeAction, type ChatMessage, type FileAttachment } from '../services/chatAgent/index.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'chatRoutes' });
const router = Router();

// ============================================
// FILE UPLOAD CONFIG
// ============================================

const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}. Use PDF, JPEG, PNG, or WebP.`));
        }
    },
});

// ============================================
// VALIDATION SCHEMAS
// ============================================

const MessagePayloadSchema = z.object({
    messages: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
    })).min(1, 'At least one message is required'),
});

const ConfirmSchema = z.object({
    actionId: z.string().min(1),
    toolName: z.string().min(1),
    toolInput: z.record(z.string(), z.unknown()),
});

// ============================================
// POST /message — Stream chat response (SSE)
// ============================================

router.post('/message', authenticateToken, upload.array('files', 5), asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    // Parse the JSON payload from the multipart form
    const rawPayload = req.body.payload;
    if (!rawPayload) {
        res.status(400).json({ error: 'Missing "payload" field in request body' });
        return;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload));
    } catch {
        res.status(400).json({ error: 'Invalid JSON in "payload" field' });
        return;
    }

    const validation = MessagePayloadSchema.safeParse(parsed);
    if (!validation.success) {
        res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid payload' });
        return;
    }

    const { messages } = validation.data;

    // Convert uploaded files to base64 attachments
    const files: FileAttachment[] = [];
    if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
            files.push({
                base64Data: file.buffer.toString('base64'),
                mimeType: file.mimetype,
                fileName: file.originalname,
            });
        }
    }

    log.info({ userId, messageCount: messages.length, fileCount: files.length }, 'Chat message received');

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Stream the response
    const chatMessages: ChatMessage[] = messages.map(m => ({
        role: m.role,
        content: m.content,
    }));

    try {
        for await (const chunk of streamChat(chatMessages, userId, files.length > 0 ? files : undefined)) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Stream error';
        log.error({ error: message }, 'Chat stream failed');
        res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    }

    res.end();
}));

// ============================================
// POST /confirm — Execute confirmed action
// ============================================

router.post('/confirm', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const validation = ConfirmSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid request' });
        return;
    }

    const { actionId, toolName, toolInput } = validation.data;

    log.info({ userId, actionId, toolName }, 'Action confirmed');

    const result = await executeAction(toolName, toolInput, userId);
    res.json(result);
}));

export default router;
