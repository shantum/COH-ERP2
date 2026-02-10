/**
 * useOrdersMutations hook - Facade
 *
 * Centralizes all mutations for the Orders page by composing focused sub-hooks.
 *
 * STRIPPED: Workflow (allocate/pick/pack), ship, delivery, and release hooks removed.
 * Fulfillment now managed in Google Sheets. Only CRUD, status (cancel order-level),
 * line ops, and production remain.
 */

import {
    useOrderCrudMutations,
    useOrderStatusMutations,
    useOrderLineMutations,
    useProductionBatchMutations,
    useOrderInvalidation,
} from './orders';

interface UseOrdersMutationsOptions {
    /** Callback fired after successful order creation */
    onCreateSuccess?: () => void;
    /** Callback fired after successful order deletion */
    onDeleteSuccess?: () => void;
    /** Callback fired after successful order edit */
    onEditSuccess?: () => void;
    /** Callback fired after successful notes update */
    onNotesSuccess?: () => void;
    /** Current view for optimistic update cache targeting */
    currentView?: string;
    /** Current page for optimistic update cache targeting */
    page?: number;
}

export function useOrdersMutations(options: UseOrdersMutationsOptions = {}) {
    const optimisticOptions = {
        currentView: options.currentView,
        page: options.page,
    };

    const crud = useOrderCrudMutations({
        onCreateSuccess: options.onCreateSuccess,
        onDeleteSuccess: options.onDeleteSuccess,
        onEditSuccess: options.onEditSuccess,
        onNotesSuccess: options.onNotesSuccess,
    });
    const status = useOrderStatusMutations(optimisticOptions);
    const line = useOrderLineMutations({ onEditSuccess: options.onEditSuccess });
    const production = useProductionBatchMutations(optimisticOptions);
    const { invalidateAll } = useOrderInvalidation();

    return {
        // Production
        createBatch: production.createBatch,
        updateBatch: production.updateBatch,
        deleteBatch: production.deleteBatch,

        // Order CRUD
        createOrder: crud.createOrder,
        deleteOrder: crud.deleteOrder,
        updateOrder: crud.updateOrder,
        updateOrderNotes: crud.updateOrderNotes,

        // Order status (order-level cancel/uncancel still works)
        cancelOrder: status.cancelOrder,
        uncancelOrder: status.uncancelOrder,

        // Line status (cancel/uncancel line still works)
        cancelLine: status.cancelLine,
        uncancelLine: status.uncancelLine,

        // Order lines
        updateLine: line.updateLine,
        updateLineNotes: crud.updateLineNotes,
        updateShipByDate: crud.updateShipByDate,
        addLine: line.addLine,

        // Customization
        customizeLine: line.customizeLine,
        removeCustomization: line.removeCustomization,

        // Helper
        invalidateAll,
    };
}

export default useOrdersMutations;
