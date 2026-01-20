/**
 * useUnifiedOrderModal hook
 * Manages all state for the unified order modal
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../../../../services/api';
import { calculateOrderTotal } from '../../../../utils/orderPricing';
import type { Order } from '../../../../types';
import type {
  ModalMode,
  EditFormState,
  ShipFormState,
  AddressData,
  ExpandedSections,
  CategorizedLines,
  NavigationState,
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
  onNavigateToOrder?: (orderId: string) => void;
}

export function useUnifiedOrderModal({ order, initialMode, onNavigateToOrder }: UseUnifiedOrderModalProps) {
  // Determine available modes based on order state
  // Line-level: can edit if ANY line is not shipped/cancelled (not just order.status)
  const hasEditableLines = order.orderLines?.some(
    l => l.lineStatus !== 'shipped' && l.lineStatus !== 'cancelled'
  );
  const canEdit = hasEditableLines ?? order.status === 'open';
  const canShip = order.fulfillmentStage === 'ready_to_ship' ||
    order.orderLines?.some(l => l.lineStatus === 'packed');
  const canCustomer = !!order.customerId;

  // Initialize mode - default to view, or provided initial mode if available
  const getInitialMode = (): ModalMode => {
    if (initialMode) {
      if (initialMode === 'edit' && canEdit) return 'edit';
      if (initialMode === 'ship' && canShip) return 'ship';
      if (initialMode === 'customer' && canCustomer) return 'customer';
    }
    return 'view';
  };

  const [mode, setMode] = useState<ModalMode>(getInitialMode());

  // Navigation state for in-modal order navigation
  const [navigationState, setNavigationState] = useState<NavigationState>(() => ({
    history: [{
      orderId: order.id,
      orderNumber: order.orderNumber,
      mode: getInitialMode(),
    }],
    currentIndex: 0,
  }));

  // Edit form state
  const [editForm, setEditForm] = useState<EditFormState>({
    customerId: null,
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
        customerId: order.customerId || null,
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

  // Use selected customer ID (from search) or fall back to order's customer ID
  const activeCustomerId = editForm.customerId || order?.customerId;

  // Fetch past addresses when address picker is expanded
  const { data: pastAddressesData, isLoading: isLoadingAddresses } = useQuery({
    queryKey: ['customer-addresses', activeCustomerId],
    queryFn: () => customersApi.getAddresses(activeCustomerId!),
    enabled: expandedSections.addressPicker && !!activeCustomerId,
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

  // Calculate order total using shared pricing utility
  // Handles exchange orders correctly (always calculates from lines)
  const orderTotal = useMemo(() => {
    return calculateOrderTotal(order).total;
  }, [order]);

  // Mode change handler
  const handleModeChange = useCallback((newMode: ModalMode) => {
    if (newMode === 'edit' && !canEdit) return;
    if (newMode === 'ship' && !canShip) return;
    if (newMode === 'customer' && !canCustomer) return;

    setMode(newMode);

    // Update navigation history when switching to customer tab
    if (newMode === 'customer') {
      setNavigationState(prev => {
        const lastEntry = prev.history[prev.history.length - 1];
        // Don't add duplicate customer entries
        if (lastEntry?.mode === 'customer' && lastEntry?.orderId === order.id) {
          return prev;
        }
        return {
          history: [...prev.history, {
            orderId: order.id,
            orderNumber: order.orderNumber,
            mode: 'customer',
          }],
          currentIndex: prev.history.length,
        };
      });
    }
  }, [canEdit, canShip, canCustomer, order.id, order.orderNumber]);

  // Track the order ID to detect when order changes (for navigation)
  const [previousOrderId, setPreviousOrderId] = useState(order.id);

  // When order changes (from navigation), update mode and history
  useEffect(() => {
    if (order.id !== previousOrderId) {
      setPreviousOrderId(order.id);
      // Switch to view mode for the new order
      setMode('view');
      // Add new order to navigation history
      setNavigationState(prev => {
        const lastEntry = prev.history[prev.history.length - 1];
        // Don't add duplicate entries
        if (lastEntry?.orderId === order.id) {
          return prev;
        }
        return {
          history: [...prev.history, {
            orderId: order.id,
            orderNumber: order.orderNumber,
            mode: 'view',
          }],
          currentIndex: prev.history.length,
        };
      });
    }
  }, [order.id, order.orderNumber, previousOrderId]);

  // Navigate to a different order (from Customer tab order history)
  const navigateToOrder = useCallback((orderId: string) => {
    if (orderId === order.id) {
      // Same order, just switch to view mode
      setMode('view');
      return;
    }

    // Call parent callback to load new order
    if (onNavigateToOrder) {
      onNavigateToOrder(orderId);
    }
  }, [order.id, onNavigateToOrder]);

  // Go back in navigation history
  const goBack = useCallback(() => {
    setNavigationState(prev => {
      if (prev.currentIndex <= 0) return prev;

      const newIndex = prev.currentIndex - 1;
      const previousEntry = prev.history[newIndex];

      // Update mode to previous entry's mode
      setMode(previousEntry.mode);

      // If previous entry is a different order, navigate to it
      if (previousEntry.orderId !== order.id && onNavigateToOrder) {
        onNavigateToOrder(previousEntry.orderId);
      }

      return {
        ...prev,
        currentIndex: newIndex,
        history: prev.history.slice(0, newIndex + 1),
      };
    });
  }, [order.id, onNavigateToOrder]);

  // Computed navigation values
  const canGoBack = navigationState.currentIndex > 0;
  const navigationHistory = navigationState.history.slice(0, navigationState.currentIndex + 1);

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

  // Toggle address picker (convenience wrapper)
  const toggleAddressPicker = useCallback(() => {
    setExpandedSections(prev => ({ ...prev, addressPicker: !prev.addressPicker }));
  }, []);

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

  return {
    // Mode
    mode,
    handleModeChange,
    canEdit,
    canShip,
    canCustomer,

    // Navigation
    navigationHistory,
    canGoBack,
    navigateToOrder,
    goBack,

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
    expectedAwb,
    awbMatches,
    canShipOrder,

    // Lines
    categorizedLines,
    calculatedTotal,
    handleAddLine,
    handleUpdateLine,
    handleCancelLine,
    handleUncancelLine,

    // UI state
    hasUnsavedChanges,
    isSearchingCustomer,
    setIsSearchingCustomer,
    isAddingProduct,
    setIsAddingProduct,
  };
}
