/**
 * OrdersGridSkeleton - Skeleton loading state for the orders grid
 *
 * Displays a realistic skeleton that matches the grid layout while data is loading.
 * This provides instant visual feedback and reduces perceived loading time.
 */

interface OrdersGridSkeletonProps {
    /** Number of skeleton rows to display */
    rowCount?: number;
    /** Number of columns to display */
    columnCount?: number;
}

export function OrdersGridSkeleton({
    rowCount = 20,
    columnCount = 12,
}: OrdersGridSkeletonProps) {
    return (
        <div className="border rounded overflow-hidden bg-white">
            {/* Header row */}
            <div className="flex bg-gray-50 border-b border-gray-200">
                {/* Checkbox column */}
                <div className="w-10 h-10 flex items-center justify-center border-r border-gray-200">
                    <div className="w-4 h-4 bg-gray-200 rounded animate-pulse" />
                </div>
                {/* Data columns */}
                {Array.from({ length: columnCount }).map((_, i) => (
                    <div
                        key={`header-${i}`}
                        className="flex-1 min-w-[100px] h-10 px-3 py-2 border-r border-gray-200 last:border-r-0"
                    >
                        <div
                            className="h-4 bg-gray-200 rounded animate-pulse"
                            style={{ width: `${60 + Math.random() * 30}%` }}
                        />
                    </div>
                ))}
            </div>

            {/* Data rows */}
            {Array.from({ length: rowCount }).map((_, rowIdx) => (
                <div
                    key={`row-${rowIdx}`}
                    className="flex border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50"
                >
                    {/* Checkbox column */}
                    <div className="w-10 h-8 flex items-center justify-center border-r border-gray-100">
                        <div className="w-3.5 h-3.5 bg-gray-100 rounded animate-pulse" />
                    </div>
                    {/* Data columns */}
                    {Array.from({ length: columnCount }).map((_, colIdx) => (
                        <div
                            key={`cell-${rowIdx}-${colIdx}`}
                            className="flex-1 min-w-[100px] h-8 px-3 py-1.5 border-r border-gray-100 last:border-r-0"
                        >
                            <div
                                className="h-4 bg-gray-100 rounded animate-pulse"
                                style={{
                                    width: `${40 + Math.random() * 50}%`,
                                    animationDelay: `${(rowIdx * columnCount + colIdx) * 20}ms`,
                                }}
                            />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

export default OrdersGridSkeleton;
