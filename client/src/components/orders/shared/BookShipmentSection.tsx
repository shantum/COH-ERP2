/**
 * BookShipmentSection - iThink Logistics integration for booking shipments
 *
 * Shared component used by UnifiedOrderModal and EditOrderModal.
 * Provides:
 * - Weight input with quick select buttons
 * - Rate fetching from iThink API
 * - Courier selection with service type badges
 * - Shipment booking and confirmation
 * - AWB display and label printing for booked shipments
 */

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
  Truck, Loader2, AlertCircle, CheckCircle2,
  XCircle, Printer
} from 'lucide-react';
import ConfirmModal from '@/components/common/ConfirmModal';
import { getShippingRates, createShipment, cancelShipment, getShippingLabel } from '../../../server/functions/tracking';
import type { Order } from '../../../types';
import { getProductMrpForShipping } from '../../../utils/orderPricing';
import { invalidateOrderViews } from '../../../hooks/orders/orderMutationUtils';

interface CourierRate {
  logistics: string;
  rate: number;
  zone: string;
  weightSlab: string;
  deliveryTat?: string;
  serviceType?: string;
  supportsCod: boolean;
  supportsPrepaid: boolean;
  supportsReversePickup?: boolean;
}

interface AddressData {
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  country?: string;
}

/**
 * Extended order type for shipment booking.
 * The order data from the modal includes enriched fields like trackingStatus
 * that aren't on the base Order type.
 */
interface BookShipmentOrder extends Order {
  trackingStatus?: string | null;
}

interface BookShipmentSectionProps {
  order: BookShipmentOrder;
  addressForm: AddressData;
  onShipmentBooked?: () => void;
}

export function BookShipmentSection({
  order,
  addressForm,
  onShipmentBooked,
}: BookShipmentSectionProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'idle' | 'rates' | 'confirm' | 'booked'>('idle');
  const [rates, setRates] = useState<CourierRate[]>([]);
  const [selectedCourier, setSelectedCourier] = useState<CourierRate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shipmentWeight, setShipmentWeight] = useState<string>('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Server Functions
  const getShippingRatesFn = useServerFn(getShippingRates);
  const createShipmentFn = useServerFn(createShipment);
  const cancelShipmentFn = useServerFn(cancelShipment);
  const getShippingLabelFn = useServerFn(getShippingLabel);

  // Check if order already has AWB
  const hasAwb = !!order.awbNumber;
  const canCancel = hasAwb && !['delivered', 'rto_delivered'].includes(order.trackingStatus ?? '');

  // Validate address has pincode
  const customerPincode = addressForm.zip || '';
  const hasValidPincode = customerPincode.length === 6;

  // Determine payment method for COD check
  const isCod = order.shopifyCache?.paymentMethod?.toUpperCase() === 'COD';

  const orderTotal = getProductMrpForShipping(order);

  // Helper: Find appropriate weight slab for entered weight
  const getWeightSlab = (weight: number): string => {
    if (weight <= 0.5) return '0.50';
    if (weight <= 1.0) return '1.00';
    if (weight <= 2.0) return '2.00';
    return '5.00';
  };

  // Fetch rates mutation
  const fetchRatesMutation = useMutation({
    mutationFn: async () => {
      const originPincode = '400092'; // Mumbai warehouse
      const weightNum = parseFloat(shipmentWeight) || 0.5;

      const result = await getShippingRatesFn({
        data: {
          fromPincode: originPincode,
          toPincode: customerPincode,
          weight: weightNum,
          paymentMethod: isCod ? 'cod' : 'prepaid',
          productMrp: orderTotal,
        },
      });
      return { data: result, weight: weightNum };
    },
    onSuccess: ({ data, weight }) => {
      const targetSlab = getWeightSlab(weight);

      // Filter rates: only matching weight slab + payment method support
      const filteredRates = (data.rates || []).filter((r: CourierRate) => {
        const paymentOk = isCod ? r.supportsCod : r.supportsPrepaid;
        const slabOk = r.weightSlab === targetSlab;
        return paymentOk && slabOk;
      });

      // If no exact slab match, show lowest available rates per courier
      if (filteredRates.length === 0) {
        const lowestPerCourier = new Map<string, CourierRate>();
        for (const r of data.rates || []) {
          const paymentOk = isCod ? r.supportsCod : r.supportsPrepaid;
          if (!paymentOk) continue;
          const key = r.logistics;
          if (!lowestPerCourier.has(key) || r.rate < lowestPerCourier.get(key)!.rate) {
            lowestPerCourier.set(key, r);
          }
        }
        setRates(Array.from(lowestPerCourier.values()));
      } else {
        setRates(filteredRates);
      }

      setStep('rates');
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to fetch rates');
    },
  });

  // Book shipment mutation
  const bookShipmentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCourier) throw new Error('No courier selected');
      const result = await createShipmentFn({
        data: {
          orderId: order.id,
          logistics: selectedCourier.logistics.toLowerCase(),
        },
      });
      return result;
    },
    onSuccess: () => {
      setStep('booked');
      // Invalidate only affected views: all (where order is) and in_transit (where it may go)
      invalidateOrderViews(queryClient, ['all', 'in_transit']);
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      onShipmentBooked?.();
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to book shipment');
    },
  });

  // Cancel shipment mutation
  const cancelShipmentMutation = useMutation({
    mutationFn: async () => {
      const result = await cancelShipmentFn({
        data: {
          orderId: order.id,
        },
      });
      return result;
    },
    onSuccess: () => {
      // Invalidate only affected views: all and in_transit
      invalidateOrderViews(queryClient, ['all', 'in_transit']);
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      onShipmentBooked?.();
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to cancel shipment');
    },
  });

  // Get label mutation
  const getLabelMutation = useMutation({
    mutationFn: async () => {
      const result = await getShippingLabelFn({
        data: {
          orderId: order.id,
          pageSize: 'A4',
        },
      });
      return result;
    },
    onSuccess: (data) => {
      if (data.labelUrl) {
        window.open(data.labelUrl, '_blank');
      }
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to get label');
    },
  });

  // Reset state when order changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local state to order change
    setStep('idle');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local state to order change
    setRates([]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local state to order change
    setSelectedCourier(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local state to order change
    setError(null);
  }, [order.id]);

  // If order already has AWB - show AWB info with cancel option
  if (hasAwb) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-400 uppercase tracking-wider">
          <Truck size={12} />
          Shipment Details
        </div>

        <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-200">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 size={18} className="text-green-600" />
                <span className="font-semibold text-green-800">Shipment Booked</span>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-slate-700">
                  <span className="text-slate-500">AWB:</span>{' '}
                  <span className="font-mono font-medium">{order.awbNumber}</span>
                </p>
                {order.courier && (
                  <p className="text-sm text-slate-700">
                    <span className="text-slate-500">Courier:</span>{' '}
                    <span className="font-medium capitalize">{order.courier}</span>
                  </p>
                )}
                {order.trackingStatus && (
                  <p className="text-sm text-slate-700">
                    <span className="text-slate-500">Status:</span>{' '}
                    <span className="font-medium capitalize">{order.trackingStatus.replace(/_/g, ' ')}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => getLabelMutation.mutate()}
                disabled={getLabelMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors"
              >
                {getLabelMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Printer size={14} />
                )}
                Label
              </button>

              {canCancel && (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={cancelShipmentMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-lg transition-colors"
                >
                  {cancelShipmentMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <XCircle size={14} />
                  )}
                  Cancel
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-3 p-2 bg-red-100 text-red-700 text-xs rounded-lg">
              {error}
            </div>
          )}
        </div>

        <ConfirmModal
          isOpen={showCancelConfirm}
          onClose={() => setShowCancelConfirm(false)}
          onConfirm={() => cancelShipmentMutation.mutate()}
          title="Cancel Shipment"
          message="Are you sure you want to cancel this shipment? The AWB will be released."
          confirmText="Cancel Shipment"
          confirmVariant="danger"
        />
      </div>
    );
  }

  // Check if can book shipment
  if (!hasValidPincode) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-400 uppercase tracking-wider">
          <Truck size={12} />
          Book Shipment
        </div>
        <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertCircle size={16} />
            <span className="text-sm">Add a valid 6-digit pincode in shipping address to book shipment</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-400 uppercase tracking-wider">
        <Truck size={12} />
        Book Shipment via iThink
      </div>

      {/* Idle state - Show book button */}
      {step === 'idle' && (
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-700">Ready to ship</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Destination: {addressForm.city || 'City'}, {customerPincode}
                  {isCod && <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px]">COD</span>}
                </p>
              </div>
            </div>

            {/* Weight input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Package Weight (kg) <span className="text-red-500">*</span></label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={shipmentWeight}
                    onChange={(e) => setShipmentWeight(e.target.value)}
                    min="0.1"
                    max="50"
                    step="0.1"
                    placeholder="Enter weight"
                    className={`w-24 px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 ${
                      !shipmentWeight || parseFloat(shipmentWeight) <= 0
                        ? 'border-red-300 bg-red-50'
                        : 'border-slate-300'
                    }`}
                  />
                  <span className="text-sm text-slate-500">kg</span>
                </div>
                <div className="flex gap-1">
                  {['0.5', '1', '2', '5'].map((w) => (
                    <button
                      key={w}
                      onClick={() => setShipmentWeight(w)}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        shipmentWeight === w
                          ? 'bg-sky-500 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {w}kg
                    </button>
                  ))}
                </div>
              </div>
              {(!shipmentWeight || parseFloat(shipmentWeight) <= 0) && (
                <p className="text-xs text-red-500">Please enter package weight to get rates</p>
              )}
            </div>

            <button
              onClick={() => fetchRatesMutation.mutate()}
              disabled={fetchRatesMutation.isPending || !shipmentWeight || parseFloat(shipmentWeight) <= 0}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${
                !shipmentWeight || parseFloat(shipmentWeight) <= 0
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'text-white bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 shadow-lg shadow-sky-500/25'
              }`}
            >
              {fetchRatesMutation.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Fetching Rates...
                </>
              ) : (
                <>
                  <Truck size={16} />
                  Get Shipping Rates
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="mt-3 p-2 bg-red-100 text-red-700 text-xs rounded-lg">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Rates step - Show courier options */}
      {step === 'rates' && (
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">Select Courier</p>
              <p className="text-xs text-slate-500">
                {rates.length} options for {shipmentWeight}kg package
              </p>
            </div>
            <button
              onClick={() => { setStep('idle'); setError(null); }}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              ← Back
            </button>
          </div>

          {rates.length === 0 ? (
            <div className="p-4 text-center">
              <AlertCircle size={24} className="mx-auto text-amber-500 mb-2" />
              <p className="text-sm text-slate-600">No couriers available for this pincode</p>
              {isCod && <p className="text-xs text-slate-500 mt-1">COD may not be available at this location</p>}
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {rates.map((rate, idx) => {
                const isSelected = selectedCourier?.logistics === rate.logistics &&
                  selectedCourier?.weightSlab === rate.weightSlab &&
                  selectedCourier?.rate === rate.rate;

                const serviceTypeText = rate.serviceType || '';
                const serviceModeLower = serviceTypeText.toLowerCase();
                const isAir = serviceModeLower.includes('air') || serviceModeLower.includes('express') || serviceModeLower.includes('priority');
                const isSurface = serviceModeLower.includes('surface') || serviceModeLower.includes('ground') || serviceModeLower.includes('standard');

                return (
                  <button
                    key={`${rate.logistics}-${rate.weightSlab}-${rate.rate}-${idx}`}
                    onClick={() => setSelectedCourier(rate)}
                    className={`w-full p-3 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-200'
                        : 'border-slate-200 hover:border-sky-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`p-2 rounded-lg shrink-0 ${isSelected ? 'bg-sky-100' : 'bg-slate-100'}`}>
                          <Truck size={16} className={isSelected ? 'text-sky-600' : 'text-slate-500'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-slate-900">{rate.logistics}</p>
                            {serviceTypeText && (
                              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                isAir
                                  ? 'bg-sky-100 text-sky-700'
                                  : isSurface
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-slate-100 text-slate-600'
                              }`}>
                                {isAir ? '✈ Air' : isSurface ? '🚛 Surface' : serviceTypeText}
                              </span>
                            )}
                            {rate.weightSlab && (
                              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 text-purple-700">
                                ≤{rate.weightSlab}kg
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                            <span className="font-medium">Zone {rate.zone}</span>
                            <span>•</span>
                            <span>{rate.deliveryTat ? `${rate.deliveryTat} day${rate.deliveryTat !== '1' ? 's' : ''} delivery` : 'Est. 2-3 days'}</span>
                            {rate.supportsReversePickup && (
                              <>
                                <span>•</span>
                                <span className="text-green-600">Easy returns</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base font-semibold text-slate-900">₹{rate.rate.toFixed(2)}</p>
                        <div className="flex items-center justify-end gap-1 mt-1">
                          {rate.supportsCod && (
                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-medium rounded">COD</span>
                          )}
                          {rate.supportsPrepaid && (
                            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] font-medium rounded">Prepaid</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selectedCourier && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <button
                onClick={() => setStep('confirm')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 rounded-xl transition-all"
              >
                Continue with {selectedCourier.logistics}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Confirm step */}
      {step === 'confirm' && selectedCourier && (
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-slate-900">Confirm Booking</p>
            <button
              onClick={() => setStep('rates')}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              ← Change
            </button>
          </div>

          <div className="p-4 bg-sky-50 rounded-lg border border-sky-200 mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-sky-100 rounded-lg">
                <Truck size={20} className="text-sky-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-sky-900">{selectedCourier.logistics}</p>
                <p className="text-xs text-sky-700">
                  Zone {selectedCourier.zone} • {selectedCourier.deliveryTat ? `${selectedCourier.deliveryTat} day${selectedCourier.deliveryTat !== '1' ? 's' : ''} delivery` : 'Est. 2-3 days'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-sky-900">₹{selectedCourier.rate.toFixed(2)}</p>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-sm text-slate-600 mb-4">
            <div className="flex justify-between">
              <span>Destination</span>
              <span className="font-medium text-slate-900">{addressForm.city}, {customerPincode}</span>
            </div>
            <div className="flex justify-between">
              <span>Payment</span>
              <span className="font-medium text-slate-900">{isCod ? 'Cash on Delivery' : 'Prepaid'}</span>
            </div>
            <div className="flex justify-between">
              <span>Order Value</span>
              <span className="font-medium text-slate-900">₹{orderTotal.toLocaleString('en-IN')}</span>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-2 bg-red-100 text-red-700 text-xs rounded-lg">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep('rates')}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => bookShipmentMutation.mutate()}
              disabled={bookShipmentMutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 rounded-xl shadow-lg shadow-emerald-500/25 transition-all"
            >
              {bookShipmentMutation.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Booking...
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  Confirm Booking
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Booked step - Success message */}
      {step === 'booked' && (
        <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-green-100 rounded-full">
              <CheckCircle2 size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-green-800">Shipment Booked Successfully!</p>
              <p className="text-xs text-green-600">AWB number has been assigned</p>
            </div>
          </div>
          <p className="text-xs text-slate-500">The order will refresh to show AWB details.</p>
        </div>
      )}
    </div>
  );
}

export default BookShipmentSection;
