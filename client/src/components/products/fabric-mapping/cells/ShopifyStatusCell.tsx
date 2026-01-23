/**
 * ShopifyStatusCell - Shopify product status indicator
 *
 * Shows a compact status badge for Shopify product status:
 * - active: green badge
 * - archived: gray badge
 * - draft: amber badge
 * - not_linked: muted text
 * - not_cached: muted text
 */

import { memo } from 'react';
import type { ShopifyStatus } from '../types';

interface ShopifyStatusCellProps {
    status?: ShopifyStatus;
}

const statusConfig: Record<ShopifyStatus, { label: string; className: string }> = {
    active: {
        label: 'Active',
        className: 'bg-green-100 text-green-700 border-green-200',
    },
    archived: {
        label: 'Archived',
        className: 'bg-gray-100 text-gray-600 border-gray-200',
    },
    draft: {
        label: 'Draft',
        className: 'bg-amber-100 text-amber-700 border-amber-200',
    },
    not_linked: {
        label: '-',
        className: 'text-gray-300',
    },
    not_cached: {
        label: '?',
        className: 'text-gray-400',
    },
    unknown: {
        label: '?',
        className: 'text-gray-400',
    },
};

export const ShopifyStatusCell = memo(function ShopifyStatusCell({
    status = 'not_linked',
}: ShopifyStatusCellProps) {
    const config = statusConfig[status];

    // For not_linked and unknown, just show muted text
    if (status === 'not_linked' || status === 'not_cached' || status === 'unknown') {
        return (
            <div className="flex items-center justify-center">
                <span className={`text-xs ${config.className}`}>{config.label}</span>
            </div>
        );
    }

    // For actual statuses, show a badge
    return (
        <div className="flex items-center justify-center">
            <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${config.className}`}
            >
                {config.label}
            </span>
        </div>
    );
});
