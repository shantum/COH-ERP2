# COH-ERP App Overview

> **Living Document** — Last updated: January 5, 2026

## What Is This App?

**Creatures of Habit ERP** manages everything that happens behind the scenes of the fashion brand — from buying fabrics to delivering orders to customers and handling returns.

It connects to the Shopify online store and keeps everything in sync automatically.

---

## How the Business Flows Through the App

```
📦 Products    →    🧵 Fabrics    →    🏭 Production    →    📦 Inventory
     ↓                                                            ↓
💰 Orders      ←──────────────────────────────────────────    📤 Fulfillment
     ↓
🔄 Returns     →    Inspect    →    Restock or Write-off
```

---

## The Six Main Areas

### 1. 📦 Product Catalog
**What it does:** Stores all information about what we sell.

- **Products** — The main item (e.g., "Linen Midi Dress")
- **Variations** — Different colors of the same product
- **SKUs** — The specific item with size and barcode (what gets shipped)

*Example: "Linen Midi Dress" → "Mustard" color → Size "M"*

---

### 2. 🧵 Fabrics & Materials
**What it does:** Tracks fabric inventory and orders from suppliers.

- See how much fabric we have in stock
- Place orders with fabric suppliers
- Track when fabric arrives and when it's used for production

---

### 3. 🏭 Production
**What it does:** Manages the manufacturing process with tailors.

- Plan production batches based on what's needed
- Assign work to tailors
- Record when finished items arrive back

---

### 4. 💰 Orders & Customers
**What it does:** Handles all sales orders from Shopify.

- Automatically imports orders from Shopify
- Stores customer information
- Tracks each item in an order

---

### 5. 📤 Inventory & Fulfillment
**What it does:** Manages stock levels and order shipping.

- Shows real-time stock for each item
- Tracks when items are picked and packed
- Updates stock when items ship

**Stock goes up when:** Production completes, returns are restocked  
**Stock goes down when:** Orders are shipped

---

### 6. 🔄 Returns & Exchanges
**What it does:** Processes returned items from customers.

- Create return requests
- Inspect returned items
- Either restock good items or write off damaged ones

---

## Connection with Shopify

The app automatically syncs with Shopify:

| What Syncs | Direction |
|------------|-----------|
| Products & variants | Shopify → ERP |
| Customer info | Shopify → ERP |
| Orders | Shopify → ERP |
| Inventory levels | ERP → Shopify |

---

## App at a Glance

| Area | What's There |
|------|--------------|
| Main screens | 15 different pages |
| Data types tracked | 37 categories |
| Automated processes | 5 background sync services |

---

## Planned Improvements

| Priority | What We're Working On |
|----------|----------------------|
| 🔴 High | Faster order loading, better sync reliability |
| 🟡 Medium | Improved address handling |
| 🟢 Done | Return processing page, Production tracking |

---

## Recent Updates

| When | What Changed |
|------|--------------|
| Jan 2026 | New return processing with quality inspection |
| | Better testing coverage |
| | Planning for simpler navigation |
| Jan 2024 | App launched with core features |
| | Shopify integration completed |
| | Production tracking added |
