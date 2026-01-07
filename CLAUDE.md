# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

COH-ERP is a full-stack ERP system for Creatures of Habit's manufacturing operations. It manages products, inventory, orders, customers, returns, production tracking, and Shopify integration.

## Development Commands

### Server (Express.js + Prisma)
```bash
cd server
npm run dev           # Start server with nodemon (port 3001)
npm run db:generate   # Generate Prisma client after schema changes
npm run db:push       # Push schema changes to database
npm run db:migrate    # Create migration files
npm run db:seed       # Seed sample data
npm run db:studio     # Open Prisma Studio GUI
```

### Client (React + Vite)
```bash
cd client
npm run dev      # Start Vite dev server (port 5173)
npm run build    # TypeScript compile + Vite production build
npm run lint     # Run ESLint
```

### Testing
```bash
cd server
npm test              # Run Jest tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

### First-time Setup
```bash
# Server
cd server && npm install && cp .env.example .env
npx prisma db push && npm run db:seed && npm run dev

# Client (new terminal)
cd client && npm install && npm run dev
```

Default login: `admin@coh.com` / `XOFiya@34`

## Architecture

### Tech Stack
- **Backend**: Node.js, Express.js (JavaScript ES modules), Prisma ORM, PostgreSQL
- **Frontend**: React 19, TypeScript, Vite, TanStack Query, Tailwind CSS, AG-Grid, Recharts
- **Auth**: JWT tokens (7-day expiry) with bcryptjs password hashing
- **Integrations**: Shopify (webhooks + bulk sync), iThink Logistics (shipment tracking)

### Key Patterns
- **API Client**: Centralized axios instance in `client/src/services/api.ts` with auth interceptors
- **Auth Context**: `client/src/hooks/useAuth.tsx` provides login/logout/user state
- **Protected Routes**: Wrapper component checks auth state before rendering
- **Server State**: TanStack Query for caching and data fetching
- **State Machines**: Order fulfillment (pending→allocated→picked→packed→shipped) and returns (6-step workflow)

### Database Schema (Prisma)
Located at `server/prisma/schema.prisma`. Key models:
- **Product Hierarchy**: Product → Variation → SKU (with imageUrl, barcode fields)
- **Inventory**: `InventoryTransaction` ledger (inward/outward/reserved)
- **Orders**: Order → OrderLine with fulfillment status tracking, Shopify sync, and COD remittance fields
- **Returns**: ReturnRequest with multi-step workflow states
- **Production**: ProductionBatch for date-wise manufacturing scheduling

### Key Business Logic Files
Critical files to understand before making changes:
- `server/src/utils/queryPatterns.js` - Shared Prisma patterns, inventory calculations
- `server/src/services/shopifyOrderProcessor.js` - Order sync logic (cache-first pattern)
- `server/src/services/trackingSync.js` - Background tracking sync with RTO detection
- `server/src/routes/remittance.js` - COD payment processing and Shopify sync
- `client/src/types/index.ts` - All TypeScript types for entities

### Domain READMEs (for deeper context)
Each major domain has a README with key files, functions, data flows, and gotchas:
- `server/src/routes/ORDERS_DOMAIN.md` - Order fulfillment workflow + COD remittance
- `server/src/routes/RETURNS_DOMAIN.md` - Returns and repacking
- `server/src/routes/SHOPIFY_DOMAIN.md` - Sync, webhooks, cache pattern, payment sync
- `server/src/routes/INVENTORY_DOMAIN.md` - Ledger transactions
- `server/src/routes/PRODUCTION_DOMAIN.md` - Batch scheduling
- `server/src/routes/TRACKING_DOMAIN.md` - iThink Logistics
- `client/src/FRONTEND_DOMAINS.md` - Page organization, patterns

### API Routes
All routes in `server/src/routes/`. Base URL: `/api`
- **Auth**: `/api/auth` - Login, register, user management
- **Products**: `/api/products` - Product/Variation/SKU CRUD
- **Fabrics**: `/api/fabrics` - Fabric types and inventory
- **Inventory**: `/api/inventory` - Stock balance, transactions, alerts
- **Orders**: `/api/orders` - Order management, fulfillment workflow, archive management
- **Remittance**: `/api/remittance` - COD payment tracking and Shopify sync
- **Customers**: `/api/customers` - Customer records
- **Returns**: `/api/returns` - Return request workflow
- **Production**: `/api/production` - Production batch scheduling
- **Tracking**: `/api/tracking` - iThink Logistics shipment tracking (single/batch AWB)
- **Reports**: `/api/reports` - Analytics and reporting
- **Shopify**: `/api/shopify` - Shopify sync (products, orders, customers)
- **Webhooks**: `/api/webhooks` - Shopify webhook receivers
- **Repacking**: `/api/repacking` - Return item QC and restocking queue
- **Import/Export**: `/api/export/*`, `/api/import/*` - CSV import/export
- **Admin**: `/api/admin` - System settings, database management

## Shopify Integration

### Configuration
Shopify credentials stored in `SystemSetting` table (keys: `shopify_shop_domain`, `shopify_access_token`). Configure via Settings page in UI.

### Sync Features
- **Products**: Sync products, variations, SKUs with images and inventory quantities
- **Orders**: Import orders with line items, customer data, fulfillment status
- **Customers**: Sync customer records with addresses
- **COD Payments**: Sync COD payment status using Transaction API

### Webhooks
Webhook endpoints for real-time Shopify updates:

**Recommended - Unified Order Endpoint:**
- `POST /api/webhooks/shopify/orders` - Handles create, update, cancel, fulfill (use with `orders/updated` topic)

**Legacy Endpoints (still supported):**
- `POST /api/webhooks/shopify/orders/create`
- `POST /api/webhooks/shopify/orders/updated`
- `POST /api/webhooks/shopify/orders/cancelled`
- `POST /api/webhooks/shopify/orders/fulfilled`

**Other Endpoints:**
- `POST /api/webhooks/shopify/customers/create`
- `POST /api/webhooks/shopify/customers/update`

Webhook secret stored in `SystemSetting` (key: `shopify_webhook_secret`). HMAC-SHA256 verification enabled when secret is configured.

### Key Files
- `server/src/services/shopify.js` - Shopify API client (including `markOrderAsPaid`)
- `server/src/routes/shopify.js` - Sync endpoints
- `server/src/routes/webhooks.js` - Webhook receivers

## COD Remittance System

### Endpoints
- `POST /api/remittance/upload` - Upload CSV with COD payment data
- `GET /api/remittance/pending` - COD orders delivered but not paid
- `GET /api/remittance/summary` - Stats for pending/paid COD orders
- `GET /api/remittance/failed` - Orders that failed Shopify sync
- `POST /api/remittance/retry-sync` - Retry failed Shopify syncs
- `POST /api/remittance/approve-manual` - Approve orders flagged for manual review

### CSV Expected Columns
- `Order No.` (required)
- `Price` / `COD Amount`
- `Remittance Date`
- `Remittance UTR`

Amount mismatches >5% are flagged for `manual_review`.

## CSV Import/Export

### Endpoints
- `GET /api/export/products` - Export products/SKUs as CSV
- `GET /api/export/fabrics` - Export fabrics as CSV
- `POST /api/import/products` - Import products from CSV
- `POST /api/import/fabrics` - Import fabrics from CSV

## Orders UI Features
- **Tabs**: Open Orders, Shipped Orders, Archived Orders (with separate grids)
- **AG-Grid**: Full-featured grid with column filters, sorting, and grouping
- **Summary Panels**: Dashboard stats for order counts and fulfillment progress
- **Pagination**: 25 items per page (archived orders use server-side pagination)
- **Archived Sort**: Sort by `orderDate` or `archivedAt`
- **Payment Grouping**: Shipped orders grouped by payment method (COD/Prepaid)
- **Manual Archive**: Archive individual shipped orders
- **Archived Analytics**: Revenue and order stats via `/orders/archived/analytics`
- **Conditional Formatting**: Row colors indicate status:
  - Green: Packed/allocated items
  - Emerald: Picked items
  - Blue: Ready to pack (fully allocated)
  - Amber: Production queued
- **Tracking Modal**: Real-time shipment tracking via iThink Logistics API
- **Production Scheduling**: Date picker for out-of-stock items links to production batches
- **Archive by Date**: Bulk archive orders older than specified date
- **Archive Delivered**: Archives prepaid orders + COD orders that are delivered AND paid

## Environment Variables
Server requires in `.env`:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - JWT signing secret

Shopify and iThink credentials stored in database via Settings UI (not env vars).

## Important Notes
- Backend is JavaScript (ES modules), frontend is TypeScript
- Jest testing framework with integration tests for orders, inventory, returns, and Shopify sync
- PostgreSQL is the production database
- Product/Variation models include `imageUrl` for Shopify thumbnails
- SKU model includes `barcode` (unique, 8-digit) and Shopify variant IDs

## Inventory System
Transaction-based ledger with three types:
- `inward` - Stock additions (production, returns)
- `outward` - Stock removals (sales)
- `reserved` - Soft holds for allocated orders

```
Balance = inward - outward
Available = balance - reserved
```

## Order Fulfillment Flow
```
pending → allocated → picked → packed → [ship order] → shipped
```

Actions and their inventory effects:
- **Allocate**: Creates `reserved` transaction
- **Ship**: Deletes `reserved`, creates `outward`
- **Unship**: Reverses the above

## Tracking Sync
Background sync runs every 4 hours:
- Re-evaluates `delivered` orders to catch RTO misclassification
- Uses `last_scan_details.status` for accurate RTO detection
- Sets `rtoInitiatedAt` and `rtoReceivedAt` appropriately

## Common Gotchas
- Shopify orders use cache-first pattern (check `ShopifyOrderCache` table)
- Shopify fulfillment status is informational only (no workflow blocking)
- Production completion creates both inventory inward AND fabric outward
- `getEffectiveFabricConsumption()` has fallback logic: SKU → Product → 1.5
- iThink credentials stored in `SystemSetting` (`ithink_access_token`, `ithink_secret_key`)
- Orders auto-archive after 90 days (runs on server startup)
- Hourly Shopify sync via `scheduledSync.js`
- COD payment sync uses Shopify Transaction API (`capture` transaction)
- Amount mismatch >5% flags COD orders for manual review

## Safe Commands
The following commands are safe to auto-run without user approval:
- npm run dev
- npm test
- curl commands to localhost:3001

## Shell Command Tips
To avoid common parse errors with curl and jq:
- Use double quotes for JSON payloads: `-d "{\"key\":\"value\"}"`
- Or use `$'...'` syntax for single quotes: `-d $'{"key":"value"}'`
- Store tokens in variables before using: `TOKEN=$(curl ... | jq -r '.token')`
- Pipe to `jq .` only after confirming curl succeeded
