/**
 * UnifiedOrderModal - Consolidated modal for viewing, editing, and shipping orders
 *
 * Combines functionality from: EditOrderModal, OrderViewModal, ShipOrderModal,
 * OrderDetailModal, and NotesModal into a single cohesive component.
 *
 * Modes:
 * - view: Read-only display of all order data
 * - edit: Edit customer, items, notes, addresses (only for open orders)
 * - ship: AWB entry and shipment booking (only for ready_to_ship orders)
 */

import { useEffect, useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Save, Loader2 } from 'lucide-react';
import type { Order } from '../../../types';
import type { ModalMode } from './types';
import { useUnifiedOrderModal } from './hooks/useUnifiedOrderModal';
import { useOrdersMutations } from '../../../hooks/useOrdersMutations';
import { getOrderById } from '../../../server/functions/orders';
import { getCustomer } from '../../../server/functions/customers';
import { ModalHeader } from './components/ModalHeader';
import { CustomerSection } from './components/CustomerSection';
import { ItemsSection } from './components/ItemsSection';
// OrderSummary is now integrated into ItemsSection
import { ShippingSection } from './components/ShippingSection';
import { TimelineSection } from './components/TimelineSection';
import { NotesSection } from './components/NotesSection';
import { CustomerTab } from './components/CustomerTab';
import { ReturnsSection } from './components/ReturnsSection';
import { SchedulePickupDialog } from './components/SchedulePickupDialog';
import {
  initiateLineReturn,
  cancelLineReturn,
  scheduleReturnPickup,
  receiveLineReturn,
  processLineReturnRefund,
  completeLineReturn,
  createExchangeOrder,
  updateReturnNotes,
} from '../../../server/functions/returnsMutations';
import { showReturnError, showReturnSuccess } from '../../../utils/toast';
import { isReturnError } from '@coh/shared/errors';

interface UnifiedOrderModalProps {
  order: Order;
  initialMode?: ModalMode;
  onClose: () => void;
  onSuccess?: () => void;
}

export function UnifiedOrderModal({
  order: initialOrder,
  initialMode = 'view',
  onClose,
  onSuccess,
}: UnifiedOrderModalProps) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [isShipping, setIsShipping] = useState(false);
  const [updatingLineIds, setUpdatingLineIds] = useState<Set<string>>(new Set());
  // Track which line is open for pickup scheduling dialog
  const [pickupDialogLineId, setPickupDialogLineId] = useState<string | null>(null);
  // Track current order for navigation
  const [currentOrderId, setCurrentOrderId] = useState(initialOrder.id);
  // Keep track of last valid order for smooth transitions
  const [lastValidOrder, setLastValidOrder] = useState<Order>(initialOrder);

  // Server function for fetching order
  const getOrderByIdFn = useServerFn(getOrderById);

  // Fetch fresh order data to ensure we have all fields
  const { data: fetchedOrder, isLoading: isLoadingOrder, isFetching } = useQuery({
    queryKey: ['order', currentOrderId],
    queryFn: async () => {
      const result = await getOrderByIdFn({ data: { id: currentOrderId } });
      return result as unknown as Order;
    },
    staleTime: 30 * 1000, // 30 seconds
  });

  // Use fetched order if available, otherwise fall back to initial order or last valid order
  const order = fetchedOrder || (currentOrderId === initialOrder.id ? initialOrder : lastValidOrder);

  // Update last valid order when we get new data
  useEffect(() => {
    if (fetchedOrder) {
      setLastValidOrder(fetchedOrder);
    }
  }, [fetchedOrder]);

  // Check if we're loading a different order (navigating)
  const isNavigating = isFetching && currentOrderId !== order?.id;

  // Handle order navigation - switch to view mode and load new order
  const handleNavigateToOrder = useCallback((orderId: string) => {
    if (orderId === currentOrderId) return; // Don't navigate to same order
    setCurrentOrderId(orderId);
  }, [currentOrderId]);

  // Initialize modal state
  const modalState = useUnifiedOrderModal({
    order: order || initialOrder,
    initialMode,
    onNavigateToOrder: handleNavigateToOrder,
  });
  const {
    mode,
    editForm,
    shipForm,
    addressForm,
    pastAddresses,
    isLoadingAddresses,
    hasUnsavedChanges,
    isAddressExpanded,
    isSearchingCustomer,
    isAddingProduct,
    canEdit,
    canCustomer,
    canReturn,
    calculatedTotal,
    categorizedLines,
    expectedAwb,
    awbMatches,
    canShipOrder,
    handleModeChange,
    handleEditFieldChange,
    handleShipFieldChange,
    handleAddressChange,
    handleSelectPastAddress,
    toggleAddressPicker,
    setIsSearchingCustomer,
    setIsAddingProduct,
    handleAddLine,
    handleUpdateLine,
    handleCancelLine,
    handleUncancelLine,
    handleToggleLineSelection,
    // Return form
    returnForm,
    handleReturnFieldChange,
    handleSelectLineForReturn,
    resetReturnForm,
    getLineEligibility,
    // Navigation
    navigationHistory,
    canGoBack,
    navigateToOrder,
    goBack,
  } = modalState;

  // Ensure canShip is always boolean
  const canShip = modalState.canShip ?? false;

  // Server function for fetching customer
  const getCustomerFn = useServerFn(getCustomer);

  // Fetch customer data when Customer tab is active (using Server Function for full affinity data)
  const { data: customerResponse, isLoading: isLoadingCustomer } = useQuery({
    queryKey: ['customer', order?.customerId],
    queryFn: async () => {
      const result = await getCustomerFn({ data: { id: order!.customerId! } });
      return result;
    },
    enabled: mode === 'customer' && !!order?.customerId,
    staleTime: 2 * 60 * 1000, // 2 min (matches server cache)
  });
  const customerData = customerResponse || null;

  // Get mutations
  const mutations = useOrdersMutations({
    onEditSuccess: () => {
      setIsSaving(false);
      onSuccess?.();
    },
    onShipSuccess: () => {
      setIsShipping(false);
      onSuccess?.();
      onClose();
    },
  });

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (hasUnsavedChanges) {
          if (window.confirm('You have unsaved changes. Are you sure you want to close?')) {
            onClose();
          }
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [hasUnsavedChanges, onClose]);

  // Handle backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      if (hasUnsavedChanges) {
        if (window.confirm('You have unsaved changes. Are you sure you want to close?')) {
          onClose();
        }
      } else {
        onClose();
      }
    }
  }, [hasUnsavedChanges, onClose]);

  // Save changes
  const handleSave = useCallback(async () => {
    if (!hasUnsavedChanges) {
      onClose();
      return;
    }

    setIsSaving(true);

    try {
      // Build update data
      const updateData: Record<string, any> = {};

      // Customer info
      if (editForm.customerName !== order.customerName) {
        updateData.customerName = editForm.customerName;
      }
      if (editForm.customerEmail !== (order.customerEmail || '')) {
        updateData.customerEmail = editForm.customerEmail || null;
      }
      if (editForm.customerPhone !== (order.customerPhone || '')) {
        updateData.customerPhone = editForm.customerPhone || null;
      }

      // Address
      const addressFields = ['address1', 'address2', 'city', 'province', 'zip', 'country'] as const;
      const hasAddressChanges = addressFields.some(field => {
        const originalAddress = order.shippingAddress as Record<string, any> | null;
        return addressForm[field] !== (originalAddress?.[field] || '');
      });

      if (hasAddressChanges) {
        updateData.shippingAddress = {
          address1: addressForm.address1,
          address2: addressForm.address2,
          city: addressForm.city,
          province: addressForm.province,
          zip: addressForm.zip,
          country: addressForm.country,
        };
      }

      // Internal notes
      if (editForm.internalNotes !== (order.internalNotes || '')) {
        updateData.internalNotes = editForm.internalNotes || null;
      }

      // Ship by date
      if (editForm.shipByDate !== (order.shipByDate || '')) {
        updateData.shipByDate = editForm.shipByDate || null;
      }

      // Is exchange
      if (editForm.isExchange !== order.isExchange) {
        updateData.isExchange = editForm.isExchange;
      }

      if (Object.keys(updateData).length > 0) {
        await mutations.updateOrder.mutateAsync({ id: order.id, data: updateData });
      } else {
        setIsSaving(false);
        onClose();
      }
    } catch (error) {
      setIsSaving(false);
      console.error('Failed to save order:', error);
    }
  }, [hasUnsavedChanges, editForm, addressForm, order, mutations, onClose]);

  // Ship entire order
  const handleShipOrder = useCallback(async () => {
    if (!shipForm.awbNumber.trim() || !shipForm.courier.trim()) {
      alert('Please enter AWB number and select a courier');
      return;
    }

    // Verify AWB if expected
    if (expectedAwb && !awbMatches && !shipForm.bypassVerification) {
      alert('AWB number does not match Shopify tracking. Check the "Use this AWB anyway" box to proceed.');
      return;
    }

    setIsShipping(true);
    try {
      await mutations.ship.mutateAsync({
        id: order.id,
        data: {
          awbNumber: shipForm.awbNumber.trim(),
          courier: shipForm.courier.trim(),
        },
      });
    } catch (error) {
      setIsShipping(false);
      console.error('Failed to ship order:', error);
    }
  }, [shipForm, expectedAwb, awbMatches, order.id, mutations]);

  // Ship selected lines (partial shipment)
  const handleShipLines = useCallback(async () => {
    if (!shipForm.awbNumber.trim() || !shipForm.courier.trim()) {
      alert('Please enter AWB number and select a courier');
      return;
    }

    if (shipForm.selectedLineIds.size === 0) {
      alert('Please select at least one line to ship');
      return;
    }

    // Verify AWB if expected
    if (expectedAwb && !awbMatches && !shipForm.bypassVerification) {
      alert('AWB number does not match Shopify tracking. Check the "Use this AWB anyway" box to proceed.');
      return;
    }

    setIsShipping(true);
    try {
      await mutations.shipLines.mutateAsync({
        lineIds: Array.from(shipForm.selectedLineIds),
        awbNumber: shipForm.awbNumber.trim(),
        courier: shipForm.courier.trim(),
      });
    } catch (error) {
      setIsShipping(false);
      console.error('Failed to ship lines:', error);
    }
  }, [shipForm, expectedAwb, awbMatches, order.id, mutations]);

  // Handle add line
  const handleAddLineWithMutation = useCallback(async (data: { skuId: string; qty: number; unitPrice: number }) => {
    try {
      await mutations.addLine.mutateAsync({
        orderId: order.id,
        data,
      });
      handleAddLine(data.skuId, data.qty, data.unitPrice);
    } catch (error) {
      console.error('Failed to add line:', error);
    }
  }, [order.id, mutations, handleAddLine]);

  // Handle update line
  const handleUpdateLineWithMutation = useCallback(async (lineId: string, data: { qty?: number; unitPrice?: number }) => {
    setUpdatingLineIds(prev => new Set(prev).add(lineId));
    try {
      await mutations.updateLine.mutateAsync({ lineId, data });
      // Invalidate the individual order query to refresh modal data
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      handleUpdateLine(lineId, data);
    } catch (error) {
      console.error('Failed to update line:', error);
    } finally {
      setUpdatingLineIds(prev => {
        const next = new Set(prev);
        next.delete(lineId);
        return next;
      });
    }
  }, [mutations, handleUpdateLine, queryClient, order.id]);

  // Handle cancel line
  const handleCancelLineWithMutation = useCallback(async (lineId: string) => {
    try {
      await mutations.cancelLine.mutateAsync(lineId);
      handleCancelLine(lineId);
    } catch (error) {
      console.error('Failed to cancel line:', error);
    }
  }, [mutations, handleCancelLine]);

  // Handle uncancel line
  const handleUncancelLineWithMutation = useCallback(async (lineId: string) => {
    try {
      await mutations.uncancelLine.mutateAsync(lineId);
      handleUncancelLine(lineId);
    } catch (error) {
      console.error('Failed to restore line:', error);
    }
  }, [mutations, handleUncancelLine]);

  // Handle mark line as delivered
  const handleMarkLineDeliveredWithMutation = useCallback(async (lineId: string) => {
    try {
      await mutations.markLineDelivered.mutateAsync({ lineId });
      // Invalidate order query to refresh modal data
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      onSuccess?.();
    } catch (error) {
      console.error('Failed to mark line as delivered:', error);
    }
  }, [mutations, queryClient, order.id, onSuccess]);

  // Handle initiate return
  const handleInitiateReturn = useCallback(async () => {
    if (!returnForm.selectedLineId || !returnForm.returnReasonCategory || returnForm.returnResolution === null) {
      return;
    }

    try {
      const result = await initiateLineReturn({
        data: {
          lines: [{ orderLineId: returnForm.selectedLineId, returnQty: returnForm.returnQty }],
          returnReasonCategory: returnForm.returnReasonCategory,
          returnReasonDetail: returnForm.returnReasonDetail || undefined,
          returnResolution: returnForm.returnResolution,
        },
      });

      // Check for structured error response
      if (isReturnError(result)) {
        showReturnError(result, 'Initiate return');
        return;
      }

      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['returns', 'active'] });
      queryClient.invalidateQueries({ queryKey: ['returns', 'action-queue'] });

      // Show success toast
      showReturnSuccess(result.message || 'Return initiated successfully');

      // Reset form
      resetReturnForm();
      onSuccess?.();
    } catch (error) {
      console.error('Failed to initiate return:', error);
      showReturnError(error, 'Initiate return');
    }
  }, [returnForm, queryClient, order.id, resetReturnForm, onSuccess]);

  // Handle cancel return
  const handleCancelReturn = useCallback(async (lineId: string) => {
    if (!confirm('Are you sure you want to cancel this return?')) return;

    try {
      const result = await cancelLineReturn({ data: { orderLineId: lineId } });

      // Check for structured error response
      if (isReturnError(result)) {
        showReturnError(result, 'Cancel return');
        return;
      }

      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['returns', 'active'] });
      queryClient.invalidateQueries({ queryKey: ['returns', 'action-queue'] });

      // Show success toast
      showReturnSuccess(result.message || 'Return cancelled');

      onSuccess?.();
    } catch (error) {
      console.error('Failed to cancel return:', error);
      showReturnError(error, 'Cancel return');
    }
  }, [queryClient, order.id, onSuccess]);

  // Handle schedule return pickup - opens dialog for iThink booking
  const handleSchedulePickup = useCallback((lineId: string) => {
    setPickupDialogLineId(lineId);
  }, []);

  // Handle actual pickup scheduling from dialog
  const handleSchedulePickupConfirm = useCallback(async (params: {
    scheduleWithIthink: boolean;
    courier?: string;
    awbNumber?: string;
  }): Promise<{ success: boolean; awbNumber?: string; courier?: string; error?: string }> => {
    if (!pickupDialogLineId) {
      return { success: false, error: 'No line selected' };
    }

    try {
      const result = await scheduleReturnPickup({
        data: {
          orderLineId: pickupDialogLineId,
          pickupType: params.scheduleWithIthink ? 'arranged_by_us' : 'customer_shipped',
          scheduleWithIthink: params.scheduleWithIthink,
          courier: params.courier,
          awbNumber: params.awbNumber,
        },
      });

      if (isReturnError(result)) {
        return { success: false, error: result.error.message };
      }

      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      showReturnSuccess(result.message || 'Pickup scheduled');
      onSuccess?.();

      return {
        success: true,
        awbNumber: result.data?.awbNumber,
        courier: result.data?.courier,
      };
    } catch (error) {
      console.error('Failed to schedule pickup:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }, [pickupDialogLineId, queryClient, order.id, onSuccess]);

  // Handle receive return
  const handleReceiveReturn = useCallback(async (lineId: string, condition: 'good' | 'damaged' | 'defective' | 'wrong_item' | 'used') => {
    try {
      const result = await receiveLineReturn({
        data: { orderLineId: lineId, condition },
      });

      if (isReturnError(result)) {
        showReturnError(result, 'Receive return');
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['repacking-queue'] });
      showReturnSuccess(result.message || 'Return received');
      onSuccess?.();
    } catch (error) {
      console.error('Failed to receive return:', error);
      showReturnError(error, 'Receive return');
    }
  }, [queryClient, order.id, onSuccess]);

  // Handle process refund
  const handleProcessRefund = useCallback(async (lineId: string, grossAmount: number) => {
    try {
      const result = await processLineReturnRefund({
        data: { orderLineId: lineId, grossAmount, discountClawback: 0, deductions: 0 },
      });

      if (isReturnError(result)) {
        showReturnError(result, 'Process refund');
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      showReturnSuccess(result.message || 'Refund processed');
      onSuccess?.();
    } catch (error) {
      console.error('Failed to process refund:', error);
      showReturnError(error, 'Process refund');
    }
  }, [queryClient, order.id, onSuccess]);

  // Handle complete return
  const handleCompleteReturn = useCallback(async (lineId: string) => {
    try {
      const result = await completeLineReturn({ data: { orderLineId: lineId } });

      if (isReturnError(result)) {
        showReturnError(result, 'Complete return');
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      showReturnSuccess(result.message || 'Return completed');
      onSuccess?.();
    } catch (error) {
      console.error('Failed to complete return:', error);
      showReturnError(error, 'Complete return');
    }
  }, [queryClient, order.id, onSuccess]);

  // Handle create exchange order
  const handleCreateExchange = useCallback(async (lineId: string, exchangeSkuId: string, exchangeQty: number) => {
    try {
      const result = await createExchangeOrder({
        data: { orderLineId: lineId, exchangeSkuId, exchangeQty },
      });

      if (isReturnError(result)) {
        showReturnError(result, 'Create exchange');
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      showReturnSuccess(result.message || 'Exchange order created');
      onSuccess?.();
    } catch (error) {
      console.error('Failed to create exchange:', error);
      showReturnError(error, 'Create exchange');
    }
  }, [queryClient, order.id, onSuccess]);

  // Handle update return notes
  const handleUpdateReturnNotes = useCallback(async (lineId: string, notes: string) => {
    try {
      const result = await updateReturnNotes({
        data: { orderLineId: lineId, returnNotes: notes },
      });

      if (isReturnError(result)) {
        showReturnError(result, 'Update notes');
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      showReturnSuccess('Notes updated');
    } catch (error) {
      console.error('Failed to update notes:', error);
      showReturnError(error, 'Update notes');
    }
  }, [queryClient, order.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4"
      onClick={handleBackdropClick}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-white rounded-xl sm:rounded-2xl shadow-2xl w-full sm:max-w-[920px] max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden"
        style={{
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05)',
        }}
      >
        {/* Header */}
        <ModalHeader
          order={order || initialOrder}
          mode={mode}
          onModeChange={handleModeChange}
          canEdit={canEdit}
          canShip={canShip}
          canCustomer={canCustomer}
          canReturn={canReturn}
          hasUnsavedChanges={hasUnsavedChanges}
          onClose={onClose}
          navigationHistory={navigationHistory}
          canGoBack={canGoBack}
          onGoBack={goBack}
        />

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-5">
          {/* Loading state while fetching order data or navigating */}
          {(isLoadingOrder && !fetchedOrder) || isNavigating ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <Loader2 size={24} className="animate-spin text-sky-500 mx-auto mb-3" />
                <p className="text-sm text-slate-500">
                  {isNavigating ? 'Loading order...' : 'Loading order details...'}
                </p>
              </div>
            </div>
          ) : null}

          {/* Content sections - show after data is loaded */}
          {!isNavigating && (!isLoadingOrder || fetchedOrder) && order && (
            <>
              {/* Customer Tab - Full customer intelligence view */}
              {mode === 'customer' && (
                <CustomerTab
                  customer={customerData || null}
                  currentOrderId={order.id}
                  onSelectOrder={navigateToOrder}
                  isLoading={isLoadingCustomer}
                />
              )}

              {/* Returns Tab - Return management */}
              {mode === 'returns' && (
                <ReturnsSection
                  order={order}
                  returnForm={returnForm}
                  getLineEligibility={getLineEligibility}
                  onReturnFieldChange={handleReturnFieldChange}
                  onSelectLineForReturn={handleSelectLineForReturn}
                  onInitiateReturn={handleInitiateReturn}
                  onCancelReturn={handleCancelReturn}
                  onSchedulePickup={handleSchedulePickup}
                  onReceiveReturn={handleReceiveReturn}
                  onProcessRefund={handleProcessRefund}
                  onCompleteReturn={handleCompleteReturn}
                  onCreateExchange={handleCreateExchange}
                  onUpdateNotes={handleUpdateReturnNotes}
                />
              )}

              {/* Other modes: View, Edit, Ship */}
              {mode !== 'customer' && mode !== 'returns' && (
                <>
                  {/* Customer & Address */}
                  <CustomerSection
                    order={order}
                    mode={mode}
                    editForm={editForm}
                    addressForm={addressForm}
                    pastAddresses={pastAddresses}
                    isLoadingAddresses={isLoadingAddresses}
                    isAddressExpanded={isAddressExpanded}
                    isSearchingCustomer={isSearchingCustomer}
                    onEditFieldChange={handleEditFieldChange}
                    onAddressChange={handleAddressChange}
                    onSelectPastAddress={handleSelectPastAddress}
                    onToggleAddressPicker={toggleAddressPicker}
                    onSetSearchingCustomer={setIsSearchingCustomer}
                    onViewCustomerProfile={order.customerId ? () => handleModeChange('customer') : undefined}
                  />

                  {/* Line Items */}
                  <ItemsSection
                    order={order}
                    mode={mode}
                    categorizedLines={categorizedLines}
                    shipForm={shipForm}
                    isAddingProduct={isAddingProduct}
                    updatingLineIds={updatingLineIds}
                    onSetAddingProduct={setIsAddingProduct}
                    onAddLine={handleAddLineWithMutation}
                    onUpdateLine={handleUpdateLineWithMutation}
                    onCancelLine={handleCancelLineWithMutation}
                    onUncancelLine={handleUncancelLineWithMutation}
                    onToggleLineSelection={handleToggleLineSelection}
                    onMarkLineDelivered={handleMarkLineDeliveredWithMutation}
                  />

                  {/* Shipping */}
                  <ShippingSection
                    order={order}
                    mode={mode}
                    shipForm={shipForm}
                    categorizedLines={categorizedLines}
                    expectedAwb={expectedAwb}
                    awbMatches={awbMatches}
                    canShipOrder={canShipOrder}
                    isShipping={isShipping}
                    addressForm={addressForm}
                    onShipFieldChange={handleShipFieldChange}
                    onShip={handleShipOrder}
                    onShipLines={handleShipLines}
                    onShipmentBooked={onSuccess}
                  />

                  {/* Timeline */}
                  <TimelineSection order={order} />

                  {/* Notes */}
                  <NotesSection
                    order={order}
                    mode={mode}
                    internalNotes={editForm.internalNotes}
                    onNotesChange={(notes) => handleEditFieldChange('internalNotes', notes)}
                  />
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {mode === 'edit' && (
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-200 bg-gradient-to-r from-slate-50 to-white flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Total:</span>
              <span className="text-lg font-bold text-slate-800">
                ₹{calculatedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl transition-all ${
                  hasUnsavedChanges
                    ? 'bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 text-white shadow-lg shadow-sky-500/25'
                    : 'bg-slate-200 text-slate-500'
                }`}
              >
                {isSaving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Schedule Pickup Dialog */}
      {pickupDialogLineId && (() => {
        const pickupLine = order.orderLines?.find(l => l.id === pickupDialogLineId);
        if (!pickupLine) return null;
        return (
          <SchedulePickupDialog
            isOpen={true}
            onClose={() => setPickupDialogLineId(null)}
            order={order}
            orderLine={pickupLine}
            onSchedule={handleSchedulePickupConfirm}
          />
        );
      })()}
    </div>
  );
}

export default UnifiedOrderModal;
