-- Add currentBalance column to Sku table
-- This is a materialized balance that is automatically updated by database triggers

-- Step 1: Add the column with default 0
ALTER TABLE "Sku" ADD COLUMN IF NOT EXISTS "currentBalance" INTEGER NOT NULL DEFAULT 0;

-- Step 2: Create the trigger function
CREATE OR REPLACE FUNCTION update_sku_balance()
RETURNS TRIGGER AS $$
DECLARE
    delta INTEGER;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- On INSERT: inward adds, outward subtracts
        IF NEW."txnType" = 'inward' THEN
            delta := NEW."qty";
        ELSE
            delta := -NEW."qty";
        END IF;

        UPDATE "Sku"
        SET "currentBalance" = "currentBalance" + delta
        WHERE "id" = NEW."skuId";

        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        -- On DELETE: reverse the effect
        IF OLD."txnType" = 'inward' THEN
            delta := -OLD."qty";
        ELSE
            delta := OLD."qty";
        END IF;

        UPDATE "Sku"
        SET "currentBalance" = "currentBalance" + delta
        WHERE "id" = OLD."skuId";

        RETURN OLD;

    ELSIF TG_OP = 'UPDATE' THEN
        -- On UPDATE: only handle qty changes (rare but possible)
        -- First reverse old effect, then apply new effect
        IF OLD."qty" != NEW."qty" OR OLD."txnType" != NEW."txnType" THEN
            -- Reverse old
            IF OLD."txnType" = 'inward' THEN
                delta := -OLD."qty";
            ELSE
                delta := OLD."qty";
            END IF;

            UPDATE "Sku"
            SET "currentBalance" = "currentBalance" + delta
            WHERE "id" = OLD."skuId";

            -- Apply new
            IF NEW."txnType" = 'inward' THEN
                delta := NEW."qty";
            ELSE
                delta := -NEW."qty";
            END IF;

            UPDATE "Sku"
            SET "currentBalance" = "currentBalance" + delta
            WHERE "id" = NEW."skuId";
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Drop existing triggers if any (for idempotency)
DROP TRIGGER IF EXISTS trg_inventory_balance_insert ON "InventoryTransaction";
DROP TRIGGER IF EXISTS trg_inventory_balance_delete ON "InventoryTransaction";
DROP TRIGGER IF EXISTS trg_inventory_balance_update ON "InventoryTransaction";

-- Step 4: Create triggers
CREATE TRIGGER trg_inventory_balance_insert
    AFTER INSERT ON "InventoryTransaction"
    FOR EACH ROW
    EXECUTE FUNCTION update_sku_balance();

CREATE TRIGGER trg_inventory_balance_delete
    AFTER DELETE ON "InventoryTransaction"
    FOR EACH ROW
    EXECUTE FUNCTION update_sku_balance();

CREATE TRIGGER trg_inventory_balance_update
    AFTER UPDATE ON "InventoryTransaction"
    FOR EACH ROW
    EXECUTE FUNCTION update_sku_balance();

-- Step 5: Initialize currentBalance from existing transactions
-- This calculates SUM(inward) - SUM(outward) for each SKU
UPDATE "Sku" s
SET "currentBalance" = COALESCE(
    (
        SELECT
            COALESCE(SUM(CASE WHEN t."txnType" = 'inward' THEN t."qty" ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN t."txnType" = 'outward' THEN t."qty" ELSE 0 END), 0)
        FROM "InventoryTransaction" t
        WHERE t."skuId" = s."id"
    ),
    0
);

-- Step 6: Add an index on currentBalance for fast stock queries
CREATE INDEX IF NOT EXISTS "Sku_currentBalance_idx" ON "Sku"("currentBalance");

-- ============================================
-- FABRIC COLOUR BALANCE TRIGGERS
-- ============================================

-- Step 7: Add currentBalance column to FabricColour table
ALTER TABLE "FabricColour" ADD COLUMN IF NOT EXISTS "currentBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Step 8: Create the trigger function for FabricColour
CREATE OR REPLACE FUNCTION update_fabric_colour_balance()
RETURNS TRIGGER AS $$
DECLARE
    delta DOUBLE PRECISION;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."txnType" = 'inward' THEN
            delta := NEW."qty";
        ELSE
            delta := -NEW."qty";
        END IF;

        UPDATE "FabricColour"
        SET "currentBalance" = "currentBalance" + delta
        WHERE "id" = NEW."fabricColourId";

        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        IF OLD."txnType" = 'inward' THEN
            delta := -OLD."qty";
        ELSE
            delta := OLD."qty";
        END IF;

        UPDATE "FabricColour"
        SET "currentBalance" = "currentBalance" + delta
        WHERE "id" = OLD."fabricColourId";

        RETURN OLD;

    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD."qty" != NEW."qty" OR OLD."txnType" != NEW."txnType" THEN
            -- Reverse old
            IF OLD."txnType" = 'inward' THEN
                delta := -OLD."qty";
            ELSE
                delta := OLD."qty";
            END IF;

            UPDATE "FabricColour"
            SET "currentBalance" = "currentBalance" + delta
            WHERE "id" = OLD."fabricColourId";

            -- Apply new
            IF NEW."txnType" = 'inward' THEN
                delta := NEW."qty";
            ELSE
                delta := -NEW."qty";
            END IF;

            UPDATE "FabricColour"
            SET "currentBalance" = "currentBalance" + delta
            WHERE "id" = NEW."fabricColourId";
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Step 9: Drop existing triggers if any (for idempotency)
DROP TRIGGER IF EXISTS trg_fabric_colour_balance_insert ON "FabricColourTransaction";
DROP TRIGGER IF EXISTS trg_fabric_colour_balance_delete ON "FabricColourTransaction";
DROP TRIGGER IF EXISTS trg_fabric_colour_balance_update ON "FabricColourTransaction";

-- Step 10: Create triggers for FabricColourTransaction
CREATE TRIGGER trg_fabric_colour_balance_insert
    AFTER INSERT ON "FabricColourTransaction"
    FOR EACH ROW
    EXECUTE FUNCTION update_fabric_colour_balance();

CREATE TRIGGER trg_fabric_colour_balance_delete
    AFTER DELETE ON "FabricColourTransaction"
    FOR EACH ROW
    EXECUTE FUNCTION update_fabric_colour_balance();

CREATE TRIGGER trg_fabric_colour_balance_update
    AFTER UPDATE ON "FabricColourTransaction"
    FOR EACH ROW
    EXECUTE FUNCTION update_fabric_colour_balance();

-- Step 11: Initialize FabricColour balances from existing transactions
UPDATE "FabricColour" fc
SET "currentBalance" = COALESCE(
    (
        SELECT
            COALESCE(SUM(CASE WHEN t."txnType" = 'inward' THEN t."qty" ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN t."txnType" = 'outward' THEN t."qty" ELSE 0 END), 0)
        FROM "FabricColourTransaction" t
        WHERE t."fabricColourId" = fc."id"
    ),
    0
);

-- Step 12: Add index on FabricColour.currentBalance
CREATE INDEX IF NOT EXISTS "FabricColour_currentBalance_idx" ON "FabricColour"("currentBalance");

-- ============================================
-- GUARD TRIGGERS (prevent direct writes)
-- ============================================

-- Step 13: Guard trigger for Sku.currentBalance
-- Only allows changes when called from another trigger (pg_trigger_depth() > 0)
CREATE OR REPLACE FUNCTION guard_sku_balance()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow changes if we're inside a trigger (like update_sku_balance)
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    -- Block direct changes to currentBalance
    IF OLD."currentBalance" IS DISTINCT FROM NEW."currentBalance" THEN
        RAISE EXCEPTION 'Direct modification of Sku.currentBalance is not allowed. Use InventoryTransaction instead.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing guard trigger if any (for idempotency)
DROP TRIGGER IF EXISTS trg_guard_sku_balance ON "Sku";

-- Create guard trigger (runs BEFORE UPDATE to block invalid changes)
CREATE TRIGGER trg_guard_sku_balance
    BEFORE UPDATE ON "Sku"
    FOR EACH ROW
    EXECUTE FUNCTION guard_sku_balance();

-- Step 14: Guard trigger for FabricColour.currentBalance
CREATE OR REPLACE FUNCTION guard_fabric_colour_balance()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow changes if we're inside a trigger (like update_fabric_colour_balance)
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    -- Block direct changes to currentBalance
    IF OLD."currentBalance" IS DISTINCT FROM NEW."currentBalance" THEN
        RAISE EXCEPTION 'Direct modification of FabricColour.currentBalance is not allowed. Use FabricColourTransaction instead.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing guard trigger if any (for idempotency)
DROP TRIGGER IF EXISTS trg_guard_fabric_colour_balance ON "FabricColour";

-- Create guard trigger
CREATE TRIGGER trg_guard_fabric_colour_balance
    BEFORE UPDATE ON "FabricColour"
    FOR EACH ROW
    EXECUTE FUNCTION guard_fabric_colour_balance();
