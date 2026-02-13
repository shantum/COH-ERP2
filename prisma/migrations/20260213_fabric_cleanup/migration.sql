-- leadTimeDays and minOrderQty were already dropped in a prior migration
-- Data was already copied to defaultLeadTimeDays / defaultMinOrderQty

-- Add default for colorName
ALTER TABLE "Fabric" ALTER COLUMN "colorName" SET DEFAULT 'N/A';
