/**
 * ShippingSection - AWB entry, verification, and shipping info
 */

import { useState } from 'react';
import {
  Truck, Package, CheckCircle, AlertCircle, XCircle,
  ScanBarcode, ChevronDown, ChevronUp, ExternalLink
} from 'lucide-react';
import type { Order } from '../../../../types';
import type { ModalMode, ShipFormState, CategorizedLines } from '../types';
import { COURIER_OPTIONS } from '../types';

interface ShippingSectionProps {
  order: Order;
  mode: ModalMode;
  shipForm: ShipFormState;
  categorizedLines: CategorizedLines;
  expectedAwb: string;
  awbMatches: boolean;
  canShipOrder: boolean;
  isShipping?: boolean;
  onShipFieldChange: (field: keyof Omit<ShipFormState, 'selectedLineIds'>, value: string | boolean) => void;
  onShip?: () => void;
  onShipLines?: () => void;
}

export function ShippingSection({
  order,
  mode,
  shipForm,
  categorizedLines,
  expectedAwb,
  awbMatches,
  canShipOrder,
  isShipping,
  onShipFieldChange,
  onShip,
  onShipLines,
}: ShippingSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const isShipMode = mode === 'ship';
  const hasPackedLines = categorizedLines.packed.length > 0;
  const hasSelectedLines = shipForm.selectedLineIds.size > 0;

  // Already shipped - show tracking info
  if (order.status === 'shipped' || order.status === 'delivered' || categorizedLines.shipped.length > 0) {
    const trackingNumber = order.awbNumber || order.shopifyCache?.trackingNumber;
    const courier = order.courier || order.shopifyCache?.trackingCompany;

    // Group shipped lines by AWB
    const shippedByAwb: Record<string, any[]> = {};
    for (const line of categorizedLines.shipped) {
      const awb = (line as any).awbNumber || trackingNumber || 'Unknown';
      if (!shippedByAwb[awb]) shippedByAwb[awb] = [];
      shippedByAwb[awb].push(line);
    }

    return (
      <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-100 rounded-lg">
              <Truck size={14} className="text-emerald-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-700">Shipping</h3>
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">
              Shipped
            </span>
          </div>
          {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>

        {isExpanded && (
          <div className="p-4 space-y-4">
            {Object.entries(shippedByAwb).map(([awb, lines]) => (
              <div key={awb} className="p-3 bg-emerald-50/50 rounded-lg border border-emerald-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Package size={14} className="text-emerald-600" />
                    <span className="text-sm font-mono font-medium text-slate-700">{awb}</span>
                    {courier && (
                      <span className="text-xs text-slate-500">via {courier}</span>
                    )}
                  </div>
                  <a
                    href={`https://www.trackingmore.com/track/en/${awb}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-sky-600 hover:text-sky-700 flex items-center gap-1"
                  >
                    Track <ExternalLink size={12} />
                  </a>
                </div>
                <div className="space-y-1">
                  {lines.map((line: any) => (
                    <div key={line.id} className="flex items-center gap-2 text-xs text-slate-600">
                      <CheckCircle size={12} className="text-emerald-500" />
                      <span>{line.sku?.skuCode || line.skuId}</span>
                      <span className="text-slate-400">×{line.qty}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* If there are still packed lines, show ship form */}
            {hasPackedLines && isShipMode && (
              <div className="pt-4 border-t border-slate-200">
                <ShipForm
                  shipForm={shipForm}
                  expectedAwb={expectedAwb}
                  awbMatches={awbMatches}
                  canShipOrder={canShipOrder}
                  hasSelectedLines={hasSelectedLines}
                  isShipping={isShipping}
                  onShipFieldChange={onShipFieldChange}
                  onShip={onShip}
                  onShipLines={onShipLines}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Not shipped yet - show ship form if in ship mode or has packed lines
  if (!hasPackedLines && !isShipMode) {
    return null; // Don't show shipping section if no packed lines and not in ship mode
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center gap-2">
        <div className="p-1.5 bg-slate-100 rounded-lg">
          <Truck size={14} className="text-slate-500" />
        </div>
        <h3 className="text-sm font-semibold text-slate-700">Shipping</h3>
        {hasPackedLines && (
          <span className="px-2 py-0.5 bg-violet-100 text-violet-700 text-xs font-medium rounded-full">
            Ready to Ship
          </span>
        )}
      </div>

      <div className="p-4">
        {isShipMode ? (
          <ShipForm
            shipForm={shipForm}
            expectedAwb={expectedAwb}
            awbMatches={awbMatches}
            canShipOrder={canShipOrder}
            hasSelectedLines={hasSelectedLines}
            isShipping={isShipping}
            onShipFieldChange={onShipFieldChange}
            onShip={onShip}
            onShipLines={onShipLines}
          />
        ) : (
          <div className="text-center py-4">
            <Truck size={32} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">
              {hasPackedLines
                ? `${categorizedLines.packed.length} items packed and ready to ship`
                : 'Items need to be packed before shipping'
              }
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Switch to Ship mode to enter AWB details
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Ship form sub-component
function ShipForm({
  shipForm,
  expectedAwb,
  awbMatches,
  canShipOrder,
  hasSelectedLines,
  isShipping,
  onShipFieldChange,
  onShip,
  onShipLines,
}: {
  shipForm: ShipFormState;
  expectedAwb: string;
  awbMatches: boolean;
  canShipOrder: boolean;
  hasSelectedLines: boolean;
  isShipping?: boolean;
  onShipFieldChange: (field: keyof Omit<ShipFormState, 'selectedLineIds'>, value: string | boolean) => void;
  onShip?: () => void;
  onShipLines?: () => void;
}) {
  const hasAwb = shipForm.awbNumber.trim() !== '';
  const hasCourier = shipForm.courier.trim() !== '';
  const showVerification = hasAwb && expectedAwb;

  return (
    <div className="space-y-4">
      {/* AWB Input */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1.5">
          AWB / Tracking Number
        </label>
        <div className="relative">
          <ScanBarcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={shipForm.awbNumber}
            onChange={(e) => onShipFieldChange('awbNumber', e.target.value.toUpperCase())}
            placeholder="Scan or enter AWB number..."
            className="w-full pl-10 pr-12 py-2.5 text-sm border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all font-mono"
            autoFocus
          />
          {hasAwb && showVerification && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {awbMatches ? (
                <CheckCircle size={18} className="text-emerald-500" />
              ) : shipForm.bypassVerification ? (
                <AlertCircle size={18} className="text-amber-500" />
              ) : (
                <XCircle size={18} className="text-red-500" />
              )}
            </div>
          )}
        </div>
        {/* Verification message */}
        {hasAwb && expectedAwb && !awbMatches && (
          <div className="mt-2 flex items-start gap-2">
            <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="text-amber-600 font-medium">AWB doesn't match Shopify</p>
              <p className="text-slate-500">Expected: <span className="font-mono">{expectedAwb}</span></p>
              <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shipForm.bypassVerification}
                  onChange={(e) => onShipFieldChange('bypassVerification', e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span className="text-slate-600">Use this AWB anyway</span>
              </label>
            </div>
          </div>
        )}
        {hasAwb && awbMatches && (
          <p className="mt-1.5 text-xs text-emerald-600 flex items-center gap-1">
            <CheckCircle size={12} />
            AWB matches Shopify tracking
          </p>
        )}
      </div>

      {/* Courier Select */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1.5">
          Courier
        </label>
        <select
          value={shipForm.courier}
          onChange={(e) => onShipFieldChange('courier', e.target.value)}
          className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all bg-white"
        >
          <option value="">Select courier...</option>
          {COURIER_OPTIONS.map((courier) => (
            <option key={courier} value={courier}>{courier}</option>
          ))}
        </select>
      </div>

      {/* Ship button */}
      <div className="flex gap-3 pt-2">
        {hasSelectedLines && onShipLines ? (
          <button
            type="button"
            onClick={onShipLines}
            disabled={!canShipOrder || isShipping}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all ${
              canShipOrder && !isShipping
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-lg shadow-emerald-500/25'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            {isShipping ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Shipping...
              </>
            ) : (
              <>
                <Truck size={16} />
                Ship {shipForm.selectedLineIds.size} Selected
              </>
            )}
          </button>
        ) : onShip && (
          <button
            type="button"
            onClick={onShip}
            disabled={!hasAwb || !hasCourier || isShipping}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all ${
              hasAwb && hasCourier && !isShipping
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-lg shadow-emerald-500/25'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            {isShipping ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Shipping...
              </>
            ) : (
              <>
                <Truck size={16} />
                Ship Order
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
