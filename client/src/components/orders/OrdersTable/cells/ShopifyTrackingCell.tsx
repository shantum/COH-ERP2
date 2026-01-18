/**
 * ShopifyTrackingCell - Shopify-style fulfillment status display
 * High-end logistics feel with status indicators
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { Package, Truck, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { cn } from '../../../../lib/utils';

interface ShopifyTrackingCellProps {
    row: FlattenedOrderRow;
}

type FulfillmentState = 'unfulfilled' | 'fulfilled' | 'in_transit' | 'delivered' | 'partial';

function getFulfillmentState(status: string | null | undefined, awb: string | null): FulfillmentState {
    if (!status || status === '-' || status === 'unfulfilled') {
        return awb ? 'in_transit' : 'unfulfilled';
    }
    const s = status.toLowerCase();
    if (s.includes('deliver')) return 'delivered';
    if (s.includes('transit') || s.includes('ship')) return 'in_transit';
    if (s.includes('partial')) return 'partial';
    if (s.includes('fulfil')) return 'fulfilled';
    return 'fulfilled';
}

const stateConfig: Record<FulfillmentState, {
    icon: typeof Package;
    label: string;
    iconClass: string;
    labelClass: string;
    bgClass: string;
}> = {
    unfulfilled: {
        icon: Clock,
        label: 'Unfulfilled',
        iconClass: 'text-amber-500',
        labelClass: 'text-amber-700',
        bgClass: 'bg-amber-50',
    },
    fulfilled: {
        icon: CheckCircle2,
        label: 'Fulfilled',
        iconClass: 'text-emerald-500',
        labelClass: 'text-emerald-700',
        bgClass: 'bg-emerald-50',
    },
    in_transit: {
        icon: Truck,
        label: 'In Transit',
        iconClass: 'text-blue-500',
        labelClass: 'text-blue-700',
        bgClass: 'bg-blue-50',
    },
    delivered: {
        icon: CheckCircle2,
        label: 'Delivered',
        iconClass: 'text-emerald-500',
        labelClass: 'text-emerald-700',
        bgClass: 'bg-emerald-50',
    },
    partial: {
        icon: AlertCircle,
        label: 'Partial',
        iconClass: 'text-orange-500',
        labelClass: 'text-orange-700',
        bgClass: 'bg-orange-50',
    },
};

export function ShopifyTrackingCell({ row }: ShopifyTrackingCellProps) {
    if (!row.isFirstLine) return null;

    const awb = row.shopifyAwb;
    const courier = row.shopifyCourier;
    const status = row.shopifyStatus;

    const state = getFulfillmentState(status, awb);
    const config = stateConfig[state];
    const Icon = config.icon;

    // Unfulfilled - minimal display
    if (state === 'unfulfilled') {
        return (
            <div className="flex items-center gap-1.5">
                <Icon size={14} className={config.iconClass} />
                <span className={cn('text-[11px] font-medium', config.labelClass)}>
                    {config.label}
                </span>
            </div>
        );
    }

    // Has tracking info
    return (
        <div className="flex flex-col gap-0.5">
            {/* AWB with icon */}
            <div className="flex items-center gap-1.5">
                <Icon size={14} className={config.iconClass} />
                {awb ? (
                    <span
                        className="font-mono text-[11px] text-gray-700 truncate max-w-[120px]"
                        title={awb}
                    >
                        {awb}
                    </span>
                ) : (
                    <span className={cn('text-[11px] font-medium', config.labelClass)}>
                        {config.label}
                    </span>
                )}
            </div>
            {/* Courier + Status badge */}
            {(courier || awb) && (
                <div className="flex items-center gap-1.5 ml-5">
                    {courier && (
                        <span className="text-[10px] text-gray-500 truncate max-w-[60px]" title={courier}>
                            {courier}
                        </span>
                    )}
                    <span className={cn(
                        'text-[9px] font-medium px-1.5 py-0.5 rounded-full',
                        config.bgClass,
                        config.labelClass
                    )}>
                        {config.label}
                    </span>
                </div>
            )}
        </div>
    );
}
