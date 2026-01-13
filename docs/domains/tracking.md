# Tracking Domain

> Shipment tracking via iThink Logistics API with status mapping.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/tracking.ts` |
| Key Files | `services/ithinkLogistics.ts`, `services/trackingSync.ts` |
| Related | Orders (trackingStatus), Returns (RTO detection), Customers (tier) |

## Status Mapping

| iThink Code | Internal Status |
|-------------|-----------------|
| `6` / delivered | `delivered` |
| `7` / rto_* | `rto_initiated`, `rto_in_transit`, `rto_delivered` |
| `36` / cancelled | `cancelled` |
| `11` / lost | `lost` |
| Other codes | `in_transit`, `out_for_delivery`, `manifested` |

**RTO Detection**: `return_tracking_no` field presence triggers RTO status.

## Background Sync

- Runs every 30 minutes (configurable via `trackingSync` service)
- Updates shipped/delivered orders with latest tracking status
- Triggers customer tier recalculation on delivery or RTO

## Order Fields Updated

`trackingStatus`, `courierStatusCode`, `courier`, `deliveryAttempts`, `lastTrackingUpdate`, `expectedDeliveryDate`, `lastScanStatus`, `lastScanLocation`, `lastScanAt`, `deliveredAt`, `rtoInitiatedAt`

## Key Endpoints

| Path | Purpose |
|------|---------|
| `GET /awb/:awbNumber` | Track single AWB with full details |
| `POST /batch` | Track multiple AWBs (max 10) |
| `POST /orders` | Track by order UUIDs (batch lookup) |
| `GET /history/:awbNumber` | Full scan history timeline |
| `GET /sync/status` | Background sync status |
| `POST /sync/trigger` | Trigger manual sync |
| `POST /sync/backfill` | One-time backfill for old orders |
| `POST /create-shipment` | Book shipment, get AWB |
| `POST /cancel-shipment` | Cancel shipment by AWB or orderId |
| `POST /label` | Get shipping label PDF URL |
| `GET /pincode/:pincode` | Check serviceability |
| `POST /rates` | Get shipping rate quotes |
| `GET/PUT /config` | iThink credentials (stored in SystemSetting) |
| `POST /test-connection` | Validate API credentials |

## Cross-Domain

- **Orders**: Updates trackingStatus, triggers RTO view visibility
- **Customers**: Delivery/RTO triggers tier recalculation via `updateCustomerTier()`
- **Returns**: RTO status makes orders appear in RTO queue

## Gotchas

1. **Batch limit**: Max 10 AWBs per iThink API request
2. **RTO detection**: `return_tracking_no` field presence = RTO initiated
3. **Credentials in DB**: iThink config in `SystemSetting`, not env vars
4. **Rate limiting**: Backfill uses 1s delay between batches
5. **COD amount**: Uses active order lines value (excludes cancelled lines)
6. **Tier update on RTO**: Only COD RTOs affect customer risk; prepaid RTOs refunded
