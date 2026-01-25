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
} from 'lucide-react';
import type { Order, OrderLine } from '../../../../types';
import type { ReturnFormState, LineReturnEligibility } from '../types';

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
  pickup_scheduled: { label: 'Pickup Scheduled', color: 'text-blue-600 bg-blue-50', icon: Truck },
  in_transit: { label: 'In Transit', color: 'text-indigo-600 bg-indigo-50', icon: Truck },
  received: { label: 'Received', color: 'text-violet-600 bg-violet-50', icon: PackageCheck },
  complete: { label: 'Complete', color: 'text-green-600 bg-green-50', icon: CheckCircle2 },
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
  onInitiateReturn: () => Promise<void>;
  onCancelReturn?: (lineId: string) => Promise<void>;
  isInitiating?: boolean;
}

// Format currency
const formatCurrency = (amount: number) => {
  return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

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


// Single line item for returns display
function ReturnLineItem({
  line,
  eligibility,
  isSelected,
  onSelect,
}: {
  line: OrderLine;
  eligibility: LineReturnEligibility;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const sku = line.sku;
  const productName = sku?.variation?.product?.name || 'Unknown Product';
  const colorName = sku?.variation?.colorName || '';
  const size = sku?.size || '';
  const skuCode = sku?.skuCode || line.skuId;
  const imageUrl = sku?.variation?.imageUrl || sku?.variation?.product?.imageUrl;

  // Active return status
  const hasActiveReturn = line.returnStatus && !['cancelled', 'complete'].includes(line.returnStatus);
  const returnStatusConfig = line.returnStatus ? RETURN_STATUS_CONFIG[line.returnStatus] : null;
  const StatusIcon = returnStatusConfig?.icon || Clock;

  // Eligibility display
  const isEligible = eligibility.eligible;
  const hasWarning = !!eligibility.warning;

  return (
    <div
      className={`relative flex items-stretch gap-4 p-4 transition-all cursor-pointer rounded-lg border ${
        isSelected
          ? 'bg-sky-50 border-sky-300 ring-2 ring-sky-200'
          : hasActiveReturn
            ? 'bg-amber-50/50 border-amber-200 hover:border-amber-300'
            : isEligible
              ? 'bg-white border-slate-200 hover:border-sky-300 hover:bg-sky-50/30'
              : 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
      }`}
      onClick={isEligible && !hasActiveReturn ? onSelect : undefined}
    >
      {/* Product image */}
      <div className="w-14 h-14 shrink-0 bg-slate-100 rounded-lg overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt={productName} className="w-full h-full object-cover" />
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

        {/* Return Status or Eligibility */}
        <div className="mt-2 flex items-center gap-2">
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
              {isSelected && (
                <span className="text-xs text-sky-600 font-medium">Selected</span>
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

// Return initiation form
function ReturnInitiationForm({
  line,
  form,
  onFieldChange,
  onInitiate,
  onCancel,
  isInitiating,
}: {
  line: OrderLine;
  form: ReturnFormState;
  onFieldChange: (field: keyof ReturnFormState, value: string | number | null) => void;
  onInitiate: () => void;
  onCancel: () => void;
  isInitiating?: boolean;
}) {
  const maxQty = line.qty;
  const canSubmit =
    form.returnQty > 0 &&
    form.returnQty <= maxQty &&
    form.returnReasonCategory &&
    form.returnResolution !== null;

  return (
    <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <RotateCcw size={16} className="text-sky-600" />
          Initiate Return
        </h4>
        <button
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          Cancel
        </button>
      </div>

      {/* Quantity */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Quantity to Return
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={maxQty}
            value={form.returnQty}
            onChange={(e) => onFieldChange('returnQty', parseInt(e.target.value) || 1)}
            className="w-20 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          />
          <span className="text-xs text-slate-500">of {maxQty} units</span>
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
          <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-all ${
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
          <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-all ${
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
            Exchange order will be created after the return is received.
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
            Initiate Return
          </>
        )}
      </button>
    </div>
  );
}

// Active return display
function ActiveReturnCard({
  line,
  onCancelReturn,
}: {
  line: OrderLine;
  onCancelReturn?: () => void;
}) {
  const statusConfig = RETURN_STATUS_CONFIG[line.returnStatus || ''];
  if (!statusConfig) return null;

  const StatusIcon = statusConfig.icon;
  const sku = line.sku;
  const productName = sku?.variation?.product?.name || 'Unknown Product';
  const colorName = sku?.variation?.colorName || '';
  const size = sku?.size || '';

  // Get reason label
  const reasonLabel = RETURN_REASON_CATEGORIES.find(c => c.value === line.returnReasonCategory)?.label || line.returnReasonCategory;

  return (
    <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${statusConfig.color}`}>
            <StatusIcon size={18} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800">
              {productName} ({colorName} / {size})
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Qty: {line.returnQty} | {reasonLabel}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig.color}`}>
                {statusConfig.label}
              </span>
              <span className="text-xs text-slate-500">
                {line.returnResolution === 'refund' ? 'Refund' : 'Exchange'}
              </span>
            </div>
          </div>
        </div>
        {line.returnStatus === 'requested' && onCancelReturn && (
          <button
            onClick={onCancelReturn}
            className="text-xs text-slate-500 hover:text-red-600 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export function ReturnsSection({
  order,
  returnForm,
  getLineEligibility,
  onReturnFieldChange,
  onSelectLineForReturn,
  onInitiateReturn,
  onCancelReturn,
  isInitiating,
}: ReturnsSectionProps) {
  const [initiatingReturn, setInitiatingReturn] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // Scroll to form when a line is selected
  useEffect(() => {
    if (returnForm.selectedLineId && formRef.current) {
      // Small delay to allow form to render
      setTimeout(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [returnForm.selectedLineId]);

  // Categorize lines
  const { activeReturns, eligibleLines, blockedLines } = useMemo(() => {
    const lines = order.orderLines || [];
    const active: OrderLine[] = [];
    const eligible: Array<{ line: OrderLine; eligibility: LineReturnEligibility }> = [];
    const blocked: Array<{ line: OrderLine; eligibility: LineReturnEligibility }> = [];

    for (const line of lines) {
      // Skip cancelled lines
      if (line.lineStatus === 'cancelled') continue;

      const hasActiveReturn = line.returnStatus && !['cancelled', 'complete'].includes(line.returnStatus);

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

  // Get selected line data
  const selectedLine = useMemo(() => {
    if (!returnForm.selectedLineId) return null;
    return order.orderLines?.find(l => l.id === returnForm.selectedLineId) || null;
  }, [order.orderLines, returnForm.selectedLineId]);

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
    <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
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

        {/* Active Returns */}
        {activeReturns.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Active Returns ({activeReturns.length})
            </h4>
            {activeReturns.map((line) => (
              <ActiveReturnCard
                key={line.id}
                line={line}
                onCancelReturn={
                  onCancelReturn && line.returnStatus === 'requested'
                    ? () => onCancelReturn(line.id)
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {/* Eligible Lines */}
        {eligibleLines.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Eligible for Return ({eligibleLines.length})
            </h4>
            <p className="text-xs text-slate-500 -mt-1">
              Click on an item to initiate a return
            </p>
            {eligibleLines.map(({ line, eligibility }) => (
              <ReturnLineItem
                key={line.id}
                line={line}
                eligibility={eligibility}
                isSelected={returnForm.selectedLineId === line.id}
                onSelect={() => onSelectLineForReturn(line.id, line.qty)}
              />
            ))}

            {/* Return Form */}
            {selectedLine && (
              <div ref={formRef}>
                <ReturnInitiationForm
                  line={selectedLine}
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
                onSelect={() => {}}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
