# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

COH-ERP is a full-stack ERP system for Creatures of Habit's manufacturing operations. It manages products, inventory, orders, customers, returns, and production tracking.

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
- **Product Hierarchy**: Product → Variation → SKU → SkuCosting
- **Inventory**: FabricInventory/ProductInventory with InventoryTransaction ledger
- **Orders**: Order → OrderItem with fulfillment status tracking
- **Returns**: ReturnRequest with multi-step workflow states
- **Production**: Tailor and ProductionBatch for manufacturing

### API Routes
All routes in `server/src/routes/`. Base URL: `/api`
- Auth, Products, Fabrics, Inventory, Orders, Customers, Returns, Production, Reports, Feedback

### Environment Variables
Server requires `DATABASE_URL` and `JWT_SECRET` in `.env`. Shopify integration fields are prepared but optional.

## Important Notes
- Backend is JavaScript (ES modules), frontend is TypeScript
- No test framework is currently configured
- SQLite is the default database (file: `server/prisma/dev.db`)
- Schema includes Shopify integration fields for future sync
