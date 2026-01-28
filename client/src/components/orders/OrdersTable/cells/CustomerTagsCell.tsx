/**
 * CustomerTagsCell - Displays customer tags
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface CustomerTagsCellProps {
    row: FlattenedOrderRow;
}

export const CustomerTagsCell = memo(function CustomerTagsCell({ row }: CustomerTagsCellProps) {
    if (!row.isFirstLine) return null;

    const rawTags = row.customerTags as string | string[] | null | undefined;
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
});
