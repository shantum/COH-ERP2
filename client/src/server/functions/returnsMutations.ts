/**
 * Returns Mutations - Barrel re-export
 *
 * All return mutations are split into focused files:
 * - returnLifecycle.ts — initiation, logistics, status transitions, notes
 * - returnResolution.ts — refunds, exchanges, completion
 *
 * This file preserves backward compatibility for existing imports.
 */

// Lifecycle: initiation, logistics, cancellation, notes
export {
    initiateLineReturn,
    scheduleReturnPickup,
    markReturnInTransit,
    receiveLineReturn,
    cancelLineReturn,
    closeLineReturnManually,
    updateReturnNotes,
} from './returnLifecycle';

// Resolution: refunds, exchanges, completion
export {
    processLineReturnRefund,
    sendReturnRefundLink,
    completeLineReturnRefund,
    completeLineReturn,
    createExchangeOrder,
} from './returnResolution';
