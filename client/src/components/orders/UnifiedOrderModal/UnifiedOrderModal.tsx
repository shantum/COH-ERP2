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
import { useQuery } from '@tanstack/react-query';
import { Save, Loader2 } from 'lucide-react';
import type { Order } from '../../../types';
import type { ModalMode } from './types';
import { useUnifiedOrderModal } from './hooks/useUnifiedOrderModal';
import { useOrdersMutations } from '../../../hooks/useOrdersMutations';
import { ordersApi } from '../../../services/api';
import { ModalHeader } from './components/ModalHeader';
import { CustomerSection } from './components/CustomerSection';
import { ItemsSection } from './components/ItemsSection';
// OrderSummary is now integrated into ItemsSection
import { ShippingSection } from './components/ShippingSection';
import { TimelineSection } from './components/TimelineSection';
import { NotesSection } from './components/NotesSection';

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
  const [isSaving, setIsSaving] = useState(false);
  const [isShipping, setIsShipping] = useState(false);

  // Fetch fresh order data to ensure we have all fields
  const { data: fetchedOrder, isLoading: isLoadingOrder } = useQuery({
    queryKey: ['order', initialOrder.id],
    queryFn: async () => {
      const response = await ordersApi.getById(initialOrder.id);
      return response.data;
    },
    staleTime: 30 * 1000, // 30 seconds
  });

  // Use fetched order if available, otherwise fall back to initial order
  const order = fetchedOrder || initialOrder;

  // Initialize modal state
  const modalState = useUnifiedOrderModal({ order, initialMode });
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
    totalItems: _totalItems,
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
  } = modalState;

  // Ensure canShip is always boolean
  const canShip = modalState.canShip ?? false;

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
        id: order.id,
        data: {
          lineIds: Array.from(shipForm.selectedLineIds),
          awbNumber: shipForm.awbNumber.trim(),
          courier: shipForm.courier.trim(),
        },
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
    try {
      await mutations.updateLine.mutateAsync({ lineId, data });
      handleUpdateLine(lineId, data);
    } catch (error) {
      console.error('Failed to update line:', error);
    }
  }, [mutations, handleUpdateLine]);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-[920px] w-full max-h-[90vh] flex flex-col overflow-hidden"
        style={{
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05)',
        }}
      >
        {/* Header */}
        <ModalHeader
          order={order}
          mode={mode}
          onModeChange={handleModeChange}
          canEdit={canEdit}
          canShip={canShip}
          hasUnsavedChanges={hasUnsavedChanges}
          onClose={onClose}
        />

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Loading state while fetching fresh order data */}
          {isLoadingOrder && !fetchedOrder && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <Loader2 size={24} className="animate-spin text-sky-500 mx-auto mb-3" />
                <p className="text-sm text-slate-500">Loading order details...</p>
              </div>
            </div>
          )}

          {/* Content sections - show after data is loaded */}
          {(!isLoadingOrder || fetchedOrder) && (
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
              />

              {/* Line Items */}
              <ItemsSection
                order={order}
                mode={mode}
                categorizedLines={categorizedLines}
                shipForm={shipForm}
                isAddingProduct={isAddingProduct}
                onSetAddingProduct={setIsAddingProduct}
                onAddLine={handleAddLineWithMutation}
                onUpdateLine={handleUpdateLineWithMutation}
                onCancelLine={handleCancelLineWithMutation}
                onUncancelLine={handleUncancelLineWithMutation}
                onToggleLineSelection={handleToggleLineSelection}
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
                onShipFieldChange={handleShipFieldChange}
                onShip={handleShipOrder}
                onShipLines={handleShipLines}
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
        </div>

        {/* Footer */}
        {mode === 'edit' && (
          <div className="px-6 py-4 border-t border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
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
    </div>
  );
}

export default UnifiedOrderModal;
