/**
 * OrderSummary - Pricing breakdown with clear calculation flow
 * Shows: Item Total (MRP) → Discount → Subtotal → Shipping → Tax → Total
 */

import { Tag, CreditCard, Truck, Percent, Receipt } from 'lucide-react';
import type { Order } from '../../../../types';

// Extended order type with shopifyDetails
interface OrderWithDetails extends Order {
  shopifyDetails?: {
    subtotalPrice?: string;
    totalPrice?: string;
    totalTax?: string;
    totalDiscounts?: string;
    shippingLines?: Array<{ title: string; price: string }>;
    taxLines?: Array<{ title: string; price: string; rate: number }>;
  };
}

interface OrderSummaryProps {
  order: Order;
  calculatedTotal: number;
  totalItems: number;
}

// Format currency
const formatCurrency = (amount: number | string | undefined | null) => {
  if (amount === undefined || amount === null) return '₹0.00';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '₹0.00';
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function OrderSummary({ order, calculatedTotal, totalItems }: OrderSummaryProps) {
  const shopify = order.shopifyCache;
  const orderWithDetails = order as OrderWithDetails;
  const shopifyDetails = orderWithDetails.shopifyDetails;

  const discountCodes = shopify?.discountCodes || order.discountCode;
  const paymentMethod = shopify?.paymentMethod || 'Prepaid';
  const isCod = paymentMethod.toUpperCase() === 'COD';

  // Get values from shopifyDetails
  // Note: Shopify's subtotal_price is AFTER discount, before tax/shipping
  const shopifySubtotal = shopifyDetails?.subtotalPrice
    ? parseFloat(shopifyDetails.subtotalPrice)
    : 0;

  const totalDiscount = shopifyDetails?.totalDiscounts
    ? parseFloat(shopifyDetails.totalDiscounts)
    : 0;

  const totalTax = shopifyDetails?.totalTax
    ? parseFloat(shopifyDetails.totalTax)
    : 0;

  const shippingCost = shopifyDetails?.shippingLines?.reduce(
    (sum, line) => sum + parseFloat(line.price || '0'), 0
  ) || 0;

  // Shopify's subtotal_price is after discount but includes GST (Indian prices are GST-inclusive)
  // We need to calculate pre-GST amounts

  // Calculate item total (MRP with GST) = subtotal + discount
  const itemTotalWithGst = shopifySubtotal > 0
    ? shopifySubtotal + totalDiscount
    : calculatedTotal;

  // Subtotal after discount (still GST-inclusive from Shopify)
  const subtotalWithGst = shopifySubtotal > 0
    ? shopifySubtotal
    : calculatedTotal;

  // Calculate pre-GST subtotal (this is what user wants to see as "Subtotal")
  const subtotalPreGst = subtotalWithGst - totalTax;

  // Calculate discount percentage based on item total
  const discountPercent = totalDiscount > 0 && itemTotalWithGst > 0
    ? ((totalDiscount / itemTotalWithGst) * 100).toFixed(1)
    : '0';

  // Get tax rate from tax lines (usually GST)
  const taxRate = shopifyDetails?.taxLines?.[0]?.rate
    ? (shopifyDetails.taxLines[0].rate * 100).toFixed(0)
    : totalTax > 0 && subtotalPreGst > 0
      ? ((totalTax / subtotalPreGst) * 100).toFixed(0)
      : null;

  // Final total from order (GST-inclusive)
  const finalTotal = order.totalAmount || calculatedTotal;

  // Check if we have Shopify pricing data
  const hasShopifyData = shopifySubtotal > 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-slate-100 rounded-lg">
            <Receipt size={14} className="text-slate-500" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700">Order Summary</h3>
        </div>
      </div>

      <div className="p-4 space-y-2.5">
        {/* Item Total (MRP) - show when there's a discount */}
        {hasShopifyData && totalDiscount > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Item Total ({totalItems} items)</span>
            <span className="text-slate-500">{formatCurrency(itemTotalWithGst)}</span>
          </div>
        )}

        {/* Discount */}
        {(discountCodes || totalDiscount > 0) && (
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
              {totalDiscount > 0 ? (
                <>
                  -{formatCurrency(totalDiscount)}
                  <span className="text-emerald-500 text-xs ml-1">({discountPercent}%)</span>
                </>
              ) : (
                'Applied'
              )}
            </span>
          </div>
        )}

        {/* Subtotal (pre-GST) */}
        {hasShopifyData && (
          <div className={`flex items-center justify-between text-sm ${totalDiscount > 0 ? 'pt-1 border-t border-slate-100' : ''}`}>
            <span className="text-slate-600 font-medium">
              Subtotal {!totalDiscount && `(${totalItems} items)`}
              <span className="text-[10px] text-slate-400 ml-1">(excl. GST)</span>
            </span>
            <span className="font-semibold text-slate-800">{formatCurrency(subtotalPreGst)}</span>
          </div>
        )}

        {/* If no Shopify data, show simple subtotal */}
        {!hasShopifyData && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">Subtotal ({totalItems} items)</span>
            <span className="font-medium text-slate-800">{formatCurrency(subtotalWithGst)}</span>
          </div>
        )}

        {/* Shipping */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 flex items-center gap-1.5">
            <Truck size={13} className="text-slate-400" />
            Shipping
          </span>
          <span className={`font-medium ${shippingCost > 0 ? 'text-slate-700' : 'text-emerald-600'}`}>
            {shippingCost > 0 ? formatCurrency(shippingCost) : 'Free'}
          </span>
        </div>

        {/* Tax/GST - show as addition */}
        {totalTax > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500 flex items-center gap-1.5">
              <Percent size={13} className="text-slate-400" />
              GST {taxRate && <span className="text-xs text-slate-400">({taxRate}%)</span>}
            </span>
            <span className="text-slate-600">+{formatCurrency(totalTax)}</span>
          </div>
        )}

        {/* Divider */}
        <div className="border-t-2 border-slate-200 my-2" />

        {/* Total */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-base font-bold text-slate-800">Total</span>
          <span className="text-xl font-bold text-slate-900 tracking-tight">
            {formatCurrency(finalTotal)}
          </span>
        </div>

        {/* Savings callout if discount applied */}
        {totalDiscount > 0 && (
          <div className="text-right">
            <span className="text-xs text-emerald-600 font-medium">
              You saved {formatCurrency(totalDiscount)}!
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
    </div>
  );
}
