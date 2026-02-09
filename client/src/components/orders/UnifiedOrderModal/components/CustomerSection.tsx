/**
 * CustomerSection - Customer info and shipping address
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { User, Mail, Phone, MapPin, Search, ChevronDown, ChevronUp, CreditCard, ExternalLink, Loader2, X } from 'lucide-react';
import { getCustomer } from '../../../../server/functions/customers';
import { CustomerSearch } from '../../../common/CustomerSearch';
import type { Order } from '../../../../types';
import type { Customer } from '../../../common/CustomerSearch';
import type { ModalMode, AddressData, EditFormState, OrderWithShopifyDetails } from '../types';
import { cn } from '@/lib/utils';

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
  // Auto-expand manual address form if no customer linked (no saved addresses to show)
  const [isManualAddressOpen, setIsManualAddressOpen] = useState(!order.customerId && !editForm.customerId);

  // Server function hooks
  const getCustomerFn = useServerFn(getCustomer);

  // Fetch customer details for LTV and RTO info
  const { data: customerData, isLoading: isLoadingCustomer } = useQuery({
    queryKey: ['customer-details', order.customerId, 'server-fn'],
    queryFn: () => getCustomerFn({ data: { id: order.customerId! } }),
    enabled: !!order.customerId && mode === 'view',
    staleTime: 60 * 1000,
  });

  // Extract customer insights
  const customerInsights = customerData ? {
    lifetimeValue: customerData.lifetimeValue || 0,
    totalOrders: customerData.totalOrders || 0,
    customerTier: customerData.customerTier || customerData.tier || 'New',
    rtoCount: customerData.rtoCount || 0,
  } : null;

  const handleSelectCustomer = (customer: Customer) => {
    const firstName = customer.firstName || '';
    const lastName = customer.lastName || '';
    const displayName = firstName || lastName ? `${firstName} ${lastName}`.trim() : customer.email?.split('@')[0] || '';
    // Set the customer ID so we can fetch their saved addresses
    if (customer.id) onEditFieldChange('customerId', customer.id);
    onEditFieldChange('customerName', displayName);
    if (customer.email) onEditFieldChange('customerEmail', customer.email);
    if (customer.phone) onEditFieldChange('customerPhone', customer.phone);
    onSetSearchingCustomer(false);
  };

  // Use selected customer ID (from editForm) or fall back to order's customer ID
  const activeCustomerId = editForm.customerId || order.customerId;

  const handleClearAddress = () => {
    // Clear all address fields
    (['address1', 'address2', 'city', 'province', 'zip', 'country', 'phone', 'first_name', 'last_name', 'name'] as (keyof AddressData)[]).forEach(field => {
      onAddressChange(field, '');
    });
    setIsManualAddressOpen(false);
  };

  const hasAddressData = Object.values(addressForm).some(v => v && String(v).trim());

  // Format address for compact display
  const addressDisplay = [
    addressForm.address1,
    addressForm.city,
    addressForm.province,
    addressForm.zip,
  ].filter(Boolean).join(', ');

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
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 bg-slate-100 rounded-lg">
            <MapPin size={14} className="text-slate-500" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700">
            {/* Show "Ship & Bill To" if addresses are same or no billing address */}
            {addressesMatch || !hasBillingAddress ? 'Ship & Bill To' : 'Shipping Address'}
          </h3>
        </div>

        {isEditing ? (
          <div className="space-y-2">
            {/* Address Toggle Button */}
            <div className={cn(
              'flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors',
              hasAddressData
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'text-slate-500 hover:bg-slate-50'
            )}>
              <button
                type="button"
                onClick={onToggleAddressPicker}
                className="flex-1 flex items-center gap-2 text-left min-w-0"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate text-xs">
                  {hasAddressData ? addressDisplay : 'Add shipping address...'}
                </span>
                {isAddressExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
              </button>
              {/* Clear address button */}
              {hasAddressData && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClearAddress();
                  }}
                  className="h-5 w-5 flex items-center justify-center rounded-full hover:bg-green-200 text-green-600 transition-colors"
                  title="Clear address"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Expanded Address Panel */}
            {isAddressExpanded && (
              <div className="border rounded-lg overflow-hidden">
                {/* Saved Addresses - only show if customer is linked */}
                {activeCustomerId ? (
                  <div className="p-3 bg-sky-50/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-slate-600">Saved Addresses</span>
                      {isLoadingAddresses && (
                        <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                      )}
                    </div>

                    {isLoadingAddresses ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                        <span className="ml-2 text-xs text-slate-500">Loading addresses...</span>
                      </div>
                    ) : pastAddresses.length > 0 ? (
                      <div className="space-y-1.5">
                        {pastAddresses.slice(0, 3).map((addr, idx) => {
                          const isSelected = addr.address1 === addressForm.address1 && addr.zip === addressForm.zip;
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => onSelectPastAddress(addr)}
                              className={cn(
                                'w-full text-left p-2.5 rounded-lg border transition-all text-xs',
                                isSelected
                                  ? 'bg-sky-50 border-sky-200 ring-1 ring-sky-200'
                                  : 'bg-white border-slate-200 hover:bg-white hover:border-sky-300'
                              )}
                            >
                              <div className="flex items-start gap-2">
                                <MapPin className={cn(
                                  'h-3.5 w-3.5 mt-0.5 shrink-0',
                                  isSelected ? 'text-sky-500' : 'text-slate-400'
                                )} />
                                <div className="flex-1 min-w-0">
                                  {(addr.first_name || addr.last_name || addr.name) && (
                                    <p className="font-medium truncate text-slate-700">
                                      {addr.name || [addr.first_name, addr.last_name].filter(Boolean).join(' ')}
                                    </p>
                                  )}
                                  <p className="text-slate-500 truncate">
                                    {[addr.address1, addr.city, addr.province, addr.zip].filter(Boolean).join(', ')}
                                  </p>
                                </div>
                                {isSelected && (
                                  <span className="text-[10px] text-sky-600 font-medium">Selected</span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 py-2 text-center">
                        No saved addresses found
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-amber-50/50 border-b border-amber-100">
                    <p className="text-xs text-amber-600 text-center">
                      No customer linked - enter address manually
                    </p>
                  </div>
                )}

                {/* Manual Entry Toggle */}
                <div className="border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setIsManualAddressOpen(!isManualAddressOpen)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    <span>Enter address manually</span>
                    {isManualAddressOpen ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>

                  {/* Manual Entry Form */}
                  {isManualAddressOpen && (
                    <div className="p-3 pt-0 space-y-2">
                      <input
                        type="text"
                        value={addressForm.address1 || ''}
                        onChange={(e) => onAddressChange('address1', e.target.value)}
                        placeholder="Address line 1"
                        className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-1 focus:ring-sky-100 outline-none transition-all"
                      />
                      <input
                        type="text"
                        value={addressForm.address2 || ''}
                        onChange={(e) => onAddressChange('address2', e.target.value)}
                        placeholder="Address line 2"
                        className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-1 focus:ring-sky-100 outline-none transition-all"
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={addressForm.city || ''}
                          onChange={(e) => onAddressChange('city', e.target.value)}
                          placeholder="City"
                          className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-1 focus:ring-sky-100 outline-none transition-all"
                        />
                        <input
                          type="text"
                          value={addressForm.province || ''}
                          onChange={(e) => onAddressChange('province', e.target.value)}
                          placeholder="State"
                          className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-1 focus:ring-sky-100 outline-none transition-all"
                        />
                        <input
                          type="text"
                          value={addressForm.zip || ''}
                          onChange={(e) => onAddressChange('zip', e.target.value)}
                          placeholder="ZIP"
                          className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-1 focus:ring-sky-100 outline-none transition-all"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={addressForm.country || ''}
                          onChange={(e) => onAddressChange('country', e.target.value)}
                          placeholder="Country"
                          className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-1 focus:ring-sky-100 outline-none transition-all"
                        />
                        <input
                          type="text"
                          value={addressForm.phone || ''}
                          onChange={(e) => onAddressChange('phone', e.target.value)}
                          placeholder="Phone"
                          className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-1 focus:ring-sky-100 outline-none transition-all"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
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
