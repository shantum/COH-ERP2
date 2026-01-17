/**
 * CustomerSection - Customer info and shipping address
 */

import { useQuery } from '@tanstack/react-query';
import { User, Mail, Phone, MapPin, Search, ChevronDown, ChevronUp, Check, Clock, CreditCard, ExternalLink } from 'lucide-react';
import { customersApi } from '../../../../services/api';
import { CustomerSearch } from '../../../common/CustomerSearch';
import type { Order } from '../../../../types';
import type { ModalMode, AddressData, EditFormState, OrderWithShopifyDetails } from '../types';
import { formatAddressDisplay } from '../hooks/useUnifiedOrderModal';

interface CustomerSectionProps {
  order: Order;
  mode: ModalMode;
  editForm: EditFormState;
  addressForm: AddressData;
  pastAddresses: AddressData[];
  isLoadingAddresses: boolean;
  isAddressExpanded: boolean;
  isSearchingCustomer: boolean;
  onEditFieldChange: (field: keyof EditFormState, value: string | boolean) => void;
  onAddressChange: (field: keyof AddressData, value: string) => void;
  onSelectPastAddress: (address: AddressData) => void;
  onToggleAddressPicker: () => void;
  onSetSearchingCustomer: (value: boolean) => void;
  onViewCustomerProfile?: () => void;
}

export function CustomerSection({
  order,
  mode,
  editForm,
  addressForm,
  pastAddresses,
  isLoadingAddresses,
  isAddressExpanded,
  isSearchingCustomer,
  onEditFieldChange,
  onAddressChange,
  onSelectPastAddress,
  onToggleAddressPicker,
  onSetSearchingCustomer,
  onViewCustomerProfile,
}: CustomerSectionProps) {
  const isEditing = mode === 'edit';

  // Fetch customer details for LTV and RTO info
  const { data: customerData, isLoading: isLoadingCustomer } = useQuery({
    queryKey: ['customer-details', order.customerId],
    queryFn: () => customersApi.getById(order.customerId!),
    enabled: !!order.customerId && mode === 'view',
    staleTime: 60 * 1000,
  });

  // Extract customer insights
  const customerInsights = customerData?.data ? {
    lifetimeValue: customerData.data.lifetimeValue || 0,
    totalOrders: customerData.data.totalOrders || 0,
    customerTier: customerData.data.customerTier || 'New',
    // Calculate RTO stats from orders
    rtoCount: customerData.data.orders?.filter((o: any) =>
      o.trackingStatus?.startsWith('rto_') || o.status === 'returned'
    ).length || 0,
  } : null;

  const handleSelectCustomer = (customer: any) => {
    const firstName = customer.firstName || '';
    const lastName = customer.lastName || '';
    const displayName = firstName || lastName ? `${firstName} ${lastName}`.trim() : customer.email?.split('@')[0] || '';
    onEditFieldChange('customerName', displayName);
    if (customer.email) onEditFieldChange('customerEmail', customer.email);
    if (customer.phone) onEditFieldChange('customerPhone', customer.phone);
    onSetSearchingCustomer(false);
  };

  const hasAddressData = Object.values(addressForm).some(v => v && String(v).trim());

  // Fallback: try to get address from various sources if addressForm is empty
  let displayAddress = addressForm;
  if (!hasAddressData) {
    // First try order.shippingAddress (JSON string)
    if (order.shippingAddress) {
      try {
        const parsed = JSON.parse(order.shippingAddress as string);
        if (parsed && typeof parsed === 'object') {
          displayAddress = parsed;
        }
      } catch {
        // Not valid JSON, could be plain text
      }
    }

    // If still no address, try shopifyDetails.shippingAddress (from Shopify raw data)
    const orderWithShopifyDetails = order as Order & {
      shopifyDetails?: { shippingAddress?: AddressData };
    };
    if (
      Object.keys(displayAddress).length === 0 &&
      orderWithShopifyDetails.shopifyDetails?.shippingAddress
    ) {
      displayAddress = orderWithShopifyDetails.shopifyDetails.shippingAddress;
    }
  }
  const hasDisplayAddress = Object.values(displayAddress).some(v => v && String(v).trim());

  // Get billing address from shopifyDetails
  const orderWithDetails = order as OrderWithShopifyDetails;
  const billingAddress = orderWithDetails.shopifyDetails?.billingAddress || {};
  const hasBillingAddress = Object.values(billingAddress).some(v => v && String(v).trim());

  // Check if billing address is different from shipping address
  const addressesMatch = hasBillingAddress && hasDisplayAddress &&
    billingAddress.address1 === displayAddress.address1 &&
    billingAddress.city === displayAddress.city &&
    billingAddress.zip === displayAddress.zip;

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Customer Info */}
      <div className="bg-gradient-to-br from-slate-50 to-white rounded-xl border border-slate-200/80 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 bg-slate-100 rounded-lg">
            <User size={14} className="text-slate-500" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700">Customer</h3>
        </div>

        {isEditing ? (
          <div className="space-y-3 relative">
            <div className="relative">
              <input
                type="text"
                value={editForm.customerName}
                onChange={(e) => onEditFieldChange('customerName', e.target.value)}
                placeholder="Customer name"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => onSetSearchingCustomer(true)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-sky-500"
                title="Search customers"
              >
                <Search size={14} />
              </button>
            </div>
            {isSearchingCustomer && (
              <CustomerSearch
                onSelect={handleSelectCustomer}
                onCancel={() => onSetSearchingCustomer(false)}
                initialQuery={editForm.customerName}
                variant="slate"
              />
            )}
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                value={editForm.customerEmail}
                onChange={(e) => onEditFieldChange('customerEmail', e.target.value)}
                placeholder="Email"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all"
              />
            </div>
            <div className="relative">
              <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="tel"
                value={editForm.customerPhone}
                onChange={(e) => onEditFieldChange('customerPhone', e.target.value)}
                placeholder="Phone"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Customer name - clickable if customer exists */}
            {order.customerId && onViewCustomerProfile ? (
              <button
                onClick={onViewCustomerProfile}
                className="text-sm font-medium text-slate-800 hover:text-sky-600 transition-colors flex items-center gap-1 group"
              >
                {order.customerName || 'Unknown'}
                <ExternalLink size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ) : (
              <p className="text-sm font-medium text-slate-800">{order.customerName || 'Unknown'}</p>
            )}
            {/* Email - check order field, customer object, then shopifyDetails */}
            {(() => {
              const email = order.customerEmail || order.customer?.email || orderWithDetails.shopifyDetails?.customerEmail;
              return email && (
                <p className="text-sm text-slate-500 flex items-center gap-2">
                  <Mail size={13} className="text-slate-400" />
                  <a href={`mailto:${email}`} className="hover:text-sky-600 transition-colors">
                    {email}
                  </a>
                </p>
              );
            })()}
            {/* Phone - check order field, customer object, shopifyDetails, or shipping address */}
            {(() => {
              const phone = order.customerPhone || order.customer?.phone || orderWithDetails.shopifyDetails?.customerPhone || displayAddress.phone;
              return phone && (
                <p className="text-sm text-slate-500 flex items-center gap-2">
                  <Phone size={13} className="text-slate-400" />
                  <a href={`tel:${phone}`} className="hover:text-sky-600 transition-colors">
                    {phone}
                  </a>
                </p>
              );
            })()}
            {/* Show message if no contact info */}
            {!order.customerEmail && !order.customer?.email && !orderWithDetails.shopifyDetails?.customerEmail &&
             !order.customerPhone && !order.customer?.phone && !orderWithDetails.shopifyDetails?.customerPhone && !displayAddress.phone && (
              <p className="text-xs text-slate-400 italic">No contact info available</p>
            )}

            {/* Customer Insights - LTV, Orders, RTO */}
            {order.customerId && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                {isLoadingCustomer ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <div className="w-3 h-3 border border-slate-300 border-t-transparent rounded-full animate-spin" />
                    Loading...
                  </div>
                ) : customerInsights ? (
                  <div className="flex flex-wrap gap-2">
                    {/* LTV */}
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 rounded-lg">
                      <span className="text-xs text-emerald-600 font-medium">LTV</span>
                      <span className="text-xs text-emerald-700 font-semibold">
                        ₹{customerInsights.lifetimeValue.toLocaleString('en-IN')}
                      </span>
                    </div>
                    {/* Total Orders */}
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-sky-50 rounded-lg">
                      <span className="text-xs text-sky-600 font-medium">Orders</span>
                      <span className="text-xs text-sky-700 font-semibold">
                        {customerInsights.totalOrders}
                      </span>
                    </div>
                    {/* RTO - only show if > 0 */}
                    {customerInsights.rtoCount > 0 && (
                      <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 rounded-lg">
                        <span className="text-xs text-amber-600 font-medium">RTO</span>
                        <span className="text-xs text-amber-700 font-semibold">
                          {customerInsights.rtoCount}
                        </span>
                      </div>
                    )}
                    {/* Customer Tier badge */}
                    {customerInsights.customerTier && customerInsights.customerTier !== 'New' && (
                      <div className={`px-2 py-1 rounded-lg text-xs font-semibold ${
                        customerInsights.customerTier === 'VIP' ? 'bg-purple-100 text-purple-700' :
                        customerInsights.customerTier === 'Gold' ? 'bg-yellow-100 text-yellow-700' :
                        customerInsights.customerTier === 'Silver' ? 'bg-slate-200 text-slate-600' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {customerInsights.customerTier}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* View Full Profile button */}
                {onViewCustomerProfile && (
                  <button
                    onClick={onViewCustomerProfile}
                    className="mt-2 flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 font-medium transition-colors"
                  >
                    <User size={12} />
                    View Full Profile
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Shipping Address (or Ship & Bill To if same) */}
      <div className="bg-gradient-to-br from-slate-50 to-white rounded-xl border border-slate-200/80 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-slate-100 rounded-lg">
              <MapPin size={14} className="text-slate-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-700">
              {/* Show "Ship & Bill To" if addresses are same or no billing address */}
              {addressesMatch || !hasBillingAddress ? 'Ship & Bill To' : 'Shipping Address'}
            </h3>
          </div>
          {isEditing && order.customerId && (
            <button
              type="button"
              onClick={onToggleAddressPicker}
              className="text-xs text-sky-600 hover:text-sky-700 font-medium flex items-center gap-1"
            >
              <Clock size={12} />
              Past addresses
              {isAddressExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-3">
            {/* Past addresses dropdown */}
            {isAddressExpanded && (
              <div className="p-3 bg-sky-50/50 rounded-lg border border-sky-100 mb-3">
                <p className="text-xs font-medium text-sky-700 mb-2">Select from history:</p>
                {isLoadingAddresses ? (
                  <div className="flex items-center justify-center py-3">
                    <div className="animate-spin w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full" />
                  </div>
                ) : pastAddresses.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">No past addresses found</p>
                ) : (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {pastAddresses.map((addr, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => onSelectPastAddress(addr)}
                        className="w-full text-left px-3 py-2 text-xs text-slate-600 bg-white rounded-lg border border-slate-200 hover:border-sky-300 hover:bg-sky-50 transition-all flex items-start gap-2"
                      >
                        <Check size={12} className="text-sky-500 mt-0.5 shrink-0 opacity-0 group-hover:opacity-100" />
                        <span className="line-clamp-2">{formatAddressDisplay(addr)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Address fields */}
            <input
              type="text"
              value={addressForm.address1 || ''}
              onChange={(e) => onAddressChange('address1', e.target.value)}
              placeholder="Address line 1"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all"
            />
            <input
              type="text"
              value={addressForm.address2 || ''}
              onChange={(e) => onAddressChange('address2', e.target.value)}
              placeholder="Address line 2"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={addressForm.city || ''}
                onChange={(e) => onAddressChange('city', e.target.value)}
                placeholder="City"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all"
              />
              <input
                type="text"
                value={addressForm.province || ''}
                onChange={(e) => onAddressChange('province', e.target.value)}
                placeholder="State"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={addressForm.zip || ''}
                onChange={(e) => onAddressChange('zip', e.target.value)}
                placeholder="Pincode"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all"
              />
              <input
                type="text"
                value={addressForm.country || ''}
                onChange={(e) => onAddressChange('country', e.target.value)}
                placeholder="Country"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all"
              />
            </div>
          </div>
        ) : hasDisplayAddress ? (
          <AddressDisplay address={displayAddress} />
        ) : (
          <p className="text-sm text-slate-400 italic">No address available</p>
        )}
      </div>

      {/* Billing Address - only show if different from shipping */}
      {!isEditing && billingAddress && hasBillingAddress && !addressesMatch && (
        <div className="bg-gradient-to-br from-slate-50 to-white rounded-xl border border-slate-200/80 p-4 col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-amber-100 rounded-lg">
              <CreditCard size={14} className="text-amber-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-700">Billing Address</h3>
            <span className="text-xs text-slate-400">(different from shipping)</span>
          </div>
          <AddressDisplay address={billingAddress} />
        </div>
      )}
    </div>
  );
}

// Helper component to display an address
function AddressDisplay({ address }: { address: AddressData }) {
  const hasContent = Object.values(address).some(v => v && String(v).trim());
  if (!hasContent) return null;

  return (
    <div className="text-sm text-slate-600 leading-relaxed">
      {address.name && <p className="font-medium text-slate-800">{address.name}</p>}
      {address.first_name && <p className="font-medium text-slate-800">{address.first_name} {address.last_name}</p>}
      {address.address1 && <p>{address.address1}</p>}
      {address.address2 && <p>{address.address2}</p>}
      <p>
        {[address.city, address.province, address.zip].filter(Boolean).join(', ')}
      </p>
      {address.country && <p>{address.country}</p>}
      {address.phone && (
        <p className="text-slate-500 flex items-center gap-2 mt-1">
          <Phone size={13} className="text-slate-400" />
          {address.phone}
        </p>
      )}
    </div>
  );
}
