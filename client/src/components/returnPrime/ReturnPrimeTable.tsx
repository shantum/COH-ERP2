/**
 * ReturnPrimeTable - Request list table for Return Prime dashboard
 *
 * Displays return/exchange requests with status badges, customer info, and item details
 */

import { memo } from 'react';
import { ChevronRight, Package } from 'lucide-react';
import type { ReturnPrimeRequest } from '@coh/shared/schemas/returnPrime';
import { formatDate } from '../../utils/dateFormatters';

interface Props {
  requests: ReturnPrimeRequest[];
  isLoading: boolean;
  onRowClick: (request: ReturnPrimeRequest) => void;
}

function getStatusBadge(request: ReturnPrimeRequest): { label: string; className: string } {
  if (request.rejected?.status) return { label: 'Rejected', className: 'bg-red-100 text-red-800' };
  if (request.archived?.status) return { label: 'Archived', className: 'bg-gray-100 text-gray-800' };

  const hasRefund = request.line_items?.some(li => li.refund?.status === 'refunded');
  if (hasRefund) return { label: 'Refunded', className: 'bg-emerald-100 text-emerald-800' };

  if (request.inspected?.status) return { label: 'Inspected', className: 'bg-purple-100 text-purple-800' };
  if (request.received?.status) return { label: 'Received', className: 'bg-green-100 text-green-800' };
  if (request.approved?.status) return { label: 'Approved', className: 'bg-blue-100 text-blue-800' };

  return { label: 'Pending', className: 'bg-amber-100 text-amber-800' };
}

function getTypeBadge(type: string): { label: string; className: string } {
  return type === 'exchange'
    ? { label: 'Exchange', className: 'bg-purple-100 text-purple-800' }
    : { label: 'Return', className: 'bg-blue-100 text-blue-800' };
}

import { formatCurrencyFull } from '../../utils/formatting';
function formatCurrency(amount: number | undefined): string {
  return formatCurrencyFull(amount ?? 0);
}


const TableRow = memo(function TableRow({
  request,
  onClick
}: {
  request: ReturnPrimeRequest;
  onClick: () => void;
}) {
  const status = getStatusBadge(request);
  const type = getTypeBadge(request.request_type);
  const totalValue = request.line_items?.reduce(
    (sum, li) => sum + (li.shop_price?.actual_amount || 0),
    0
  ) || 0;
  const firstLine = request.line_items?.[0];
  const primaryReason =
    firstLine?.reason_detail ||
    firstLine?.customer_comment ||
    firstLine?.reason ||
    request.customer_comment ||
    'N/A';

  return (
    <tr
      className="hover:bg-gray-50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900">{request.request_number}</div>
        <div className="text-xs text-gray-500">
          {formatDate(request.created_at)}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${type.className}`}>
          {type.label}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${status.className}`}>
          {status.label}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900">#{request.order?.name}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-gray-900">{request.customer?.name || 'N/A'}</div>
        <div className="text-xs text-gray-500">{request.customer?.email}</div>
      </td>
      <td className="px-4 py-3 text-center">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-medium">
          {request.line_items?.length || 0}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-medium">
        {formatCurrency(totalValue)}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-gray-600 truncate max-w-[120px] block">
          {primaryReason}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <ChevronRight className="w-4 h-4 text-gray-400 inline-block" />
      </td>
    </tr>
  );
});

export function ReturnPrimeTable({ requests, isLoading, onRowClick }: Props) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-500">Loading requests...</p>
        </div>
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-gray-900 mb-1">No requests found</h3>
        <p className="text-gray-500">Try adjusting your filters or date range</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Request
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Order
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Customer
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Items
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Value
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Reason
              </th>
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {requests.map((request) => (
              <TableRow
                key={request.id}
                request={request}
                onClick={() => onRowClick(request)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-500">
        Showing {requests.length} requests
      </div>
    </div>
  );
}
