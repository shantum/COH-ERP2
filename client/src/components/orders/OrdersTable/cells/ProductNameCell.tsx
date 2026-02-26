/**
 * ProductNameCell - Shows all items in the order as stacked thumbnails
 * Single item: thumbnail + name + color + size
 * Multiple items: stacked thumbnails + "X items" summary
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { Package } from 'lucide-react';
import { getOptimizedImageUrl } from '../../../../utils/imageOptimization';

interface ProductNameCellProps {
    row: FlattenedOrderRow;
}

export const ProductNameCell = memo(function ProductNameCell({ row }: ProductNameCellProps) {
    const lines = row.lines;

    if (!lines || lines.length === 0) {
        return <span className="text-gray-400 text-[11px]">(no items)</span>;
    }

    // Single item — show full detail
    if (lines.length === 1) {
        const line = lines[0];
        return (
            <div className="flex items-center gap-2 py-0.5">
                <Thumbnail url={line.imageUrl} name={line.productName} />
                <div className="flex flex-col justify-center leading-tight min-w-0">
                    <span className="font-medium text-gray-900 truncate">{line.productName}</span>
                    <span className="text-[10px] text-gray-500 truncate">
                        {[line.colorName !== '-' && line.colorName, line.size !== '-' && line.size].filter(Boolean).join(' / ')}
                        {line.qty > 1 && <span className="ml-1 text-gray-400">×{line.qty}</span>}
                    </span>
                </div>
            </div>
        );
    }

    // Multiple items — stacked thumbnails + summary
    const shown = lines.slice(0, 3);
    const remaining = lines.length - shown.length;

    return (
        <div className="flex items-center gap-2 py-0.5">
            {/* Stacked thumbnails */}
            <div className="flex -space-x-2 shrink-0">
                {shown.map((line, i) => (
                    <div key={line.lineId} className="relative" style={{ zIndex: shown.length - i }}>
                        <Thumbnail url={line.imageUrl} name={line.productName} stacked />
                    </div>
                ))}
                {remaining > 0 && (
                    <div className="relative w-7 h-7 rounded bg-gray-200 border-2 border-white flex items-center justify-center" style={{ zIndex: 0 }}>
                        <span className="text-[9px] font-medium text-gray-600">+{remaining}</span>
                    </div>
                )}
            </div>
            {/* Summary text */}
            <div className="flex flex-col justify-center leading-tight min-w-0">
                <span className="font-medium text-gray-900 text-[11px]">{lines.length} items</span>
                <span className="text-[10px] text-gray-500 truncate">
                    {lines.map(l => l.productName).filter((v, i, a) => a.indexOf(v) === i).slice(0, 2).join(', ')}
                    {lines.map(l => l.productName).filter((v, i, a) => a.indexOf(v) === i).length > 2 && '...'}
                </span>
            </div>
        </div>
    );
});

function Thumbnail({ url, name, stacked }: { url: string | null; name: string; stacked?: boolean }) {
    const cls = stacked
        ? 'w-7 h-7 rounded bg-gray-100 flex-shrink-0 overflow-hidden border-2 border-white'
        : 'w-7 h-7 rounded bg-gray-100 flex-shrink-0 overflow-hidden';

    if (url) {
        return (
            <div className={cls}>
                <img
                    src={getOptimizedImageUrl(url, 'xs') || url}
                    alt={name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                />
            </div>
        );
    }

    return (
        <div className={cls}>
            <div className="w-full h-full flex items-center justify-center text-gray-300">
                <Package size={14} />
            </div>
        </div>
    );
}
