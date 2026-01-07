# Tracking Domain

Shipment tracking via iThink Logistics.

## Key Files

| File | Size | Purpose |
|------|------|---------|
| `tracking.js` | 16KB | Tracking endpoints (438 lines) |
| `../services/ithinkLogistics.js` | 10KB | iThink API client |
| `../services/trackingSync.js` | 14KB | Background sync for updates |

## Architecture

```
Order (with AWB)
      ↓
┌──────────────────┐     ┌─────────────────┐
│ Manual Request   │────→│ iThink API      │
│ (on-demand)      │     │ (trackShipments)│
└──────────────────┘     └─────────────────┘
                                 ↑
┌──────────────────┐     ┌─────────────────┐
│ Background Sync  │────→│ Update Order    │
│ (every 4 hours)  │     │ tracking fields │
└──────────────────┘     └─────────────────┘
```

## Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/config` | Get iThink configuration |
| PUT | `/config` | Update credentials |
| POST | `/test-connection` | Verify API access |
| GET | `/awb/:awbNumber` | Track single AWB |
| POST | `/batch` | Track multiple AWBs (max 10) |
| POST | `/orders` | Track orders by order IDs |
| GET | `/history/:awbNumber` | Full scan history |
| GET | `/sync/status` | Background sync status |
| POST | `/sync/run` | Trigger manual sync |

## iThink API Client

`services/ithinkLogistics.js`:

```javascript
ithinkLogistics.loadFromDatabase()     // Load credentials
ithinkLogistics.isConfigured()          // Check if ready
ithinkLogistics.getTrackingStatus(awb)  // Single AWB
ithinkLogistics.trackShipments([awbs])  // Batch (max 10)
ithinkLogistics.mapToInternalStatus(code, statusText)  // Status mapping
```

## Tracking Response Structure

```javascript
{
    success: true,
    awbNumber: "AWB123",
    status: "In Transit",
    statusCode: "IT",
    currentLocation: "Mumbai Hub",
    isDelivered: false,
    isRto: false,
    expectedDelivery: "2026-01-10",
    lastScan: {
        location: "Mumbai Hub",
        datetime: "2026-01-07 10:30:00",
        remark: "Shipment in transit"
    },
    scans: [...]  // Full history
}
```

## Status Mapping

iThink statuses are mapped to internal tracking statuses:

| iThink Code | Display Status | Internal Status |
|-------------|----------------|-----------------|
| `DL` | Delivered | `delivered` |
| `IT`, `OT` | In Transit | `in_transit` |
| `PP` | Pending Pickup | `manifested` |
| `RTO` initiated/in transit | RTO In Transit | `rto_in_transit` |
| `RTO` delivered | RTO Delivered | `rto_delivered` |
| `UD` | Undelivered Attempt | `undelivered` |

**Note**: `rto_initiated` is consolidated into `rto_in_transit` for simpler status display.

## Background Sync (trackingSync.js)

Runs every 4 hours and syncs orders with these tracking statuses:
- `in_transit`, `out_for_delivery`, `delivery_delayed`
- `rto_in_transit`, `rto_delivered` (re-evaluates)
- `manifested`, `picked_up`, `reached_destination`
- `undelivered`, `not_picked`
- `delivered` (re-evaluates to catch RTO misclassification)

**Key Improvement**: Now re-evaluates `delivered` and `rto_delivered` orders to catch cases where iThink updates status after initial delivery scan.

### RTO Status Handling

```javascript
// Smart RTO detection using last scan status
const lastScanStatus = rawData.last_scan_details?.status || '';
const isRto = !!rawData.return_tracking_no || 
              lastScanStatus.toLowerCase().includes('rto');

// Sets rtoInitiatedAt on first RTO detection
// Sets rtoReceivedAt when rto_delivered
```

## Order Tracking Fields

Orders have tracking fields updated by sync:

```
Order
  - awbNumber (set on ship)
  - trackingStatus (in_transit, delivered, rto_in_transit, etc.)
  - lastScanLocation
  - lastScanAt
  - lastScanStatus
  - lastTrackingUpdate
  - deliveryAttempts
  - expectedDeliveryDate
  - isRto (return to origin flag)
  - rtoInitiatedAt
  - rtoReceivedAt
  - courierStatusCode (raw code from iThink)
```

## Configuration

Credentials in `SystemSetting` table:
- `ithink_access_token`
- `ithink_secret_key`

## Batch Tracking

For multiple AWBs:

```javascript
// POST /batch
{ awbNumbers: ["AWB1", "AWB2", ...] }  // Max 10

// Response
{
    "AWB1": { success: true, status: "Delivered", ... },
    "AWB2": { success: true, status: "In Transit", ... }
}
```

## Track by Order IDs

For orders (looks up AWB automatically):

```javascript
// POST /orders
{ orderIds: ["uuid1", "uuid2"] }

// Looks up AWB from Order, then tracks
```

## Dependencies

- **Orders**: Updates tracking fields on shipped orders
- **SystemSetting**: Stores API credentials

## Common Gotchas

1. **Batch limit**: Max 10 AWBs per request to iThink
2. **Credentials in DB**: Not env vars — configure via Settings
3. **RTO detection**: Uses `last_scan_details.status` for more accurate RTO detection
4. **Sync only non-final**: Background sync now includes `delivered` for re-evaluation
5. **Manual sync available**: POST `/sync/run` triggers immediate sync
6. **Tracking not blocking**: Failure doesn't affect order workflow
7. **Status mapping**: Uses both status code AND status text for smarter mapping

## Related Frontend

- `components/orders/TrackingModal.tsx` (23KB) — Tracking popup with scan history
- Order grids display `trackingStatus`, `lastScanLocation`
