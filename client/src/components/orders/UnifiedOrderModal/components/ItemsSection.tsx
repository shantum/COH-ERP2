/**
 * ItemsSection - Order line items with integrated order summary
 * Shows per-line financial info and order totals in one unified section
 */

import { useState, useMemo, useCallback } from 'react';
import { Package, Plus, X, RotateCcw, Square, CheckSquare, Tag, Truck, Percent, CreditCard, Pencil, Loader2, CheckCircle } from 'lucide-react';
import type { Order, OrderLine } from '../../../../types';
import type { ModalMode, CategorizedLines, ShipFormState } from '../types';
import { LINE_STATUS_CONFIG, LINE_STATUS_BAR_COLORS } from '../types';
import { ProductSearch, type SKUData } from '../../../common/ProductSearch';
import { getOptimizedImageUrl } from '../../../../utils/imageOptimization';

/** Data shape for inline line updates (qty or price changes) */
interface LineUpdateData {
  unitPrice?: number;
  qty?: number;
}

// Shopify line item data (from shopifyDetails)
interface ShopifyLineItem {
  id: string;
  title: string;
  variantTitle?: string;
  sku: string;
  quantity: number;
  price: string;
  totalDiscount: string;
  discountAllocations: Array<{ amount: string }>;
  imageUrl?: string;
}

// Extended order type with shopifyDetails
interface OrderWithShopifyDetails extends Order {
  shopifyDetails?: {
    lineItems?: ShopifyLineItem[];
    totalTax?: string;
    subtotalPrice?: string;
    totalDiscounts?: string;
    shippingLines?: Array<{ title: string; price: string }>;
    taxLines?: Array<{ title: string; price: string; rate: number }>;
  };
}

interface ItemsSectionProps {
  order: Order;
  mode: ModalMode;
  categorizedLines: CategorizedLines;
  shipForm: ShipFormState;
  isAddingProduct: boolean;
  updatingLineIds?: Set<string>;
  onSetAddingProduct: (value: boolean) => void;
  onUpdateLine?: (lineId: string, data: LineUpdateData) => void;
  onAddLine?: (data: { skuId: string; qty: number; unitPrice: number }) => void;
  onCancelLine?: (lineId: string) => void;
  onUncancelLine?: (lineId: string) => void;
  onToggleLineSelection?: (lineId: string) => void;
  onMarkLineDelivered?: (lineId: string) => void;
}

// Per-line financial info computed from Shopify data
interface LineFinancialInfo {
  mrp: number;              // Original MRP per unit (GST-inclusive)
  discountAmount: number;   // Total discount for the line
  discountPercent: number;  // Discount percentage
  hasDiscount: boolean;
  finalPrice: number;       // Price after discount per unit (GST-inclusive)
  lineTotal: number;        // Total for line (qty × finalPrice)
  gstAmount: number;        // GST portion of the line total
  gstRate: number;          // GST rate (e.g., 12)
  preGstAmount: number;     // Line total excluding GST
}

import { formatCurrencyExact as formatCurrency } from '../../../../utils/formatting';

// Single line item component
function LineItem({
  line,
  mode,
  isSelected,
  isUpdating,
  financialInfo,
  onUpdateLine,
  onCancelLine,
  onUncancelLine,
  onToggleSelection,
  onMarkLineDelivered,
}: {
  line: OrderLine;
  mode: ModalMode;
  isSelected?: boolean;
  isUpdating?: boolean;
  financialInfo?: LineFinancialInfo;
  onUpdateLine?: (lineId: string, data: LineUpdateData) => void;
  onCancelLine?: (lineId: string) => void;
  onUncancelLine?: (lineId: string) => void;
  onToggleSelection?: () => void;
  onMarkLineDelivered?: (lineId: string) => void;
}) {
  const [isEditingPrice, setIsEditingPrice] = useState(false);
  const [isEditingQty, setIsEditingQty] = useState(false);
  const [editPrice, setEditPrice] = useState(line.unitPrice.toString());
  const [editQty, setEditQty] = useState(line.qty.toString());
  const isCancelled = line.lineStatus === 'cancelled';
  const isPending = line.lineStatus === 'pending';
  const isShipMode = mode === 'ship';
  const canSelect = isShipMode && line.lineStatus === 'packed';
  const canEdit = mode === 'edit' && isPending && !isCancelled;

  const statusConfig = LINE_STATUS_CONFIG[line.lineStatus] || LINE_STATUS_CONFIG.pending;
  const statusBarColor = LINE_STATUS_BAR_COLORS[line.lineStatus] || 'bg-slate-300';

  const sku = line.sku;
  const productName = sku?.variation?.product?.name || 'Unknown Product';
  const colorName = sku?.variation?.colorName || '';
  const size = sku?.size || '';
  const skuCode = sku?.skuCode || line.skuId;
  const imageUrl = sku?.variation?.imageUrl || sku?.variation?.product?.imageUrl;

  const handleSavePrice = () => {
    const newPrice = parseFloat(editPrice);
    if (!isNaN(newPrice) && newPrice >= 0 && onUpdateLine) {
      onUpdateLine(line.id, { unitPrice: newPrice });
    }
    setIsEditingPrice(false);
  };

  const handleSaveQty = () => {
    const newQty = parseInt(editQty, 10);
    if (!isNaN(newQty) && newQty >= 1 && onUpdateLine) {
      onUpdateLine(line.id, { qty: newQty });
    }
    setIsEditingQty(false);
  };

  const lineTotal = financialInfo?.lineTotal ?? (line.qty * line.unitPrice);
  const hasDiscount = financialInfo?.hasDiscount || false;
  const hasFinancialInfo = !!financialInfo;

  return (
    <div className={`relative flex items-stretch gap-4 p-4 transition-all ${
      isCancelled ? 'opacity-50 bg-slate-50' : 'bg-white'
    } ${canSelect && isSelected ? 'bg-sky-50 ring-2 ring-sky-200' : ''}`}>
      {/* Status bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${statusBarColor} transition-all`} />

      {/* Selection checkbox (Ship mode) */}
      {canSelect && (
        <button
          type="button"
          onClick={onToggleSelection}
          className="shrink-0 self-center ml-2"
        >
          {isSelected ? (
            <CheckSquare size={20} className="text-sky-600" />
          ) : (
            <Square size={20} className="text-slate-300 hover:text-slate-400" />
          )}
        </button>
      )}

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
            <p className={`text-sm font-medium truncate ${isCancelled ? 'line-through text-slate-500' : 'text-slate-800'}`}>
              {productName}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {colorName} {colorName && size && '/'} {size}
            </p>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">{skuCode}</p>
          </div>

          {/* Pricing - Full financial breakdown */}
          <div className="text-right shrink-0 min-w-[140px]">
            {hasFinancialInfo && financialInfo ? (
              <>
                {/* MRP (original price) if there's a discount */}
                {hasDiscount && (
                  <div className="text-xs text-slate-400 line-through">
                    MRP: {formatCurrency(financialInfo.mrp * line.qty)}
                  </div>
                )}
                {/* Qty × Price - Editable in edit mode */}
                <div className="flex items-center justify-end gap-1.5">
                  {isUpdating && (
                    <Loader2 size={12} className="animate-spin text-sky-500 mr-1" />
                  )}
                  {canEdit && !isUpdating ? (
                    <>
                      {/* Editable Qty */}
                      {isEditingQty ? (
                        <input
                          type="number"
                          value={editQty}
                          onChange={(e) => setEditQty(e.target.value)}
                          onBlur={handleSaveQty}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveQty()}
                          className="w-12 px-1 py-0.5 text-xs text-center border-2 border-sky-400 rounded bg-white focus:ring-2 focus:ring-sky-100 outline-none"
                          autoFocus
                          min={1}
                        />
                      ) : (
                        <button
                          onClick={() => { setEditQty(line.qty.toString()); setIsEditingQty(true); }}
                          className="group relative text-xs text-slate-600 border border-dashed border-slate-300 hover:border-sky-400 hover:text-sky-600 hover:bg-sky-50 px-2 py-0.5 rounded transition-all"
                          title="Click to edit quantity"
                        >
                          {line.qty}
                          <Pencil size={10} className="absolute -right-1 -top-1 opacity-0 group-hover:opacity-100 text-sky-500 bg-white rounded-full p-0.5 shadow-sm transition-opacity" />
                        </button>
                      )}
                      <span className="text-xs text-slate-400">×</span>
                      {/* Editable Price */}
                      {isEditingPrice ? (
                        <input
                          type="number"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          onBlur={handleSavePrice}
                          onKeyDown={(e) => e.key === 'Enter' && handleSavePrice()}
                          className="w-20 px-2 py-0.5 text-sm text-right border-2 border-sky-400 rounded bg-white focus:ring-2 focus:ring-sky-100 outline-none"
                          autoFocus
                        />
                      ) : (
                        <button
                          onClick={() => { setEditPrice(line.unitPrice.toString()); setIsEditingPrice(true); }}
                          className="group relative text-sm font-medium text-slate-700 border border-dashed border-slate-300 hover:border-sky-400 hover:text-sky-600 hover:bg-sky-50 px-2 py-0.5 rounded transition-all"
                          title="Click to edit price"
                        >
                          {formatCurrency(financialInfo.finalPrice)}
                          <Pencil size={10} className="absolute -right-1 -top-1 opacity-0 group-hover:opacity-100 text-sky-500 bg-white rounded-full p-0.5 shadow-sm transition-opacity" />
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-slate-500">{line.qty} ×</span>
                      <span className="text-sm font-medium text-slate-700">{formatCurrency(financialInfo.finalPrice)}</span>
                    </>
                  )}
                </div>
                {/* Discount amount */}
                {hasDiscount && (
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <Tag size={10} className="text-emerald-500" />
                    <span className="text-xs text-emerald-600 font-medium">
                      -{formatCurrency(financialInfo.discountAmount)}
                      <span className="text-emerald-500 ml-0.5">({financialInfo.discountPercent.toFixed(0)}%)</span>
                    </span>
                  </div>
                )}
                {/* GST breakdown */}
                {financialInfo.gstAmount > 0 && (
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    GST ({financialInfo.gstRate}%): {formatCurrency(financialInfo.gstAmount)}
                  </div>
                )}
                {/* Line total */}
                <p className={`text-sm font-semibold mt-1 pt-1 border-t border-slate-100 ${isCancelled ? 'text-slate-400' : 'text-slate-800'}`}>
                  {formatCurrency(lineTotal)}
                </p>
              </>
            ) : (
              <>
                {/* Fallback for no financial info - Qty × Price editable */}
                <div className="flex items-center justify-end gap-1.5">
                  {isUpdating && (
                    <Loader2 size={12} className="animate-spin text-sky-500 mr-1" />
                  )}
                  {canEdit && !isUpdating ? (
                    <>
                      {/* Editable Qty */}
                      {isEditingQty ? (
                        <input
                          type="number"
                          value={editQty}
                          onChange={(e) => setEditQty(e.target.value)}
                          onBlur={handleSaveQty}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveQty()}
                          className="w-12 px-1 py-0.5 text-xs text-center border-2 border-sky-400 rounded bg-white focus:ring-2 focus:ring-sky-100 outline-none"
                          autoFocus
                          min={1}
                        />
                      ) : (
                        <button
                          onClick={() => { setEditQty(line.qty.toString()); setIsEditingQty(true); }}
                          className="group relative text-xs text-slate-600 border border-dashed border-slate-300 hover:border-sky-400 hover:text-sky-600 hover:bg-sky-50 px-2 py-0.5 rounded transition-all"
                          title="Click to edit quantity"
                        >
                          {line.qty}
                          <Pencil size={10} className="absolute -right-1 -top-1 opacity-0 group-hover:opacity-100 text-sky-500 bg-white rounded-full p-0.5 shadow-sm transition-opacity" />
                        </button>
                      )}
                      <span className="text-xs text-slate-400">×</span>
                      {/* Editable Price */}
                      {isEditingPrice ? (
                        <input
                          type="number"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          onBlur={handleSavePrice}
                          onKeyDown={(e) => e.key === 'Enter' && handleSavePrice()}
                          className="w-20 px-2 py-0.5 text-sm text-right border-2 border-sky-400 rounded bg-white focus:ring-2 focus:ring-sky-100 outline-none"
                          autoFocus
                        />
                      ) : (
                        <button
                          onClick={() => { setEditPrice(line.unitPrice.toString()); setIsEditingPrice(true); }}
                          className="group relative text-sm font-medium text-slate-700 border border-dashed border-slate-300 hover:border-sky-400 hover:text-sky-600 hover:bg-sky-50 px-2 py-0.5 rounded transition-all"
                          title="Click to edit price"
                        >
                          {formatCurrency(line.unitPrice)}
                          <Pencil size={10} className="absolute -right-1 -top-1 opacity-0 group-hover:opacity-100 text-sky-500 bg-white rounded-full p-0.5 shadow-sm transition-opacity" />
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-slate-500">{line.qty} ×</span>
                      <span className="text-sm font-medium text-slate-700">{formatCurrency(line.unitPrice)}</span>
                    </>
                  )}
                </div>
                <p className={`text-sm font-semibold mt-0.5 ${isCancelled ? 'text-slate-400' : 'text-slate-800'}`}>
                  {formatCurrency(lineTotal)}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Status and actions row */}
        <div className="flex items-center justify-between mt-3">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig.bg} ${statusConfig.text}`}>
            {statusConfig.label}
          </span>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Edit mode actions */}
            {mode === 'edit' && (
              <>
                {isCancelled ? (
                  onUncancelLine && (
                    <button
                      type="button"
                      onClick={() => onUncancelLine(line.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
                    >
                      <RotateCcw size={12} />
                      Restore
                    </button>
                  )
                ) : isPending && onCancelLine && (
                  <button
                    type="button"
                    onClick={() => onCancelLine(line.id)}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                  >
                    <X size={12} />
                    Cancel
                  </button>
                )}
              </>
            )}

            {/* Mark as Delivered - for shipped lines without deliveredAt */}
            {line.lineStatus === 'shipped' && !line.deliveredAt && onMarkLineDelivered && (
              <button
                type="button"
                onClick={() => onMarkLineDelivered(line.id)}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
              >
                <CheckCircle size={12} />
                Mark Delivered
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ItemsSection({
  order,
  mode,
  categorizedLines,
  shipForm,
  isAddingProduct,
  updatingLineIds,
  onSetAddingProduct,
  onUpdateLine,
  onAddLine,
  onCancelLine,
  onUncancelLine,
  onToggleLineSelection,
  onMarkLineDelivered,
}: ItemsSectionProps) {
  const lines = order.orderLines || [];
  const activeLines = lines.filter(l => l.lineStatus !== 'cancelled');
  const cancelledLines = lines.filter(l => l.lineStatus === 'cancelled');
  const packedLines = categorizedLines.packed;
  const selectedLineIds = shipForm.selectedLineIds;
  const isShipMode = mode === 'ship';

  // Get order-level financial data from Shopify
  const orderWithDetails = order as OrderWithShopifyDetails;
  const shopifyDetails = orderWithDetails.shopifyDetails;
  const shopify = order.shopifyCache;

  // Calculate GST rate from tax lines (default 12% for India)
  const gstRate = shopifyDetails?.taxLines?.[0]?.rate
    ? shopifyDetails.taxLines[0].rate * 100
    : 12;

  // Order-level totals for summary
  // Calculate from line items for accurate display (order.totalAmount may be 0 for exchanges)
  const calculatedLineTotal = useMemo(() => {
    return activeLines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  }, [activeLines]);

  const orderTotals = useMemo(() => {
    // Use Shopify data if available, otherwise calculate from line items
    const subtotalWithGst = shopifyDetails?.subtotalPrice
      ? parseFloat(shopifyDetails.subtotalPrice)
      : calculatedLineTotal;
    const totalTax = shopifyDetails?.totalTax
      ? parseFloat(shopifyDetails.totalTax)
      : 0;
    const totalDiscount = shopifyDetails?.totalDiscounts
      ? parseFloat(shopifyDetails.totalDiscounts)
      : 0;
    const shippingCost = shopifyDetails?.shippingLines?.reduce(
      (sum, line) => sum + parseFloat(line.price || '0'), 0
    ) || 0;
    // Final total: use calculated subtotal for display (line item total)
    // This ensures exchange orders show correct total even when order.totalAmount is 0
    const finalTotal = subtotalWithGst;

    // Pre-GST calculations
    const subtotalPreGst = subtotalWithGst - totalTax;
    const itemTotalWithGst = subtotalWithGst + totalDiscount;

    return {
      itemTotalWithGst,
      totalDiscount,
      subtotalWithGst,
      subtotalPreGst,
      shippingCost,
      totalTax,
      finalTotal,
      discountPercent: totalDiscount > 0 && itemTotalWithGst > 0
        ? (totalDiscount / itemTotalWithGst) * 100
        : 0,
    };
  }, [order, shopifyDetails, calculatedLineTotal]);

  // Build map of SKU -> full financial info from Shopify line items
  const financialInfoBySku = useMemo<Map<string, LineFinancialInfo>>(() => {
    const map = new Map<string, LineFinancialInfo>();
    const shopifyLineItems = shopifyDetails?.lineItems || [];

    for (const item of shopifyLineItems) {
      if (!item.sku) continue;

      const finalPrice = parseFloat(item.price) || 0;
      const totalDiscount = parseFloat(item.totalDiscount) || 0;
      const quantity = item.quantity || 1;

      // Calculate original price per unit (before discount)
      const discountPerUnit = totalDiscount / quantity;
      const mrp = finalPrice + discountPerUnit;

      // Calculate discount percentage
      const discountPercent = mrp > 0 ? (discountPerUnit / mrp) * 100 : 0;

      // Line total (GST-inclusive)
      const lineTotal = finalPrice * quantity;

      // Calculate GST portion (GST is included in price)
      // Formula: preGst = total / (1 + rate), gst = total - preGst
      const preGstAmount = lineTotal / (1 + gstRate / 100);
      const gstAmount = lineTotal - preGstAmount;

      map.set(item.sku, {
        mrp,
        discountAmount: totalDiscount,
        discountPercent,
        hasDiscount: totalDiscount > 0,
        finalPrice,
        lineTotal,
        gstAmount,
        gstRate,
        preGstAmount,
      });
    }

    return map;
  }, [shopifyDetails, gstRate]);

  // Payment method
  const discountCodes = shopify?.discountCodes || order.discountCode;
  const paymentMethod = shopify?.paymentMethod || 'Prepaid';
  const isCod = paymentMethod.toUpperCase() === 'COD';
  const hasShopifyData = !!shopifyDetails?.subtotalPrice;

  // Handle product selection from search
  const handleSelectProduct = useCallback((sku: SKUData, _stock: number) => {
    if (onAddLine) {
      const unitPrice = Number(sku.mrp) || 0;
      onAddLine({
        skuId: sku.id,
        qty: 1,
        unitPrice,
      });
    }
    onSetAddingProduct(false);
  }, [onAddLine, onSetAddingProduct]);

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-slate-100 rounded-lg">
            <Package size={14} className="text-slate-500" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700">
            Items ({activeLines.length})
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {/* Ship mode: Select all/none */}
          {isShipMode && packedLines.length > 0 && (
            <div className="flex items-center gap-1 mr-2">
              <button
                type="button"
                onClick={() => {
                  packedLines.forEach(line => {
                    if (!selectedLineIds.has(line.id)) {
                      onToggleLineSelection?.(line.id);
                    }
                  });
                }}
                className="px-2 py-1 text-xs text-sky-600 hover:bg-sky-50 rounded transition-colors"
              >
                All
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={() => {
                  packedLines.forEach(line => {
                    if (selectedLineIds.has(line.id)) {
                      onToggleLineSelection?.(line.id);
                    }
                  });
                }}
                className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded transition-colors"
              >
                None
              </button>
            </div>
          )}

          {/* Add item button (Edit mode only) */}
          {mode === 'edit' && (
            <button
              type="button"
              onClick={() => onSetAddingProduct(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-sky-600 hover:text-sky-700 hover:bg-sky-50 rounded-lg transition-colors"
            >
              <Plus size={14} />
              Add Item
            </button>
          )}
        </div>
      </div>

      {/* Product search (when adding) */}
      {isAddingProduct && (
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <ProductSearch
            onSelect={handleSelectProduct}
            onCancel={() => onSetAddingProduct(false)}
          />
        </div>
      )}

      {/* Line items */}
      <div className="divide-y divide-slate-100">
        {activeLines.map((line) => {
          const skuCode = line.sku?.skuCode || line.skuId;
          return (
            <LineItem
              key={line.id}
              line={line}
              mode={mode}
              isSelected={selectedLineIds?.has(line.id)}
              isUpdating={updatingLineIds?.has(line.id)}
              financialInfo={skuCode ? financialInfoBySku.get(skuCode) : undefined}
              onUpdateLine={onUpdateLine}
              onCancelLine={onCancelLine}
              onUncancelLine={onUncancelLine}
              onToggleSelection={onToggleLineSelection ? () => onToggleLineSelection(line.id) : undefined}
              onMarkLineDelivered={onMarkLineDelivered}
            />
          );
        })}

        {/* Cancelled lines (collapsed) */}
        {cancelledLines.length > 0 && (
          <div className="p-3 bg-slate-50">
            <p className="text-xs text-slate-500 mb-2">Cancelled ({cancelledLines.length})</p>
            <div className="space-y-2">
              {cancelledLines.map((line) => {
                const skuCode = line.sku?.skuCode || line.skuId;
                return (
                  <LineItem
                    key={line.id}
                    line={line}
                    mode={mode}
                    isUpdating={updatingLineIds?.has(line.id)}
                    financialInfo={skuCode ? financialInfoBySku.get(skuCode) : undefined}
                    onUncancelLine={onUncancelLine}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Empty state */}
      {lines.length === 0 && (
        <div className="p-8 text-center">
          <Package size={32} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-500">No items in this order</p>
        </div>
      )}

      {/* Order Summary Footer */}
      {lines.length > 0 && (
        <div className="border-t-2 border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 space-y-2">
          {/* Item Total (MRP) - show when there's a discount */}
          {hasShopifyData && orderTotals.totalDiscount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Item Total ({activeLines.length} items)</span>
              <span className="text-slate-500">{formatCurrency(orderTotals.itemTotalWithGst)}</span>
            </div>
          )}

          {/* Discount */}
          {(discountCodes || orderTotals.totalDiscount > 0) && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-emerald-600 flex items-center gap-1.5">
                <Tag size={13} />
                Discount
                {discountCodes && (
                  <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-semibold rounded">
                    {discountCodes}
                  </span>
                )}
              </span>
              <span className="font-medium text-emerald-600">
                {orderTotals.totalDiscount > 0 ? (
                  <>
                    -{formatCurrency(orderTotals.totalDiscount)}
                    <span className="text-emerald-500 text-xs ml-1">({orderTotals.discountPercent.toFixed(1)}%)</span>
                  </>
                ) : (
                  'Applied'
                )}
              </span>
            </div>
          )}

          {/* Subtotal (pre-GST) */}
          <div className={`flex items-center justify-between text-sm ${orderTotals.totalDiscount > 0 ? 'pt-2 border-t border-slate-100' : ''}`}>
            <span className="text-slate-600 font-medium">
              Subtotal {!orderTotals.totalDiscount && `(${activeLines.length} items)`}
              <span className="text-[10px] text-slate-400 ml-1">(excl. GST)</span>
            </span>
            <span className="font-semibold text-slate-800">{formatCurrency(orderTotals.subtotalPreGst)}</span>
          </div>

          {/* Shipping */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500 flex items-center gap-1.5">
              <Truck size={13} className="text-slate-400" />
              Shipping
            </span>
            <span className={`font-medium ${orderTotals.shippingCost > 0 ? 'text-slate-700' : 'text-emerald-600'}`}>
              {orderTotals.shippingCost > 0 ? formatCurrency(orderTotals.shippingCost) : 'Free'}
            </span>
          </div>

          {/* Tax/GST */}
          {orderTotals.totalTax > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500 flex items-center gap-1.5">
                <Percent size={13} className="text-slate-400" />
                GST <span className="text-xs text-slate-400">({gstRate}%)</span>
              </span>
              <span className="text-slate-600">+{formatCurrency(orderTotals.totalTax)}</span>
            </div>
          )}

          {/* Divider */}
          <div className="border-t-2 border-slate-200 my-2" />

          {/* Total */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-base font-bold text-slate-800">Total</span>
            <span className="text-xl font-bold text-slate-900 tracking-tight">
              {formatCurrency(orderTotals.finalTotal)}
            </span>
          </div>

          {/* Savings callout */}
          {orderTotals.totalDiscount > 0 && (
            <div className="text-right">
              <span className="text-xs text-emerald-600 font-medium">
                You saved {formatCurrency(orderTotals.totalDiscount)}!
              </span>
            </div>
          )}

          {/* Payment Method */}
          <div className="flex items-center justify-between pt-3 mt-1 border-t border-slate-100">
            <span className="text-sm text-slate-500 flex items-center gap-1.5">
              <CreditCard size={13} className="text-slate-400" />
              Payment
            </span>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
              isCod
                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
            }`}>
              {paymentMethod}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
