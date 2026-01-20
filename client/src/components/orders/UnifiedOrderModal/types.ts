/**
 * Types for UnifiedOrderModal component
 * Consolidates all order modal functionality into one interface
 */

import type { Order, OrderLine } from '../../../types';

export type ModalMode = 'view' | 'edit' | 'ship' | 'customer';

// Navigation entry for order navigation within the modal
export interface NavigationEntry {
  orderId: string;
  orderNumber: string;
  mode: ModalMode;
}

// Navigation state for breadcrumb and back button
export interface NavigationState {
  history: NavigationEntry[];
  currentIndex: number;
}

export interface AddressData {
  first_name?: string;
  last_name?: string;
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  country?: string;
  phone?: string;
}

export interface EditFormState {
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  internalNotes: string;
  shipByDate: string;
  isExchange: boolean;
}

export interface ShipFormState {
  awbNumber: string;
  courier: string;
  selectedLineIds: Set<string>;
  bypassVerification: boolean;
}

export interface ExpandedSections {
  timeline: boolean;
  addressPicker: boolean;
  shipping: boolean;
}

export interface UnifiedOrderModalState {
  mode: ModalMode;
  editForm: EditFormState;
  shipForm: ShipFormState;
  addressForm: AddressData;
  hasUnsavedChanges: boolean;
  expandedSections: ExpandedSections;
  isSearchingCustomer: boolean;
  isAddingProduct: boolean;
}

export interface UnifiedOrderModalProps {
  order: Order;
  initialMode?: ModalMode;
  onClose: () => void;
  onSuccess?: () => void;
}

// Extended order type with Shopify details (used by CustomerSection, ItemsSection)
export interface OrderWithShopifyDetails extends Order {
  shopifyDetails?: {
    shippingAddress?: AddressData;
    billingAddress?: AddressData;
    customerEmail?: string;
    customerPhone?: string;
  };
}

// Shopify line item structure from raw order data
export interface ShopifyLineItem {
  sku?: string;
  variant_id?: number;
  title?: string;
  quantity?: number;
  price?: string;
  name?: string;
  product_id?: number;
  variant_title?: string;
}

// Timeline event for order history
export interface TimelineEvent {
  id: string;
  type: 'created' | 'status_change' | 'shipped' | 'delivered' | 'note' | 'edit';
  title: string;
  description?: string;
  timestamp: string;
  user?: string;
}

// Shipping rate from iThink
export interface ShippingRate {
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

// Line categorization for Ship mode
export interface CategorizedLines {
  shipped: OrderLine[];
  packed: OrderLine[];
  other: OrderLine[];
}

// Status configuration for visual display
export interface StatusConfig {
  bg: string;
  text: string;
  border: string;
  label: string;
  icon?: string;
}

export const LINE_STATUS_CONFIG: Record<string, StatusConfig> = {
  pending: {
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    border: 'border-slate-200',
    label: 'Pending',
  },
  allocated: {
    bg: 'bg-sky-100',
    text: 'text-sky-700',
    border: 'border-sky-200',
    label: 'Allocated',
  },
  picked: {
    bg: 'bg-indigo-100',
    text: 'text-indigo-700',
    border: 'border-indigo-200',
    label: 'Picked',
  },
  packed: {
    bg: 'bg-violet-100',
    text: 'text-violet-700',
    border: 'border-violet-200',
    label: 'Packed',
  },
  shipped: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    label: 'Shipped',
  },
  delivered: {
    bg: 'bg-green-100',
    text: 'text-green-700',
    border: 'border-green-200',
    label: 'Delivered',
  },
  cancelled: {
    bg: 'bg-red-100',
    text: 'text-red-600',
    border: 'border-red-200',
    label: 'Cancelled',
  },
};

export const LINE_STATUS_BAR_COLORS: Record<string, string> = {
  pending: 'bg-slate-300',
  allocated: 'bg-sky-400',
  picked: 'bg-indigo-400',
  packed: 'bg-violet-500',
  shipped: 'bg-emerald-500',
  delivered: 'bg-green-500',
  cancelled: 'bg-red-400',
};

// Common courier options
export const COURIER_OPTIONS = [
  'Delhivery',
  'BlueDart',
  'DTDC',
  'Ekart',
  'Xpressbees',
  'Shadowfax',
  'Ecom Express',
  'iThink Logistics',
  'Other',
];
