/**
 * Post-Ship Columns - TanStack Table column definitions
 * Columns: shippedAt, deliveredAt, deliveryDays, daysInTransit, rtoInitiatedAt, daysInRto, daysSinceDelivery, codRemittedAt, archivedAt, finalStatus
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import { cn } from '../../../../lib/utils';

export function buildPostShipColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName } = ctx;

    const formatDate = (dateStr: string | null | undefined) => {
        if (!dateStr) return null;
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
        });
    };

    return [
        // Shipped At
        {
            id: 'shippedAt',
            header: getHeaderName('shippedAt'),
            size: DEFAULT_COLUMN_WIDTHS.shippedAt,
            cell: ({ row }) => {
                const date = row.original.lineShippedAt;
                if (!date) return <span className="text-gray-300">-</span>;
                return <span className="text-gray-700">{formatDate(date)}</span>;
            },
            enableSorting: true,
        },

        // Delivered At
        {
            id: 'deliveredAt',
            header: getHeaderName('deliveredAt'),
            size: DEFAULT_COLUMN_WIDTHS.deliveredAt,
            cell: ({ row }) => {
                const date = row.original.lineDeliveredAt;
                if (!date) return <span className="text-gray-300">-</span>;
                return <span className="text-green-700">{formatDate(date)}</span>;
            },
            enableSorting: true,
        },

        // Delivery Days (computed from shipped to delivered)
        {
            id: 'deliveryDays',
            header: getHeaderName('deliveryDays'),
            size: DEFAULT_COLUMN_WIDTHS.deliveryDays,
            cell: ({ row }) => {
                const shipped = row.original.lineShippedAt;
                const delivered = row.original.lineDeliveredAt;
                if (!shipped || !delivered) return <span className="text-gray-300">-</span>;
                const days = Math.floor(
                    (new Date(delivered).getTime() - new Date(shipped).getTime()) / (1000 * 60 * 60 * 24)
                );
                return (
                    <span className={cn('font-medium', days > 7 ? 'text-amber-600' : 'text-gray-700')}>
                        {days}d
                    </span>
                );
            },
            enableSorting: true,
        },

        // Days In Transit
        {
            id: 'daysInTransit',
            header: getHeaderName('daysInTransit'),
            size: DEFAULT_COLUMN_WIDTHS.daysInTransit,
            cell: ({ row }) => {
                const days = row.original.daysInTransit;
                if (days == null) return <span className="text-gray-300">-</span>;
                return (
                    <span className={cn('font-medium', days > 7 ? 'text-amber-600' : 'text-gray-700')}>
                        {days}d
                    </span>
                );
            },
            enableSorting: true,
        },

        // RTO Initiated At
        {
            id: 'rtoInitiatedAt',
            header: getHeaderName('rtoInitiatedAt'),
            size: DEFAULT_COLUMN_WIDTHS.rtoInitiatedAt,
            cell: ({ row }) => {
                // Would need to come from the order data
                const rtoStatus = row.original.rtoStatus;
                if (!rtoStatus) return <span className="text-gray-300">-</span>;
                return <span className="text-red-600">{rtoStatus}</span>;
            },
            enableSorting: true,
        },

        // Days In RTO
        {
            id: 'daysInRto',
            header: getHeaderName('daysInRto'),
            size: DEFAULT_COLUMN_WIDTHS.daysInRto,
            cell: ({ row }) => {
                const days = row.original.daysInRto;
                if (days == null) return <span className="text-gray-300">-</span>;
                return <span className="text-orange-600 font-medium">{days}d</span>;
            },
            enableSorting: true,
        },

        // Days Since Delivery
        {
            id: 'daysSinceDelivery',
            header: getHeaderName('daysSinceDelivery'),
            size: DEFAULT_COLUMN_WIDTHS.daysSinceDelivery,
            cell: ({ row }) => {
                const days = row.original.daysSinceDelivery;
                if (days == null) return <span className="text-gray-300">-</span>;
                return <span className="text-gray-600">{days}d</span>;
            },
            enableSorting: true,
        },

        // COD Remitted At
        {
            id: 'codRemittedAt',
            header: getHeaderName('codRemittedAt'),
            size: DEFAULT_COLUMN_WIDTHS.codRemittedAt,
            cell: ({ row }) => {
                // Would come from order.codRemittedAt
                const order = row.original.order;
                const date = order?.codRemittedAt;
                if (!date) return <span className="text-gray-300">-</span>;
                return <span className="text-green-700">{formatDate(date)}</span>;
            },
            enableSorting: true,
        },

        // Archived At
        {
            id: 'archivedAt',
            header: getHeaderName('archivedAt'),
            size: DEFAULT_COLUMN_WIDTHS.archivedAt,
            cell: ({ row }) => {
                const order = row.original.order;
                const date = order?.archivedAt;
                if (!date) return <span className="text-gray-300">-</span>;
                return <span className="text-gray-600">{formatDate(date)}</span>;
            },
            enableSorting: true,
        },

        // Final Status
        {
            id: 'finalStatus',
            header: getHeaderName('finalStatus'),
            size: DEFAULT_COLUMN_WIDTHS.finalStatus,
            cell: ({ row }) => {
                const tracking = row.original.lineTrackingStatus;
                const lineStatus = row.original.lineStatus;

                // Determine final status
                let status = lineStatus || 'unknown';
                if (tracking === 'delivered') status = 'delivered';
                else if (tracking === 'rto_delivered' || tracking === 'rto_received') status = 'rto_received';
                else if (tracking?.includes('rto')) status = 'rto';

                const styles: Record<string, string> = {
                    delivered: 'bg-green-100 text-green-700',
                    rto_received: 'bg-purple-100 text-purple-700',
                    rto: 'bg-orange-100 text-orange-700',
                    shipped: 'bg-blue-100 text-blue-700',
                    cancelled: 'bg-gray-100 text-gray-600',
                };

                return (
                    <span className={cn('px-1.5 py-0.5 rounded font-medium', styles[status] || 'bg-gray-100 text-gray-600')}>
                        {status}
                    </span>
                );
            },
            enableSorting: true,
        },
    ];
}
