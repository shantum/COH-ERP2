/**
 * Types, constants, and helpers for the Returns module
 */

import type { ActiveReturnLine as ServerActiveReturnLine } from '@coh/shared/schemas/returns';
import {
    RETURN_REASONS,
    RETURN_CONDITIONS,
    RETURN_RESOLUTIONS,
    toOptions,
    getLabel,
} from '@coh/shared/domain/returns';

// ============================================
// TYPES
// ============================================

// Re-export server types with client additions
export interface ActiveReturnLine extends ServerActiveReturnLine {
    // Client-computed fields
    ageDays?: number;
}

export type TabType = 'actions' | 'all' | 'analytics' | 'settings';

// ============================================
// CONSTANTS & UI STYLING
// ============================================

// Use shared module for dropdown options (single source of truth)
export const reasonOptions = toOptions(RETURN_REASONS);
export const conditionOptions = toOptions(RETURN_CONDITIONS);
export const resolutionOptions = toOptions(RETURN_RESOLUTIONS);

// UI-specific styling (keyed by shared values)
export const RESOLUTION_COLORS: Record<string, string> = {
    refund: 'bg-red-100 text-red-800',
    exchange: 'bg-blue-100 text-blue-800',
    rejected: 'bg-gray-100 text-gray-800',
};

export const WRITE_OFF_REASONS = [
    { value: 'damaged', label: 'Damaged - Not Repairable' },
    { value: 'defective', label: 'Manufacturing Defect' },
    { value: 'stained', label: 'Stained / Soiled' },
    { value: 'wrong_product', label: 'Wrong Product Received' },
    { value: 'destroyed', label: 'Destroyed / Unusable' },
    { value: 'other', label: 'Other' },
] as const;

export const REFUND_METHODS = [
    { value: 'payment_link', label: 'Payment Link' },
    { value: 'bank_transfer', label: 'Bank Transfer (NEFT/IMPS)' },
    { value: 'store_credit', label: 'Store Credit' },
] as const;

// ============================================
// HELPERS
// ============================================

export const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
        requested: 'bg-yellow-100 text-yellow-800',
        pickup_scheduled: 'bg-blue-100 text-blue-800',
        in_transit: 'bg-purple-100 text-purple-800',
        received: 'bg-green-100 text-green-800',
        complete: 'bg-gray-100 text-gray-800',
        cancelled: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
};

export const getResolutionBadge = (resolution: string | null) => {
    if (!resolution) return { label: 'Pending', color: 'bg-gray-100 text-gray-800' };
    return {
        label: getLabel(RETURN_RESOLUTIONS, resolution),
        color: RESOLUTION_COLORS[resolution] || 'bg-gray-100 text-gray-800',
    };
};

export const computeAgeDays = (requestedAt: Date | string | null) => {
    if (!requestedAt) return 0;
    const date = new Date(requestedAt);
    return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
};
