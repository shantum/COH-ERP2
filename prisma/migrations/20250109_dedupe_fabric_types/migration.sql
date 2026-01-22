-- Deduplicate FabricType records and add unique constraint on name
-- This migration consolidates duplicate fabric types (same name, different IDs) into single records

-- Step 1: Create a temporary table mapping duplicate IDs to canonical IDs (first ID per name)
CREATE TEMP TABLE fabric_type_mapping AS
WITH ranked AS (
    SELECT
        id,
        name,
        ROW_NUMBER() OVER (PARTITION BY name ORDER BY id) as rn
    FROM "FabricType"
),
canonical AS (
    SELECT id as canonical_id, name
    FROM ranked
    WHERE rn = 1
)
SELECT r.id as old_id, c.canonical_id as new_id
FROM ranked r
JOIN canonical c ON r.name = c.name
WHERE r.rn > 1;

-- Step 2: Update Fabric records to point to canonical FabricType IDs
UPDATE "Fabric" f
SET "fabricTypeId" = m.new_id
FROM fabric_type_mapping m
WHERE f."fabricTypeId" = m.old_id;

-- Step 3: Update Product records to point to canonical FabricType IDs
UPDATE "Product" p
SET "fabricTypeId" = m.new_id
FROM fabric_type_mapping m
WHERE p."fabricTypeId" = m.old_id;

-- Step 4: Delete the duplicate FabricType records
DELETE FROM "FabricType"
WHERE id IN (SELECT old_id FROM fabric_type_mapping);

-- Step 5: Drop the temporary table
DROP TABLE fabric_type_mapping;

-- Step 6: Add unique constraint on name to prevent future duplicates
ALTER TABLE "FabricType" ADD CONSTRAINT "FabricType_name_key" UNIQUE ("name");
