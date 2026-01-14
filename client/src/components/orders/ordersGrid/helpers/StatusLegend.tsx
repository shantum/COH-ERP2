/**
 * StatusLegend
 * Visual guide to row colors showing order line statuses
 */

import { useState, useRef, useEffect } from 'react';
import { STATUS_LEGEND_ITEMS } from '../constants';

export function StatusLegend() {
    const [isOpen, setIsOpen] = useState(false);
    const legendRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (legendRef.current && !legendRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    return (
        <div className="relative" ref={legendRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300"
                title="Show status legend"
            >
                <span className="w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #bbf7d0 100%)', border: '1px solid #93c5fd' }} />
                <span>Legend</span>
            </button>
            {isOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3 min-w-[240px]">
                    <div className="text-xs font-medium text-gray-600 mb-2">Row Status Colors</div>
                    <div className="space-y-1.5">
                        {STATUS_LEGEND_ITEMS.map((status) => (
                            <div key={status.label} className="flex items-center gap-2">
                                <div
                                    className="w-4 h-4 rounded flex-shrink-0"
                                    style={{
                                        backgroundColor: status.color,
                                        borderLeft: `3px solid ${status.border}`,
                                    }}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-medium text-gray-700">{status.label}</div>
                                    <div className="text-[10px] text-gray-500">{status.desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
