/**
 * Image Upload Routes
 *
 * Simple Express endpoint for uploading product images.
 * Saves files to server/uploads/products/ and returns the URL path.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// ============================================
// MULTER CONFIG
// ============================================

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'products');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e4)}`;
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${unique}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${ext} not allowed. Use: ${allowed.join(', ')}`));
        }
    },
});

// ============================================
// UPLOAD ENDPOINT
// ============================================

/**
 * POST /api/uploads/images
 * Upload a single product image. Returns the public URL path.
 */
router.post(
    '/images',
    requireAdmin,
    upload.single('image'),
    asyncHandler(async (req: Request, res: Response) => {
        if (!req.file) {
            res.status(400).json({ error: 'No image file provided' });
            return;
        }

        const url = `/api/uploads/products/${req.file.filename}`;
        res.json({ success: true, url });
    }),
);

export default router;
