# Remittance Domain

> COD payment reconciliation and Shopify financial status sync.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/remittance.ts` |
| Key Files | `services/shopify.ts` (markOrderAsPaid) |
| Related | Shopify (Transaction API), Orders (COD pending view) |

## Workflow

```
iThink CSV → Parse → Match Orders → Mark Paid → Auto-Sync Shopify
                          ↓                           ↓
                    [amount check]              [Transaction API]
                          ↓                           ↓
                    >5% mismatch?              failed/success?
                          ↓                           ↓
                   manual_review               failed/synced
```

## Sync Status Flow

| Status | Meaning | Action |
|--------|---------|--------|
| `pending` | Marked paid, awaiting sync | Auto-sync attempted |
| `synced` | Payment recorded in Shopify | Complete |
| `failed` | Shopify API error | Retry via UI |
| `manual_review` | Amount mismatch >5% | Manual approval required |

## Amount Tolerance

**5% tolerance** for automatic processing:
```javascript
percentDiff = |csvAmount - orderAmount| / orderAmount * 100
if (percentDiff > 5) status = 'manual_review'
```

## CSV Format

**Required column**: `Order No.` (orderNumber)
**Optional**: `AWB NO.`, `Price`, `Remittance Date`, `Remittance UTR`

**Handled variations**: `Order No.`, `Order No`, `order_number`, `OrderNumber`
**Date format**: Supports `DD-Mon-YY` (e.g., "06-Jan-26") and ISO formats

## Database Fields (Order)

| Field | Purpose |
|-------|---------|
| `codRemittedAt` | When COD was remitted |
| `codRemittanceUtr` | Bank UTR reference |
| `codRemittedAmount` | Actual amount remitted |
| `codShopifySyncStatus` | pending/synced/failed/manual_review |
| `codShopifySyncError` | Error message if sync failed |
| `codShopifySyncedAt` | When successfully synced to Shopify |

## Key Endpoints

| Path | Purpose |
|------|---------|
| `POST /upload` | Upload CSV (multipart/form-data) |
| `GET /pending` | COD orders awaiting remittance |
| `GET /summary` | Remittance stats (pending/paid counts, date range) |
| `GET /failed` | Orders with failed/pending/manual_review sync |
| `POST /sync-orders` | Sync specific orders to Shopify |
| `POST /retry-sync` | Retry failed syncs (by orderIds or all=true) |
| `POST /approve-manual` | Approve manual_review order with optional amount |
| `POST /reset` | Reset remittance data (admin, for testing) |
| `POST /fix-payment-method` | Fix orders with COD data but labeled Prepaid |

## Cross-Domain

- **Shopify**: Transaction API to mark orders paid (markOrderAsPaid)
- **Orders**: COD Pending view shows unremitted delivered orders
- **SystemSetting**: Tracks earliest/latest remittance dates processed

## Gotchas

1. **Idempotent upload**: Orders with `codRemittedAt` set silently skipped
2. **Atomic update**: Uses `updateMany` with `codRemittedAt: null` condition (race-safe)
3. **Shopify non-blocking**: CSV upload succeeds even if Shopify sync fails
4. **Transaction API**: Uses capture transaction, not order update
5. **COD Pending filter**: `paymentMethod='COD' + trackingStatus='delivered' + codRemittedAt=null`
6. **BOM handling**: Strips UTF-8 BOM (0xFEFF) from CSV files
7. **Date range tracking**: Stored in SystemSetting (cod_remittance_earliest/latest_date)
