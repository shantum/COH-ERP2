/**
 * Payment Columns
 *
 * Columns: discountCode, paymentMethod, rtoHistory, customerNotes, customerOrderCount, customerLtv
 */

import type {
    ColDef,
    ICellRendererParams,
    ValueFormatterParams,
    ValueGetterParams,
} from 'ag-grid-community';
import type { ColumnBuilderContext } from '../types';

/**
 * Build payment and customer column definitions
 */
export function buildPaymentColumns(ctx: ColumnBuilderContext): ColDef[] {
    const { getHeaderName } = ctx;

    return [
        // Discount Code
        {
            colId: 'discountCode',
            headerName: getHeaderName('discountCode'),
            width: 90,
            valueGetter: (params: ValueGetterParams) => {
                if (!params.data?.isFirstLine) return '';
                return params.data.order?.shopifyCache?.discountCodes
                    || params.data.order?.discountCode || '';
            },
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.data?.isFirstLine) return null;
                const code = params.data.order?.shopifyCache?.discountCodes
                    || params.data.order?.discountCode;
                if (!code) return null;
                return (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700">
                        {code}
                    </span>
                );
            },
            cellClass: 'text-xs',
        },

        // Shopify Tags
        {
            colId: 'tags',
            headerName: getHeaderName('tags'),
            width: 180,
            valueGetter: (params: ValueGetterParams) => {
                if (!params.data?.isFirstLine) return '';
                return params.data.order?.shopifyCache?.tags || '';
            },
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.data?.isFirstLine) return null;
                const tagsStr = params.data.order?.shopifyCache?.tags || '';
                if (!tagsStr) return null;

                const tags = tagsStr.split(',').map((t: string) => t.trim()).filter(Boolean);
                return (
                    <div className="flex flex-wrap gap-1">
                        {tags.map((tag: string) => (
                            <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                                {tag}
                            </span>
                        ))}
                    </div>
                );
            },
            cellClass: 'text-xs',
        },

        // Payment Method (COD/Prepaid)
        {
            colId: 'paymentMethod',
            headerName: getHeaderName('paymentMethod'),
            width: 70,
            valueGetter: (params: ValueGetterParams) => {
                if (!params.data?.isFirstLine) return '';
                return params.data.order?.shopifyCache?.paymentMethod
                    || params.data.order?.paymentMethod || '';
            },
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.data?.isFirstLine) return null;
                const method = params.data.order?.shopifyCache?.paymentMethod
                    || params.data.order?.paymentMethod || '';
                if (!method) return null;
                const isCod = method.toLowerCase().includes('cod');
                return (
                    <span
                        className={`text-xs px-1.5 py-0.5 rounded ${isCod ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}
                    >
                        {isCod ? 'COD' : 'Prepaid'}
                    </span>
                );
            },
            cellClass: 'text-center',
        },

        // RTO History (risk indicator)
        {
            colId: 'rtoHistory',
            headerName: getHeaderName('rtoHistory'),
            width: 200,
            valueGetter: (params: ValueGetterParams) => {
                if (!params.data?.isFirstLine) return '';
                return params.data.order?.customerRtoCount || 0;
            },
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.data?.isFirstLine) return null;
                const rtoCount = params.data.order?.customerRtoCount || 0;
                const orderCount = params.data.customerOrderCount || 0;
                const paymentMethod = params.data.order?.shopifyCache?.paymentMethod
                    || params.data.order?.paymentMethod || '';
                const isCod = paymentMethod.toLowerCase().includes('cod');

                // COD orders with RTO history - highest priority warning
                if (isCod && rtoCount > 0) {
                    return (
                        <span
                            className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium border border-red-200"
                            title={`This customer has ${rtoCount} prior COD RTO${rtoCount > 1 ? 's' : ''}`}
                        >
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            {rtoCount} RTO
                        </span>
                    );
                }

                // First-time customer with COD - verification warning
                if (isCod && orderCount <= 1) {
                    return (
                        <span className="text-xs text-amber-600">
                            1st Order + COD - Confirm before shipping
                        </span>
                    );
                }

                // For prepaid orders with RTO history, show subtle indicator
                if (rtoCount > 0) {
                    return (
                        <span className="text-xs text-gray-400" title={`${rtoCount} prior RTO${rtoCount > 1 ? 's' : ''} (prepaid - refunded)`}>
                            {rtoCount}
                        </span>
                    );
                }

                return null;
            },
            cellClass: 'text-center',
            headerTooltip: 'RTO Risk (COD verification)',
        },

        // Customer Notes (from Shopify)
        {
            colId: 'customerNotes',
            headerName: getHeaderName('customerNotes'),
            width: 180,
            autoHeight: true,
            wrapText: true,
            valueGetter: (params: ValueGetterParams) =>
                params.data?.isFirstLine ? params.data.order?.shopifyCache?.customerNotes || '' : '',
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.data?.isFirstLine) return null;
                const notes = params.data.order?.shopifyCache?.customerNotes || '';
                if (!notes) return null;
                return (
                    <span className="text-xs text-purple-600 whitespace-pre-wrap break-words">
                        {notes}
                    </span>
                );
            },
            cellClass: 'text-xs',
        },

        // Customer Order Count
        {
            colId: 'customerOrderCount',
            headerName: getHeaderName('customerOrderCount'),
            field: 'customerOrderCount',
            width: 40,
            valueFormatter: (params: ValueFormatterParams) =>
                params.data?.isFirstLine ? params.value : '',
            cellClass: 'text-xs text-center text-gray-500',
            headerTooltip: 'Customer Order Count',
        },

        // Customer LTV (tier + order count)
        {
            colId: 'customerLtv',
            headerName: getHeaderName('customerLtv'),
            field: 'customerLtv',
            width: 85,
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.data?.isFirstLine) return null;
                const orderCount = params.data.customerOrderCount || 0;
                const ltv = params.data.customerLtv || 0;
                const tier = params.data.order?.customerTier || 'bronze';

                // First order customer - show NEW badge
                if (orderCount <= 1) {
                    return (
                        <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200"
                            title={`First order customer`}
                        >
                            NEW
                        </span>
                    );
                }

                // Returning customer - show order count with tier color
                const tierStyles: Record<string, { bg: string; border: string; icon: string }> = {
                    platinum: { bg: 'bg-purple-100 text-purple-700', border: 'border-purple-300', icon: '' },
                    gold: { bg: 'bg-amber-100 text-amber-700', border: 'border-amber-300', icon: '' },
                    silver: { bg: 'bg-slate-100 text-slate-600', border: 'border-slate-300', icon: '' },
                    bronze: { bg: 'bg-orange-100 text-orange-700', border: 'border-orange-300', icon: '' },
                };
                const style = tierStyles[tier] || tierStyles.bronze;

                return (
                    <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${style.bg} border ${style.border}`}
                        title={`${tier.charAt(0).toUpperCase() + tier.slice(1)} tier - ${orderCount} orders - LTV ${ltv.toLocaleString()}`}
                    >
                        {style.icon && <span>{style.icon}</span>}
                        {orderCount} orders
                    </span>
                );
            },
            cellClass: 'text-xs',
            headerTooltip: 'Customer Lifetime Value',
        },

        // Customer Tags (from Shopify)
        {
            colId: 'customerTags',
            headerName: getHeaderName('customerTags'),
            width: 180,
            valueGetter: (params: ValueGetterParams) => {
                if (!params.data?.isFirstLine) return '';
                return params.data.order?.customer?.tags || '';
            },
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.data?.isFirstLine) return null;
                const tagsStr = params.data.order?.customer?.tags || '';
                if (!tagsStr) return null;

                const tags = tagsStr.split(',').map((t: string) => t.trim()).filter(Boolean);
                return (
                    <div className="flex flex-wrap gap-1">
                        {tags.map((tag: string) => (
                            <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-teal-100 text-teal-700">
                                {tag}
                            </span>
                        ))}
                    </div>
                );
            },
            cellClass: 'text-xs',
        },
    ];
}
