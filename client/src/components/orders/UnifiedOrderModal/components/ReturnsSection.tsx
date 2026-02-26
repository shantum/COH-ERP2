/**
 * ReturnsSection - Return management for the order modal
 * Shows return eligibility, active returns, and return initiation form
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Package,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Clock,
  RotateCcw,
  ArrowRight,
  Truck,
  PackageCheck,
  CircleDot,
  DollarSign,
  Check,
  MessageSquare,
  Pencil,
  Save,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import type { Order, OrderLine } from '../../../../types';
import { getOptimizedImageUrl } from '../../../../utils/imageOptimization';
import type { ReturnFormState, LineReturnEligibility } from '../types';
import { ProductSearch, type SKUData } from '../../../common/ProductSearch';

// Return conditions for receive action
const RETURN_CONDITIONS = [
  { value: 'good', label: 'Good Condition' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'defective', label: 'Defective' },
  { value: 'wrong_item', label: 'Wrong Item' },
  { value: 'used', label: 'Used' },
] as const;

// Return reason categories (matching server config)
const RETURN_REASON_CATEGORIES = [
  { value: 'fit_size', label: 'Size/Fit Issue' },
  { value: 'product_quality', label: 'Quality Issue' },
  { value: 'product_different', label: 'Different from Listing' },
  { value: 'wrong_item_sent', label: 'Wrong Item Sent' },
  { value: 'damaged_in_transit', label: 'Damaged in Transit' },
  { value: 'changed_mind', label: 'Changed Mind' },
  { value: 'other', label: 'Other' },
];

// Return statuses for display
const RETURN_STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  requested: { label: 'Requested', color: 'text-amber-600 bg-amber-50', icon: Clock },
  approved: { label: 'Approved', color: 'text-blue-600 bg-blue-50', icon: Truck },
  inspected: { label: 'Inspected', color: 'text-teal-600 bg-teal-50', icon: CheckCircle2 },
  refunded: { label: 'Refunded', color: 'text-green-600 bg-green-50', icon: CheckCircle2 },
  archived: { label: 'Archived', color: 'text-slate-500 bg-slate-100', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'text-red-600 bg-red-50', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'text-slate-500 bg-slate-100', icon: XCircle },
};

interface ReturnsSectionProps {
  order: Order;
  returnForm: ReturnFormState;
  getLineEligibility: (line: {
    deliveredAt?: Date | string | null;
    returnStatus?: string | null;
    isNonReturnable?: boolean;
  }) => LineReturnEligibility;
  onReturnFieldChange: (field: keyof ReturnFormState, value: string | number | null) => void;
  onSelectLineForReturn: (lineId: string | null, defaultQty?: number) => void;
  onToggleReturnLineSelection?: (lineId: string, defaultQty?: number) => void;
  onUpdateReturnQty?: (lineId: string, qty: number) => void;
  onInitiateReturn: () => Promise<void>;
  onCancelReturn?: (lineId: string) => Promise<void>;
  onSchedulePickup?: (lineId: string) => void | Promise<void>;
  onReceiveReturn?: (lineId: string, condition: 'good' | 'damaged' | 'defective' | 'wrong_item' | 'used') => Promise<void>;
  onProcessRefund?: (lineId: string, grossAmount: number) => Promise<void>;
  onCompleteReturn?: (lineId: string) => Promise<void>;
  onCreateExchange?: (lineId: string, exchangeSkuId: string, exchangeQty: number) => Promise<void>;
  onUpdateNotes?: (lineId: string, notes: string) => Promise<void>;
  isInitiating?: boolean;
}

import { formatCurrencyExact as formatCurrency } from '../../../../utils/formatting';

// Eligibility display configuration with icons and colors
const ELIGIBILITY_DISPLAY: Record<string, {
  label: string;
  variant: 'destructive' | 'warning' | 'success' | 'muted';
  icon: typeof CheckCircle2;
}> = {
  already_returned: {
    label: 'Already has an active return',
    variant: 'destructive',
    icon: XCircle,
  },
  not_delivered: {
    label: 'Not delivered yet',
    variant: 'destructive',
    icon: XCircle,
  },
  line_non_returnable: {
    label: 'Non-returnable item',
    variant: 'destructive',
    icon: XCircle,
  },
  product_non_returnable: {
    label: 'Non-returnable product',
    variant: 'destructive',
    icon: XCircle,
  },
  window_expired: {
    label: 'Return window expired',
    variant: 'destructive',
    icon: XCircle,
  },
  window_expired_override: {
    label: 'Window expired (can override)',
    variant: 'warning',
    icon: AlertCircle,
  },
  within_window: {
    label: 'Eligible',
    variant: 'success',
    icon: CheckCircle2,
  },
};

// Variant color mapping
const VARIANT_COLORS: Record<string, string> = {
  destructive: 'text-red-600 bg-red-50',
  warning: 'text-amber-600 bg-amber-50',
  success: 'text-green-600 bg-green-50',
  muted: 'text-slate-500 bg-slate-100',
};

// Get eligibility reason display text and config
function getEligibilityDisplay(reason?: string): { label: string; colorClass: string; Icon: typeof CheckCircle2 } {
  const config = reason ? ELIGIBILITY_DISPLAY[reason] : undefined;
  if (config) {
    return {
      label: config.label,
      colorClass: VARIANT_COLORS[config.variant],
      Icon: config.icon,
    };
  }
  // Fallback for unknown reasons
  return {
    label: reason || 'Unknown',
    colorClass: VARIANT_COLORS.muted,
    Icon: AlertCircle,
  };
}


// Single line item for returns display (with checkbox for multi-select)
function ReturnLineItem({
  line,
  eligibility,
  isSelected,
  onToggleSelect,
  returnQty,
  onQtyChange,
}: {
  line: OrderLine;
  eligibility: LineReturnEligibility;
  isSelected: boolean;
  onToggleSelect: () => void;
  returnQty?: number;
  onQtyChange?: (qty: number) => void;
}) {
  const sku = line.sku;
  const productName = sku?.variation?.product?.name || 'Unknown Product';
  const colorName = sku?.variation?.colorName || '';
  const size = sku?.size || '';
  const skuCode = sku?.skuCode || line.skuId;
  const imageUrl = sku?.variation?.imageUrl || sku?.variation?.product?.imageUrl;

  // Active return status
  const hasActiveReturn = !!(line.returnStatus && !['cancelled', 'refunded', 'archived', 'rejected'].includes(line.returnStatus));
  const returnStatusConfig = line.returnStatus ? RETURN_STATUS_CONFIG[line.returnStatus] : null;
  const StatusIcon = returnStatusConfig?.icon || Clock;

  // Eligibility display
  const isEligible = eligibility.eligible;
  const hasWarning = !!eligibility.warning;

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isEligible && !hasActiveReturn) {
      onToggleSelect();
    }
  };

  const handleQtyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const newQty = parseInt(e.target.value) || 1;
    if (onQtyChange) {
      onQtyChange(Math.min(Math.max(1, newQty), line.qty));
    }
  };

  return (
    <div
      className={`relative flex items-stretch gap-3 p-4 transition-all rounded-lg border ${
        isSelected
          ? 'bg-sky-50 border-sky-300 ring-2 ring-sky-200'
          : hasActiveReturn
            ? 'bg-amber-50/50 border-amber-200'
            : isEligible
              ? 'bg-white border-slate-200 hover:border-sky-300 hover:bg-sky-50/30'
              : 'bg-slate-50 border-slate-200 opacity-60'
      }`}
    >
      {/* Checkbox for multi-select */}
      <div className="flex items-center">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => {}}
          onClick={handleCheckboxClick}
          disabled={!isEligible || hasActiveReturn}
          className={`w-5 h-5 rounded border-2 transition-all cursor-pointer ${
            isSelected
              ? 'bg-sky-500 border-sky-500 text-white'
              : isEligible && !hasActiveReturn
                ? 'border-slate-300 hover:border-sky-400'
                : 'border-slate-200 bg-slate-100 cursor-not-allowed'
          }`}
        />
      </div>

      {/* Product image */}
      <div className="w-14 h-14 shrink-0 bg-slate-100 rounded-lg overflow-hidden">
        {imageUrl ? (
          <img src={getOptimizedImageUrl(imageUrl, 'md') || imageUrl} alt={productName} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400">
            <Package size={20} />
          </div>
        )}
      </div>

      {/* Product details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate text-slate-800">
              {productName}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {colorName} {colorName && size && '/'} {size}
            </p>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">{skuCode}</p>
          </div>

          {/* Qty and Price */}
          <div className="text-right shrink-0">
            <p className="text-sm font-medium text-slate-800">
              {line.qty} × {formatCurrency(line.unitPrice)}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {formatCurrency(line.qty * line.unitPrice)}
            </p>
          </div>
        </div>

        {/* Return Status or Eligibility + Qty selector when selected */}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {hasActiveReturn && returnStatusConfig ? (
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${returnStatusConfig.color}`}>
              <StatusIcon size={12} />
              Return: {returnStatusConfig.label}
            </span>
          ) : isEligible ? (
            <>
              {hasWarning ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-amber-600 bg-amber-50">
                  <AlertCircle size={12} />
                  {eligibility.warning}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-green-600 bg-green-50">
                  <CheckCircle2 size={12} />
                  {eligibility.daysRemaining !== null && eligibility.daysRemaining >= 0
                    ? `${eligibility.daysRemaining} days left`
                    : 'Eligible'}
                </span>
              )}
              {/* Show qty input when selected */}
              {isSelected && onQtyChange && (
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-xs text-slate-500">Return:</span>
                  <input
                    type="number"
                    min={1}
                    max={line.qty}
                    value={returnQty ?? line.qty}
                    onChange={handleQtyChange}
                    onClick={(e) => e.stopPropagation()}
                    className="w-14 px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                  <span className="text-xs text-slate-400">/ {line.qty}</span>
                </div>
              )}
            </>
          ) : (() => {
            // Use improved eligibility display for blocked items
            const { label, colorClass, Icon } = getEligibilityDisplay(eligibility.reason);
            return (
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
                <Icon size={12} />
                {label}
              </span>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// Return initiation form (multi-line)
function ReturnInitiationForm({
  selectedLines,
  form,
  onFieldChange,
  onInitiate,
  onCancel,
  isInitiating,
}: {
  selectedLines: Array<{ line: OrderLine; returnQty: number }>;
  form: ReturnFormState;
  onFieldChange: (field: keyof ReturnFormState, value: string | number | null) => void;
  onInitiate: () => void;
  onCancel: () => void;
  isInitiating?: boolean;
}) {
  const totalItems = selectedLines.reduce((sum, { returnQty }) => sum + returnQty, 0);
  const totalValue = selectedLines.reduce(
    (sum, { line, returnQty }) => sum + (returnQty * line.unitPrice),
    0
  );

  const canSubmit =
    selectedLines.length > 0 &&
    form.returnReasonCategory &&
    form.returnResolution !== null;

  return (
    <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <RotateCcw size={16} className="text-sky-600" />
          Initiate Return ({selectedLines.length} item{selectedLines.length !== 1 ? 's' : ''})
        </h4>
        <button
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          Clear Selection
        </button>
      </div>

      {/* Summary of selected items */}
      <div className="bg-white rounded-lg p-3 border border-slate-200">
        <p className="text-xs font-medium text-slate-600 mb-2">Selected for Return:</p>
        <div className="space-y-1.5 max-h-32 overflow-y-auto">
          {selectedLines.map(({ line, returnQty }) => (
            <div key={line.id} className="flex items-center justify-between text-xs">
              <span className="text-slate-700 truncate flex-1">
                {line.sku?.variation?.product?.name || 'Product'} - {line.sku?.size || 'Size'}
              </span>
              <span className="text-slate-500 ml-2">
                {returnQty} × {formatCurrency(line.unitPrice)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-xs font-medium">
          <span className="text-slate-600">{totalItems} item{totalItems !== 1 ? 's' : ''} total</span>
          <span className="text-slate-800">{formatCurrency(totalValue)}</span>
        </div>
      </div>

      {/* Reason Category */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Reason for Return <span className="text-red-500">*</span>
        </label>
        <select
          value={form.returnReasonCategory}
          onChange={(e) => onFieldChange('returnReasonCategory', e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white"
        >
          <option value="">Select a reason...</option>
          {RETURN_REASON_CATEGORIES.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </select>
      </div>

      {/* Reason Detail */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Additional Details (Optional)
        </label>
        <textarea
          value={form.returnReasonDetail}
          onChange={(e) => onFieldChange('returnReasonDetail', e.target.value)}
          placeholder="Any additional details about the return..."
          rows={2}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent resize-none"
        />
      </div>

      {/* Resolution */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-2">
          Resolution <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-3">
          <label className={`relative flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-all ${
            form.returnResolution === 'refund'
              ? 'border-sky-500 bg-sky-50 text-sky-700'
              : 'border-slate-200 hover:border-slate-300 text-slate-600'
          }`}>
            <input
              type="radio"
              name="resolution"
              value="refund"
              checked={form.returnResolution === 'refund'}
              onChange={() => onFieldChange('returnResolution', 'refund')}
              className="sr-only"
            />
            <CircleDot size={16} className={form.returnResolution === 'refund' ? 'text-sky-600' : 'text-slate-400'} />
            <span className="text-sm font-medium">Refund</span>
          </label>
          <label className={`relative flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-all ${
            form.returnResolution === 'exchange'
              ? 'border-sky-500 bg-sky-50 text-sky-700'
              : 'border-slate-200 hover:border-slate-300 text-slate-600'
          }`}>
            <input
              type="radio"
              name="resolution"
              value="exchange"
              checked={form.returnResolution === 'exchange'}
              onChange={() => onFieldChange('returnResolution', 'exchange')}
              className="sr-only"
            />
            <RotateCcw size={16} className={form.returnResolution === 'exchange' ? 'text-sky-600' : 'text-slate-400'} />
            <span className="text-sm font-medium">Exchange</span>
          </label>
        </div>
        {form.returnResolution === 'exchange' && (
          <p className="mt-2 text-xs text-slate-500">
            Exchange order will be created immediately for JIT production.
          </p>
        )}
      </div>

      {/* Submit Button */}
      <button
        onClick={onInitiate}
        disabled={!canSubmit || isInitiating}
        className={`w-full py-2.5 px-4 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
          canSubmit && !isInitiating
            ? 'bg-sky-600 hover:bg-sky-700 text-white shadow-lg shadow-sky-500/25'
            : 'bg-slate-200 text-slate-500 cursor-not-allowed'
        }`}
      >
        {isInitiating ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <ArrowRight size={16} />
            Initiate Return for {selectedLines.length} Item{selectedLines.length !== 1 ? 's' : ''}
          </>
        )}
      </button>
    </div>
  );
}

// Active return display with full management capabilities
function ActiveReturnCard({
  line,
  onCancelReturn,
  onSchedulePickup,
  onReceiveReturn,
  onProcessRefund,
  onCompleteReturn,
  onCreateExchange,
  onUpdateNotes,
}: {
  line: OrderLine;
  onCancelReturn?: () => void;
  onSchedulePickup?: () => void;
  onReceiveReturn?: (condition: 'good' | 'damaged' | 'defective' | 'wrong_item' | 'used') => void;
  onProcessRefund?: (grossAmount: number) => void;
  onCompleteReturn?: () => void;
  onCreateExchange?: (exchangeSkuId: string, exchangeQty: number) => void;
  onUpdateNotes?: (notes: string) => void;
}) {
  const [receiveCondition, setReceiveCondition] = useState<string>('');
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(line.returnNotes || '');

  const statusConfig = RETURN_STATUS_CONFIG[line.returnStatus || ''];
  if (!statusConfig) return null;

  const StatusIcon = statusConfig.icon;
  const sku = line.sku;
  const productName = sku?.variation?.product?.name || 'Unknown Product';
  const colorName = sku?.variation?.colorName || '';
  const size = sku?.size || '';
  const skuCode = sku?.skuCode || '';

  // Get reason label
  const reasonLabel = RETURN_REASON_CATEGORIES.find(c => c.value === line.returnReasonCategory)?.label || line.returnReasonCategory;

  // Determine what action is needed based on status
  const getActionNeeded = () => {
    switch (line.returnStatus) {
      case 'requested':
        return 'schedule_pickup';
      case 'approved':
        return 'receive';
      case 'inspected':
        if (line.returnResolution === 'refund' && !line.returnRefundCompletedAt) {
          return 'process_refund';
        } else if (line.returnResolution === 'exchange' && !line.returnExchangeOrderId) {
          return 'create_exchange';
        }
        return 'complete';
      default:
        return null;
    }
  };

  const actionNeeded = getActionNeeded();

  const handleSaveNotes = () => {
    if (onUpdateNotes) {
      onUpdateNotes(notesValue);
    }
    setIsEditingNotes(false);
  };

  const handleReceive = () => {
    if (onReceiveReturn && receiveCondition) {
      onReceiveReturn(receiveCondition as 'good' | 'damaged' | 'defective' | 'wrong_item' | 'used');
    }
  };

  const handleProcessRefund = () => {
    if (onProcessRefund) {
      const grossAmount = (line.returnQty || 1) * line.unitPrice;
      onProcessRefund(grossAmount);
    }
  };

  const [showExchangeSearch, setShowExchangeSearch] = useState(false);

  const handleExchangeSkuSelect = (sku: SKUData, _stock: number) => {
    if (onCreateExchange) {
      onCreateExchange(sku.id, line.returnQty || 1);
    }
    setShowExchangeSearch(false);
  };

  // Calculate days since request
  const daysSinceRequest = line.returnRequestedAt
    ? Math.floor((Date.now() - new Date(line.returnRequestedAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
      {/* Header with status */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className={`p-2 rounded-lg ${statusConfig.color}`}>
            <StatusIcon size={18} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-800">
              {productName}
            </p>
            <p className="text-xs text-slate-500">
              {colorName} / {size} • SKU: {skuCode}
            </p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig.color}`}>
                {statusConfig.label}
              </span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                Qty: {line.returnQty}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${line.returnResolution === 'refund' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                {line.returnResolution === 'refund' ? 'Refund' : 'Exchange'}
              </span>
              {line.returnQcResult && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  line.returnQcResult === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  QC: {line.returnQcResult === 'approved' ? 'Approved' : 'Written Off'}
                </span>
              )}
              {line.returnQcResult === 'written_off' && line.returnResolution === 'exchange' && (
                <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded-full flex items-center gap-1">
                  <AlertTriangle size={10} />
                  QC failed — review exchange
                </span>
              )}
              {line.returnExchangeOrderId && (
                <a
                  href={`/orders?modal=view&orderId=${line.returnExchangeOrderId}`}
                  className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full flex items-center gap-1 hover:bg-blue-200"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={10} />
                  Exchange Order
                </a>
              )}
              {daysSinceRequest > 0 && (
                <span className="text-xs text-slate-400">
                  {daysSinceRequest}d ago
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Return details */}
      <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
        <div className="text-xs text-slate-600">
          <span className="font-medium">Reason:</span> {reasonLabel}
          {line.returnReasonDetail && <span className="text-slate-400"> - {line.returnReasonDetail}</span>}
        </div>
        {line.returnAwbNumber && (
          <div className="text-xs text-slate-600">
            <span className="font-medium">AWB:</span> {line.returnAwbNumber}
            {line.returnCourier && <span className="text-slate-400"> ({line.returnCourier})</span>}
          </div>
        )}
        {line.returnCondition && (
          <div className="text-xs text-slate-600">
            <span className="font-medium">Condition:</span> {line.returnCondition}
          </div>
        )}
      </div>

      {/* Notes section */}
      <div className="mt-3 pt-3 border-t border-slate-100">
        {isEditingNotes ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              placeholder="Add notes..."
              className="flex-1 px-2 py-1 text-sm border border-slate-200 rounded"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveNotes();
                if (e.key === 'Escape') setIsEditingNotes(false);
              }}
            />
            <button onClick={handleSaveNotes} className="p-1 text-green-600 hover:bg-green-50 rounded">
              <Save size={14} />
            </button>
            <button onClick={() => setIsEditingNotes(false)} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
              <XCircle size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs">
            <MessageSquare size={12} className="text-slate-400" />
            <span className="text-slate-500 flex-1">
              {line.returnNotes || <span className="italic">No notes</span>}
            </span>
            {onUpdateNotes && (
              <button
                onClick={() => setIsEditingNotes(true)}
                className="p-1 text-slate-400 hover:text-blue-600"
              >
                <Pencil size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2">
        {actionNeeded === 'schedule_pickup' && onSchedulePickup && (
          <button
            onClick={onSchedulePickup}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 flex items-center gap-1"
          >
            <Truck size={14} />
            Schedule Pickup
          </button>
        )}

        {actionNeeded === 'receive' && onReceiveReturn && (
          <div className="flex items-center gap-2 flex-1">
            <select
              value={receiveCondition}
              onChange={(e) => setReceiveCondition(e.target.value)}
              className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg"
            >
              <option value="">Select Condition</option>
              {RETURN_CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <button
              onClick={handleReceive}
              disabled={!receiveCondition}
              className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <PackageCheck size={14} />
              Receive
            </button>
          </div>
        )}

        {actionNeeded === 'process_refund' && onProcessRefund && (
          <button
            onClick={handleProcessRefund}
            className="px-3 py-1.5 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-700 flex items-center gap-1"
          >
            <DollarSign size={14} />
            Process Refund
          </button>
        )}

        {actionNeeded === 'create_exchange' && onCreateExchange && !showExchangeSearch && (
          <button
            onClick={() => setShowExchangeSearch(true)}
            className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 flex items-center gap-1"
          >
            <ArrowRight size={14} />
            Create Exchange
          </button>
        )}

        {actionNeeded === 'complete' && onCompleteReturn && (
          <button
            onClick={onCompleteReturn}
            className="px-3 py-1.5 bg-slate-600 text-white text-xs rounded-lg hover:bg-slate-700 flex items-center gap-1"
          >
            <Check size={14} />
            Complete
          </button>
        )}

        {line.returnStatus === 'requested' && onCancelReturn && (
          <button
            onClick={onCancelReturn}
            className="px-3 py-1.5 bg-red-50 text-red-700 text-xs rounded-lg hover:bg-red-100 flex items-center gap-1 ml-auto"
          >
            <XCircle size={14} />
            Cancel
          </button>
        )}
      </div>

      {/* Exchange SKU search (inline) */}
      {showExchangeSearch && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-600 mb-2 font-medium">Select exchange product:</p>
          <ProductSearch
            onSelect={handleExchangeSkuSelect}
            onCancel={() => setShowExchangeSearch(false)}
            placeholder="Search for exchange SKU..."
            maxResultsHeight="14rem"
          />
        </div>
      )}
    </div>
  );
}

export function ReturnsSection({
  order,
  returnForm,
  getLineEligibility,
  onReturnFieldChange,
  onSelectLineForReturn,
  onToggleReturnLineSelection,
  onUpdateReturnQty,
  onInitiateReturn,
  onCancelReturn,
  onSchedulePickup,
  onReceiveReturn,
  onProcessRefund,
  onCompleteReturn,
  onCreateExchange,
  onUpdateNotes,
  isInitiating,
}: ReturnsSectionProps) {
  const [initiatingReturn, setInitiatingReturn] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // Scroll to form when lines are selected
  useEffect(() => {
    if (returnForm.selectedLineIds.size > 0 && formRef.current) {
      // Small delay to allow form to render
      setTimeout(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [returnForm.selectedLineIds.size]);

  // Categorize lines
  const { activeReturns, eligibleLines, blockedLines } = useMemo(() => {
    const lines = order.orderLines || [];
    const active: OrderLine[] = [];
    const eligible: Array<{ line: OrderLine; eligibility: LineReturnEligibility }> = [];
    const blocked: Array<{ line: OrderLine; eligibility: LineReturnEligibility }> = [];

    for (const line of lines) {
      // Skip cancelled lines
      if (line.lineStatus === 'cancelled') continue;

      const hasActiveReturn = line.returnStatus && !['cancelled', 'refunded', 'archived', 'rejected'].includes(line.returnStatus);

      if (hasActiveReturn) {
        active.push(line);
      } else {
        const eligibility = getLineEligibility({
          deliveredAt: line.deliveredAt,
          returnStatus: line.returnStatus,
          isNonReturnable: line.isNonReturnable,
        });

        if (eligibility.eligible) {
          eligible.push({ line, eligibility });
        } else {
          blocked.push({ line, eligibility });
        }
      }
    }

    return { activeReturns: active, eligibleLines: eligible, blockedLines: blocked };
  }, [order.orderLines, getLineEligibility]);

  // Get selected lines data with quantities
  const selectedLinesData = useMemo(() => {
    const result: Array<{ line: OrderLine; returnQty: number }> = [];
    for (const lineId of returnForm.selectedLineIds) {
      const line = order.orderLines?.find(l => l.id === lineId);
      if (line) {
        result.push({
          line,
          returnQty: returnForm.returnQtyMap[lineId] ?? line.qty,
        });
      }
    }
    return result;
  }, [order.orderLines, returnForm.selectedLineIds, returnForm.returnQtyMap]);

  // Handle toggle selection - use dedicated handler if available, otherwise fall back
  const handleToggleSelection = (lineId: string, defaultQty?: number) => {
    if (onToggleReturnLineSelection) {
      onToggleReturnLineSelection(lineId, defaultQty);
    } else {
      // Legacy fallback - toggle using single-select
      if (returnForm.selectedLineIds.has(lineId)) {
        onSelectLineForReturn(null);
      } else {
        onSelectLineForReturn(lineId, defaultQty);
      }
    }
  };

  // Handle initiate return
  const handleInitiate = async () => {
    setInitiatingReturn(true);
    try {
      await onInitiateReturn();
    } finally {
      setInitiatingReturn(false);
    }
  };

  const hasAnyDelivered = order.orderLines?.some(l => l.deliveredAt);

  return (
    <div className="bg-white rounded-xl border border-slate-200/80">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white rounded-t-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RotateCcw size={18} className="text-sky-600" />
            <h3 className="font-semibold text-slate-800">Returns</h3>
          </div>
          <span className="text-xs text-slate-500">
            {activeReturns.length > 0 && `${activeReturns.length} active`}
            {activeReturns.length > 0 && eligibleLines.length > 0 && ' | '}
            {eligibleLines.length > 0 && `${eligibleLines.length} eligible`}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* No delivered items message */}
        {!hasAnyDelivered && (
          <div className="text-center py-8 text-slate-500">
            <Package size={32} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm">No delivered items in this order</p>
            <p className="text-xs mt-1">Returns can only be initiated for delivered items</p>
          </div>
        )}

        {/* Active Returns - Full Management UI */}
        {activeReturns.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-amber-600 uppercase tracking-wide flex items-center gap-2">
              <RotateCcw size={14} />
              Active Returns ({activeReturns.length})
            </h4>
            {activeReturns.map((line) => (
              <ActiveReturnCard
                key={line.id}
                line={line}
                onCancelReturn={onCancelReturn ? () => onCancelReturn(line.id) : undefined}
                onSchedulePickup={onSchedulePickup ? () => onSchedulePickup(line.id) : undefined}
                onReceiveReturn={onReceiveReturn ? (condition) => onReceiveReturn(line.id, condition) : undefined}
                onProcessRefund={onProcessRefund ? (amount) => onProcessRefund(line.id, amount) : undefined}
                onCompleteReturn={onCompleteReturn ? () => onCompleteReturn(line.id) : undefined}
                onCreateExchange={onCreateExchange ? (skuId, qty) => onCreateExchange(line.id, skuId, qty) : undefined}
                onUpdateNotes={onUpdateNotes ? (notes) => onUpdateNotes(line.id, notes) : undefined}
              />
            ))}
          </div>
        )}

        {/* Eligible Lines */}
        {eligibleLines.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Eligible for Return ({eligibleLines.length})
              </h4>
              {returnForm.selectedLineIds.size > 0 && (
                <span className="text-xs text-sky-600 font-medium">
                  {returnForm.selectedLineIds.size} selected
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 -mt-1">
              Select items using checkboxes to initiate a return
            </p>
            {eligibleLines.map(({ line, eligibility }) => (
              <ReturnLineItem
                key={line.id}
                line={line}
                eligibility={eligibility}
                isSelected={returnForm.selectedLineIds.has(line.id)}
                onToggleSelect={() => handleToggleSelection(line.id, line.qty)}
                returnQty={returnForm.returnQtyMap[line.id]}
                onQtyChange={onUpdateReturnQty ? (qty) => onUpdateReturnQty(line.id, qty) : undefined}
              />
            ))}

            {/* Return Form - shows when any lines are selected */}
            {selectedLinesData.length > 0 && (
              <div ref={formRef}>
                <ReturnInitiationForm
                  selectedLines={selectedLinesData}
                  form={returnForm}
                  onFieldChange={onReturnFieldChange}
                  onInitiate={handleInitiate}
                  onCancel={() => onSelectLineForReturn(null)}
                  isInitiating={initiatingReturn || isInitiating}
                />
              </div>
            )}
          </div>
        )}

        {/* Blocked Lines */}
        {blockedLines.length > 0 && hasAnyDelivered && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Not Eligible ({blockedLines.length})
            </h4>
            {blockedLines.map(({ line, eligibility }) => (
              <ReturnLineItem
                key={line.id}
                line={line}
                eligibility={eligibility}
                isSelected={false}
                onToggleSelect={() => {}}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
