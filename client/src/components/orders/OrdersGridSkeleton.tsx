/**
 * OrdersGridSkeleton - Clean loading state for the orders table
 */

import { Loader2 } from 'lucide-react';

interface OrdersGridSkeletonProps {
    /** Number of skeleton rows to display */
    rowCount?: number;
    /** Number of columns to display */
    columnCount?: number;
}

export function OrdersGridSkeleton({
    rowCount = 15,
    columnCount: _columnCount = 10,
}: OrdersGridSkeletonProps) {
    // Simple shimmer rows with consistent widths
    const rowWidths = [110, 160, 130, 220, 40, 50, 35, 70, 100, 35, 35, 35, 35];

    return (
        <div className="border rounded overflow-hidden bg-white relative">
            {/* Header shimmer */}
            <div className="flex bg-gray-50 border-b border-gray-200 h-7">
                {rowWidths.map((width, i) => (
                    <div
                        key={`header-${i}`}
                        className="px-1 py-1 border-r border-gray-200 last:border-r-0"
                        style={{ width }}
                    >
                        <div className="h-3 bg-gray-200 rounded w-3/4 animate-pulse" />
                    </div>
                ))}
            </div>

            {/* Row shimmer */}
            {Array.from({ length: rowCount }).map((_, rowIdx) => (
                <div
                    key={`row-${rowIdx}`}
                    className="flex border-b border-gray-100 last:border-b-0"
                    style={{ height: 36 }}
                >
                    {rowWidths.map((width, colIdx) => (
                        <div
                            key={`cell-${rowIdx}-${colIdx}`}
                            className="px-1 py-2 border-r border-gray-100 last:border-r-0"
                            style={{ width }}
                        >
                            <div
                                className="h-3 bg-gray-100 rounded animate-pulse"
                                style={{
                                    width: colIdx < 4 ? '85%' : '60%',
                                    opacity: 0.6 + (rowIdx % 3) * 0.15,
                                }}
                            />
                        </div>
                    ))}
                </div>
            ))}

            {/* Centered loading indicator overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="flex items-center gap-2 bg-white/90 px-4 py-2 rounded-lg shadow-sm border">
                    <Loader2 size={16} className="animate-spin text-blue-600" />
                    <span className="text-sm text-gray-600">Loading orders...</span>
                </div>
            </div>
        </div>
    );
}

export default OrdersGridSkeleton;
