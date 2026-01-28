/**
 * ChannelCell - Displays the order channel/source as a compact badge
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface ChannelCellProps {
    row: FlattenedOrderRow;
}

const CHANNEL_CONFIG: Record<string, { label: string; className: string }> = {
    shopify: { label: 'Shopify', className: 'bg-emerald-50 text-emerald-700' },
    offline: { label: 'COH', className: 'bg-slate-100 text-slate-700' },
    myntra: { label: 'Myntra', className: 'bg-pink-50 text-pink-700' },
    nykaa: { label: 'Nykaa', className: 'bg-purple-50 text-purple-700' },
    ajio: { label: 'AJIO', className: 'bg-yellow-50 text-yellow-700' },
    jio: { label: 'Jio', className: 'bg-blue-50 text-blue-700' },
    nica: { label: 'Nica', className: 'bg-teal-50 text-teal-700' },
};

export const ChannelCell = memo(function ChannelCell({ row }: ChannelCellProps) {
    if (!row.isFirstLine) return null;

    const channel = row.channel?.toLowerCase() || 'shopify';
    const config = CHANNEL_CONFIG[channel] || {
        label: channel.charAt(0).toUpperCase() + channel.slice(1),
        className: 'bg-gray-100 text-gray-600',
    };

    return (
        <span
            className={cn(
                'px-1.5 py-0.5 rounded text-[11px] font-medium',
                config.className,
            )}
        >
            {config.label}
        </span>
    );
});
