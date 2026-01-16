/**
 * useOrdersMutations hook - Facade
 *
 * Centralizes all mutations for the Orders page by composing focused sub-hooks.
 * This facade maintains backward compatibility while allowing consumers to
 * optionally import individual hooks for better tree-shaking.
 *
 * SIMPLIFIED: No optimistic updates.
 * - Mutations complete in 100-300ms (fast enough)
 * - SSE broadcasts changes to other users in <1s
 * - No race conditions, no cache sync issues
 * - Loading states in UI provide feedback
 *
 * Individual hooks available in ./orders/:
 * - useOrderWorkflowMutations: allocate/pick/pack
 * - useOrderShipMutations: ship operations
 * - useOrderCrudMutations: create/update/delete
 * - useOrderStatusMutations: cancel/uncancel
 * - useOrderDeliveryMutations: delivery tracking
 * - useOrderLineMutations: line ops + customization
 * - useOrderReleaseMutations: release workflows
 * - useProductionBatchMutations: production batches
 */

import {
    useOrderWorkflowMutations,
    useOrderShipMutations,
    useOrderCrudMutations,
    useOrderStatusMutations,
    useOrderDeliveryMutations,
    useOrderLineMutations,
    useOrderReleaseMutations,
    useProductionBatchMutations,
    useOrderInvalidation,
} from './orders';

interface UseOrdersMutationsOptions {
    onShipSuccess?: () => void;
    onCreateSuccess?: () => void;
    onDeleteSuccess?: () => void;
    onEditSuccess?: () => void;
    onNotesSuccess?: () => void;
}

export function useOrdersMutations(options: UseOrdersMutationsOptions = {}) {
    // Compose all sub-hooks
    const workflow = useOrderWorkflowMutations();
    const ship = useOrderShipMutations({ onShipSuccess: options.onShipSuccess });
    const crud = useOrderCrudMutations({
        onCreateSuccess: options.onCreateSuccess,
        onDeleteSuccess: options.onDeleteSuccess,
        onEditSuccess: options.onEditSuccess,
        onNotesSuccess: options.onNotesSuccess,
    });
    const status = useOrderStatusMutations();
    const delivery = useOrderDeliveryMutations();
    const line = useOrderLineMutations({ onEditSuccess: options.onEditSuccess });
    const release = useOrderReleaseMutations();
    const production = useProductionBatchMutations();
    const { invalidateAll } = useOrderInvalidation();

    return {
        // Ship
        ship: ship.ship,
        shipLines: ship.shipLines,
        forceShip: ship.forceShip,
        unship: ship.unship,

        // Delivery tracking
        markDelivered: delivery.markDelivered,
        markRto: delivery.markRto,
        receiveRto: delivery.receiveRto,

        // Allocate/Pick/Pack
        allocate: workflow.allocate,
        unallocate: workflow.unallocate,
        pickLine: workflow.pickLine,
        unpickLine: workflow.unpickLine,
        packLine: workflow.packLine,
        unpackLine: workflow.unpackLine,

        // Ship line (direct: packed → shipped)
        markShippedLine: ship.markShippedLine,
        unmarkShippedLine: ship.unmarkShippedLine,
        updateLineTracking: ship.updateLineTracking,

        // Migration (onboarding)
        migrateShopifyFulfilled: release.migrateShopifyFulfilled,

        // Production
        createBatch: production.createBatch,
        updateBatch: production.updateBatch,
        deleteBatch: production.deleteBatch,

        // Order CRUD
        createOrder: crud.createOrder,
        deleteOrder: crud.deleteOrder,
        updateOrder: crud.updateOrder,
        updateOrderNotes: crud.updateOrderNotes,

        // Order status
        cancelOrder: status.cancelOrder,
        uncancelOrder: status.uncancelOrder,

        // Order lines
        cancelLine: status.cancelLine,
        uncancelLine: status.uncancelLine,
        updateLine: line.updateLine,
        updateLineNotes: crud.updateLineNotes,
        updateShipByDate: crud.updateShipByDate,
        addLine: line.addLine,

        // Release to shipped view
        releaseToShipped: release.releaseToShipped,

        // Release to cancelled view
        releaseToCancelled: release.releaseToCancelled,

        // Customization
        customizeLine: line.customizeLine,
        removeCustomization: line.removeCustomization,

        // Helper
        invalidateAll,
    };
}

export default useOrdersMutations;
