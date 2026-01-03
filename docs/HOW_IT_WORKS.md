# How COH-ERP Works
*A simple guide to understanding the Creatures of Habit ERP system*

---

## What is This System?

COH-ERP is an internal system that helps Creatures of Habit manage their clothing business. Think of it as the "brain" that keeps track of:

- What products exist and their details
- How much fabric and finished goods are in stock
- Customer orders from Shopify and offline sales
- Production planning for tailors
- Returns and exchanges

---

## The Main Parts

### 🛍️ Products

**What it tracks:**
- Product (e.g., "Linen MIDI Dress")
  - Variation (e.g., "Linen MIDI Dress in Blue")
    - SKU (e.g., "LMD-BLU-XL" - the specific size)

**Simple explanation:** A product is like a dress design. Each color of that dress is a variation. Each size of each color is a SKU (Stock Keeping Unit) - the thing you actually sell.

---

### 🧵 Fabrics

**What it tracks:**
- Fabric types (e.g., "Linen 60 Lea")
- Individual fabrics/colors (e.g., "Wildflower Blue Linen")
- Fabric stock levels (how many meters available)
- When fabric comes in from suppliers
- When fabric goes out for production

**Simple explanation:** Before you can make clothes, you need fabric. This section tracks all your fabric inventory - what came in, what was used, and what's left.

---

### 📦 Inventory

**What it tracks:**
- Current stock of each finished product (SKU)
- Stock movements (in from production, out for sales)
- Reserved stock (held for pending orders)
- Target stock levels (how much you WANT to have)

**The math:**
```
Available Stock = Stock In - Stock Out - Reserved
```

**Simple explanation:** This tells you exactly how many of each product you have ready to sell right now.

---

### 🛒 Orders

**Where orders come from:**
- Shopify (automatically synced)
- Manual entry (offline/phone orders)

**Order journey:**
1. **Open** - New order arrives
2. **Allocated** - Stock is reserved for this order
3. **Picked** - Items physically pulled from shelf
4. **Packed** - Items boxed and ready
5. **Shipped** - Handed to courier with tracking number
6. **Delivered** - Customer received it

**Simple explanation:** Orders flow through these stages. The system tracks every step so you know exactly where each order is.

---

### 👥 Customers

**What it tracks:**
- Customer details (name, email, phone, address)
- Order history
- Total spending (Lifetime Value / LTV)
- Customer tier (Bronze → Silver → Gold → Platinum)

**Tier thresholds:**
| Tier | Spending |
|------|----------|
| Bronze | Under ₹10,000 |
| Silver | ₹10,000 - ₹24,999 |
| Gold | ₹25,000 - ₹49,999 |
| Platinum | ₹50,000+ |

**Simple explanation:** The system remembers all customers and their purchase history. VIP customers (high spenders) are highlighted so you can give them special treatment.

---

### 🔄 Returns & Exchanges

**The return process:**
1. Customer requests return/exchange
2. Reverse pickup scheduled
3. Item in transit back to you
4. Item received at warehouse
5. Item inspected (is it damaged?)
6. Resolution (refund, exchange, or reject)

**What happens to stock:**
- Good items go back into inventory
- Damaged items don't

**Simple explanation:** When customers return items, this tracks the whole process from pickup to resolution.

---

### 🧵 Production

**What it tracks:**
- Production batches (what to make, when, how many)
- Tailor assignments
- Batch status (planned → in progress → completed)
- Fabric usage per batch

**How it connects:**
- When an order can't be fulfilled (no stock), you can schedule production
- When production completes, finished goods go into inventory
- Fabric is deducted when production completes

**Simple explanation:** When you need to make more products, this plans the work for your tailors and tracks what gets made.

---

### 🔗 Shopify Connection

**What syncs automatically:**
- Products (your catalog)
- Orders (new sales)
- Customers (buyer information)
- Inventory levels (stock counts)

**How it works:**
1. Customer places order on Shopify website
2. Webhook instantly notifies COH-ERP
3. Order appears in the Open Orders tab
4. You fulfill the order in COH-ERP
5. (Optional) Update Shopify with tracking info

**Simple explanation:** Your Shopify store and this system talk to each other automatically. Orders flow in, and you manage them here.

---

## How Everything Connects

```
┌─────────────────────────────────────────────────────────────┐
│                        SHOPIFY                               │
│               (Where customers buy)                          │
└─────────────────────────┬───────────────────────────────────┘
                          │ Orders sync automatically
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                        ORDERS                                │
│              (Manage fulfillment)                            │
└─────────────┬───────────────────────────────────┬───────────┘
              │                                   │
    Need stock?                          Have stock?
              │                                   │
              ▼                                   ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│      PRODUCTION         │         │       INVENTORY         │
│   (Make more items)     │────────▶│    (Track all stock)    │
└─────────────────────────┘         └─────────────────────────┘
              │                                   ▲
              │                                   │
              ▼                                   │
┌─────────────────────────┐                       │
│        FABRICS          │───────────────────────┘
│  (Raw material stock)   │    Fabric used in production
└─────────────────────────┘
```

---

## Key Screens

### Dashboard
- Quick overview of open orders, low stock alerts
- Today's shipping queue
- Recent activity

### Orders (Open Tab)
- All orders waiting to be shipped
- Color-coded by status (green = ready, amber = needs production)
- One-click allocation and shipping

### Inventory
- Stock levels for all products
- Alerts for items below target
- Movement history

### Production
- Calendar view of production schedule
- Tailor capacity and assignments
- Requirements from pending orders

### Settings
- Shopify connection configuration
- Data import/export
- System preferences

---

## Common Workflows

### Fulfilling a Shopify Order
1. Order appears in Open Orders (auto-synced)
2. Check if items are in stock (green row = yes)
3. Click to allocate stock
4. Pick and pack the items
5. Enter AWB (tracking number) and courier
6. Click Ship - order moves to Shipped tab

### Handling Out-of-Stock
1. Order item shows red (no stock)
2. Select a production date
3. Batch is created for tailors
4. Once made, complete the batch
5. Items enter inventory
6. Go back and allocate the order

### Processing a Return
1. Create return request
2. Schedule reverse pickup
3. Receive and inspect item
4. If good: refund and restock
5. If damaged: refund only, no restock

---

## Need Help?

- **Technical issues:** Check CLAUDE.md for developer notes
- **Architecture details:** See ARCHITECTURE.md
- **API documentation:** Review server/src/routes/*.js files
