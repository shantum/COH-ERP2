/**
 * @module routes/returns
 * Return request (ticket) management and QC workflow.
 *
 * Status flow:
 *   requested -> reverse_initiated -> in_transit -> received -> processing -> resolved
 *   (can jump to cancelled from any non-terminal state)
 *
 * Resolution types:
 *   - refund: Customer gets money back
 *   - exchange_same: Same product, different size/color
 *   - exchange_up: Higher value product (customer pays difference)
 *   - exchange_down: Lower value product (customer gets refund difference)
 *
 * Key workflows:
 * - Return creation: Creates ticket, validates items not customized, checks for duplicates
 * - Receive item: Marks condition, adds to repacking queue (QC), auto-resolves when all received
 * - Repacking queue: QC -> inventory inward (good/used) OR write-off (damaged/wrong)
 * - Exchange early-ship: Allow replacement shipment when reverse in-transit (not yet received)
 *
 * Critical gotchas:
 * - Customized items (isNonReturnable=true) cannot be returned (blocked at creation)
 * - Items already in active tickets cannot be added to new tickets (duplicate check)
 * - Status transitions validated via state machine (see VALID_STATUS_TRANSITIONS in types.ts)
 * - Receive uses optimistic locking (re-fetch line inside transaction to prevent double-receive)
 * - Reason category locked after first item received (prevents gaming after QC)
 * - Delete only allowed if no items received AND no processed repacking items
 * - Exchange auto-resolves when both reverseReceived=true AND forwardDelivered=true
 *
 * @see types.ts for type definitions and state machine
 * @see routes/repacking.js for QC queue processing
 */

import { Router } from 'express';
import ticketsRouter from './tickets.js';
import receiveRouter from './receive.js';
import shippingRouter from './shipping.js';
import qcRouter from './qc.js';

const router: Router = Router();

// Mount sub-routers - order matters for route matching
// More specific routes first, then parameterized routes

// Tickets (CRUD for return requests)
// GET /                        - List all return requests
// GET /pending                 - Get pending tickets
// GET /pending/by-sku          - Find pending tickets by SKU
// GET /action-queue            - Get action queue summary
// GET /order/:orderId          - Get order details for creating return
// GET /:id                     - Get single request
// POST /                       - Create return request
// PUT /:id                     - Update return request
// DELETE /:id                  - Delete return request
// POST /:id/add-item           - Add item to return
// DELETE /:id/items/:lineId    - Remove item from return
// POST /:id/cancel             - Cancel return request
router.use('/', ticketsRouter);

// Receive (Item receipt and condition handling)
// POST /:id/receive-item       - Receive item
// POST /:id/undo-receive       - Undo receive
// POST /:id/resolve            - Resolve return request
router.use('/', receiveRouter);

// Shipping (Reverse/forward shipping operations)
// POST /:id/initiate-reverse           - Initiate reverse pickup
// POST /:id/mark-received              - Mark reverse shipment as received (legacy)
// POST /:id/cancel-simple              - Cancel return request (legacy)
// PUT /:id/link-exchange-order         - Link exchange to order
// PUT /:id/unlink-exchange-order       - Unlink exchange from order
// PUT /:id/mark-reverse-received       - Mark reverse received (exchanges)
// PUT /:id/unmark-reverse-received     - Unmark reverse received
// PUT /:id/mark-forward-delivered      - Mark forward delivered
// PUT /:id/unmark-forward-delivered    - Unmark forward delivered
// PUT /:id/mark-reverse-in-transit     - Mark reverse in-transit (enables early ship)
// PUT /:id/ship-replacement            - Ship replacement
router.use('/', shippingRouter);

// QC/Analytics
// GET /analytics/by-product    - Get return analytics by product
router.use('/', qcRouter);

export default router;
