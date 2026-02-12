-- Add sheetPushedAt to track which orders have been pushed to Google Sheets
ALTER TABLE "Order" ADD COLUMN "sheetPushedAt" TIMESTAMP(3);

-- Backfill: all existing orders are already on the sheet (or old enough we don't care)
-- This prevents the reconciler from trying to re-push everything on first run
UPDATE "Order" SET "sheetPushedAt" = "createdAt";
