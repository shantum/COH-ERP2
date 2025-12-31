# Creatures of Habit - ERP System

A lightweight, purpose-built ERP for managing COH's manufacturing operations, inventory, orders, and production planning.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ (recommended: 20+)
- PostgreSQL database (local, Supabase, or Railway)

### 1. Setup Database

Create a PostgreSQL database and get your connection string:
```
postgresql://user:password@localhost:5432/coh_erp
```

### 2. Setup Server

```bash
cd server

# Copy environment file
cp .env.example .env

# Edit .env with your database URL
# DATABASE_URL="postgresql://user:password@localhost:5432/coh_erp"

# Install dependencies
npm install

# Generate Prisma client and push schema
npx prisma generate
npx prisma db push

# Seed sample data
npm run db:seed

# Start server
npm run dev
```

Server runs at: http://localhost:3001

### 3. Setup Client

```bash
cd client

# Install dependencies
npm install

# Start dev server
npm run dev
```

Client runs at: http://localhost:5173

### 4. Login

Default credentials (from seed):
- Email: `admin@coh.com`
- Password: `admin123`

---

## 📦 Features

### Products & Catalog
- Product → Variation → SKU hierarchy
- Fabric consumption tracking
- COGS calculation

### Inventory
- Transaction ledger (inward/outward)
- Real-time balance tracking
- Stock alerts (below target)

### Fabrics
- Fabric types and suppliers
- Stock analysis with reorder recommendations
- Days of stock remaining

### Orders
- Fulfillment workflow: Pending → Allocated → Picked → Packed → Shipped
- Line-level status tracking
- Shipping with AWB/courier

### Customers
- Tier system (Bronze/Silver/Gold/Platinum)
- Lifetime value tracking
- At-risk customer identification

### Returns & Exchanges
- 6-step workflow
- Return rate analytics by product
- Inventory integration

### Production
- Tailor management
- Batch creation and tracking
- Capacity utilization dashboard

---

## 🗂 Project Structure

```
coh-erp/
├── server/
│   ├── src/
│   │   ├── routes/        # API endpoints
│   │   ├── middleware/    # Auth, etc.
│   │   └── index.js       # Express app
│   └── prisma/
│       ├── schema.prisma  # Database schema
│       └── seed.js        # Sample data
│
└── client/
    └── src/
        ├── components/    # Layout, shared
        ├── pages/         # Route pages
        ├── hooks/         # useAuth
        └── services/      # API client
```

---

## 🔧 API Endpoints

| Module | Base URL | Description |
|--------|----------|-------------|
| Auth | `/api/auth` | Login, register, current user |
| Products | `/api/products` | Products, variations, SKUs, COGS |
| Fabrics | `/api/fabrics` | Fabrics, types, suppliers, stock analysis |
| Inventory | `/api/inventory` | Transactions, balance, alerts |
| Orders | `/api/orders` | Orders, fulfillment workflow |
| Customers | `/api/customers` | Customer list, analytics |
| Returns | `/api/returns` | Return requests, workflow |
| Production | `/api/production` | Batches, tailors, capacity |
| Reports | `/api/reports` | Dashboard, velocity, COGS |

---

## 🔄 Shopify Integration (Future)

The schema and API are ready for Shopify integration:
- `shopifyOrderId` / `shopifyCustomerId` fields
- `shopifyInventoryItemId` for inventory sync
- Webhook-ready endpoints

Configure in `.env`:
```
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_...
SHOPIFY_WEBHOOK_SECRET=...
```

---

## 📝 License

Internal use only - Creatures of Habit
