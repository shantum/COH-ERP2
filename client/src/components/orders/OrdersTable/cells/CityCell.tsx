/**
 * CityCell - Displays shipping city
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface CityCellProps {
    row: FlattenedOrderRow;
}

export const CityCell = memo(function CityCell({ row }: CityCellProps) {
    if (!row.isFirstLine) return null;

    const city = row.city || '-';

    return (
        <span className="text-gray-700 truncate" title={city}>
            {city}
        </span>
    );
});
