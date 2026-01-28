/**
 * TagsCell - Displays Shopify order tags
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface TagsCellProps {
    row: FlattenedOrderRow;
}

export const TagsCell = memo(function TagsCell({ row }: TagsCellProps) {
    if (!row.isFirstLine) return null;

    const tags = row.shopifyTags;
    if (!tags) return <span className="text-gray-300">-</span>;

    return (
        <span className="text-gray-600 truncate" title={tags}>
            {tags}
        </span>
    );
});
