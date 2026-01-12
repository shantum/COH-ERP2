/**
 * ItemsSection - Order line items with integrated order summary
 * Shows per-line financial info and order totals in one unified section
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Package, Plus, X, RotateCcw, Square, CheckSquare, Tag, Truck, Percent, CreditCard, Search, Loader2 } from 'lucide-react';
import type { Order, OrderLine } from '../../../../types';
import type { ModalMode, CategorizedLines, ShipFormState } from '../types';
import { LINE_STATUS_CONFIG, LINE_STATUS_BAR_COLORS } from '../types';
import { trpc } from '../../../../services/trpc';

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
  onSetAddingProduct: (value: boolean) => void;
  onUpdateLine?: (lineId: string, data: any) => void;
  onAddLine?: (data: { skuId: string; qty: number; unitPrice: number }) => void;
  onCancelLine?: (lineId: string) => void;
  onUncancelLine?: (lineId: string) => void;
  onToggleLineSelection?: (lineId: string) => void;
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

// Format currency
const formatCurrency = (amount: number) => {
  return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Balance info type for on-demand fetched balances
interface BalanceInfo {
  skuId: string;
  availableBalance: number;
  currentBalance: number;
}

// Product Search Component with on-demand balance fetching
function ProductSearch({
  onSelect,
  onCancel,
}: {
  onSelect: (sku: any, stock: number) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [localBalances, setLocalBalances] = useState<Map<string, BalanceInfo>>(new Map());
  const [fetchingBalanceFor, setFetchingBalanceFor] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const trpcUtils = trpc.useUtils();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fetch all SKUs from tRPC (limit 1000 for comprehensive list)
  const { data: productsData, isLoading: isLoadingProducts } = trpc.products.list.useQuery(
    { limit: 1000 },
    {
      staleTime: 60000, // SKU list doesn't change often
      refetchOnWindowFocus: false,
    }
  );

  // Transform products data into flat SKU list
  const allSkus = useMemo(() => {
    if (!productsData?.products) return [];
    const skus: any[] = [];
    productsData.products.forEach((product: any) => {
      product.variations?.forEach((variation: any) => {
        variation.skus?.forEach((sku: any) => {
          skus.push({
            ...sku,
            variation: {
              ...variation,
              product,
            },
          });
        });
      });
    });
    return skus;
  }, [productsData]);

  // Filter SKUs based on search query - supports multi-word search
  const filteredSkus = useMemo(() => {
    if (!query.trim()) return allSkus.slice(0, 30);

    // Split query into words and check if ALL words match somewhere
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);

    return allSkus.filter((sku: any) => {
      const productName = sku.variation?.product?.name?.toLowerCase() || '';
      const colorName = sku.variation?.colorName?.toLowerCase() || '';
      const size = sku.size?.toLowerCase() || '';
      const skuCode = sku.skuCode?.toLowerCase() || '';

      // Combined searchable text
      const searchText = `${productName} ${colorName} ${size} ${skuCode}`;

      // All words must match somewhere in the combined text
      return words.every(word => searchText.includes(word));
    }).slice(0, 50);
  }, [allSkus, query]);

  // Sort results: by product name, then color, then size order (XS → 4XL)
  const sortedSkus = useMemo(() => {
    const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];

    return [...filteredSkus].sort((a: any, b: any) => {
      // First sort by product name
      const nameA = a.variation?.product?.name || '';
      const nameB = b.variation?.product?.name || '';
      const nameCompare = nameA.localeCompare(nameB);
      if (nameCompare !== 0) return nameCompare;

      // Then by color
      const colorA = a.variation?.colorName || '';
      const colorB = b.variation?.colorName || '';
      const colorCompare = colorA.localeCompare(colorB);
      if (colorCompare !== 0) return colorCompare;

      // Then by size order (XS → 4XL)
      const sizeA = a.size || '';
      const sizeB = b.size || '';
      const sizeIndexA = sizeOrder.indexOf(sizeA);
      const sizeIndexB = sizeOrder.indexOf(sizeB);

      // If both sizes are in our order list, use that order
      if (sizeIndexA !== -1 && sizeIndexB !== -1) {
        return sizeIndexA - sizeIndexB;
      }
      // Unknown sizes go to the end
      if (sizeIndexA === -1 && sizeIndexB !== -1) return 1;
      if (sizeIndexA !== -1 && sizeIndexB === -1) return -1;

      // Both unknown, sort alphabetically
      return sizeA.localeCompare(sizeB);
    });
  }, [filteredSkus]);

  // Fetch balances on-demand for displayed SKUs
  const fetchBalancesForSkus = useCallback(async (skuIds: string[]) => {
    // Filter out SKUs we already have balances for or are currently fetching
    const idsToFetch = skuIds.filter(
      id => !localBalances.has(id) && !fetchingBalanceFor.has(id)
    );

    if (idsToFetch.length === 0) return;

    // Mark as fetching
    setFetchingBalanceFor(prev => {
      const next = new Set(prev);
      idsToFetch.forEach(id => next.add(id));
      return next;
    });

    try {
      // Fetch balances via tRPC
      const balances = await trpcUtils.inventory.getBalances.fetch({ skuIds: idsToFetch });

      // Update local balances map
      setLocalBalances(prev => {
        const next = new Map(prev);
        balances.forEach((balance: any) => {
          next.set(balance.skuId, {
            skuId: balance.skuId,
            availableBalance: balance.availableBalance ?? balance.currentBalance ?? 0,
            currentBalance: balance.currentBalance ?? 0,
          });
        });
        return next;
      });
    } catch (error) {
      console.error('Failed to fetch inventory balances:', error);
    } finally {
      // Clear fetching state
      setFetchingBalanceFor(prev => {
        const next = new Set(prev);
        idsToFetch.forEach(id => next.delete(id));
        return next;
      });
    }
  }, [localBalances, fetchingBalanceFor, trpcUtils.inventory.getBalances]);

  // Trigger balance fetch when sorted SKUs change
  useEffect(() => {
    if (sortedSkus.length > 0) {
      const skuIds = sortedSkus.map((sku: any) => sku.id);
      fetchBalancesForSkus(skuIds);
    }
  }, [sortedSkus, fetchBalancesForSkus]);

  // Get stock for a SKU from local balances
  const getStock = (skuId: string): number | null => {
    const balance = localBalances.get(skuId);
    if (balance) return balance.availableBalance;
    if (fetchingBalanceFor.has(skuId)) return null; // Still loading
    return null; // Unknown
  };

  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm">
      {/* Search Input */}
      <div className="p-3 border-b border-slate-100">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. pima crew blue xs"
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all"
            autoComplete="off"
          />
        </div>
      </div>

      {/* Results - Simple List */}
      <div className="max-h-72 overflow-y-auto">
        {isLoadingProducts ? (
          <div className="p-6 text-center">
            <Loader2 size={24} className="mx-auto text-sky-500 animate-spin mb-2" />
            <p className="text-sm text-slate-500">Loading products...</p>
          </div>
        ) : sortedSkus.length === 0 ? (
          <div className="p-6 text-center">
            <Package size={24} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No products found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {sortedSkus.map((sku: any) => {
              const stock = getStock(sku.id);
              const isLoading = stock === null;
              const isOutOfStock = stock !== null && stock <= 0;
              const isLowStock = stock !== null && stock > 0 && stock <= 3;

              return (
                <button
                  key={sku.id}
                  type="button"
                  onClick={() => onSelect(sku, stock ?? 0)}
                  className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-sky-50 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${isOutOfStock ? 'text-slate-400' : 'text-slate-900'}`}>
                        {sku.variation?.product?.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-xs ${isOutOfStock ? 'text-slate-400' : 'text-slate-600'}`}>
                        {sku.variation?.colorName}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className={`text-xs font-medium ${isOutOfStock ? 'text-slate-400' : 'text-slate-700'}`}>
                        {sku.size}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs text-slate-400 font-mono">
                        {sku.skuCode}
                      </span>
                    </div>
                  </div>
                  <div className={`shrink-0 ml-3 px-2 py-1 rounded text-xs font-medium ${
                    isLoading
                      ? 'bg-slate-100 text-slate-400'
                      : isOutOfStock
                      ? 'bg-slate-100 text-slate-500'
                      : isLowStock
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {isLoading ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      stock
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {sortedSkus.length} result{sortedSkus.length !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Single line item component
function LineItem({
  line,
  mode,
  isSelected,
  financialInfo,
  onUpdateLine,
  onCancelLine,
  onUncancelLine,
  onToggleSelection,
}: {
  line: OrderLine;
  mode: ModalMode;
  isSelected?: boolean;
  financialInfo?: LineFinancialInfo;
  onUpdateLine?: (lineId: string, data: any) => void;
  onCancelLine?: (lineId: string) => void;
  onUncancelLine?: (lineId: string) => void;
  onToggleSelection?: () => void;
}) {
  const [isEditingPrice, setIsEditingPrice] = useState(false);
  const [editPrice, setEditPrice] = useState(line.unitPrice.toString());
  const isCancelled = line.lineStatus === 'cancelled';
  const isPending = line.lineStatus === 'pending';
  const isShipMode = mode === 'ship';
  const canSelect = isShipMode && line.lineStatus === 'packed';

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
                {/* Current unit price */}
                <div className="flex items-baseline justify-end gap-1.5">
                  <span className="text-xs text-slate-500">{line.qty} ×</span>
                  {mode === 'edit' && isPending && !isCancelled ? (
                    isEditingPrice ? (
                      <input
                        type="number"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        onBlur={handleSavePrice}
                        onKeyDown={(e) => e.key === 'Enter' && handleSavePrice()}
                        className="w-20 px-2 py-1 text-sm text-right border border-slate-300 rounded focus:border-sky-400 focus:ring-1 focus:ring-sky-100 outline-none"
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() => setIsEditingPrice(true)}
                        className="text-sm font-medium text-slate-700 hover:text-sky-600 transition-colors"
                      >
                        {formatCurrency(financialInfo.finalPrice)}
                      </button>
                    )
                  ) : (
                    <span className="text-sm font-medium text-slate-700">{formatCurrency(financialInfo.finalPrice)}</span>
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
                {/* Fallback for no financial info */}
                <div className="flex items-baseline justify-end gap-1.5">
                  <span className="text-xs text-slate-500">{line.qty} ×</span>
                  {mode === 'edit' && isPending && !isCancelled ? (
                    isEditingPrice ? (
                      <input
                        type="number"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        onBlur={handleSavePrice}
                        onKeyDown={(e) => e.key === 'Enter' && handleSavePrice()}
                        className="w-20 px-2 py-1 text-sm text-right border border-slate-300 rounded focus:border-sky-400 focus:ring-1 focus:ring-sky-100 outline-none"
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() => setIsEditingPrice(true)}
                        className="text-sm font-medium text-slate-700 hover:text-sky-600 transition-colors"
                      >
                        {formatCurrency(line.unitPrice)}
                      </button>
                    )
                  ) : (
                    <span className="text-sm font-medium text-slate-700">{formatCurrency(line.unitPrice)}</span>
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
          {mode === 'edit' && (
            <div className="flex items-center gap-2">
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
            </div>
          )}
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
  onSetAddingProduct,
  onUpdateLine,
  onAddLine,
  onCancelLine,
  onUncancelLine,
  onToggleLineSelection,
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
  const orderTotals = useMemo(() => {
    const subtotalWithGst = shopifyDetails?.subtotalPrice
      ? parseFloat(shopifyDetails.subtotalPrice)
      : order.totalAmount || 0;
    const totalTax = shopifyDetails?.totalTax
      ? parseFloat(shopifyDetails.totalTax)
      : 0;
    const totalDiscount = shopifyDetails?.totalDiscounts
      ? parseFloat(shopifyDetails.totalDiscounts)
      : 0;
    const shippingCost = shopifyDetails?.shippingLines?.reduce(
      (sum, line) => sum + parseFloat(line.price || '0'), 0
    ) || 0;
    const finalTotal = order.totalAmount || subtotalWithGst;

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
  }, [order, shopifyDetails]);

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

  // Note: onAddLine prop is kept for future product search implementation

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

      {/* Product search placeholder (when adding) */}
      {isAddingProduct && (
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <div className="text-center py-4">
            <p className="text-sm text-slate-500">Product search coming soon...</p>
            <button
              type="button"
              onClick={() => onSetAddingProduct(false)}
              className="mt-2 text-xs text-sky-600 hover:text-sky-700"
            >
              Cancel
            </button>
          </div>
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
              financialInfo={skuCode ? financialInfoBySku.get(skuCode) : undefined}
              onUpdateLine={onUpdateLine}
              onCancelLine={onCancelLine}
              onUncancelLine={onUncancelLine}
              onToggleSelection={onToggleLineSelection ? () => onToggleLineSelection(line.id) : undefined}
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
