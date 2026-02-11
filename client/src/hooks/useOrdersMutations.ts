/**
 * useOrdersMutations hook - Facade
 *
 * Centralizes order mutations for the Orders page by composing focused sub-hooks.
 * Covers CRUD, order-level status (cancel/uncancel), and line operations.
 *
 * Production batch mutations are used directly via useProductionBatchMutations.
 * Fulfillment workflow (allocate/pick/pack/ship) managed in Google Sheets.
 */

import {
    useOrderCrudMutations,
    useOrderStatusMutations,
    useOrderLineMutations,
    useOrderInvalidation,
} from './orders';

interface UseOrdersMutationsOptions {
    onCreateSuccess?: () => void;
    onDeleteSuccess?: () => void;
    onEditSuccess?: () => void;
    onNotesSuccess?: () => void;
    currentView?: string;
    page?: number;
}

export function useOrdersMutations(options: UseOrdersMutationsOptions = {}) {
    const crud = useOrderCrudMutations({
        onCreateSuccess: options.onCreateSuccess,
        onDeleteSuccess: options.onDeleteSuccess,
        onEditSuccess: options.onEditSuccess,
        onNotesSuccess: options.onNotesSuccess,
    });
    const status = useOrderStatusMutations({
        currentView: options.currentView,
        page: options.page,
    });
    const line = useOrderLineMutations({ onEditSuccess: options.onEditSuccess });
    const { invalidateAll } = useOrderInvalidation();

    return {
        // Order CRUD
        createOrder: crud.createOrder,
        deleteOrder: crud.deleteOrder,
        updateOrder: crud.updateOrder,
        updateOrderNotes: crud.updateOrderNotes,

        // Order status (order-level cancel/uncancel)
        cancelOrder: status.cancelOrder,
        uncancelOrder: status.uncancelOrder,

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
