/**
 * @fileoverview Pincode Routes - CSV upload and lookup for geographic analysis
 *
 * Features:
 * - CSV upload with deduplication (one row per pincode)
 * - Replace-all strategy (clean slate on each upload)
 * - Batch insert (1000 rows at a time) for performance
 * - Single and batch pincode lookup
 * - Upload statistics
 *
 * Key Patterns:
 * - Multer memory storage for file uploads
 * - fast-csv for CSV parsing
 * - Flexible column name mapping (statename → state, etc.)
 * - Raw SQL for efficient batch inserts
 */

import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parse } from 'fast-csv';
import multer from 'multer';
import { Readable } from 'stream';

const router = Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for large pincode files
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    },
});

// ============================================
// TYPE DEFINITIONS (JSDoc)
// ============================================

/**
 * CSV row for pincode data (flexible column naming)
 * @typedef {Object} PincodeCsvRow
 * @property {string} [pincode]
 * @property {string} [district]
 * @property {string} [state]
 * @property {string} [statename]
 * @property {string} [region]
 * @property {string} [regionname]
 * @property {string} [division]
 * @property {string} [divisionname]
 * Other columns we ignore: circlename, officename, officetype, delivery, latitude, longitude
 */

/**
 * Normalized pincode data
 * @typedef {Object} PincodeData
 * @property {string} pincode
 * @property {string} district
 * @property {string} state
 * @property {string} [region]
 * @property {string} [division]
 */

// ============================================
// UPLOAD PINCODE CSV
// ============================================

router.post('/upload', requireAdmin, upload.single('file'), asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
    }

    // Parse CSV from buffer
    const rows = [];
    await new Promise((resolve, reject) => {
        const stream = Readable.from(file.buffer.toString());
        stream
            .pipe(parse({ headers: true, trim: true }))
            .on('data', (row) => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
    });

    if (rows.length === 0) {
        res.status(400).json({ error: 'CSV file is empty' });
        return;
    }

    // Deduplicate by pincode (keep first occurrence)
    const pincodeMap = new Map();

    for (const row of rows) {
        // Flexible column mapping
        const pincode = row.pincode?.trim();
        const district = row.district?.trim();
        const state = (row.state || row.statename)?.trim();
        const region = (row.region || row.regionname)?.trim();
        const division = (row.division || row.divisionname)?.trim();

        // Validate required fields
        if (!pincode || !district || !state) {
            continue; // Skip invalid rows
        }

        // Skip if already seen (deduplication)
        if (pincodeMap.has(pincode)) {
            continue;
        }

        pincodeMap.set(pincode, {
            pincode,
            district,
            state,
            region: region || undefined,
            division: division || undefined,
        });
    }

    const uniquePincodes = Array.from(pincodeMap.values());

    if (uniquePincodes.length === 0) {
        res.status(400).json({ error: 'No valid pincode data found in CSV' });
        return;
    }

    // Replace all existing data (clean slate)
    await req.prisma.$executeRaw`DELETE FROM "Pincode"`;

    // Batch insert (1000 rows at a time)
    const BATCH_SIZE = 1000;
    let inserted = 0;

    for (let i = 0; i < uniquePincodes.length; i += BATCH_SIZE) {
        const batch = uniquePincodes.slice(i, i + BATCH_SIZE);

        // Build VALUES clause
        const values = batch.map((p) => {
            const id = `gen_random_uuid()`;
            const pincode = `'${p.pincode.replace(/'/g, "''")}'`;
            const district = `'${p.district.replace(/'/g, "''")}'`;
            const state = `'${p.state.replace(/'/g, "''")}'`;
            const region = p.region ? `'${p.region.replace(/'/g, "''")}'` : 'NULL';
            const division = p.division ? `'${p.division.replace(/'/g, "''")}'` : 'NULL';
            const createdAt = 'NOW()';

            return `(${id}, ${pincode}, ${district}, ${state}, ${region}, ${division}, ${createdAt})`;
        }).join(',\n');

        // Execute batch insert
        await req.prisma.$executeRawUnsafe(`
            INSERT INTO "Pincode" (id, pincode, district, state, region, division, "createdAt")
            VALUES ${values}
        `);

        inserted += batch.length;
    }

    res.json({
        message: 'Upload successful',
        stats: {
            totalRows: rows.length,
            uniquePincodes: uniquePincodes.length,
            inserted,
            uploadedAt: new Date().toISOString(),
        },
    });
}));

// ============================================
// LOOKUP SINGLE PINCODE
// ============================================

router.get('/lookup/:pincode', authenticateToken, asyncHandler(async (req, res) => {
    const { pincode } = req.params;

    const result = await req.prisma.pincode.findUnique({
        where: { pincode },
        select: {
            pincode: true,
            district: true,
            state: true,
            region: true,
            division: true,
        },
    });

    if (!result) {
        res.status(404).json({ error: 'Pincode not found' });
        return;
    }

    res.json(result);
}));

// ============================================
// BATCH LOOKUP
// ============================================

router.post('/lookup', authenticateToken, asyncHandler(async (req, res) => {
    const { pincodes } = req.body;

    if (!Array.isArray(pincodes)) {
        res.status(400).json({ error: 'pincodes must be an array' });
        return;
    }

    const results = await req.prisma.pincode.findMany({
        where: {
            pincode: { in: pincodes },
        },
        select: {
            pincode: true,
            district: true,
            state: true,
            region: true,
            division: true,
        },
    });

    res.json(results);
}));

// ============================================
// STATS
// ============================================

router.get('/stats', authenticateToken, asyncHandler(async (req, res) => {
    const count = await req.prisma.pincode.count();

    // Get last upload timestamp (most recent createdAt)
    const latest = await req.prisma.pincode.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
    });

    res.json({
        totalPincodes: count,
        lastUploadedAt: latest?.createdAt || null,
    });
}));

export default router;
