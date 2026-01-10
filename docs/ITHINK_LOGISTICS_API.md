# iThink Logistics API Integration

Integration with iThink Logistics for shipment booking, tracking, and label generation.

## Configuration

Credentials are stored in `SystemSetting` table:
- `ithink_access_token` - API access token
- `ithink_secret_key` - API secret key
- `ithink_pickup_address_id` - Warehouse pickup address ID
- `ithink_return_address_id` - Return address ID
- `ithink_default_logistics` - Default courier (delhivery, bluedart, xpressbees, etc.)

Configure via Settings > General tab or API:
```bash
PUT /api/tracking/config
{
  "accessToken": "...",
  "secretKey": "...",
  "pickupAddressId": "54443",
  "returnAddressId": "54443",
  "defaultLogistics": "delhivery"
}
```

---

## API Endpoints

### Create Shipment
Book a shipment with iThink and get AWB number.

```
POST /api/tracking/create-shipment
```

**Request:**
```json
{
  "orderId": "uuid",
  "logistics": "delhivery"  // optional, uses default
}
```

**Response:**
```json
{
  "success": true,
  "message": "Shipment created successfully",
  "awbNumber": "21025852767421",
  "logistics": "delhivery",
  "orderId": "ITL123456"
}
```

**Notes:**
- Requires order to have customer address info (from Shopify cache or customer record)
- Automatically detects COD vs Prepaid from order payment status
- Updates order with AWB number and sets `trackingStatus: 'manifested'`

---

### Cancel Shipment
Cancel a booked shipment by AWB number.

```
POST /api/tracking/cancel-shipment
```

**Request (3 options):**
```json
// Option 1: Single AWB
{ "awbNumber": "21025852767421" }

// Option 2: Multiple AWBs (max 100)
{ "awbNumbers": ["AWB1", "AWB2", "AWB3"] }

// Option 3: By order ID
{ "orderId": "uuid" }
```

**Response:**
```json
{
  "success": true,
  "message": "Cancellation request processed",
  "results": {
    "21025852767421": {
      "success": true,
      "status": "success",
      "remark": "Cancel Request Received"
    }
  }
}
```

---

### Get Shipping Rates
Compare rates across logistics providers.

```
POST /api/tracking/rates
```

**Request:**
```json
{
  "fromPincode": "400092",
  "toPincode": "400061",
  "length": 22,           // cm, optional (default: 10)
  "width": 12,            // cm, optional (default: 10)
  "height": 12,           // cm, optional (default: 5)
  "weight": 2,            // kg, optional (default: 0.5)
  "orderType": "forward", // optional (forward/reverse)
  "paymentMethod": "cod", // optional (cod/prepaid)
  "productMrp": 1200      // optional, for COD
}
```

**Response:**
```json
{
  "success": true,
  "zone": "A",
  "expectedDelivery": "1 to 2 Days",
  "rates": [
    {
      "logistics": "DTDC",
      "serviceType": "14",
      "rate": 109.74,
      "zone": "A",
      "deliveryTat": "2",
      "supportsCod": true,
      "supportsPrepaid": true,
      "supportsPickup": true,
      "supportsReversePickup": true
    },
    {
      "logistics": "Xpressbees",
      "rate": 123.90,
      "deliveryTat": "1",
      ...
    }
  ]
}
```

**Notes:**
- Rates are sorted by price (lowest first)
- Includes all available couriers with their capabilities

---

### Check Pincode Serviceability
Check which couriers can service a pincode.

```
GET /api/tracking/pincode/:pincode
```

**Response:**
```json
{
  "success": true,
  "pincode": "400067",
  "serviceable": true,
  "city": "MUMBAI",
  "state": "maharashtra",
  "providers": [
    {
      "logistics": "Delhivery",
      "supportsCod": true,
      "supportsPrepaid": true,
      "supportsPickup": true,
      "district": "MH",
      "stateCode": "MH",
      "sortCode": "MUM/MIE"
    },
    {
      "logistics": "DTDC",
      "supportsCod": true,
      "supportsPrepaid": true,
      "supportsPickup": true
    }
  ]
}
```

---

### Get Shipping Label
Generate PDF shipping label for AWB(s).

```
POST /api/tracking/label
```

**Request:**
```json
{
  // One of these required:
  "awbNumber": "21025852654253",
  // OR
  "awbNumbers": ["AWB1", "AWB2"],
  // OR
  "orderId": "uuid",

  // Optional settings:
  "pageSize": "A4",              // A4 or A6 (default: A4)
  "displayCodPrepaid": true,     // Show COD/Prepaid on label
  "displayShipperMobile": true,  // Show shipper phone
  "displayShipperAddress": true  // Show shipper address
}
```

**Response:**
```json
{
  "success": true,
  "labelUrl": "https://itl-uploads.s3.ap-south-1.amazonaws.com/uploads/shipping/abc123.pdf"
}
```

---

### Track AWB
Get real-time tracking for a single AWB.

```
GET /api/tracking/awb/:awbNumber
```

**Response:**
```json
{
  "awbNumber": "21025852654253",
  "courier": "Delhivery",
  "currentStatus": "Delivered",
  "statusCode": "DL",
  "expectedDeliveryDate": "2025-01-10",
  "ofdCount": 1,
  "isRto": false,
  "lastScan": {
    "status": "Delivered",
    "location": "Mumbai Hub",
    "datetime": "2025-01-10 14:30:00"
  },
  "scanHistory": [...]
}
```

---

### Track Multiple AWBs
Track up to 10 AWBs in a single request.

```
POST /api/tracking/batch
```

**Request:**
```json
{
  "awbNumbers": ["AWB1", "AWB2", "AWB3"]
}
```

---

### Track by Order IDs
Track orders by their internal IDs.

```
POST /api/tracking/orders
```

**Request:**
```json
{
  "orderIds": ["uuid1", "uuid2"]
}
```

---

### Trigger Tracking Sync
Manually trigger background tracking sync.

```
POST /api/tracking/sync/trigger
```

---

### Backfill Tracking
Backfill tracking data for shipped orders.

```
POST /api/tracking/sync/backfill?days=30&limit=100
```

---

## Status Mapping

iThink status codes are mapped to internal tracking statuses:

| iThink Code | iThink Status | Internal Status |
|-------------|---------------|-----------------|
| M | Manifested | `manifested` |
| NP | Not Picked | `not_picked` |
| PP | Picked Up | `picked_up` |
| IT, OT | In Transit | `in_transit` |
| RAD | Reached Destination | `reached_destination` |
| OFD | Out For Delivery | `out_for_delivery` |
| UD, NDR | Undelivered | `undelivered` |
| DL | Delivered | `delivered` |
| CA | Cancelled | `cancelled` |
| RTO, RTP, RTI | RTO In Transit | `rto_in_transit` |
| RTD | RTO Delivered | `rto_delivered` |

---

## Error Handling

All endpoints return errors in this format:
```json
{
  "error": "Error message here"
}
```

Common errors:
- `iThink Logistics not configured` - Missing credentials
- `iThink Logistics not fully configured` - Missing warehouse IDs
- `Order not found` - Invalid order ID
- `Order has no AWB number` - Order not shipped yet
- `Logistics error: ...` - Courier rejected the order

---

## Files

| File | Description |
|------|-------------|
| `server/src/services/ithinkLogistics.js` | Core API client |
| `server/src/services/trackingSync.js` | Background sync service |
| `server/src/routes/tracking.js` | API endpoints |
