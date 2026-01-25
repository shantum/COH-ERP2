/**
 * OrderHistoryCard - Clickable order card for navigation within Customer tab
 *
 * Displays order summary with status, total, and product info.
 * Highlights current order and enables navigation to other orders.
 */

import { ChevronRight, Package } from 'lucide-react';

interface OrderLine {
  id: string;
  qty: number;
  sku?: {
    size?: string | null;
    variation?: {
      colorName?: string | null;
      colorHex?: string | null;
      imageUrl?: string | null;
      product?: { name?: string | null; imageUrl?: string | null } | null;
      fabricColour?: { fabric?: { name?: string | null } | null } | null;
    } | null;
  } | null;
}

interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount?: number | null;
  orderDate: string | Date;
  orderLines?: OrderLine[];
}

interface OrderHistoryCardProps {
  order: OrderSummary;
  isCurrent: boolean;
  onClick: () => void;
}

// Status badge configuration
const STATUS_CONFIG: Record<string, { bg: string; text: string }> = {
  open: { bg: 'bg-sky-100', text: 'text-sky-700' },
  pending: { bg: 'bg-slate-100', text: 'text-slate-600' },
  allocated: { bg: 'bg-purple-100', text: 'text-purple-700' },
  picked: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  packed: { bg: 'bg-violet-100', text: 'text-violet-700' },
  shipped: { bg: 'bg-amber-100', text: 'text-amber-700' },
  delivered: { bg: 'bg-green-100', text: 'text-green-700' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-600' },
  rto: { bg: 'bg-orange-100', text: 'text-orange-700' },
  rto_delivered: { bg: 'bg-orange-100', text: 'text-orange-700' },
};

function getRelativeTime(date: string | Date): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const days = Math.floor((Date.now() - dateObj.getTime()) / (1000 * 60 * 60 * 24));

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatDate(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function getProductSummary(orderLines?: OrderLine[]): string {
  if (!orderLines || orderLines.length === 0) return '';

  const firstLine = orderLines[0];
  const productName = firstLine.sku?.variation?.product?.name || 'Unknown Product';
  const colorName = firstLine.sku?.variation?.colorName || '';

  const summary = colorName ? `${productName} ${colorName}` : productName;

  if (orderLines.length > 1) {
    return `${summary} + ${orderLines.length - 1} more`;
  }

  return summary;
}

export function OrderHistoryCard({ order, isCurrent, onClick }: OrderHistoryCardProps) {
  const statusConfig = STATUS_CONFIG[order.status?.toLowerCase()] || STATUS_CONFIG.open;
  const firstImage = order.orderLines?.[0]?.sku?.variation?.imageUrl ||
    order.orderLines?.[0]?.sku?.variation?.product?.imageUrl;

  return (
    <button
      onClick={onClick}
      disabled={isCurrent}
      className={`
        w-full text-left p-3 rounded-lg border transition-all
        ${isCurrent
          ? 'bg-sky-50 border-sky-200 cursor-default'
          : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50 cursor-pointer group'
        }
      `}
    >
      <div className="flex items-center gap-3">
        {/* Product Image Thumbnail */}
        {firstImage ? (
          <img
            src={firstImage}
            alt="Product"
            className="w-10 h-10 rounded-lg object-cover border border-slate-200 flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 border border-slate-200">
            <Package size={16} className="text-slate-400" />
          </div>
        )}

        {/* Order Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">#{order.orderNumber}</span>
            {isCurrent && (
              <span className="text-[9px] uppercase tracking-wider text-sky-600 font-medium bg-sky-100 px-1.5 py-0.5 rounded">
                Current
              </span>
            )}
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusConfig.bg} ${statusConfig.text}`}>
              {order.status}
            </span>
          </div>
          <div className="text-xs text-slate-500 truncate mt-0.5">
            {getProductSummary(order.orderLines)}
          </div>
        </div>

        {/* Right: Amount + Date + Arrow */}
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="font-semibold text-slate-900 tabular-nums text-sm">
              {(order.totalAmount ?? 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}
            </div>
            <div className="text-[10px] text-slate-400" title={formatDate(order.orderDate)}>
              {getRelativeTime(order.orderDate)}
            </div>
          </div>
          {!isCurrent && (
            <ChevronRight
              size={16}
              className="text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0"
            />
          )}
        </div>
      </div>
    </button>
  );
}

export default OrderHistoryCard;
