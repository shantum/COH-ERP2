/**
 * ShopifyTrackingCell - Shopify-style fulfillment status display
 * High-end logistics feel with courier branding
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { Truck, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { cn } from '../../../../lib/utils';

interface ShopifyTrackingCellProps {
    row: FlattenedOrderRow;
}

type FulfillmentState = 'unfulfilled' | 'fulfilled' | 'in_transit' | 'delivered' | 'partial';

// Courier brand colors and short codes
const courierBranding: Record<string, { code: string; bg: string; text: string }> = {
    delhivery: { code: 'DEL', bg: 'bg-red-500', text: 'text-white' },
    bluedart: { code: 'BD', bg: 'bg-blue-600', text: 'text-white' },
    dtdc: { code: 'DTDC', bg: 'bg-red-600', text: 'text-white' },
    ekart: { code: 'EK', bg: 'bg-yellow-500', text: 'text-gray-900' },
    xpressbees: { code: 'XB', bg: 'bg-yellow-400', text: 'text-gray-900' },
    shadowfax: { code: 'SF', bg: 'bg-purple-600', text: 'text-white' },
    'ecom express': { code: 'ECE', bg: 'bg-blue-500', text: 'text-white' },
    ecomexpress: { code: 'ECE', bg: 'bg-blue-500', text: 'text-white' },
};

function getCourierBrand(courier: string | null): { code: string; bg: string; text: string } | null {
    if (!courier) return null;
    const key = courier.toLowerCase().trim();
    return courierBranding[key] || { code: courier.slice(0, 3).toUpperCase(), bg: 'bg-gray-500', text: 'text-white' };
}

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
    icon: typeof Truck;
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
    const courierBrand = getCourierBrand(courier);

    // Unfulfilled - minimal display
    if (state === 'unfulfilled') {
        return (
            <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded bg-amber-100 flex items-center justify-center">
                    <Icon size={12} className={config.iconClass} />
                </div>
                <span className={cn('text-[11px] font-medium', config.labelClass)}>
                    {config.label}
                </span>
            </div>
        );
    }

    // Has tracking info
    return (
        <div className="flex items-center gap-2">
            {/* Courier badge */}
            {courierBrand ? (
                <div
                    className={cn(
                        'w-8 h-8 rounded flex items-center justify-center text-[9px] font-bold shrink-0',
                        courierBrand.bg,
                        courierBrand.text
                    )}
                    title={courier || undefined}
                >
                    {courierBrand.code}
                </div>
            ) : (
                <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center shrink-0">
                    <Icon size={16} className={config.iconClass} />
                </div>
            )}

            {/* AWB + Status */}
            <div className="flex flex-col min-w-0">
                {awb && (
                    <span
                        className="font-mono text-[11px] text-gray-700 truncate"
                        title={awb}
                    >
                        {awb}
                    </span>
                )}
                <span className={cn(
                    'text-[10px] font-medium',
                    config.labelClass
                )}>
                    {config.label}
                </span>
            </div>
        </div>
    );
}
