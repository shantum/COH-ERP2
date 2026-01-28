/**
 * CustomerNotesCell - Displays customer notes from Shopify
 */

import { memo } from 'react';
import { MessageSquareText } from 'lucide-react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface CustomerNotesCellProps {
    row: FlattenedOrderRow;
}

export const CustomerNotesCell = memo(function CustomerNotesCell({ row }: CustomerNotesCellProps) {
    if (!row.isFirstLine) return null;

    const notes = row.customerNotes;
    if (!notes) return <span className="text-gray-300 text-[10px]">-</span>;

    return (
        <div
            className="flex items-start gap-1.5 px-2 py-1 bg-gray-50 border border-gray-100 rounded-md"
            title={notes}
        >
            <MessageSquareText size={12} className="text-gray-400 shrink-0 mt-0.5" />
            <span className="text-[10px] text-gray-600 line-clamp-2 leading-tight">
                {notes}
            </span>
        </div>
    );
});
