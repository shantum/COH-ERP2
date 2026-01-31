-- BOM Cost Database Triggers
-- Automatically recalculates Sku.bomCost and Variation.bomCost when BOM data changes
--
-- This migration creates:
-- 1. Core calculation function (3-level cascade: SKU → Variation → ProductTemplate)
-- 2. Helper functions for updating SKU and Variation costs
-- 3. BOM line triggers (SkuBomLine, VariationBomLine, ProductBomTemplate)
-- 4. Catalog cost triggers (FabricColour, Fabric, TrimItem, ServiceItem)
-- 5. Guard triggers to prevent direct bomCost modification
-- 6. Performance indexes for BOM lookups

-- ============================================
-- SECTION 1: CORE CALCULATION FUNCTION
-- ============================================

-- Calculate BOM cost for a single SKU using 3-level cascade resolution
-- Returns: Total cost or NULL if no valid costs found
CREATE OR REPLACE FUNCTION calculate_sku_bom_cost(p_sku_id TEXT)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
AS $$
DECLARE
    v_total_cost DOUBLE PRECISION := 0;
    v_has_costs BOOLEAN := false;
    v_fabric_type_id TEXT;
    v_trim_type_id TEXT;
    v_service_type_id TEXT;
    rec RECORD;
BEGIN
    -- Get component type IDs for fast comparison
    SELECT id INTO v_fabric_type_id FROM "ComponentType" WHERE code = 'FABRIC';
    SELECT id INTO v_trim_type_id FROM "ComponentType" WHERE code = 'TRIM';
    SELECT id INTO v_service_type_id FROM "ComponentType" WHERE code = 'SERVICE';

    -- Iterate through all ProductBomTemplate entries for this SKU's product
    FOR rec IN
        SELECT
            pbt.id as template_id,
            pbt."roleId",
            pbt."defaultQuantity",
            pbt."wastagePercent" as template_wastage,
            pbt."trimItemId" as template_trim_id,
            pbt."serviceItemId" as template_service_id,
            cr."typeId",
            vbl.id as vbl_id,
            vbl.quantity as vbl_quantity,
            vbl."wastagePercent" as vbl_wastage,
            vbl."fabricColourId" as vbl_fabric_colour_id,
            vbl."trimItemId" as vbl_trim_id,
            vbl."serviceItemId" as vbl_service_id,
            sbl.id as sbl_id,
            sbl.quantity as sbl_quantity,
            sbl."wastagePercent" as sbl_wastage,
            sbl."fabricColourId" as sbl_fabric_colour_id,
            sbl."trimItemId" as sbl_trim_id,
            sbl."serviceItemId" as sbl_service_id,
            sbl."overrideCost" as sbl_override_cost
        FROM "Sku" s
        JOIN "Variation" v ON s."variationId" = v.id
        JOIN "ProductBomTemplate" pbt ON pbt."productId" = v."productId"
        JOIN "ComponentRole" cr ON pbt."roleId" = cr.id
        LEFT JOIN "VariationBomLine" vbl ON vbl."variationId" = v.id AND vbl."roleId" = pbt."roleId"
        LEFT JOIN "SkuBomLine" sbl ON sbl."skuId" = s.id AND sbl."roleId" = pbt."roleId"
        WHERE s.id = p_sku_id
    LOOP
        DECLARE
            v_quantity DOUBLE PRECISION;
            v_wastage DOUBLE PRECISION;
            v_effective_qty DOUBLE PRECISION;
            v_unit_cost DOUBLE PRECISION := NULL;
            v_fabric_colour_id TEXT;
            v_trim_id TEXT;
            v_service_id TEXT;
        BEGIN
            -- Resolve quantity: SKU → Variation → ProductTemplate
            v_quantity := COALESCE(rec.sbl_quantity, rec.vbl_quantity, rec."defaultQuantity", 0);

            -- Resolve wastage: SKU → Variation → ProductTemplate
            v_wastage := COALESCE(rec.sbl_wastage, rec.vbl_wastage, rec.template_wastage, 0);

            -- Calculate effective quantity with wastage
            v_effective_qty := v_quantity * (1 + v_wastage / 100.0);

            -- Check for override cost first
            IF rec.sbl_override_cost IS NOT NULL THEN
                v_unit_cost := rec.sbl_override_cost;
            ELSIF rec."typeId" = v_fabric_type_id THEN
                -- FABRIC: Resolve fabric colour → get cost
                v_fabric_colour_id := COALESCE(rec.sbl_fabric_colour_id, rec.vbl_fabric_colour_id);
                IF v_fabric_colour_id IS NOT NULL THEN
                    SELECT COALESCE(fc."costPerUnit", f."costPerUnit")
                    INTO v_unit_cost
                    FROM "FabricColour" fc
                    JOIN "Fabric" f ON fc."fabricId" = f.id
                    WHERE fc.id = v_fabric_colour_id;
                END IF;
            ELSIF rec."typeId" = v_trim_type_id THEN
                -- TRIM: SKU → Variation → ProductTemplate
                v_trim_id := COALESCE(rec.sbl_trim_id, rec.vbl_trim_id, rec.template_trim_id);
                IF v_trim_id IS NOT NULL THEN
                    SELECT "costPerUnit" INTO v_unit_cost
                    FROM "TrimItem"
                    WHERE id = v_trim_id;
                END IF;
            ELSIF rec."typeId" = v_service_type_id THEN
                -- SERVICE: SKU → Variation → ProductTemplate
                v_service_id := COALESCE(rec.sbl_service_id, rec.vbl_service_id, rec.template_service_id);
                IF v_service_id IS NOT NULL THEN
                    SELECT "costPerJob" INTO v_unit_cost
                    FROM "ServiceItem"
                    WHERE id = v_service_id;
                END IF;
            END IF;

            -- Add to total if we have a valid cost
            IF v_unit_cost IS NOT NULL AND v_effective_qty > 0 THEN
                v_total_cost := v_total_cost + (v_effective_qty * v_unit_cost);
                v_has_costs := true;
            END IF;
        END;
    END LOOP;

    -- Return NULL if no costs were found, otherwise return total
    IF v_has_costs THEN
        RETURN v_total_cost;
    ELSE
        RETURN NULL;
    END IF;
END;
$$;

-- ============================================
-- SECTION 2: HELPER FUNCTIONS
-- ============================================

-- Update bomCost for a single SKU
CREATE OR REPLACE FUNCTION update_sku_bom_cost(p_sku_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_new_cost DOUBLE PRECISION;
BEGIN
    v_new_cost := calculate_sku_bom_cost(p_sku_id);

    UPDATE "Sku"
    SET "bomCost" = v_new_cost
    WHERE id = p_sku_id;
END;
$$;

-- Update bomCost for a variation (average of SKU costs)
CREATE OR REPLACE FUNCTION update_variation_bom_cost(p_variation_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_avg_cost DOUBLE PRECISION;
    v_sku_count INTEGER;
BEGIN
    SELECT AVG("bomCost"), COUNT("bomCost")
    INTO v_avg_cost, v_sku_count
    FROM "Sku"
    WHERE "variationId" = p_variation_id
      AND "isActive" = true
      AND "bomCost" IS NOT NULL;

    UPDATE "Variation"
    SET "bomCost" = CASE WHEN v_sku_count > 0 THEN v_avg_cost ELSE NULL END
    WHERE id = p_variation_id;
END;
$$;

-- Recalculate all SKUs for a variation, then update variation average
CREATE OR REPLACE FUNCTION recalculate_variation_and_skus(p_variation_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_sku_id TEXT;
BEGIN
    -- Recalculate each active SKU
    FOR v_sku_id IN
        SELECT id FROM "Sku"
        WHERE "variationId" = p_variation_id AND "isActive" = true
    LOOP
        PERFORM update_sku_bom_cost(v_sku_id);
    END LOOP;

    -- Update variation average
    PERFORM update_variation_bom_cost(p_variation_id);
END;
$$;

-- Recalculate all SKUs for a product (all variations), then update variation averages
CREATE OR REPLACE FUNCTION recalculate_product_bom_costs(p_product_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_variation_id TEXT;
BEGIN
    FOR v_variation_id IN
        SELECT id FROM "Variation"
        WHERE "productId" = p_product_id AND "isActive" = true
    LOOP
        PERFORM recalculate_variation_and_skus(v_variation_id);
    END LOOP;
END;
$$;

-- ============================================
-- SECTION 3: SKU BOM LINE TRIGGERS
-- ============================================

-- Trigger function for SkuBomLine changes (affects single SKU)
CREATE OR REPLACE FUNCTION trg_sku_bom_line_cost_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_sku_id TEXT;
    v_variation_id TEXT;
BEGIN
    -- Determine the affected SKU
    IF TG_OP = 'DELETE' THEN
        v_sku_id := OLD."skuId";
    ELSE
        v_sku_id := NEW."skuId";
    END IF;

    -- Get variation ID for updating average
    SELECT "variationId" INTO v_variation_id
    FROM "Sku"
    WHERE id = v_sku_id;

    -- Recalculate SKU cost
    PERFORM update_sku_bom_cost(v_sku_id);

    -- Update variation average
    IF v_variation_id IS NOT NULL THEN
        PERFORM update_variation_bom_cost(v_variation_id);
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- Drop existing triggers if any (for idempotency)
DROP TRIGGER IF EXISTS trg_sku_bom_line_cost_insert ON "SkuBomLine";
DROP TRIGGER IF EXISTS trg_sku_bom_line_cost_update ON "SkuBomLine";
DROP TRIGGER IF EXISTS trg_sku_bom_line_cost_delete ON "SkuBomLine";

-- Create triggers for SkuBomLine
CREATE TRIGGER trg_sku_bom_line_cost_insert
    AFTER INSERT ON "SkuBomLine"
    FOR EACH ROW
    EXECUTE FUNCTION trg_sku_bom_line_cost_fn();

CREATE TRIGGER trg_sku_bom_line_cost_update
    AFTER UPDATE ON "SkuBomLine"
    FOR EACH ROW
    EXECUTE FUNCTION trg_sku_bom_line_cost_fn();

CREATE TRIGGER trg_sku_bom_line_cost_delete
    AFTER DELETE ON "SkuBomLine"
    FOR EACH ROW
    EXECUTE FUNCTION trg_sku_bom_line_cost_fn();

-- ============================================
-- SECTION 4: VARIATION BOM LINE TRIGGERS
-- ============================================

-- Trigger function for VariationBomLine changes (affects all SKUs in variation)
CREATE OR REPLACE FUNCTION trg_variation_bom_line_cost_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_variation_id TEXT;
BEGIN
    -- Determine the affected variation
    IF TG_OP = 'DELETE' THEN
        v_variation_id := OLD."variationId";
    ELSE
        v_variation_id := NEW."variationId";
    END IF;

    -- Recalculate all SKUs in this variation + variation average
    PERFORM recalculate_variation_and_skus(v_variation_id);

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- Drop existing triggers if any (for idempotency)
DROP TRIGGER IF EXISTS trg_variation_bom_line_cost_insert ON "VariationBomLine";
DROP TRIGGER IF EXISTS trg_variation_bom_line_cost_update ON "VariationBomLine";
DROP TRIGGER IF EXISTS trg_variation_bom_line_cost_delete ON "VariationBomLine";

-- Create triggers for VariationBomLine
CREATE TRIGGER trg_variation_bom_line_cost_insert
    AFTER INSERT ON "VariationBomLine"
    FOR EACH ROW
    EXECUTE FUNCTION trg_variation_bom_line_cost_fn();

CREATE TRIGGER trg_variation_bom_line_cost_update
    AFTER UPDATE ON "VariationBomLine"
    FOR EACH ROW
    EXECUTE FUNCTION trg_variation_bom_line_cost_fn();

CREATE TRIGGER trg_variation_bom_line_cost_delete
    AFTER DELETE ON "VariationBomLine"
    FOR EACH ROW
    EXECUTE FUNCTION trg_variation_bom_line_cost_fn();

-- ============================================
-- SECTION 5: PRODUCT BOM TEMPLATE TRIGGERS
-- ============================================

-- Trigger function for ProductBomTemplate changes (affects all SKUs in product)
CREATE OR REPLACE FUNCTION trg_product_bom_template_cost_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_product_id TEXT;
BEGIN
    -- Determine the affected product
    IF TG_OP = 'DELETE' THEN
        v_product_id := OLD."productId";
    ELSE
        v_product_id := NEW."productId";
    END IF;

    -- Recalculate all SKUs in this product
    PERFORM recalculate_product_bom_costs(v_product_id);

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- Drop existing triggers if any (for idempotency)
DROP TRIGGER IF EXISTS trg_product_bom_template_cost_insert ON "ProductBomTemplate";
DROP TRIGGER IF EXISTS trg_product_bom_template_cost_update ON "ProductBomTemplate";
DROP TRIGGER IF EXISTS trg_product_bom_template_cost_delete ON "ProductBomTemplate";

-- Create triggers for ProductBomTemplate
CREATE TRIGGER trg_product_bom_template_cost_insert
    AFTER INSERT ON "ProductBomTemplate"
    FOR EACH ROW
    EXECUTE FUNCTION trg_product_bom_template_cost_fn();

CREATE TRIGGER trg_product_bom_template_cost_update
    AFTER UPDATE ON "ProductBomTemplate"
    FOR EACH ROW
    EXECUTE FUNCTION trg_product_bom_template_cost_fn();

CREATE TRIGGER trg_product_bom_template_cost_delete
    AFTER DELETE ON "ProductBomTemplate"
    FOR EACH ROW
    EXECUTE FUNCTION trg_product_bom_template_cost_fn();

-- ============================================
-- SECTION 6: CATALOG COST TRIGGERS
-- ============================================

-- 6a: FabricColour.costPerUnit changes
CREATE OR REPLACE FUNCTION trg_fabric_colour_cost_change_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only trigger on actual cost change
    IF OLD."costPerUnit" IS DISTINCT FROM NEW."costPerUnit" THEN
        -- Batch update all affected SKUs via VariationBomLine and SkuBomLine
        -- Using a single UPDATE statement for efficiency
        WITH affected_skus AS (
            -- SKUs with direct SkuBomLine reference to this FabricColour
            SELECT DISTINCT sbl."skuId" as sku_id
            FROM "SkuBomLine" sbl
            WHERE sbl."fabricColourId" = NEW.id
            UNION
            -- SKUs whose variation has a VariationBomLine reference (and no SKU override)
            SELECT DISTINCT s.id as sku_id
            FROM "Sku" s
            JOIN "VariationBomLine" vbl ON vbl."variationId" = s."variationId"
            WHERE vbl."fabricColourId" = NEW.id
              AND NOT EXISTS (
                  SELECT 1 FROM "SkuBomLine" sbl
                  WHERE sbl."skuId" = s.id
                    AND sbl."roleId" = vbl."roleId"
                    AND sbl."fabricColourId" IS NOT NULL
              )
        ),
        updated_skus AS (
            SELECT sku_id, calculate_sku_bom_cost(sku_id) as new_cost
            FROM affected_skus
        )
        UPDATE "Sku" s
        SET "bomCost" = us.new_cost
        FROM updated_skus us
        WHERE s.id = us.sku_id;

        -- Update affected variations' averages
        WITH affected_variations AS (
            SELECT DISTINCT v.id as variation_id
            FROM "Variation" v
            WHERE EXISTS (
                SELECT 1 FROM "VariationBomLine" vbl
                WHERE vbl."variationId" = v.id
                  AND vbl."fabricColourId" = NEW.id
            )
            OR EXISTS (
                SELECT 1 FROM "Sku" s
                JOIN "SkuBomLine" sbl ON sbl."skuId" = s.id
                WHERE s."variationId" = v.id
                  AND sbl."fabricColourId" = NEW.id
            )
        )
        UPDATE "Variation" v
        SET "bomCost" = (
            SELECT CASE WHEN COUNT(s."bomCost") > 0 THEN AVG(s."bomCost") ELSE NULL END
            FROM "Sku" s
            WHERE s."variationId" = v.id
              AND s."isActive" = true
              AND s."bomCost" IS NOT NULL
        )
        FROM affected_variations av
        WHERE v.id = av.variation_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fabric_colour_cost_change ON "FabricColour";

CREATE TRIGGER trg_fabric_colour_cost_change
    AFTER UPDATE ON "FabricColour"
    FOR EACH ROW
    EXECUTE FUNCTION trg_fabric_colour_cost_change_fn();

-- 6b: Fabric.costPerUnit changes (affects FabricColours that inherit)
CREATE OR REPLACE FUNCTION trg_fabric_cost_change_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only trigger on actual cost change
    IF OLD."costPerUnit" IS DISTINCT FROM NEW."costPerUnit" THEN
        -- Find all FabricColours that inherit from this Fabric (costPerUnit IS NULL)
        -- and recalculate affected SKUs
        WITH inheriting_colours AS (
            SELECT id FROM "FabricColour"
            WHERE "fabricId" = NEW.id
              AND "costPerUnit" IS NULL
        ),
        affected_skus AS (
            SELECT DISTINCT sbl."skuId" as sku_id
            FROM "SkuBomLine" sbl
            WHERE sbl."fabricColourId" IN (SELECT id FROM inheriting_colours)
            UNION
            SELECT DISTINCT s.id as sku_id
            FROM "Sku" s
            JOIN "VariationBomLine" vbl ON vbl."variationId" = s."variationId"
            WHERE vbl."fabricColourId" IN (SELECT id FROM inheriting_colours)
              AND NOT EXISTS (
                  SELECT 1 FROM "SkuBomLine" sbl
                  WHERE sbl."skuId" = s.id
                    AND sbl."roleId" = vbl."roleId"
                    AND sbl."fabricColourId" IS NOT NULL
              )
        ),
        updated_skus AS (
            SELECT sku_id, calculate_sku_bom_cost(sku_id) as new_cost
            FROM affected_skus
        )
        UPDATE "Sku" s
        SET "bomCost" = us.new_cost
        FROM updated_skus us
        WHERE s.id = us.sku_id;

        -- Update affected variations' averages
        WITH inheriting_colours AS (
            SELECT id FROM "FabricColour"
            WHERE "fabricId" = NEW.id
              AND "costPerUnit" IS NULL
        ),
        affected_variations AS (
            SELECT DISTINCT v.id as variation_id
            FROM "Variation" v
            WHERE EXISTS (
                SELECT 1 FROM "VariationBomLine" vbl
                WHERE vbl."variationId" = v.id
                  AND vbl."fabricColourId" IN (SELECT id FROM inheriting_colours)
            )
            OR EXISTS (
                SELECT 1 FROM "Sku" s
                JOIN "SkuBomLine" sbl ON sbl."skuId" = s.id
                WHERE s."variationId" = v.id
                  AND sbl."fabricColourId" IN (SELECT id FROM inheriting_colours)
            )
        )
        UPDATE "Variation" v
        SET "bomCost" = (
            SELECT CASE WHEN COUNT(s."bomCost") > 0 THEN AVG(s."bomCost") ELSE NULL END
            FROM "Sku" s
            WHERE s."variationId" = v.id
              AND s."isActive" = true
              AND s."bomCost" IS NOT NULL
        )
        FROM affected_variations av
        WHERE v.id = av.variation_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fabric_cost_change ON "Fabric";

CREATE TRIGGER trg_fabric_cost_change
    AFTER UPDATE ON "Fabric"
    FOR EACH ROW
    EXECUTE FUNCTION trg_fabric_cost_change_fn();

-- 6c: TrimItem.costPerUnit changes
CREATE OR REPLACE FUNCTION trg_trim_item_cost_change_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."costPerUnit" IS DISTINCT FROM NEW."costPerUnit" THEN
        -- Batch update all affected SKUs
        WITH affected_skus AS (
            -- SKUs with direct SkuBomLine reference
            SELECT DISTINCT sbl."skuId" as sku_id
            FROM "SkuBomLine" sbl
            WHERE sbl."trimItemId" = NEW.id
            UNION
            -- SKUs whose variation has a VariationBomLine reference (and no SKU override)
            SELECT DISTINCT s.id as sku_id
            FROM "Sku" s
            JOIN "VariationBomLine" vbl ON vbl."variationId" = s."variationId"
            WHERE vbl."trimItemId" = NEW.id
              AND NOT EXISTS (
                  SELECT 1 FROM "SkuBomLine" sbl
                  WHERE sbl."skuId" = s.id
                    AND sbl."roleId" = vbl."roleId"
                    AND sbl."trimItemId" IS NOT NULL
              )
            UNION
            -- SKUs whose product template has this trim (and no variation/SKU override)
            SELECT DISTINCT s.id as sku_id
            FROM "Sku" s
            JOIN "Variation" v ON s."variationId" = v.id
            JOIN "ProductBomTemplate" pbt ON pbt."productId" = v."productId"
            WHERE pbt."trimItemId" = NEW.id
              AND NOT EXISTS (
                  SELECT 1 FROM "VariationBomLine" vbl
                  WHERE vbl."variationId" = v.id
                    AND vbl."roleId" = pbt."roleId"
                    AND vbl."trimItemId" IS NOT NULL
              )
              AND NOT EXISTS (
                  SELECT 1 FROM "SkuBomLine" sbl
                  WHERE sbl."skuId" = s.id
                    AND sbl."roleId" = pbt."roleId"
                    AND sbl."trimItemId" IS NOT NULL
              )
        ),
        updated_skus AS (
            SELECT sku_id, calculate_sku_bom_cost(sku_id) as new_cost
            FROM affected_skus
        )
        UPDATE "Sku" s
        SET "bomCost" = us.new_cost
        FROM updated_skus us
        WHERE s.id = us.sku_id;

        -- Update affected variations' averages
        WITH affected_variations AS (
            SELECT DISTINCT v.id as variation_id
            FROM "Variation" v
            WHERE EXISTS (
                SELECT 1 FROM "VariationBomLine" vbl
                WHERE vbl."variationId" = v.id AND vbl."trimItemId" = NEW.id
            )
            OR EXISTS (
                SELECT 1 FROM "ProductBomTemplate" pbt
                WHERE pbt."productId" = v."productId" AND pbt."trimItemId" = NEW.id
            )
            OR EXISTS (
                SELECT 1 FROM "Sku" s
                JOIN "SkuBomLine" sbl ON sbl."skuId" = s.id
                WHERE s."variationId" = v.id AND sbl."trimItemId" = NEW.id
            )
        )
        UPDATE "Variation" v
        SET "bomCost" = (
            SELECT CASE WHEN COUNT(s."bomCost") > 0 THEN AVG(s."bomCost") ELSE NULL END
            FROM "Sku" s
            WHERE s."variationId" = v.id
              AND s."isActive" = true
              AND s."bomCost" IS NOT NULL
        )
        FROM affected_variations av
        WHERE v.id = av.variation_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trim_item_cost_change ON "TrimItem";

CREATE TRIGGER trg_trim_item_cost_change
    AFTER UPDATE ON "TrimItem"
    FOR EACH ROW
    EXECUTE FUNCTION trg_trim_item_cost_change_fn();

-- 6d: ServiceItem.costPerJob changes
CREATE OR REPLACE FUNCTION trg_service_item_cost_change_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."costPerJob" IS DISTINCT FROM NEW."costPerJob" THEN
        -- Batch update all affected SKUs
        WITH affected_skus AS (
            -- SKUs with direct SkuBomLine reference
            SELECT DISTINCT sbl."skuId" as sku_id
            FROM "SkuBomLine" sbl
            WHERE sbl."serviceItemId" = NEW.id
            UNION
            -- SKUs whose variation has a VariationBomLine reference (and no SKU override)
            SELECT DISTINCT s.id as sku_id
            FROM "Sku" s
            JOIN "VariationBomLine" vbl ON vbl."variationId" = s."variationId"
            WHERE vbl."serviceItemId" = NEW.id
              AND NOT EXISTS (
                  SELECT 1 FROM "SkuBomLine" sbl
                  WHERE sbl."skuId" = s.id
                    AND sbl."roleId" = vbl."roleId"
                    AND sbl."serviceItemId" IS NOT NULL
              )
            UNION
            -- SKUs whose product template has this service (and no variation/SKU override)
            SELECT DISTINCT s.id as sku_id
            FROM "Sku" s
            JOIN "Variation" v ON s."variationId" = v.id
            JOIN "ProductBomTemplate" pbt ON pbt."productId" = v."productId"
            WHERE pbt."serviceItemId" = NEW.id
              AND NOT EXISTS (
                  SELECT 1 FROM "VariationBomLine" vbl
                  WHERE vbl."variationId" = v.id
                    AND vbl."roleId" = pbt."roleId"
                    AND vbl."serviceItemId" IS NOT NULL
              )
              AND NOT EXISTS (
                  SELECT 1 FROM "SkuBomLine" sbl
                  WHERE sbl."skuId" = s.id
                    AND sbl."roleId" = pbt."roleId"
                    AND sbl."serviceItemId" IS NOT NULL
              )
        ),
        updated_skus AS (
            SELECT sku_id, calculate_sku_bom_cost(sku_id) as new_cost
            FROM affected_skus
        )
        UPDATE "Sku" s
        SET "bomCost" = us.new_cost
        FROM updated_skus us
        WHERE s.id = us.sku_id;

        -- Update affected variations' averages
        WITH affected_variations AS (
            SELECT DISTINCT v.id as variation_id
            FROM "Variation" v
            WHERE EXISTS (
                SELECT 1 FROM "VariationBomLine" vbl
                WHERE vbl."variationId" = v.id AND vbl."serviceItemId" = NEW.id
            )
            OR EXISTS (
                SELECT 1 FROM "ProductBomTemplate" pbt
                WHERE pbt."productId" = v."productId" AND pbt."serviceItemId" = NEW.id
            )
            OR EXISTS (
                SELECT 1 FROM "Sku" s
                JOIN "SkuBomLine" sbl ON sbl."skuId" = s.id
                WHERE s."variationId" = v.id AND sbl."serviceItemId" = NEW.id
            )
        )
        UPDATE "Variation" v
        SET "bomCost" = (
            SELECT CASE WHEN COUNT(s."bomCost") > 0 THEN AVG(s."bomCost") ELSE NULL END
            FROM "Sku" s
            WHERE s."variationId" = v.id
              AND s."isActive" = true
              AND s."bomCost" IS NOT NULL
        )
        FROM affected_variations av
        WHERE v.id = av.variation_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_item_cost_change ON "ServiceItem";

CREATE TRIGGER trg_service_item_cost_change
    AFTER UPDATE ON "ServiceItem"
    FOR EACH ROW
    EXECUTE FUNCTION trg_service_item_cost_change_fn();

-- ============================================
-- SECTION 7: GUARD TRIGGERS
-- ============================================

-- Guard trigger for Sku.bomCost (prevent direct modification)
CREATE OR REPLACE FUNCTION guard_sku_bom_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Allow changes if we're inside a nested trigger (from BOM line triggers)
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    -- Block direct changes to bomCost
    IF OLD."bomCost" IS DISTINCT FROM NEW."bomCost" THEN
        RAISE EXCEPTION 'Direct modification of Sku.bomCost is not allowed. Modify BOM lines or catalog costs instead.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_sku_bom_cost ON "Sku";

CREATE TRIGGER trg_guard_sku_bom_cost
    BEFORE UPDATE ON "Sku"
    FOR EACH ROW
    EXECUTE FUNCTION guard_sku_bom_cost();

-- Guard trigger for Variation.bomCost (prevent direct modification)
CREATE OR REPLACE FUNCTION guard_variation_bom_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Allow changes if we're inside a nested trigger
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    -- Block direct changes to bomCost
    IF OLD."bomCost" IS DISTINCT FROM NEW."bomCost" THEN
        RAISE EXCEPTION 'Direct modification of Variation.bomCost is not allowed. Modify BOM lines or catalog costs instead.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_variation_bom_cost ON "Variation";

CREATE TRIGGER trg_guard_variation_bom_cost
    BEFORE UPDATE ON "Variation"
    FOR EACH ROW
    EXECUTE FUNCTION guard_variation_bom_cost();

-- ============================================
-- SECTION 8: PERFORMANCE INDEXES
-- ============================================

-- Indexes for efficient BOM lookups during cost calculation
CREATE INDEX IF NOT EXISTS idx_vbl_fabric_colour ON "VariationBomLine"("fabricColourId");
CREATE INDEX IF NOT EXISTS idx_sbl_fabric_colour ON "SkuBomLine"("fabricColourId");
CREATE INDEX IF NOT EXISTS idx_vbl_trim ON "VariationBomLine"("trimItemId");
CREATE INDEX IF NOT EXISTS idx_sbl_trim ON "SkuBomLine"("trimItemId");
CREATE INDEX IF NOT EXISTS idx_pbt_trim ON "ProductBomTemplate"("trimItemId");
CREATE INDEX IF NOT EXISTS idx_vbl_service ON "VariationBomLine"("serviceItemId");
CREATE INDEX IF NOT EXISTS idx_sbl_service ON "SkuBomLine"("serviceItemId");
CREATE INDEX IF NOT EXISTS idx_pbt_service ON "ProductBomTemplate"("serviceItemId");

-- Index for quick SKU lookup by variation (used in variation average calculation)
CREATE INDEX IF NOT EXISTS idx_sku_variation_active_cost ON "Sku"("variationId", "isActive") WHERE "bomCost" IS NOT NULL;

-- ============================================
-- SECTION 9: NO BACKFILL NEEDED
-- ============================================
-- Existing data was already backfilled by running recalculate-bom-costs.ts
-- New data will be automatically calculated by triggers
