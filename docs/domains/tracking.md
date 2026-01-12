# Tracking Domain

> Shipment tracking via iThink Logistics API with status mapping.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/tracking.ts` |
| Key Files | `services/ithinkLogistics.ts` |
| Related | Orders (trackingStatus), Returns (RTO detection) |
| Docs | `docs/ITHINK_LOGISTICS_API.md` (detailed integration) |

## Status Mapping

| iThink Code | Internal Status |
|-------------|-----------------|
| `DL` | `delivered` |
| `IT`, `OT` | `in_transit` |
| `PP` | `manifested` |
| RTO initiated/transit | `rto_in_transit` |
| RTO delivered | `rto_delivered` |

## Background Sync

- Runs every 4 hours
- Re-evaluates `delivered` orders to catch RTO misclassification
- Triggers customer tier recalculation on delivery

## Order Fields Updated

`awbNumber`, `trackingStatus`, `lastScanLocation`, `lastScanAt`, `isRto`, `rtoInitiatedAt`, `rtoReceivedAt`

## Key Endpoints

| Path | Purpose |
|------|---------|
| `GET /awb/:awb` | Track single AWB |
| `POST /batch` | Track multiple AWBs (max 10) |
| `POST /sync/run` | Trigger manual sync |

## Cross-Domain

- **→ Orders**: Updates trackingStatus, triggers RTO view visibility
- **→ Customers**: Delivery triggers tier recalculation
- **→ Returns**: RTO status makes orders appear in RTO queue

## Gotchas

1. **Batch limit**: Max 10 AWBs per iThink request
2. **RTO re-evaluation**: Delivered orders checked again for late RTO classification
3. **Credentials in DB**: iThink config in `SystemSetting`, not env vars
