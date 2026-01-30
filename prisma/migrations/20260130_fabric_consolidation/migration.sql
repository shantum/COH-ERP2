-- Fabric Consolidation Migration
-- ================================
-- This migration removes redundant fabric fields and makes BOM the single source
-- of truth for product material composition.
--
-- Fields removed:
-- - FabricType (entire table) - Same names as Fabric, redundant
-- - Fabric.fabricTypeId - FK to FabricType
-- - Product.fabricTypeId - Product shouldn't have direct fabric type
-- - Variation.fabricId - Replaced by VariationBomLine.fabricColourId
-- - Variation.fabricColourId - Replaced by VariationBomLine.fabricColourId
--
-- PREREQUISITE: Run backfillVariationBomLines.ts before this migration!
-- All variations MUST have a main fabric BOM line before proceeding.

-- ============================================
-- PHASE 1: DROP TRIGGERS (must happen first - they reference fabricId)
-- ============================================

DROP TRIGGER IF EXISTS trg_check_variation_bom_fabric_hierarchy ON "VariationBomLine";
DROP TRIGGER IF EXISTS trg_check_variation_fabric_hierarchy ON "Variation";
DROP FUNCTION IF EXISTS check_variation_bom_fabric_hierarchy();
DROP FUNCTION IF EXISTS check_variation_fabric_hierarchy_on_update();

-- ============================================
-- PHASE 2: DROP FOREIGN KEY CONSTRAINTS
-- ============================================

-- Variation fabric FKs
ALTER TABLE "Variation" DROP CONSTRAINT IF EXISTS "Variation_fabricId_fkey";
ALTER TABLE "Variation" DROP CONSTRAINT IF EXISTS "Variation_fabricColourId_fkey";

-- Product fabric type FK
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_fabricTypeId_fkey";

-- Fabric fabric type FK
ALTER TABLE "Fabric" DROP CONSTRAINT IF EXISTS "Fabric_fabricTypeId_fkey";

-- ============================================
-- PHASE 3: DROP INDEXES
-- ============================================

DROP INDEX IF EXISTS "Variation_fabricId_idx";
DROP INDEX IF EXISTS "Variation_fabricColourId_idx";
DROP INDEX IF EXISTS "Product_fabricTypeId_idx";
DROP INDEX IF EXISTS "Fabric_fabricTypeId_idx";

-- ============================================
-- PHASE 4: DROP COLUMNS
-- ============================================

-- Variation: Remove direct fabric fields (BOM is now source of truth)
ALTER TABLE "Variation" DROP COLUMN IF EXISTS "fabricId";
ALTER TABLE "Variation" DROP COLUMN IF EXISTS "fabricColourId";

-- Product: Remove fabric type (fabric info comes from variation BOM)
ALTER TABLE "Product" DROP COLUMN IF EXISTS "fabricTypeId";

-- Fabric: Remove fabric type link
ALTER TABLE "Fabric" DROP COLUMN IF EXISTS "fabricTypeId";

-- ============================================
-- PHASE 5: DROP LEGACY TABLES
-- ============================================

-- FabricType: Redundant with Fabric names
DROP TABLE IF EXISTS "FabricType";

-- FabricTransaction: Legacy - replaced by FabricColourTransaction
DROP TABLE IF EXISTS "FabricTransaction";

-- ============================================
-- VERIFICATION QUERIES (for manual checks)
-- ============================================
-- After migration, run these to verify:
--
-- 1. All variations have main fabric BOM line:
-- SELECT COUNT(*) FROM "Variation" v
-- WHERE v."isActive" = true
-- AND NOT EXISTS (
--     SELECT 1 FROM "VariationBomLine" vbl
--     JOIN "ComponentRole" cr ON vbl."roleId" = cr.id
--     JOIN "ComponentType" ct ON cr."typeId" = ct.id
--     WHERE vbl."variationId" = v.id
--     AND ct.code = 'FABRIC' AND cr.code = 'main'
--     AND vbl."fabricColourId" IS NOT NULL
-- );
-- Expected: 0
--
-- 2. FabricType table is gone:
-- SELECT COUNT(*) FROM "FabricType";
-- Expected: error (relation does not exist)
--
-- 3. Fabric.fabricTypeId column is gone:
-- SELECT "fabricTypeId" FROM "Fabric" LIMIT 1;
-- Expected: error (column does not exist)
