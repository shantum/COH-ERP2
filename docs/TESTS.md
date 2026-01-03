# Test Documentation - COH-ERP2

*Last updated: January 2026*

---

## Overview

| Metric | Value |
|--------|-------|
| Testing Framework | Jest (server-side) |
| Test File | `server/src/__tests__/essential.test.js` |
| Total Tests | 30 |
| Coverage | Core business logic utilities |

**Run tests:** `cd server && npm test`

---

## Test Categories

### 1. Fabric Consumption Calculation (6 tests)

**Function tested:** `getEffectiveFabricConsumption(sku)`

This function determines how much fabric is needed per unit of a SKU. It uses a fallback chain: SKU value → Product default → Hard-coded 1.5m.

| Test | Input | Expected | Purpose |
|------|-------|----------|---------|
| Uses SKU-specific value | `sku.fabricConsumption = 2.5` | 2.5 | SKU has explicit value |
| Falls back when SKU is 0 | `sku.fabricConsumption = 0`, product = 1.8 | 1.8 | SKU unset, use product |
| Falls back when SKU not set | No fabricConsumption, product = 2.0 | 2.0 | Missing SKU field |
| Final fallback to 1.5 | Both SKU and product = 0 | 1.5 | Default safety value |
| Handles product default = 0 | Product default is 0 | 1.5 | Zero is treated as unset |
| Handles missing variation | `sku.variation = null` | 1.5 | Graceful null handling |

---

### 2. Transaction Constants (2 tests)

**Constants tested:** `TXN_TYPE`, `TXN_REASON`

Verifies the inventory transaction type and reason constants are correctly defined.

| Test | Assertions |
|------|------------|
| Transaction types | `INWARD` = 'inward', `OUTWARD` = 'outward', `RESERVED` = 'reserved' |
| Transaction reasons | `ORDER_ALLOCATION`, `PRODUCTION`, `SALE`, `RETURN_RECEIPT` are correct |

---

### 3. Shopify Order Status Mapping (5 tests)

**Function tested:** `shopifyClient.mapOrderStatus(order)`

Maps Shopify order states to ERP order statuses.

| Test | Shopify State | ERP Status | Notes |
|------|---------------|------------|-------|
| Cancelled orders | `cancelled_at` set | `cancelled` | Highest priority |
| Fulfilled orders | `fulfillment_status = 'fulfilled'` | `delivered` | |
| Unfulfilled orders | `fulfillment_status = null` | `open` | Default |
| Empty order object | `{}` | `open` | Safe default |
| Cancelled + Fulfilled | Both set | `cancelled` | Cancel takes precedence |

---

### 4. Shopify Channel Mapping (3 tests)

**Function tested:** `shopifyClient.mapOrderChannel(order)`

Determines order source channel from Shopify data.

| Test | Source | Channel |
|------|--------|---------|
| Web orders | `source_name = 'web'` | `shopify_online` |
| POS orders | `source_name = 'pos'` | `shopify_pos` |
| Unknown source | `source_name = 'unknown'` | `shopify_online` |

---

### 5. Gender Normalization (3 tests)

**Function tested:** `shopifyClient.normalizeGender(value)`

Standardizes gender values from product tags.

| Test | Inputs | Output |
|------|--------|--------|
| Women variants | 'Women', 'womens', 'WOMEN', 'female' | `women` |
| Men variants | 'Men', 'mens', 'MEN', 'male' | `men` |
| Unknown values | 'unknown', '', null, 'ladies' | `unisex` |

---

### 6. Payment Method Detection (5 tests)

**Logic tested:** Payment method inference from Shopify order data.

Used to distinguish COD (Cash on Delivery) vs Prepaid orders.

| Test | Conditions | Result |
|------|------------|--------|
| Pending financial status | `financial_status = 'pending'` | `COD` |
| Paid financial status | `financial_status = 'paid'` | `Prepaid` |
| Razorpay gateway | Gateway includes 'razorpay' | `Prepaid` |
| Shopflo gateway | Gateway includes 'shopflo' | `Prepaid` |
| Missing gateway list | No `payment_gateway_names` | `COD` (if pending) |

---

### 7. Inventory Balance Logic (6 tests)

**Logic tested:** Inventory balance calculation from transactions.

This mirrors the actual database calculation logic.

**Formula:**
```
currentBalance = totalInward - totalOutward
availableBalance = currentBalance - totalReserved
```

| Test | Transactions | Current | Available | Notes |
|------|--------------|---------|-----------|-------|
| Empty list | None | 0 | 0 | Base case |
| Inward only | 10 + 5 inward | 15 | 15 | Stock added |
| Inward + Outward | 20 in, 8 out | 12 | 12 | Stock sold |
| Inward + Reserved | 20 in, 5 reserved | 20 | 15 | Soft hold |
| Complex mix | 110 in, 35 out, 20 reserved | 75 | 55 | Real-world scenario |
| Oversold | 10 in, 15 reserved | 10 | -5 | Negative available allowed |

---

## Test Structure

```javascript
describe('Category Name', () => {
    it('should do something specific', () => {
        // Arrange
        const input = {...};
        
        // Act
        const result = functionUnderTest(input);
        
        // Assert
        expect(result).toBe(expected);
    });
});
```

---

## What's NOT Tested (Yet)

| Area | Reason | Priority |
|------|--------|----------|
| Database integration | Requires test database setup | Medium |
| API endpoints | Need supertest + mock prisma | Medium |
| React components | Need Vitest + React Testing Library | Low |
| Shopify webhook handling | Requires mock HTTP requests | Medium |
| Order fulfillment flow | Integration test across services | High |

---

## Running Tests

```bash
# Run all tests
cd server
npm test

# Watch mode (re-run on file changes)
npm test:watch

# With coverage report
npm test:coverage
```

---

## Adding New Tests

1. Add tests to `server/src/__tests__/essential.test.js` or create new test files
2. Follow naming: `*.test.js` or `*.spec.js`
3. Focus on pure functions first (no database dependencies)
4. Use descriptive `it('should...')` names
