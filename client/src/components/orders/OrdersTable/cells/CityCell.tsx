/**
 * CityCell - Displays shipping city
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface CityCellProps {
    row: FlattenedOrderRow;
}

export function CityCell({ row }: CityCellProps) {
    if (!row.isFirstLine) return null;

    const city = row.city || '-';

    return (
        <span className="text-gray-700 truncate" title={city}>
            {city}
        </span>
    );
}
