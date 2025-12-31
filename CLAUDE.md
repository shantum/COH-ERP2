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

### First-time Setup
```bash
# Server
cd server && npm install && cp .env.example .env
npx prisma db push && npm run db:seed && npm run dev

# Client (new terminal)
cd client && npm install && npm run dev
```

Default login: `admin@coh.com` / `admin123`

## Architecture

### Tech Stack
- **Backend**: Node.js, Express.js (JavaScript ES modules), Prisma ORM, SQLite
- **Frontend**: React 19, TypeScript, Vite, TanStack Query, Tailwind CSS, Recharts
- **Auth**: JWT tokens (7-day expiry) with bcryptjs password hashing

### Key Patterns
- **API Client**: Centralized axios instance in `client/src/services/api.ts` with auth interceptors
- **Auth Context**: `client/src/hooks/useAuth.tsx` provides login/logout/user state
- **Protected Routes**: Wrapper component checks auth state before rendering
- **Server State**: TanStack Query for caching and data fetching
- **State Machines**: Order fulfillment (pending→allocated→picked→packed→shipped) and returns (6-step workflow)

### Database Schema (Prisma)
Located at `server/prisma/schema.prisma`. Key models:
- **Product Hierarchy**: Product → Variation → SKU (with imageUrl, barcode fields)
- **Inventory**: FabricInventory/ProductInventory with InventoryTransaction ledger
- **Orders**: Order → OrderLine with fulfillment status tracking and Shopify sync fields
- **Returns**: ReturnRequest with multi-step workflow states
- **Production**: ProductionBatch for date-wise manufacturing scheduling

### API Routes
All routes in `server/src/routes/`. Base URL: `/api`
- **Auth**: `/api/auth` - Login, register, user management
- **Products**: `/api/products` - Product/Variation/SKU CRUD
- **Fabrics**: `/api/fabrics` - Fabric types and inventory
- **Inventory**: `/api/inventory` - Stock balance, transactions, alerts
- **Orders**: `/api/orders` - Order management, fulfillment workflow
- **Customers**: `/api/customers` - Customer records
- **Returns**: `/api/returns` - Return request workflow
- **Production**: `/api/production` - Production batch scheduling
- **Reports**: `/api/reports` - Analytics and reporting
- **Shopify**: `/api/shopify` - Shopify sync (products, orders, customers)
- **Webhooks**: `/api/webhooks` - Shopify webhook receivers
- **Import/Export**: `/api/export/*`, `/api/import/*` - CSV import/export
- **Admin**: `/api/admin` - System settings, database management

## Shopify Integration

### Configuration
Shopify credentials stored in `SystemSetting` table (keys: `shopify_shop_domain`, `shopify_access_token`). Configure via Settings page in UI.

### Sync Features
- **Products**: Sync products, variations, SKUs with images and inventory quantities
- **Orders**: Import orders with line items, customer data, fulfillment status
- **Customers**: Sync customer records with addresses

### Webhooks
Webhook endpoints for real-time Shopify updates:
- `POST /api/webhooks/shopify/orders/create`
- `POST /api/webhooks/shopify/orders/updated`
- `POST /api/webhooks/shopify/orders/cancelled`
- `POST /api/webhooks/shopify/orders/fulfilled`
- `POST /api/webhooks/shopify/customers/create`
- `POST /api/webhooks/shopify/customers/update`

Webhook secret stored in `SystemSetting` (key: `shopify_webhook_secret`). HMAC-SHA256 verification enabled when secret is configured.

### Key Files
- `server/src/services/shopify.js` - Shopify API client
- `server/src/routes/shopify.js` - Sync endpoints
- `server/src/routes/webhooks.js` - Webhook receivers

## CSV Import/Export

### Endpoints
- `GET /api/export/products` - Export products/SKUs as CSV
- `GET /api/export/fabrics` - Export fabrics as CSV
- `POST /api/import/products` - Import products from CSV
- `POST /api/import/fabrics` - Import fabrics from CSV

## Orders UI Features
- **Pagination**: 25 items per page with page controls
- **Conditional Formatting**: Row colors indicate status:
  - Green: Packed/allocated items
  - Emerald: Picked items
  - Blue: Ready to pack (fully allocated)
  - Amber: Production queued
- **Production Scheduling**: Date picker for out-of-stock items links to production batches

## Environment Variables
Server requires in `.env`:
- `DATABASE_URL` - SQLite connection string
- `JWT_SECRET` - JWT signing secret

Shopify credentials stored in database via Settings UI (not env vars).

## Important Notes
- Backend is JavaScript (ES modules), frontend is TypeScript
- No test framework is currently configured
- SQLite is the default database (file: `server/prisma/dev.db`)
- Product/Variation models include `imageUrl` for Shopify thumbnails
- SKU model includes `barcode` (unique, 8-digit) and Shopify variant IDs
