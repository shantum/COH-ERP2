-- Pulse notification function
-- Sends lightweight signals to 'coh_erp_pulse' channel on table changes
CREATE OR REPLACE FUNCTION notify_table_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'coh_erp_pulse',
        json_build_object(
            'table', TG_TABLE_NAME,
            'op', TG_OP,
            'id', COALESCE(NEW.id, OLD.id)
        )::text
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Order triggers
CREATE TRIGGER trg_order_pulse
    AFTER INSERT OR UPDATE OR DELETE ON "Order"
    FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- OrderLine triggers
CREATE TRIGGER trg_orderline_pulse
    AFTER INSERT OR UPDATE OR DELETE ON "OrderLine"
    FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Material triggers
CREATE TRIGGER trg_material_pulse
    AFTER INSERT OR UPDATE OR DELETE ON "Material"
    FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Fabric triggers
CREATE TRIGGER trg_fabric_pulse
    AFTER INSERT OR UPDATE OR DELETE ON "Fabric"
    FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- FabricColour triggers
CREATE TRIGGER trg_fabriccolour_pulse
    AFTER INSERT OR UPDATE OR DELETE ON "FabricColour"
    FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- InventoryTransaction triggers (INSERT only - high volume table)
CREATE TRIGGER trg_inventorytxn_pulse
    AFTER INSERT ON "InventoryTransaction"
    FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Product triggers
CREATE TRIGGER trg_product_pulse
    AFTER INSERT OR UPDATE OR DELETE ON "Product"
    FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Variation triggers
CREATE TRIGGER trg_variation_pulse
    AFTER INSERT OR UPDATE OR DELETE ON "Variation"
    FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Sku triggers
CREATE TRIGGER trg_sku_pulse
    AFTER INSERT OR UPDATE OR DELETE ON "Sku"
    FOR EACH ROW EXECUTE FUNCTION notify_table_change();
