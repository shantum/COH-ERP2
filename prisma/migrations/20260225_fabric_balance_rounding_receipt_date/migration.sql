-- ============================================
-- 1. Update trigger function to round balance to 2 decimal places
-- ============================================

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
        SET "currentBalance" = ROUND(("currentBalance" + delta)::numeric, 2)
        WHERE "id" = NEW."fabricColourId";

        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        IF OLD."txnType" = 'inward' THEN
            delta := -OLD."qty";
        ELSE
            delta := OLD."qty";
        END IF;

        UPDATE "FabricColour"
        SET "currentBalance" = ROUND(("currentBalance" + delta)::numeric, 2)
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
            SET "currentBalance" = ROUND(("currentBalance" + delta)::numeric, 2)
            WHERE "id" = OLD."fabricColourId";

            -- Apply new
            IF NEW."txnType" = 'inward' THEN
                delta := NEW."qty";
            ELSE
                delta := -NEW."qty";
            END IF;

            UPDATE "FabricColour"
            SET "currentBalance" = ROUND(("currentBalance" + delta)::numeric, 2)
            WHERE "id" = NEW."fabricColourId";
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 2. Fix existing dirty balances (floating-point noise)
-- ============================================

-- Temporarily disable the guard trigger so we can update directly
ALTER TABLE "FabricColour" DISABLE TRIGGER trg_guard_fabric_colour_balance;

UPDATE "FabricColour"
SET "currentBalance" = ROUND("currentBalance"::numeric, 2)
WHERE "currentBalance" != ROUND("currentBalance"::numeric, 2);

-- Re-enable the guard trigger
ALTER TABLE "FabricColour" ENABLE TRIGGER trg_guard_fabric_colour_balance;

-- ============================================
-- 3. Add receiptDate column to FabricColourTransaction
-- ============================================

ALTER TABLE "FabricColourTransaction" ADD COLUMN IF NOT EXISTS "receiptDate" TIMESTAMP(3);
