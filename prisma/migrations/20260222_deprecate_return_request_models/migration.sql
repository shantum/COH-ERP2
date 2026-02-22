-- DropForeignKey: RepackingQueueItem -> ReturnRequest
ALTER TABLE "RepackingQueueItem" DROP CONSTRAINT IF EXISTS "RepackingQueueItem_returnRequestId_fkey";

-- DropIndex: RepackingQueueItem.returnRequestId
DROP INDEX IF EXISTS "RepackingQueueItem_returnRequestId_idx";

-- AlterTable: Remove returnRequestId and returnLineId from RepackingQueueItem
ALTER TABLE "RepackingQueueItem" DROP COLUMN IF EXISTS "returnRequestId";
ALTER TABLE "RepackingQueueItem" DROP COLUMN IF EXISTS "returnLineId";

-- DropTable: ReturnStatusHistory (depends on ReturnRequest)
DROP TABLE IF EXISTS "ReturnStatusHistory" CASCADE;

-- DropTable: ReturnShipping (depends on ReturnRequest)
DROP TABLE IF EXISTS "ReturnShipping" CASCADE;

-- DropTable: ReplacementItem (depends on ReturnRequest and Sku)
DROP TABLE IF EXISTS "ReplacementItem" CASCADE;

-- DropTable: ReturnRequestLine (depends on ReturnRequest, Sku, OrderLine)
DROP TABLE IF EXISTS "ReturnRequestLine" CASCADE;

-- DropTable: ReturnRequest (depends on Customer, Order)
DROP TABLE IF EXISTS "ReturnRequest" CASCADE;
