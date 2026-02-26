/**
 * useUnifiedOrderModal hook
 * Manages all state for the unified order modal
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getCustomerAddresses } from '../../../../server/functions/customers';
import { calculateOrderTotal } from '../../../../utils/orderPricing';
import type { Order, OrderLine } from '../../../../types';
import type {
  ModalMode,
  EditFormState,
  ShipFormState,
  ReturnFormState,
  AddressData,
  ExpandedSections,
  CategorizedLines,
  NavigationState,
  LineReturnEligibility,
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
  // Server function hooks
  const getCustomerAddressesFn = useServerFn(getCustomerAddresses);

  // Determine available modes based on order state
  // Line-level: can edit if ANY line is not shipped/cancelled (not just order.status)
  const hasEditableLines = order.orderLines?.some(
    l => l.lineStatus !== 'shipped' && l.lineStatus !== 'cancelled'
  );
  const canEdit = hasEditableLines ?? order.status === 'open';
  const canShip = order.fulfillmentStage === 'ready_to_ship' ||
    order.orderLines?.some(l => l.lineStatus === 'packed');
  const canCustomer = !!order.customerId;

  // Returns tab: always enabled for debugging (was: only if delivered lines exist)
  // TODO: Restore stricter check after debugging
  const canReturn = (order.orderLines?.length ?? 0) > 0;

  // Initialize mode - default to view, or provided initial mode if available
  const getInitialMode = (): ModalMode => {
    if (initialMode) {
      if (initialMode === 'edit' && canEdit) return 'edit';
      if (initialMode === 'ship' && canShip) return 'ship';
      if (initialMode === 'customer' && canCustomer) return 'customer';
      if (initialMode === 'returns' && canReturn) return 'returns';
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

  // Return form state (multi-select)
  const [returnForm, setReturnForm] = useState<ReturnFormState>({
    selectedLineIds: new Set<string>(),
    returnQtyMap: {},
    returnReasonCategory: '',
    returnReasonDetail: '',
    returnResolution: null,
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

  // Initialize form values from order — keyed on order.id + key fields to avoid
  // resetting user edits on every background TanStack Query refetch.
  const orderSyncKey = `${order.id}-${order.status}-${order.customerId ?? ''}-${order.orderLines?.length ?? 0}`;
  const prevOrderSyncKeyRef = useRef(orderSyncKey);

  useEffect(() => {
    // Only re-initialize when the order truly changes (different ID or meaningful server-side update)
    if (prevOrderSyncKeyRef.current === orderSyncKey && prevOrderSyncKeyRef.current !== '') return;
    prevOrderSyncKeyRef.current = orderSyncKey;

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
  }, [orderSyncKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Use selected customer ID (from search) or fall back to order's customer ID
  const activeCustomerId = editForm.customerId || order?.customerId;

  // Fetch past addresses when address picker is expanded
  const { data: pastAddressesData, isLoading: isLoadingAddresses } = useQuery({
    queryKey: ['customer-addresses', activeCustomerId, 'server-fn'],
    queryFn: () => getCustomerAddressesFn({ data: { customerId: activeCustomerId! } }),
    enabled: expandedSections.addressPicker && !!activeCustomerId,
    staleTime: 60 * 1000,
  });

  const pastAddresses: AddressData[] = pastAddressesData || [];

  // Categorize lines for display
  const categorizedLines = useMemo<CategorizedLines>(() => {
    const lines = order.orderLines || [];
    const shipped: OrderLine[] = [];
    const packed: OrderLine[] = [];
    const other: OrderLine[] = [];

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
  }, [order.orderLines, order.totalAmount, order.isExchange]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mode change handler
  const handleModeChange = useCallback((newMode: ModalMode) => {
    if (newMode === 'edit' && !canEdit) return;
    if (newMode === 'ship' && !canShip) return;
    if (newMode === 'customer' && !canCustomer) return;
    if (newMode === 'returns' && !canReturn) return;

    setMode(newMode);

    // Reset return form when leaving returns mode
    if (mode === 'returns' && newMode !== 'returns') {
      setReturnForm({
        selectedLineIds: new Set<string>(),
        returnQtyMap: {},
        returnReasonCategory: '',
        returnReasonDetail: '',
        returnResolution: null,
      });
    }

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
  }, [canEdit, canShip, canCustomer, canReturn, order.id, order.orderNumber, mode]);

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

  // Return form field change
  const handleReturnFieldChange = useCallback((field: keyof ReturnFormState, value: string | number | null) => {
    setReturnForm(prev => ({ ...prev, [field]: value }));
  }, []);

  // Toggle line selection for return (multi-select)
  const handleToggleReturnLineSelection = useCallback((lineId: string, defaultQty?: number) => {
    setReturnForm(prev => {
      const newSelectedLineIds = new Set(prev.selectedLineIds);
      const newReturnQtyMap = { ...prev.returnQtyMap };

      if (newSelectedLineIds.has(lineId)) {
        // Deselect
        newSelectedLineIds.delete(lineId);
        delete newReturnQtyMap[lineId];
      } else {
        // Select
        newSelectedLineIds.add(lineId);
        newReturnQtyMap[lineId] = defaultQty ?? 1;
      }

      return {
        ...prev,
        selectedLineIds: newSelectedLineIds,
        returnQtyMap: newReturnQtyMap,
      };
    });
  }, []);

  // Update return quantity for a specific line
  const handleUpdateReturnQty = useCallback((lineId: string, qty: number) => {
    setReturnForm(prev => ({
      ...prev,
      returnQtyMap: {
        ...prev.returnQtyMap,
        [lineId]: qty,
      },
    }));
  }, []);

  // Select a line for return (legacy single-select - for backward compatibility)
  const handleSelectLineForReturn = useCallback((lineId: string | null, defaultQty?: number) => {
    if (lineId === null) {
      // Clear all selections
      setReturnForm(prev => ({
        ...prev,
        selectedLineIds: new Set<string>(),
        returnQtyMap: {},
        returnReasonCategory: '',
        returnReasonDetail: '',
        returnResolution: null,
      }));
    } else {
      // Toggle selection
      handleToggleReturnLineSelection(lineId, defaultQty);
    }
  }, [handleToggleReturnLineSelection]);

  // Reset return form
  const resetReturnForm = useCallback(() => {
    setReturnForm({
      selectedLineIds: new Set<string>(),
      returnQtyMap: {},
      returnReasonCategory: '',
      returnReasonDetail: '',
      returnResolution: null,
    });
  }, []);

  // Calculate line return eligibility client-side
  // Hard block: already has active return
  // Soft warnings (but allowed): not delivered, window expired, non-returnable
  const RETURN_WINDOW_DAYS = 14;
  const getLineEligibility = useCallback((line: {
    deliveredAt?: Date | string | null;
    returnStatus?: string | null;
    isNonReturnable?: boolean;
  }): LineReturnEligibility => {
    const warnings: string[] = [];

    // HARD BLOCK: already has active return - cannot initiate another
    if (line.returnStatus && !['cancelled', 'complete'].includes(line.returnStatus)) {
      return {
        eligible: false,
        reason: 'active_return',
        daysRemaining: null,
        windowExpiringSoon: false,
        warning: `Active return in progress: ${line.returnStatus}`,
      };
    }

    // Soft warning: line marked non-returnable (allow override)
    if (line.isNonReturnable) {
      warnings.push('Non-returnable item');
    }

    // Soft warning: not delivered yet (allow for pre-delivery returns)
    if (!line.deliveredAt) {
      warnings.push('Not yet delivered');
      return {
        eligible: true,
        reason: 'not_delivered',
        daysRemaining: null,
        windowExpiringSoon: false,
        ...(warnings.length > 0 ? { warning: warnings.join(' | ') } : {}),
      };
    }

    // Calculate return window
    const deliveredDate = typeof line.deliveredAt === 'string' ? new Date(line.deliveredAt) : line.deliveredAt;
    const daysSinceDelivery = Math.floor((Date.now() - deliveredDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysRemaining = RETURN_WINDOW_DAYS - daysSinceDelivery;
    const windowExpiringSoon = daysRemaining > 0 && daysRemaining <= 2;

    // Soft warning: window expired (allow manual override)
    if (daysRemaining < 0) {
      warnings.push(`Window expired ${Math.abs(daysRemaining)}d ago`);
    } else if (windowExpiringSoon) {
      warnings.push(`Only ${daysRemaining}d left`);
    }

    return {
      eligible: true, // Eligible with warnings - staff can override
      reason: warnings.length > 0 ? 'has_warnings' : 'within_window',
      daysRemaining,
      windowExpiringSoon,
      ...(warnings.length > 0 ? { warning: warnings.join(' | ') } : {}),
    };
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
    canReturn,

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

    // Return form
    returnForm,
    handleReturnFieldChange,
    handleSelectLineForReturn,
    handleToggleReturnLineSelection,
    handleUpdateReturnQty,
    resetReturnForm,
    getLineEligibility,

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
