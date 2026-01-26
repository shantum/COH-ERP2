/**
 * OrderViewTabs Component
 *
 * Segmented control for switching between order views:
 * - Open: Orders pending fulfillment
 * - Shipped: Recently shipped, not yet delivered (excludes RTO)
 * - RTO: Orders returning to origin
 * - All: All recent non-archived orders
 */

import { memo } from 'react';

export type OrderView = 'open' | 'shipped' | 'rto' | 'all';

export interface ViewCounts {
    open: number;
    shipped: number;
    rto: number;
    all: number;
}

interface OrderViewTabsProps {
    currentView: OrderView;
    onViewChange: (view: OrderView) => void;
    counts?: ViewCounts;
    isLoading?: boolean;
}

const VIEW_CONFIG: Record<OrderView, { label: string; color: string; bgColor: string }> = {
    open: { label: 'Open', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
    shipped: { label: 'Shipped', color: 'text-blue-700', bgColor: 'bg-blue-100' },
    rto: { label: 'RTO', color: 'text-orange-700', bgColor: 'bg-orange-100' },
    all: { label: 'All', color: 'text-gray-700', bgColor: 'bg-gray-100' },
};

const VIEWS: OrderView[] = ['open', 'shipped', 'rto', 'all'];

function OrderViewTabsComponent({
    currentView,
    onViewChange,
    counts,
    isLoading = false,
}: OrderViewTabsProps) {
    return (
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            {VIEWS.map((view) => {
                const config = VIEW_CONFIG[view];
                const isActive = currentView === view;
                const count = counts?.[view];

                return (
                    <button
                        key={view}
                        onClick={() => onViewChange(view)}
                        className={`
                            flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-all
                            ${isActive
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                            }
                        `}
                    >
                        <span>{config.label}</span>
                        {count !== undefined && (
                            <span
                                className={`
                                    px-1.5 py-0.5 text-[10px] rounded-full font-semibold tabular-nums
                                    ${isActive
                                        ? `${config.bgColor} ${config.color}`
                                        : 'bg-gray-200 text-gray-600'
                                    }
                                    ${isLoading ? 'opacity-50' : ''}
                                `}
                            >
                                {count.toLocaleString()}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

export const OrderViewTabs = memo(OrderViewTabsComponent);
