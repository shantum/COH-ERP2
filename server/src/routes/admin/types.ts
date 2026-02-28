import type logBuffer from '../../utils/logBuffer.js';

/** Channel configuration */
export interface Channel {
    id: string;
    name: string;
}

/** Tier thresholds */
export interface TierThresholds {
    platinum: number;
    gold: number;
    silver: number;
}

/** Permission override */
export interface PermissionOverride {
    permission: string;
    granted: boolean;
}

/** User creation/update body */
export interface CreateUserBody {
    email: string;
    name: string;
    phone: string;
    role?: string;
    roleId?: string;
}

export interface UpdateUserBody {
    email?: string;
    name?: string;
    role?: string;
    isActive?: boolean;
    password?: string;
}

/** Background job status */
export interface BackgroundJob {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    intervalMinutes?: number;
    schedule?: string;
    isRunning?: boolean;
    lastRunAt?: string | Date | null;
    lastResult?: unknown;
    config?: Record<string, unknown>;
    stats?: unknown;
    note?: string;
}

/** Grid preferences */
export interface GridPreferences {
    visibleColumns?: string[];
    columnOrder?: string[];
    columnWidths?: Record<string, number>;
    updatedAt?: string;
    updatedBy?: string;
}

/** Delete operation model interface */
export interface DeleteModel {
    count: () => Promise<number>;
    deleteMany: () => Promise<{ count: number }>;
}

/** Delete operation config */
export interface DeleteOperation {
    name: string;
    model: DeleteModel;
}

/** Password validation result */
export interface PasswordValidationResult {
    isValid: boolean;
    errors: string[];
}

/** Sync status from scheduledSync service */
export interface ShopifySyncStatus {
    isRunning: boolean;
    schedulerActive: boolean;
    intervalMinutes: number;
    lookbackHours: number;
    lastSyncAt: Date | null;
    lastSyncResult: unknown;
}

/** Sync status from trackingSync service */
export interface TrackingSyncStatus {
    isRunning: boolean;
    schedulerActive: boolean;
    intervalMinutes: number;
    lastSyncAt: Date | null;
    lastSyncResult: unknown;
}

/** Cache cleanup result */
export interface CleanupResult {
    orderCache: { deletedCount: number; errors: string[] };
    productCache: { deletedCount: number; errors: string[] };
    webhookLogs: { deletedCount: number; errors: string[] };
    failedSyncItems: { deletedCount: number; errors: string[] };
    syncJobs: { deletedCount: number; errors: string[] };
    summary: {
        totalDeleted: number;
        totalErrors: number;
        durationMs: number;
    };
}

/** Clear tables request body */
export interface ClearTablesBody {
    tables: string[];
    confirmPhrase: string;
}

/** Channels update body */
export interface ChannelsUpdateBody {
    channels: Channel[];
}

/** Tier thresholds update body */
export interface TierThresholdsUpdateBody {
    platinum: number;
    gold: number;
    silver: number;
}

/** Role assignment body */
export interface RoleAssignmentBody {
    roleId: string;
}

/** Permissions update body */
export interface PermissionsUpdateBody {
    overrides: PermissionOverride[];
}

/** Background job trigger params */
export type JobId = 'shopify_sync' | 'tracking_sync' | 'cache_cleanup' | 'ingest_inward' | 'ingest_outward' | 'move_shipped_to_outward' | 'preview_ingest_inward' | 'preview_ingest_outward' | 'cleanup_done_rows' | 'migrate_sheet_formulas' | 'snapshot_compute' | 'snapshot_backfill' | 'push_balances' | 'preview_push_balances' | 'push_fabric_balances' | 'import_fabric_balances' | 'preview_fabric_inward' | 'ingest_fabric_inward' | 'reconcile_sheet_orders' | 'sync_sheet_status' | 'run_inward_cycle' | 'run_outward_cycle' | 'remittance_sync' | 'payu_settlement_sync' | 'drive_finance_sync' | 'sync_sheet_awb';

/** Background job update body */
export interface JobUpdateBody {
    enabled: boolean;
}

// Type for Prisma model with dynamic access
export type PrismaModelDelegate = {
    findMany: (args?: unknown) => Promise<unknown[]>;
    count: (args?: unknown) => Promise<number>;
};

// Extended logBuffer type to access private logFilePath
export interface LogBufferWithPath {
    getLogs: typeof logBuffer.getLogs;
    getStats: typeof logBuffer.getStats;
    clearLogs: typeof logBuffer.clearLogs;
    logFilePath: string;
}

/** User grid preferences response */
export interface UserGridPreferencesResponse {
    visibleColumns: string[];
    columnOrder: string[];
    columnWidths: Record<string, number>;
    adminVersion: string | null;
}
