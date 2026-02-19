-- Finance pulse triggers (reuses existing notify_table_change function)

-- BankTransaction — bank import worker creates these in background
CREATE TRIGGER trg_banktransaction_pulse
    AFTER INSERT OR UPDATE OR DELETE ON "BankTransaction"
    FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Payment — auto-post creates these from bank import
CREATE TRIGGER trg_payment_pulse
    AFTER INSERT OR UPDATE OR DELETE ON "Payment"
    FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Invoice — confirms, cancels, linked payments
CREATE TRIGGER trg_invoice_pulse
    AFTER INSERT OR UPDATE OR DELETE ON "Invoice"
    FOR EACH ROW EXECUTE FUNCTION notify_table_change();
