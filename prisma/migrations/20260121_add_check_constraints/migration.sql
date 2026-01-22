-- Phase 3: Add CHECK constraints for business rule enforcement
-- These constraints ensure data integrity at the database level

-- Qty must be positive on OrderLine
-- Business rule: Order lines must have at least 1 item
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_qty_positive" CHECK (qty > 0);

-- Qty must be positive on InventoryTransaction
-- Business rule: All inventory transactions must have positive quantities
-- (the txnType determines if it's adding or removing inventory)
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_qty_positive" CHECK (qty > 0);

-- Transaction type must be valid
-- Business rule: Only 'inward' (adding stock) and 'outward' (removing stock) are valid
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_txnType_check"
CHECK ("txnType" IN ('inward', 'outward'));

-- Note: We intentionally do NOT add a CHECK constraint for lineStatus because:
-- 1. Status transitions are managed by the state machine (server/src/utils/orderStateMachine.ts)
-- 2. There may be edge cases or legacy data that need flexibility
-- 3. The existing code already validates status transitions
