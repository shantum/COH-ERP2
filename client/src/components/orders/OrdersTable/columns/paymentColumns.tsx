/**
 * Payment Columns - TanStack Table column definitions
 * Columns: tags, customerNotes, customerTags
 * Note: paymentInfo column is now in orderInfoColumns.tsx
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';

export function buildPaymentColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName } = ctx;

    return [
        // Tags
        {
            id: 'tags',
            header: getHeaderName('tags'),
            size: DEFAULT_COLUMN_WIDTHS.tags,
            cell: ({ row }) => {
                if (!row.original.isFirstLine) return null;
                const tags = row.original.shopifyTags;
                if (!tags) return <span className="text-gray-300">-</span>;
                return (
                    <span className="text-gray-600 truncate" title={tags}>
                        {tags}
                    </span>
                );
            },
        },

        // Customer Notes
        {
            id: 'customerNotes',
            header: getHeaderName('customerNotes'),
            size: DEFAULT_COLUMN_WIDTHS.customerNotes,
            cell: ({ row }) => {
                if (!row.original.isFirstLine) return null;
                const notes = row.original.customerNotes;
                if (!notes) return <span className="text-gray-300 text-[10px]">-</span>;
                return (
                    <span
                        className="text-[10px] text-gray-600 line-clamp-2 leading-tight"
                        title={notes}
                    >
                        {notes}
                    </span>
                );
            },
        },

        // Customer Tags
        {
            id: 'customerTags',
            header: getHeaderName('customerTags'),
            size: DEFAULT_COLUMN_WIDTHS.customerTags,
            cell: ({ row }) => {
                if (!row.original.isFirstLine) return null;
                const rawTags = row.original.customerTags as string | string[] | null | undefined;
                if (!rawTags) return <span className="text-gray-300">-</span>;
                // Handle both string and array formats
                const tags: string[] = Array.isArray(rawTags)
                    ? rawTags
                    : rawTags.split(',').map((t: string) => t.trim()).filter(Boolean);
                if (tags.length === 0) return <span className="text-gray-300">-</span>;
                return (
                    <div className="flex flex-wrap gap-0.5">
                        {tags.slice(0, 2).map((tag: string, i: number) => (
                            <span key={i} className="px-1 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px]">
                                {tag}
                            </span>
                        ))}
                        {tags.length > 2 && (
                            <span className="text-gray-400 text-[10px]">+{tags.length - 2}</span>
                        )}
                    </div>
                );
            },
        },
    ];
}
