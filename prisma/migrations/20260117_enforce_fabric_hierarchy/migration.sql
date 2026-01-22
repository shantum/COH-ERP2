-- Enforce hierarchical consistency between Variation.fabricId and VariationBomLine.fabricColourId
-- Rule: If a BOM line links to a FabricColour, the variation's fabricId MUST match the colour's parent fabricId

-- Function to validate fabric hierarchy on BOM line changes
CREATE OR REPLACE FUNCTION check_variation_bom_fabric_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
    variation_fabric_id TEXT;
    colour_fabric_id TEXT;
BEGIN
    -- Only check if fabricColourId is being set
    IF NEW."fabricColourId" IS NULL THEN
        RETURN NEW;
    END IF;

    -- Get the variation's current fabricId
    SELECT "fabricId" INTO variation_fabric_id
    FROM "Variation"
    WHERE id = NEW."variationId";

    -- Get the fabric colour's parent fabricId
    SELECT "fabricId" INTO colour_fabric_id
    FROM "FabricColour"
    WHERE id = NEW."fabricColourId";

    -- Check consistency
    IF variation_fabric_id IS DISTINCT FROM colour_fabric_id THEN
        RAISE EXCEPTION 'Fabric hierarchy violation: Variation.fabricId (%) does not match FabricColour.fabricId (%). Update the variation''s fabricId first or use the link-variations endpoint.',
            variation_fabric_id, colour_fabric_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to validate fabric hierarchy on Variation.fabricId changes
CREATE OR REPLACE FUNCTION check_variation_fabric_hierarchy_on_update()
RETURNS TRIGGER AS $$
DECLARE
    bom_colour_fabric_id TEXT;
    main_fabric_role_id TEXT;
BEGIN
    -- Only check if fabricId is being changed
    IF OLD."fabricId" = NEW."fabricId" THEN
        RETURN NEW;
    END IF;

    -- Get the main fabric role ID
    SELECT cr.id INTO main_fabric_role_id
    FROM "ComponentRole" cr
    JOIN "ComponentType" ct ON cr."typeId" = ct.id
    WHERE cr.code = 'main' AND ct.code = 'FABRIC';

    -- Check if there's a BOM line with a fabric colour that doesn't match the new fabricId
    SELECT fc."fabricId" INTO bom_colour_fabric_id
    FROM "VariationBomLine" vbl
    JOIN "FabricColour" fc ON vbl."fabricColourId" = fc.id
    WHERE vbl."variationId" = NEW.id
      AND vbl."roleId" = main_fabric_role_id
      AND fc."fabricId" IS DISTINCT FROM NEW."fabricId"
    LIMIT 1;

    IF bom_colour_fabric_id IS NOT NULL THEN
        RAISE EXCEPTION 'Fabric hierarchy violation: Cannot change Variation.fabricId to (%) because BOM line references a FabricColour with fabricId (%). Update or remove the BOM line first.',
            NEW."fabricId", bom_colour_fabric_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on VariationBomLine INSERT/UPDATE
DROP TRIGGER IF EXISTS trg_check_variation_bom_fabric_hierarchy ON "VariationBomLine";
CREATE TRIGGER trg_check_variation_bom_fabric_hierarchy
    BEFORE INSERT OR UPDATE OF "fabricColourId"
    ON "VariationBomLine"
    FOR EACH ROW
    EXECUTE FUNCTION check_variation_bom_fabric_hierarchy();

-- Create trigger on Variation UPDATE
DROP TRIGGER IF EXISTS trg_check_variation_fabric_hierarchy ON "Variation";
CREATE TRIGGER trg_check_variation_fabric_hierarchy
    BEFORE UPDATE OF "fabricId"
    ON "Variation"
    FOR EACH ROW
    EXECUTE FUNCTION check_variation_fabric_hierarchy_on_update();

-- Add comment explaining the constraint
COMMENT ON FUNCTION check_variation_bom_fabric_hierarchy() IS
'Enforces hierarchical consistency: If VariationBomLine.fabricColourId is set, Variation.fabricId must match FabricColour.fabricId';

COMMENT ON FUNCTION check_variation_fabric_hierarchy_on_update() IS
'Enforces hierarchical consistency: Prevents changing Variation.fabricId if it would break consistency with existing BOM lines';
