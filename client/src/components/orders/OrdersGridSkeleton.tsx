/**
 * OrdersGridSkeleton - Clean loading state for the orders table
 * Matches the exact dimensions of OrdersTable for seamless transition
 */

import { Loader2 } from 'lucide-react';

const ROW_HEIGHT = 28; // Match OrdersTable ROW_HEIGHT

export function OrdersGridSkeleton() {
    // Column widths matching common table columns
    const columnWidths = [110, 160, 130, 220, 40, 50, 35, 70, 100, 35, 35, 35, 35];

    return (
        <div className="border rounded overflow-hidden bg-white relative">
            {/* Scrollable container matching table dimensions */}
            <div
                className="overflow-hidden"
                style={{
                    height: 'calc(100vh - 180px)',
                    minHeight: '300px',
                }}
            >
                {/* Header shimmer */}
                <div className="flex bg-gray-50 border-b border-gray-200 sticky top-0">
                    {columnWidths.map((width, i) => (
                        <div
                            key={`header-${i}`}
                            className="px-1 py-0.5 border-r border-gray-200 last:border-r-0"
                            style={{ width, height: ROW_HEIGHT }}
                        >
                            <div className="h-3 bg-gray-200 rounded w-3/4 animate-pulse mt-1" />
                        </div>
                    ))}
                </div>

                {/* Row shimmer - fill available space */}
                <div className="flex-1">
                    {Array.from({ length: 30 }).map((_, rowIdx) => (
                        <div
                            key={`row-${rowIdx}`}
                            className="flex border-b border-gray-100 last:border-b-0"
                            style={{ height: ROW_HEIGHT }}
                        >
                            {columnWidths.map((width, colIdx) => (
                                <div
                                    key={`cell-${rowIdx}-${colIdx}`}
                                    className="px-1 py-1 border-r border-gray-100 last:border-r-0 flex items-center"
                                    style={{ width }}
                                >
                                    <div
                                        className="h-2.5 bg-gray-100 rounded animate-pulse"
                                        style={{
                                            width: colIdx < 4 ? '85%' : '60%',
                                            opacity: 0.5 + (rowIdx % 3) * 0.15,
                                        }}
                                    />
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {/* Centered loading indicator overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="flex items-center gap-2 bg-white/90 px-3 py-1.5 rounded-lg shadow-sm border">
                    <Loader2 size={14} className="animate-spin text-blue-600" />
                    <span className="text-xs text-gray-600">Loading orders...</span>
                </div>
            </div>
        </div>
    );
}

export default OrdersGridSkeleton;
