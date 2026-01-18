/**
 * StatusLegend - Visual guide to row colors
 */

import { STATUS_LEGEND_ITEMS } from '../rowStyling';

export function StatusLegend() {
    return (
        <div className="flex flex-wrap items-center gap-3 text-xs">
            {STATUS_LEGEND_ITEMS.map((item) => (
                <div key={item.label} className="flex items-center gap-1.5" title={item.desc}>
                    <div
                        className={`w-3 h-3 rounded border-l-4 ${item.color} ${item.border}`}
                    />
                    <span className="text-gray-600">{item.label}</span>
                </div>
            ))}
        </div>
    );
}
