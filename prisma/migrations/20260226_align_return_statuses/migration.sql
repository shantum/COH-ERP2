-- Align return statuses to match Return Prime lifecycle
-- pickup_scheduled + in_transit -> approved
-- received + qc_inspected -> inspected
-- complete -> refunded
UPDATE "OrderLine" SET "returnStatus" = 'approved' WHERE "returnStatus" IN ('pickup_scheduled', 'in_transit');
UPDATE "OrderLine" SET "returnStatus" = 'inspected' WHERE "returnStatus" IN ('received', 'qc_inspected');
UPDATE "OrderLine" SET "returnStatus" = 'refunded' WHERE "returnStatus" = 'complete';
