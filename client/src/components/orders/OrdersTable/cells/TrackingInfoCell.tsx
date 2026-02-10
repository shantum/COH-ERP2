/**
 * TrackingInfoCell - Read-only display of AWB + courier
 */
import { memo } from 'react';
import cohLogo from '../../../../assets/COH-Square-Monkey-Logo.png';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface TrackingInfoCellProps {
    row: FlattenedOrderRow;
}

export const TrackingInfoCell = memo(function TrackingInfoCell({ row }: TrackingInfoCellProps) {
    if (!row?.lineId) return null;

    const awb = row.lineAwbNumber;
    const courier = row.lineCourier;
    const hasData = awb || courier;

    if (!hasData) {
        return <span className="text-gray-400 text-[11px]">-</span>;
    }

    return (
        <div className={cn(
            'text-xs rounded-md flex items-center gap-1.5 px-2 py-1 border',
            'bg-slate-50 text-slate-700 border-slate-200'
        )}>
            <img src={cohLogo} alt="COH" className="w-3 h-3" />
            <span className="flex flex-col items-start leading-tight">
                <span className="font-medium text-[11px] truncate max-w-[80px]">{awb || '-'}</span>
                <span className="text-[9px] text-slate-500">{courier || '-'}</span>
            </span>
        </div>
    );
});
