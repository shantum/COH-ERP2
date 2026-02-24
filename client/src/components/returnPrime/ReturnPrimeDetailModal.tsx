/**
 * ReturnPrimeDetailModal - Detailed view of a Return Prime request
 *
 * Shows comprehensive information including:
 * - Header with request number, type, and status
 * - Status timeline (requested -> approved -> received -> inspected -> refunded)
 * - Order and customer info
 * - Line items with product images and details
 * - Exchange info (if applicable)
 * - Shipping/tracking info
 */

import {
  X,
  Package,
  User,
  ShoppingBag,
  Truck,
  CheckCircle,
  Clock,
  AlertCircle,
  ArrowLeftRight,
  RotateCcw,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  ExternalLink,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Badge } from '../ui/badge';
import type { ReturnPrimeRequest, StatusFlag } from '@coh/shared/schemas/returnPrime';
import { formatDate, formatDateTime, formatShortDate } from '../../utils/dateFormatters';

interface Props {
  request: ReturnPrimeRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============================================
// STATUS TIMELINE
// ============================================

interface TimelineStep {
  key: string;
  label: string;
  icon: React.ElementType;
  getStatus: (request: ReturnPrimeRequest) => StatusFlag | undefined;
}

const TIMELINE_STEPS: TimelineStep[] = [
  {
    key: 'requested',
    label: 'Requested',
    icon: Clock,
    getStatus: (r) => ({ status: true, comment: null, created_at: r.created_at }),
  },
  {
    key: 'approved',
    label: 'Approved',
    icon: CheckCircle,
    getStatus: (r) => r.approved,
  },
  {
    key: 'received',
    label: 'Received',
    icon: Package,
    getStatus: (r) => r.received,
  },
  {
    key: 'inspected',
    label: 'Inspected',
    icon: AlertCircle,
    getStatus: (r) => r.inspected,
  },
  {
    key: 'refunded',
    label: 'Refunded',
    icon: CreditCard,
    getStatus: (r) => {
      const refundedItem = r.line_items?.find(li => li.refund?.status === 'refunded');
      if (refundedItem?.refund?.refunded_at) {
        return { status: true, comment: null, created_at: refundedItem.refund.refunded_at };
      }
      return undefined;
    },
  },
];

function StatusTimeline({ request }: { request: ReturnPrimeRequest }) {
  const isRejected = request.rejected?.status;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Status Timeline</h3>

      {isRejected ? (
        <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-200">
          <div className="p-2 bg-red-100 rounded-full">
            <X className="w-4 h-4 text-red-600" />
          </div>
          <div>
            <p className="font-medium text-red-800">Request Rejected</p>
            {request.rejected?.created_at && (
              <p className="text-xs text-red-600">
                {formatDateTime(request.rejected.created_at)}
              </p>
            )}
            {request.rejected?.comment && (
              <p className="text-sm text-red-700 mt-1">{request.rejected.comment}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          {TIMELINE_STEPS.map((step, index) => {
            const statusFlag = step.getStatus(request);
            const isComplete = statusFlag?.status === true;
            const isLast = index === TIMELINE_STEPS.length - 1;
            const Icon = step.icon;

            return (
              <div key={step.key} className="flex flex-col items-center flex-1">
                <div className="flex items-center w-full">
                  <div
                    className={`
                      w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                      ${isComplete
                        ? 'bg-green-100 text-green-600'
                        : 'bg-gray-100 text-gray-400'
                      }
                    `}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  {!isLast && (
                    <div
                      className={`flex-1 h-0.5 mx-1 ${
                        isComplete ? 'bg-green-300' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </div>
                <div className="mt-2 text-center">
                  <p className={`text-xs font-medium ${isComplete ? 'text-gray-900' : 'text-gray-400'}`}>
                    {step.label}
                  </p>
                  {isComplete && statusFlag?.created_at && (
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {formatShortDate(statusFlag.created_at)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================
// INFO SECTIONS
// ============================================

function OrderInfoSection({ request }: { request: ReturnPrimeRequest }) {
  const order = request.order;
  if (!order) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <ShoppingBag className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-700">Order Information</h3>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-gray-500 text-xs">Order Number</p>
          <p className="font-medium">#{order.name}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs">Order ID</p>
          <p className="font-mono text-xs">{order.id}</p>
        </div>
        {order.created_at && (
          <div>
            <p className="text-gray-500 text-xs">Order Date</p>
            <p className="font-medium">{formatDate(order.created_at)}</p>
          </div>
        )}
        {order.payment_gateways && order.payment_gateways.length > 0 && (
          <div>
            <p className="text-gray-500 text-xs">Payment</p>
            <p className="font-medium">{order.payment_gateways.map(pg => pg.name).join(', ')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerInfoSection({ request }: { request: ReturnPrimeRequest }) {
  const customer = request.customer;
  if (!customer) return null;

  const address = customer.address;
  const bank = customer.bank;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <User className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-700">Customer Information</h3>
      </div>
      <div className="space-y-3">
        {/* Basic Info */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {customer.name && (
            <div>
              <p className="text-gray-500 text-xs">Name</p>
              <p className="font-medium">{customer.name}</p>
            </div>
          )}
          {customer.email && (
            <div>
              <p className="text-gray-500 text-xs">Email</p>
              <a href={`mailto:${customer.email}`} className="font-medium text-blue-600 hover:underline flex items-center gap-1">
                <Mail className="w-3 h-3" />
                {customer.email}
              </a>
            </div>
          )}
          {customer.phone && (
            <div>
              <p className="text-gray-500 text-xs">Phone</p>
              <a href={`tel:${customer.phone}`} className="font-medium text-blue-600 hover:underline flex items-center gap-1">
                <Phone className="w-3 h-3" />
                {customer.phone}
              </a>
            </div>
          )}
        </div>

        {/* Address */}
        {address && (
          <div className="pt-2 border-t border-gray-100">
            <p className="text-gray-500 text-xs mb-1 flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              Address
            </p>
            <p className="text-sm text-gray-700">
              {[
                address.address_line_1,
                address.address_line_2,
                address.city,
                address.province,
                address.postal_code,
                address.country,
              ]
                .filter(Boolean)
                .join(', ')}
            </p>
          </div>
        )}

        {/* Bank Details */}
        {bank && (bank.account_holder_name || bank.account_number) && (
          <div className="pt-2 border-t border-gray-100">
            <p className="text-gray-500 text-xs mb-1 flex items-center gap-1">
              <CreditCard className="w-3 h-3" />
              Bank Details
            </p>
            <div className="text-sm text-gray-700 space-y-0.5">
              {bank.account_holder_name && <p>Name: {bank.account_holder_name}</p>}
              {bank.account_number && <p>Account: ****{bank.account_number.slice(-4)}</p>}
              {bank.ifsc_code && <p>IFSC: {bank.ifsc_code}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LineItemsSection({ request }: { request: ReturnPrimeRequest }) {
  const lineItems = request.line_items;
  if (!lineItems || lineItems.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Package className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-700">
          Items ({lineItems.length})
        </h3>
      </div>
      <div className="space-y-3">
        {lineItems.map((item) => {
          const product = item.original_product;
          const exchangeProduct = item.exchange_product;
          const refund = item.refund;
          const shopPrice = item.shop_price;
          const reasonDetail = item.reason_detail || item.customer_comment || request.customer_comment;
          const inspectionNotes = item.inspection_notes || request.inspection_notes;

          return (
            <div
              key={item.id}
              className="flex gap-3 p-3 bg-gray-50 rounded-lg"
            >
              {/* Product Image */}
              {product?.image?.src ? (
                <img
                  src={product.image.src}
                  alt={product.title || 'Product'}
                  className="w-16 h-16 object-cover rounded-lg border border-gray-200 flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-16 bg-gray-200 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Package className="w-6 h-6 text-gray-400" />
                </div>
              )}

              {/* Product Details */}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">
                  {product?.title || 'Unknown Product'}
                </p>
                {product?.variant_title && (
                  <p className="text-xs text-gray-500">{product.variant_title}</p>
                )}
                {product?.sku && (
                  <p className="text-xs text-gray-400 font-mono">SKU: {product.sku}</p>
                )}
                <div className="flex items-center gap-3 mt-1 text-xs">
                  <span className="text-gray-600">Qty: {item.quantity}</span>
                  {shopPrice?.actual_amount && (
                    <span className="font-medium">
                      ₹{shopPrice.actual_amount.toLocaleString()}
                    </span>
                  )}
                </div>

                {/* Reason */}
                {(item.reason || reasonDetail) && (
                  <div className="mt-2 space-y-1">
                    {item.reason && (
                      <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded inline-block">
                        Reason: {item.reason}
                      </p>
                    )}
                    {reasonDetail && reasonDetail !== item.reason && (
                      <p className="text-xs text-gray-700 bg-gray-100 px-2 py-1 rounded">
                        Comment: {reasonDetail}
                      </p>
                    )}
                  </div>
                )}

                {inspectionNotes && (
                  <p className="mt-2 text-xs text-slate-700 bg-slate-100 px-2 py-1 rounded inline-block">
                    Inspection: {inspectionNotes}
                  </p>
                )}

                {/* Refund Status */}
                {refund && (
                  <div className="mt-2 flex items-center gap-2">
                    <Badge
                      variant={refund.status === 'refunded' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {refund.status === 'refunded' ? 'Refunded' : refund.status}
                    </Badge>
                    {refund.refunded_amount?.shop_money?.amount && (
                      <span className="text-xs text-green-600 font-medium">
                        ₹{refund.refunded_amount.shop_money.amount.toLocaleString()}
                      </span>
                    )}
                    {refund.actual_mode && (
                      <span className="text-xs text-gray-500">
                        via {refund.actual_mode}
                      </span>
                    )}
                  </div>
                )}

                {/* Exchange Product */}
                {exchangeProduct && (
                  <div className="mt-2 p-2 bg-purple-50 rounded border border-purple-100">
                    <p className="text-xs text-purple-700 font-medium flex items-center gap-1">
                      <ArrowLeftRight className="w-3 h-3" />
                      Exchange for:
                    </p>
                    <p className="text-sm text-purple-900 mt-0.5">
                      {exchangeProduct.title}
                      {exchangeProduct.variant_title && ` - ${exchangeProduct.variant_title}`}
                    </p>
                  </div>
                )}

                {/* Shipping Info */}
                {item.shipping && item.shipping.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.shipping.map((ship, idx) => (
                      <div key={idx} className="text-xs text-gray-600 flex items-center gap-1">
                        <Truck className="w-3 h-3" />
                        {ship.shipping_company && <span>{ship.shipping_company}</span>}
                        {ship.awb && <span className="font-mono">AWB: {ship.awb}</span>}
                        {ship.tracking_url && (
                          <a
                            href={ship.tracking_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-0.5"
                          >
                            Track <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export function ReturnPrimeDetailModal({ request, open, onOpenChange }: Props) {
  if (!request) return null;

  const isExchange = request.request_type === 'exchange';
  const TypeIcon = isExchange ? ArrowLeftRight : RotateCcw;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-4 border-b">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-lg font-semibold flex items-center gap-2">
                <TypeIcon className={`w-5 h-5 ${isExchange ? 'text-purple-600' : 'text-blue-600'}`} />
                Request {request.request_number}
              </DialogTitle>
              <p className="text-sm text-gray-500 mt-1">
                Created {formatDateTime(request.created_at)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={isExchange ? 'border-purple-300 text-purple-700' : 'border-blue-300 text-blue-700'}
              >
                {isExchange ? 'Exchange' : 'Return'}
              </Badge>
              {request.manual_request && (
                <Badge variant="secondary" className="text-xs">
                  Manual
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Status Timeline */}
          <StatusTimeline request={request} />

          {/* Two Column Layout for Order and Customer */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <OrderInfoSection request={request} />
            <CustomerInfoSection request={request} />
          </div>

          {/* Line Items */}
          <LineItemsSection request={request} />

          {request.notes && (
            <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Internal Notes</h3>
              <p className="text-sm text-slate-700">{request.notes}</p>
            </div>
          )}

          {/* Incentive Info */}
          {request.incentive && (
            <div className="bg-green-50 rounded-lg border border-green-200 p-4">
              <h3 className="text-sm font-semibold text-green-800 mb-2">Exchange Incentive</h3>
              <p className="text-sm text-green-700">
                {request.incentive.type === 'percentage'
                  ? `${request.incentive.value}% off`
                  : `₹${request.incentive.value} off`}
                {request.incentive.amount?.shop_money?.amount && (
                  <span className="ml-2">
                    (Worth ₹{request.incentive.amount.shop_money.amount.toLocaleString()})
                  </span>
                )}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
