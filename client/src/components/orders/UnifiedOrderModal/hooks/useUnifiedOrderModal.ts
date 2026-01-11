/**
 * useUnifiedOrderModal hook
 * Manages all state for the unified order modal
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../../../../services/api';
import type { Order } from '../../../../types';
import type {
  ModalMode,
  EditFormState,
  ShipFormState,
  AddressData,
  ExpandedSections,
  CategorizedLines,
} from '../types';

// Parse JSON address string to AddressData object
export function parseAddress(addressJson: string | null | undefined): AddressData {
  if (!addressJson) return {};
  try {
    // Handle case where addressJson is already an object (from shopifyDetails)
    if (typeof addressJson === 'object') {
      return addressJson as unknown as AddressData;
    }
    return JSON.parse(addressJson);
  } catch {
    return {};
  }
}

// Stringify AddressData object to JSON string
export function stringifyAddress(address: AddressData): string {
  return JSON.stringify(address);
}

// Format address for display
export function formatAddressDisplay(address: AddressData): string {
  return [
    address.address1,
    address.address2,
    address.city,
    address.province,
    address.zip,
    address.country,
  ]
    .filter(Boolean)
    .join(', ');
}

interface UseUnifiedOrderModalProps {
  order: Order;
  initialMode?: ModalMode;
}

export function useUnifiedOrderModal({ order, initialMode }: UseUnifiedOrderModalProps) {
  // Determine available modes based on order state
  const canEdit = order.status === 'open';
  const canShip = order.fulfillmentStage === 'ready_to_ship' ||
    order.orderLines?.some(l => l.lineStatus === 'packed');

  // Initialize mode - default to view, or provided initial mode if available
  const getInitialMode = (): ModalMode => {
    if (initialMode) {
      if (initialMode === 'edit' && canEdit) return 'edit';
      if (initialMode === 'ship' && canShip) return 'ship';
    }
    return 'view';
  };

  const [mode, setMode] = useState<ModalMode>(getInitialMode());

  // Edit form state
  const [editForm, setEditForm] = useState<EditFormState>({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    internalNotes: '',
    shipByDate: '',
    isExchange: false,
  });

  // Ship form state
  const [shipForm, setShipForm] = useState<ShipFormState>({
    awbNumber: '',
    courier: '',
    selectedLineIds: new Set(),
    bypassVerification: false,
  });

  // Address form state
  const [addressForm, setAddressForm] = useState<AddressData>({});

  // UI state
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
    timeline: false,
    addressPicker: false,
    shipping: true,
  });
  const [isSearchingCustomer, setIsSearchingCustomer] = useState(false);
  const [isAddingProduct, setIsAddingProduct] = useState(false);

  // Initialize form values from order
  useEffect(() => {
    if (order) {
      // Get shopify details for fallback data
      const orderWithDetails = order as Order & {
        shopifyDetails?: {
          shippingAddress?: AddressData;
          billingAddress?: AddressData;
          customerEmail?: string;
          customerPhone?: string;
        };
      };
      const shopifyDetails = orderWithDetails.shopifyDetails;
      const shopifyAddr = shopifyDetails?.shippingAddress;

      // Parse shipping address JSON for phone fallback
      let parsedAddressPhone = '';
      if (order.shippingAddress) {
        try {
          const parsed = typeof order.shippingAddress === 'string'
            ? JSON.parse(order.shippingAddress)
            : order.shippingAddress;
          if (parsed?.phone) parsedAddressPhone = parsed.phone;
        } catch {
          // Not valid JSON
        }
      }

      // Email fallback chain: order -> customer -> shopifyDetails
      const customerEmail = order.customerEmail ||
        order.customer?.email ||
        shopifyDetails?.customerEmail ||
        '';

      // Phone fallback chain: order -> customer -> shopifyDetails -> parsed address -> shopify address
      const customerPhone = order.customerPhone ||
        order.customer?.phone ||
        shopifyDetails?.customerPhone ||
        parsedAddressPhone ||
        shopifyAddr?.phone ||
        '';

      setEditForm({
        customerName: order.customerName || '',
        customerEmail,
        customerPhone,
        internalNotes: order.internalNotes || '',
        shipByDate: order.shipByDate ? order.shipByDate.split('T')[0] : '',
        isExchange: order.isExchange || false,
      });

      // Try to get address from order.shippingAddress first
      // Fall back to shopifyDetails.shippingAddress if available (from Shopify raw data)
      let addressData = parseAddress(order.shippingAddress);

      // If no address from order, try shopifyDetails fallback
      const orderWithShopifyDetails = order as Order & {
        shopifyDetails?: { shippingAddress?: AddressData };
      };
      if (
        Object.keys(addressData).length === 0 &&
        orderWithShopifyDetails.shopifyDetails?.shippingAddress
      ) {
        addressData = orderWithShopifyDetails.shopifyDetails.shippingAddress;
      }

      setAddressForm(addressData);

      // Pre-fill ship form with expected courier from Shopify
      const expectedCourier = order.shopifyCache?.trackingCompany || order.courier || '';
      setShipForm(prev => ({
        ...prev,
        awbNumber: prev.awbNumber || '',
        courier: prev.courier || expectedCourier,
      }));

      // Initialize selected lines for ship mode (all packed lines)
      const packedLineIds = order.orderLines
        ?.filter(l => l.lineStatus === 'packed')
        .map(l => l.id) || [];
      setShipForm(prev => ({
        ...prev,
        selectedLineIds: new Set(packedLineIds),
      }));
    }
  }, [order]);

  // Fetch past addresses when address picker is expanded
  const { data: pastAddressesData, isLoading: isLoadingAddresses } = useQuery({
    queryKey: ['customer-addresses', order?.customerId],
    queryFn: () => customersApi.getAddresses(order.customerId!),
    enabled: expandedSections.addressPicker && !!order?.customerId,
    staleTime: 60 * 1000,
  });

  const pastAddresses: AddressData[] = pastAddressesData?.data || [];

  // Categorize lines for display
  const categorizedLines = useMemo<CategorizedLines>(() => {
    const lines = order.orderLines || [];
    const shipped: any[] = [];
    const packed: any[] = [];
    const other: any[] = [];

    for (const line of lines) {
      if (line.lineStatus === 'cancelled') continue;
      if (line.lineStatus === 'shipped') {
        shipped.push(line);
      } else if (line.lineStatus === 'packed') {
        packed.push(line);
      } else {
        other.push(line);
      }
    }

    return { shipped, packed, other };
  }, [order.orderLines]);

  // Active (non-cancelled) lines
  const activeLines = useMemo(() => {
    return order.orderLines?.filter(l => l.lineStatus !== 'cancelled') || [];
  }, [order.orderLines]);

  // Calculate order total from active lines
  const orderTotal = useMemo(() => {
    return activeLines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  }, [activeLines]);

  // Total items count
  const totalItems = useMemo(() => {
    return activeLines.reduce((sum, l) => sum + l.qty, 0);
  }, [activeLines]);

  // Mode change handler
  const handleModeChange = useCallback((newMode: ModalMode) => {
    if (newMode === 'edit' && !canEdit) return;
    if (newMode === 'ship' && !canShip) return;
    setMode(newMode);
  }, [canEdit, canShip]);

  // Edit form field change
  const handleEditFieldChange = useCallback((field: keyof EditFormState, value: string | boolean) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
    setHasUnsavedChanges(true);
  }, []);

  // Address field change
  const handleAddressChange = useCallback((field: keyof AddressData, value: string) => {
    setAddressForm(prev => ({ ...prev, [field]: value }));
    setHasUnsavedChanges(true);
  }, []);

  // Select past address
  const handleSelectPastAddress = useCallback((address: AddressData) => {
    setAddressForm(address);
    setHasUnsavedChanges(true);
    setExpandedSections(prev => ({ ...prev, addressPicker: false }));
  }, []);

  // Ship form field change
  const handleShipFieldChange = useCallback((field: keyof Omit<ShipFormState, 'selectedLineIds'>, value: string | boolean) => {
    setShipForm(prev => ({ ...prev, [field]: value }));
  }, []);

  // Toggle line selection for partial shipment
  const handleToggleLineSelection = useCallback((lineId: string) => {
    setShipForm(prev => {
      const newSelected = new Set(prev.selectedLineIds);
      if (newSelected.has(lineId)) {
        newSelected.delete(lineId);
      } else {
        newSelected.add(lineId);
      }
      return { ...prev, selectedLineIds: newSelected };
    });
  }, []);

  // Select all packed lines
  const handleSelectAllLines = useCallback(() => {
    const packedLineIds = categorizedLines.packed.map(l => l.id);
    setShipForm(prev => ({ ...prev, selectedLineIds: new Set(packedLineIds) }));
  }, [categorizedLines.packed]);

  // Deselect all lines
  const handleDeselectAllLines = useCallback(() => {
    setShipForm(prev => ({ ...prev, selectedLineIds: new Set() }));
  }, []);

  // Toggle section expansion
  const toggleSection = useCallback((section: keyof ExpandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // Toggle address picker (convenience wrapper)
  const toggleAddressPicker = useCallback(() => {
    setExpandedSections(prev => ({ ...prev, addressPicker: !prev.addressPicker }));
  }, []);

  // Get save data for order update
  const getSaveData = useCallback(() => {
    return {
      customerName: editForm.customerName,
      customerEmail: editForm.customerEmail,
      customerPhone: editForm.customerPhone,
      shippingAddress: stringifyAddress(addressForm),
      internalNotes: editForm.internalNotes,
      shipByDate: editForm.shipByDate ? new Date(editForm.shipByDate).toISOString() : null,
      isExchange: editForm.isExchange,
    };
  }, [editForm, addressForm]);

  // Get ship data
  const getShipData = useCallback(() => {
    return {
      awbNumber: shipForm.awbNumber.trim().toUpperCase(),
      courier: shipForm.courier,
    };
  }, [shipForm]);

  // Get ship lines data
  const getShipLinesData = useCallback(() => {
    return {
      lineIds: Array.from(shipForm.selectedLineIds),
      awbNumber: shipForm.awbNumber.trim().toUpperCase(),
      courier: shipForm.courier,
    };
  }, [shipForm]);

  // AWB verification
  const expectedAwb = order.shopifyCache?.trackingNumber || order.awbNumber || '';
  const awbMatches = shipForm.awbNumber.trim() !== '' &&
    expectedAwb.trim() !== '' &&
    shipForm.awbNumber.trim().toLowerCase() === expectedAwb.trim().toLowerCase();

  // Can ship check
  const canShipOrder = shipForm.awbNumber.trim() !== '' &&
    shipForm.courier.trim() !== '' &&
    (shipForm.selectedLineIds.size > 0 || categorizedLines.packed.length > 0);

  // Calculated total (same as orderTotal, for backward compatibility)
  const calculatedTotal = orderTotal;

  // Is address picker expanded (convenience accessor)
  const isAddressExpanded = expandedSections.addressPicker;

  // Line handlers (these trigger mutations in the parent, we just track state changes here)
  const handleAddLine = useCallback((_skuId: string, _qty: number, _unitPrice: number) => {
    // State update happens via mutation + cache invalidation
    setIsAddingProduct(false);
  }, []);

  const handleUpdateLine = useCallback((_lineId: string, _data: { qty?: number; unitPrice?: number }) => {
    // State update happens via mutation + cache invalidation
    setHasUnsavedChanges(true);
  }, []);

  const handleCancelLine = useCallback((_lineId: string) => {
    // State update happens via mutation + cache invalidation
  }, []);

  const handleUncancelLine = useCallback((_lineId: string) => {
    // State update happens via mutation + cache invalidation
  }, []);

  // Reset form to initial state
  const resetForm = useCallback(() => {
    // Get shopify details for fallback data
    const orderWithDetails = order as Order & {
      shopifyDetails?: {
        shippingAddress?: AddressData;
        billingAddress?: AddressData;
        customerEmail?: string;
        customerPhone?: string;
      };
    };
    const shopifyDetails = orderWithDetails.shopifyDetails;
    const shopifyAddr = shopifyDetails?.shippingAddress;

    // Parse shipping address JSON for phone fallback
    let parsedAddressPhone = '';
    if (order.shippingAddress) {
      try {
        const parsed = typeof order.shippingAddress === 'string'
          ? JSON.parse(order.shippingAddress)
          : order.shippingAddress;
        if (parsed?.phone) parsedAddressPhone = parsed.phone;
      } catch {
        // Not valid JSON
      }
    }

    // Email/phone fallback chain
    const customerEmail = order.customerEmail || order.customer?.email || shopifyDetails?.customerEmail || '';
    const customerPhone = order.customerPhone || order.customer?.phone || shopifyDetails?.customerPhone || parsedAddressPhone || shopifyAddr?.phone || '';

    setEditForm({
      customerName: order.customerName || '',
      customerEmail,
      customerPhone,
      internalNotes: order.internalNotes || '',
      shipByDate: order.shipByDate ? order.shipByDate.split('T')[0] : '',
      isExchange: order.isExchange || false,
    });

    // Try to get address from order.shippingAddress, fall back to shopifyDetails
    let addressData = parseAddress(order.shippingAddress);
    if (
      Object.keys(addressData).length === 0 &&
      orderWithDetails.shopifyDetails?.shippingAddress
    ) {
      addressData = orderWithDetails.shopifyDetails.shippingAddress;
    }
    setAddressForm(addressData);
    setHasUnsavedChanges(false);
  }, [order]);

  return {
    // Mode
    mode,
    setMode,
    handleModeChange,
    canEdit,
    canShip,

    // Edit form
    editForm,
    handleEditFieldChange,

    // Address
    addressForm,
    handleAddressChange,
    handleSelectPastAddress,
    pastAddresses,
    isLoadingAddresses,
    isAddressExpanded,
    toggleAddressPicker,

    // Ship form
    shipForm,
    handleShipFieldChange,
    handleToggleLineSelection,
    handleSelectAllLines,
    handleDeselectAllLines,
    expectedAwb,
    awbMatches,
    canShipOrder,

    // Lines
    categorizedLines,
    activeLines,
    orderTotal,
    calculatedTotal,
    totalItems,
    handleAddLine,
    handleUpdateLine,
    handleCancelLine,
    handleUncancelLine,

    // UI state
    hasUnsavedChanges,
    setHasUnsavedChanges,
    expandedSections,
    toggleSection,
    isSearchingCustomer,
    setIsSearchingCustomer,
    isAddingProduct,
    setIsAddingProduct,

    // Actions
    getSaveData,
    getShipData,
    getShipLinesData,
    resetForm,
  };
}
