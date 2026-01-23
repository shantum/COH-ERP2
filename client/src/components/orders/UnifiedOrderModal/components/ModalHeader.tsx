/**
 * ModalHeader - Order header with status badges, mode tabs, and navigation
 */

import { X, ShoppingBag, RefreshCw, ExternalLink, Calendar, Hash, Tag, ArrowLeft, ChevronRight, User } from 'lucide-react';
import type { Order } from '../../../../types';
import type { ModalMode, NavigationEntry } from '../types';

interface ModalHeaderProps {
  order: Order;
  mode: ModalMode;
  onModeChange: (mode: ModalMode) => void;
  canEdit: boolean;
  canShip: boolean;
  canCustomer: boolean;
  hasUnsavedChanges: boolean;
  onClose: () => void;
  // Navigation props
  navigationHistory?: NavigationEntry[];
  canGoBack?: boolean;
  onGoBack?: () => void;
}

// Format date for display
const formatDate = (dateString: string | null | undefined) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Status badge configuration
const STATUS_BADGES: Record<string, { bg: string; text: string }> = {
  open: { bg: 'bg-sky-500', text: 'text-white' },
  shipped: { bg: 'bg-emerald-500', text: 'text-white' },
  delivered: { bg: 'bg-green-600', text: 'text-white' },
  cancelled: { bg: 'bg-red-500', text: 'text-white' },
  returned: { bg: 'bg-amber-500', text: 'text-white' },
};

const PAYMENT_BADGES: Record<string, { bg: string; text: string }> = {
  Prepaid: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  COD: { bg: 'bg-amber-100', text: 'text-amber-700' },
  paid: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  pending: { bg: 'bg-amber-100', text: 'text-amber-700' },
};

export function ModalHeader({
  order,
  mode,
  onModeChange,
  canEdit,
  canShip,
  canCustomer,
  hasUnsavedChanges,
  onClose,
  navigationHistory = [],
  canGoBack = false,
  onGoBack,
}: ModalHeaderProps) {
  const statusConfig = STATUS_BADGES[order.status] || { bg: 'bg-slate-500', text: 'text-white' };
  const paymentMethod = order.shopifyCache?.paymentMethod || (order.totalAmount > 0 ? 'Prepaid' : 'COD');
  const paymentConfig = PAYMENT_BADGES[paymentMethod] || PAYMENT_BADGES.Prepaid;
  const discountCodes = order.shopifyCache?.discountCodes || order.discountCode;

  // Build breadcrumb from navigation history
  const showBreadcrumb = navigationHistory.length > 1;

  return (
    <div className="relative">
      {/* Gradient background with subtle texture */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-50" />
      <div className="absolute inset-0 opacity-[0.015]" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
      }} />

      <div className="relative px-6 py-5 border-b border-slate-200/80">
        {/* Breadcrumb Navigation */}
        {showBreadcrumb && (
          <div className="flex items-center gap-2 mb-3 text-sm">
            <button
              onClick={onGoBack}
              disabled={!canGoBack}
              className="flex items-center gap-1.5 px-2 py-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <ArrowLeft size={14} />
              <span>Back</span>
            </button>
            <div className="flex items-center gap-1 text-slate-400 overflow-x-auto">
              {navigationHistory.map((entry, index) => (
                <div key={`${entry.orderId}-${index}`} className="flex items-center gap-1">
                  {index > 0 && <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />}
                  <span className={`whitespace-nowrap ${index === navigationHistory.length - 1 ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
                    {entry.mode === 'customer' ? (
                      <span className="flex items-center gap-1">
                        <User size={12} />
                        Customer
                      </span>
                    ) : (
                      `#${entry.orderNumber}`
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          {/* Left: Order info */}
          <div className="flex items-start gap-4 min-w-0 flex-1">
            {/* Icon */}
            <div className={`p-3 rounded-2xl shadow-sm flex-shrink-0 ${
              order.isExchange
                ? 'bg-gradient-to-br from-amber-100 to-amber-50 text-amber-600'
                : 'bg-gradient-to-br from-sky-100 to-sky-50 text-sky-600'
            }`}>
              {order.isExchange ? <RefreshCw size={22} strokeWidth={1.75} /> : <ShoppingBag size={22} strokeWidth={1.75} />}
            </div>

            {/* Order details */}
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-slate-800 tracking-tight">
                  Order #{order.orderNumber}
                </h2>
                {order.shopifyOrderId && (
                  <a
                    href={`https://admin.shopify.com/store/your-store/orders/${order.shopifyOrderId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-all"
                    title="View in Shopify"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>

              {/* Meta info row */}
              <div className="flex items-center gap-3 mt-1.5 text-sm text-slate-500 flex-wrap">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <Calendar size={13} className="text-slate-400 flex-shrink-0" />
                  {formatDate(order.orderDate)}
                </span>
                <span className="text-slate-300">|</span>
                <span className="flex items-center gap-1.5">
                  <Hash size={13} className="text-slate-400" />
                  {order.channel || 'shopify'}
                </span>
                {discountCodes && (
                  <>
                    <span className="text-slate-300">|</span>
                    <span className="flex items-center gap-1.5 text-emerald-600 max-w-[200px]" title={discountCodes}>
                      <Tag size={13} className="flex-shrink-0" />
                      <span className="truncate">{discountCodes}</span>
                    </span>
                  </>
                )}
              </div>

              {/* Status badges */}
              <div className="flex items-center gap-2 mt-3">
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusConfig.bg} ${statusConfig.text}`}>
                  {order.status}
                </span>
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${paymentConfig.bg} ${paymentConfig.text}`}>
                  {paymentMethod}
                </span>
                {order.isExchange && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                    Exchange
                  </span>
                )}
                {hasUnsavedChanges && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-rose-100 text-rose-600 animate-pulse">
                    Unsaved
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Mode tabs and close */}
          <div className="flex items-start gap-3 flex-shrink-0">
            {/* Mode tabs */}
            <div className="flex bg-slate-100/80 rounded-xl p-1 shadow-inner">
              <button
                onClick={() => onModeChange('view')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                  mode === 'view'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                View
              </button>
              <button
                onClick={() => onModeChange('edit')}
                disabled={!canEdit}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                  mode === 'edit'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : canEdit
                      ? 'text-slate-500 hover:text-slate-700'
                      : 'text-slate-300 cursor-not-allowed'
                }`}
              >
                Edit
              </button>
              <button
                onClick={() => onModeChange('ship')}
                disabled={!canShip}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                  mode === 'ship'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : canShip
                      ? 'text-slate-500 hover:text-slate-700'
                      : 'text-slate-300 cursor-not-allowed'
                }`}
              >
                Ship
              </button>
              <button
                onClick={() => onModeChange('customer')}
                disabled={!canCustomer}
                title={!canCustomer ? 'No customer linked to this order' : undefined}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 flex items-center gap-1.5 ${
                  mode === 'customer'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : canCustomer
                      ? 'text-slate-500 hover:text-slate-700'
                      : 'text-slate-300 cursor-not-allowed'
                }`}
              >
                <User size={14} />
                Customer
              </button>
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
