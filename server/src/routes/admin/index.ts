/**
 * @module routes/admin
 * @description Admin-only operations: user/role management, system settings, DB inspection, logs, and background jobs
 *
 * User Management: CRUD for users, password resets, role assignment
 * Role & Permissions: Assign roles, manage per-user permission overrides (forces re-login via tokenVersion increment)
 * System Settings: Order channels, tier thresholds (platinum/gold/silver LTV breakpoints)
 * DB Inspector: Browse any Prisma table with pagination (dev tool)
 * Logs: View server.jsonl logs (24hr retention), filter by level/search
 * Background Jobs: Shopify sync (24hr lookback), tracking sync (30min), cache cleanup (daily 2AM), auto-archive (startup)
 *
 * Protection Logic:
 * - Cannot delete/disable last admin user
 * - Cannot change last Owner role
 * - Role changes increment tokenVersion (forces re-login to get new permissions)
 *
 * @see middleware/permissions.js - Permission checking logic
 * @see utils/tierUtils.js - Customer tier calculation
 */

import { Router } from 'express';
import settingsRouter from './settings.js';
import rolesRouter from './roles.js';
import usersRouter from './users.js';
import inspectRouter from './inspect.js';
import logsRouter from './logs.js';
import backgroundJobsRouter from './backgroundJobs.js';
import gridPreferencesRouter from './gridPreferences.js';
import sheetOpsRouter from './sheetOps.js';
import workerRunsRouter from './workerRuns.js';

const router = Router();

router.use('/', settingsRouter);
router.use('/', rolesRouter);
router.use('/', usersRouter);
router.use('/', inspectRouter);
router.use('/', logsRouter);
router.use('/', backgroundJobsRouter);
router.use('/', gridPreferencesRouter);
router.use('/', sheetOpsRouter);
router.use('/', workerRunsRouter);

export default router;
