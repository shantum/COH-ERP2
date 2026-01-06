# Test Documentation - COH-ERP2

*Last updated: January 2026*

---

## Overview

| Metric | Value |
|--------|-------|
| Testing Framework | Jest (server-side) |
| Test Files | `essential.test.js` (71), `integration.test.js` (69), `database-webhook.test.js` (68), `returns-exchange.test.js` (103), `orders-inventory.test.js` (93) |
| Total Tests | 404 |
| Coverage | Core utilities, validation, encryption, sync, fulfillment, returns/exchanges, QC, inventory, shipping |

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

### 8. Password Validation (8 tests)

**Function tested:** `validatePassword(password)`

Validates password strength requirements: 8+ chars, uppercase, lowercase, number, special character.

| Test | Input | Result | Notes |
|------|-------|--------|-------|
| Valid password | `MyPass123!` | Valid | Meets all requirements |
| Too short | `Ab1!xyz` (7 chars) | Invalid | Below 8 char minimum |
| No uppercase | `mypass123!` | Invalid | Missing uppercase |
| No lowercase | `MYPASS123!` | Invalid | Missing lowercase |
| No number | `MyPassword!` | Invalid | Missing digit |
| No special char | `MyPassword123` | Invalid | Missing symbol |
| Very weak | `abc` | Invalid | Multiple errors returned |
| Null input | `null` | Invalid | Handles null gracefully |

---

### 9. Customer Tier Calculation (6 tests)

**Function tested:** `calculateTier(ltv, thresholds)`

Calculates customer tier based on lifetime value.

| Test | LTV Range | Expected Tier |
|------|-----------|---------------|
| Platinum | >= 50000 | `platinum` |
| Gold | 25000-49999 | `gold` |
| Silver | 10000-24999 | `silver` |
| Bronze | < 10000 | `bronze` |
| Custom thresholds | Any | Uses provided thresholds |
| Default constants | N/A | 50k/25k/10k verified |

---

### 10. LTV Calculation (5 tests)

**Function tested:** `calculateLTV(orders)`

Calculates customer lifetime value from order history.

| Test | Input | Result | Notes |
|------|-------|--------|-------|
| Empty array | `[]` | 0 | Base case |
| Null/undefined | `null` | 0 | Graceful handling |
| Valid orders | 3 orders | Sum of amounts | Adds all amounts |
| With cancelled | Mixed statuses | Excludes cancelled | Only valid orders |
| String amounts | `'10000'` | 10000 | Converts to number |

---

### 11. Encryption Utilities (9 tests)

**Functions tested:** `encrypt()`, `decrypt()`, `isEncrypted()`

AES-256-GCM encryption for API keys and secrets.

| Test | Function | Scenario | Notes |
|------|----------|----------|-------|
| Round trip | Both | Encrypt then decrypt | Values match |
| Random IV | encrypt | Same plaintext | Different ciphertext each time |
| Null input | encrypt | `null` | Returns null |
| Null input | decrypt | `null` | Returns null |
| Empty string | Both | `''` | Returns null |
| Special chars | Both | `!@#$%^&*()` | Handles correctly |
| Unicode | Both | Japanese + emoji | Full unicode support |
| Detect encrypted | isEncrypted | Encrypted value | Returns true |
| Detect plaintext | isEncrypted | Plain string | Returns false |

---

### 12. Size Normalization (4 tests)

**Function tested:** `normalizeSize(rawSize)`

Normalizes extended size codes to standard format.

| Test | Input | Output | Notes |
|------|-------|--------|-------|
| XXL to 2XL | `XXL`, `xxl` | `2XL` | Case insensitive |
| XXXL to 3XL | `XXXL`, `xxxl` | `3XL` | |
| XXXXL to 4XL | `XXXXL`, `xxxxl` | `4XL` | |
| Other sizes | `S`, `M`, `L`, `XL` | Unchanged | No transformation |

---

### 13. Variant Image Mapping (3 tests)

**Function tested:** `buildVariantImageMap(shopifyProduct)`

Builds a map of variant IDs to image URLs from Shopify product data.

| Test | Input | Result |
|------|-------|--------|
| Valid images | Product with variant-linked images | Map of ID → URL |
| No images | Empty product | Empty object |
| No variant IDs | Images without variant_ids | Empty object |

---

### 14. Variant Color Grouping (3 tests)

**Function tested:** `groupVariantsByColor(variants)`

Groups Shopify variants by color option (option1).

| Test | Input | Result |
|------|-------|--------|
| Multiple colors | Red/Blue variants | Grouped by color |
| No color option | Variants without option1 | Grouped under "Default" |
| Empty array | `[]`, `null` | Empty object |

---

### 15. Customer Data Builder (3 tests)

**Function tested:** `buildCustomerData(shopifyCustomer)`

Transforms Shopify customer to ERP format.

| Test | Scenario | Notes |
|------|----------|-------|
| Full customer | All fields present | ID converted to string, email lowercased |
| Minimal customer | Missing optional fields | Handles nulls gracefully |
| With address | default_address present | Stringified JSON |

---

## Integration Tests (69 tests)

### 16. Order Status Transitions (9 tests)

**Logic tested:** Order line state machine transitions

Valid forward transitions: `pending → allocated → picked → packed → shipped`  
Valid backward transitions: `allocated → pending`, `picked → allocated`, `packed → picked`, `shipped → allocated`

| Test | Transition | Allowed |
|------|------------|---------|
| Allocate | pending → allocated | ✅ |
| Pick | allocated → picked | ✅ |
| Pack | picked → packed | ✅ |
| Ship (packed) | packed → shipped | ✅ |
| Ship (skip steps) | allocated → shipped | ✅ |
| Unallocate | allocated → pending | ✅ |
| Unpick | picked → allocated | ✅ |
| Unpack | packed → picked | ✅ |
| Unship | shipped → allocated | ✅ |

---

### 17. Fulfillment Stage Calculation (7 tests)

**Logic tested:** Determining overall order fulfillment progress from line statuses

| Test | Line Statuses | Stage |
|------|---------------|-------|
| All pending | `[pending, pending, pending]` | `pending` |
| All allocated | `[allocated, allocated]` | `allocated` |
| Some picked | `[allocated, picked, pending]` | `in_progress` |
| Mix picked/packed | `[picked, packed, allocated]` | `in_progress` |
| All packed | `[packed, packed, packed]` | `ready_to_ship` |
| Single line | `[packed]` | `ready_to_ship` |
| Empty order | `[]` | `pending` |

---

### 18. Shipping Validation Rules (6 tests)

**Logic tested:** Validating order is ready for shipping

| Test | Line Statuses | Can Ship? |
|------|---------------|-----------|
| All allocated | ✅ | Yes |
| All picked | ✅ | Yes |
| All packed | ✅ | Yes |
| Mixed ready states | `[allocated, picked, packed]` | Yes |
| Some pending | `[pending, allocated]` | ❌ No |
| Already shipped | `[shipped, allocated]` | ❌ No |

---

### 19. Order Status Rules (7 tests)

**Logic tested:** Order-level status change permissions

| Test | Order Status | Operation | Allowed |
|------|--------------|-----------|---------|
| Open order | Cancel | ✅ |
| Shipped order | Cancel | ❌ |
| Delivered order | Cancel | ❌ |
| Cancelled order | Cancel | ❌ |
| Shipped order | Unship | ✅ |
| Delivered order | Unship | ❌ |
| Cancelled order | Uncancel | ✅ |

---

### 20. Tracking Status (4 tests)

**Logic tested:** Determining shipment tracking status

| Test | Order Status | Days in Transit | Result |
|------|--------------|-----------------|--------|
| Delivered | Any | Any | `completed` |
| Recent shipment | shipped | 0-7 | `in_transit` |
| Delayed | shipped | 8+ | `delivery_delayed` |

---

### 21. Return Status Transitions (3 tests)

**Logic tested:** Return request status validation

Valid statuses: `requested → reverse_initiated → in_transit → received → qc_pending → qc_approved/rejected → processed → closed`

Item conditions: `resellable`, `damaged`, `defective`, `wrong_item`

| Test | Condition | Restock? |
|------|-----------|----------|
| Resellable | resellable | ✅ Yes |
| Damaged | damaged | ❌ No |
| Defective | defective | ❌ No |

---

### 22. Return Reason Categories (3 tests)

**Logic tested:** Valid return reason categories

Valid reasons: `size_issue`, `quality_issue`, `wrong_item`, `not_as_described`, `changed_mind`, `other`

---

### 23. Shopify Order Processing (20 tests)

**Logic tested:** Order transformation from Shopify to ERP

| Category | Tests | Logic |
|----------|-------|-------|
| Status mapping | 3 | cancelled_at → cancelled, fulfilled → delivered, default → open |
| Payment detection | 4 | COD vs Prepaid based on gateway and financial_status |
| Customer name | 4 | Priority: shipping_address > customer, fallback to Unknown |
| Order number | 3 | Priority: name > order_number > generated from ID |
| Update detection | 4 | Status, fulfillment, AWB, courier, payment, notes changes |
| Action results | 6 | created, updated, skipped, cancelled, fulfilled, cache_only |

---

### 24. Inventory Transaction Rules (8 tests)

**Logic tested:** Inventory transaction types for order lifecycle

| Action | Transaction | Type | Reason |
|--------|-------------|------|--------|
| Allocate | Create | reserved | order_allocation |
| Ship | Delete | reserved | - |
| Ship | Create | outward | sale |
| Unship | Delete | outward | - |
| Unship | Create | reserved | order_allocation |
| Return restock | Create | inward | return_receipt |

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

## Database, Webhook, and Sync Tests (68 tests)

### 25. Database Model Validation (12 tests)

**Logic tested:** Data integrity rules and model structure validation

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Order model structure | 4 | Order status, channel, line status enums |
| ShopifyOrderCache model | 3 | Discount code extraction, tracking info |
| Customer model | 3 | Email normalization, phone handling |
| WebhookLog model | 2 | Status enums, deduplication keys |

---

### 26. Webhook Schema Validation (15 tests)

**Logic tested:** Zod schema validation for Shopify webhook payloads

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Order schema | 5 | Valid payloads, type coercion, required fields |
| Product schema | 3 | Title requirement, variant handling |
| Customer schema | 3 | Email validation, optional fields |
| Inventory level schema | 2 | Item ID extraction, available qty |
| Deduplication logic | 2 | Duplicate detection, topic validation |

---

### 27. Shopify Order Processing (18 tests)

**Logic tested:** Core processing from `shopifyOrderProcessor.js`

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Cache data extraction | 5 | Payment method, shipping address, gateway detection |
| Order creation | 4 | Order number generation, effective price calculation |
| Update detection | 5 | Status, fulfillment, AWB, discount code changes |
| Error handling | 4 | No SKU match, cache-only fallback, status preservation |

---

### 28. Shopify Sync Workflows (8 tests)

**Logic tested:** Sync modes and filtering from `syncWorker.js`

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Mode configuration | 3 | DEEP, QUICK, UPDATE mode settings |
| Order filtering | 3 | Date filters, skip existing, stale detection |
| Processing results | 2 | Action counting, progress calculation |

---

### 29. Orders Display Logic (9 tests)

**Logic tested:** Order listing and display from `orders.js`

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Filtering logic | 3 | Status, channel, date range filters |
| Latest orders | 2 | Sort order, pagination |
| Order enrichment | 4 | Fulfillment stage, days since order |

---

### 30. Dead Letter Queue (6 tests)

**Logic tested:** FailedSyncItem retry logic

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Queue insertion | 2 | Deduplication key, status enums |
| Retry scheduling | 2 | Exponential backoff, max retries |
| Status transitions | 2 | pending → retrying → resolved/abandoned |

---

## Returns and Exchange Tests (103 tests)

### 31. Return Request Status Transitions (12 tests)

**Logic tested:** Status flow and cancellation/deletion rules

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Status transitions | 7 | Valid status flow from requested → resolved |
| Cancellation rules | 6 | When cancellation is allowed |
| Deletion rules | 3 | When deletion is allowed based on received items |

---

### 32. Exchange Flow Types (12 tests)

**Logic tested:** Exchange resolutions and value difference calculations

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Resolution types | 5 | refund, exchange_same, exchange_up, exchange_down |
| Value difference | 4 | Positive/negative/zero difference calculation |
| Ready to ship detection | 3 | Action queue exchange detection |

---

### 33. Item Receiving and QC Flow (17 tests)

**Logic tested:** Item condition handling and restock decisions

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Condition validation | 5 | good, used, damaged, wrong_product |
| All items received check | 3 | Multi-line receiving logic |
| Restock decision | 4 | Which conditions allow restock |
| Undo receive rules | 4 | When undo is allowed |

---

### 34. Repacking Queue Management (12 tests)

**Logic tested:** QC queue status and processing actions

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Queue statuses | 4 | pending, inspecting, repacking, ready, write_off |
| Condition types | 4 | unused, used, damaged, defective |
| Processing actions | 4 | ready vs write_off decisions |

---

### 35. Value Calculations (12 tests)

**Logic tested:** Return/refund/payment amount calculations

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Return value | 3 | Line price aggregation |
| Refund amount | 4 | Resolution-based refund calculation |
| Payment amount | 3 | Exchange up payment calculation |

---

### 36. Request Number and Duplicates (8 tests)

**Logic tested:** Request number generation and duplicate detection

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Number generation | 4 | Year-based incrementing format |
| Duplicate detection | 4 | Active ticket and request duplication |

---

### 37. Action Queue and Auto-Resolve (13 tests)

**Logic tested:** Dashboard queue categorization and exchange auto-resolve

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Pending pickup | 2 | AWB presence detection |
| Refunds pending | 3 | Resolution + received + no refund |
| Payments pending | 3 | Exchange up payment tracking |
| Auto-resolve | 4 | Exchange completion detection |
| Stats update | 4 | Customer and SKU stats increment |

---

## Orders and Inventory Tests (93 tests)

### 38. Order Line Status Transitions (14 tests)

**Logic tested:** Fulfillment workflow and undo operations

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Status transitions | 8 | pending → allocated → picked → packed → shipped |
| Undo validation | 6 | unallocate, unpick, unpack rules |

---

### 39. Fulfillment Stage Calculation (9 tests)

**Logic tested:** Order-level fulfillment stage derivation

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Stage calculation | 6 | pending, allocated, in_progress, ready_to_ship |
| Line status counts | 3 | Counting lines by status |

---

### 40. Shipping and Tracking (11 tests)

**Logic tested:** Shipping readiness and delivery tracking

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Shipping readiness | 4 | All lines allocated validation |
| Unship rules | 3 | When orders can be unshipped |
| Tracking status | 4 | in_transit, delayed, completed |

---

### 41. Inventory Balance Calculations (14 tests)

**Logic tested:** Transaction aggregation and stock status

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Balance calculation | 6 | inward - outward - reserved formula |
| Stock status | 4 | below_target vs ok |
| Transaction types | 4 | inward, outward, reserved |

---

### 42. Allocation and Reservation (8 tests)

**Logic tested:** Inventory allocation for order lines

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Allocation validation | 4 | Stock sufficiency check |
| Reservation creation | 4 | Reserved transaction structure |

---

### 43. Production and Stock Alerts (16 tests)

**Logic tested:** Batch matching and shortage calculation

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Batch matching | 5 | Inward to production batch linking |
| Shortage calculation | 4 | Target vs current balance |
| Fabric requirements | 4 | Consumption per unit calculation |
| Alert status | 3 | can_produce vs fabric_needed |

---

### 44. Transaction Edit/Delete and Bulk Operations (12 tests)

**Logic tested:** Transaction management and bulk updates

| Test Category | Tests | Description |
|---------------|-------|-------------|
| Edit rules | 3 | Only inward can be edited |
| Delete rules | 3 | Admin vs user permissions |
| Bulk timestamps | 4 | Correct timestamp per status |
| Date filtering | 3 | Inward history date range |

---

## What's NOT Tested (Yet)

### Server Routes (15 files, ~300KB total)

| Route | Size | Key Endpoints | Priority |
|-------|------|---------------|----------|
| `orders.js` | 43KB | Order CRUD, fulfillment, allocation, shipping | **High** |
| `returns.js` | 38KB | Return requests, return inward, QC processing | **High** |
| `shopify.js` | 32KB | Sync triggers, order import, inventory push | Medium |
| `fabrics.js` | 27KB | Fabric CRUD, ledger, reconciliation | Medium |
| `repacking.js` | 23KB | Repacking workflows, transfers | Medium |
| `inventory.js` | 21KB | Stock adjustments, transactions | **High** |
| `production.js` | 21KB | Production planning, batch management | Medium |
| `admin.js` | 22KB | User management, system settings | Low |
| `import-export.js` | 18KB | CSV import/export | Low |
| `webhooks.js` | 15KB | Shopify webhook handlers | **High** |
| `customers.js` | 13KB | Customer CRUD, merge | Low |
| `products.js` | 12KB | Product/SKU management | Low |
| `reports.js` | 6KB | Report generation | Low |
| `auth.js` | 6KB | Login, register, password change | Medium |
| `feedback.js` | 5KB | User feedback | Low |

### Services (5 files)

| Service | Functions | Tested | Untested |
|---------|-----------|--------|----------|
| `shopifyOrderProcessor.js` | 5 | 0 | `processShopifyOrderToERP`, `cacheShopifyOrder`, `cacheAndProcessOrder` |
| `productSyncService.js` | 8 | 3 | `syncSingleProduct`, `syncSingleSku`, `syncAllProducts` |
| `customerSyncService.js` | 4 | 1 | `syncSingleCustomer`, `syncCustomers`, `syncAllCustomers` |
| `syncWorker.js` | 6 | 0 | Background sync jobs |
| `shopify.js` | 12 | 3 | API client methods (require mocking) |

### Webhooks (require mock HTTP)

| Webhook | Handler | Notes |
|---------|---------|-------|
| `orders/create` | `processShopifyOrderToERP` | HMAC verification + processing |
| `orders/updated` | `processShopifyOrderToERP` | Status updates, cancellations |
| `products/update` | `cacheAndProcessProduct` | Product sync |
| `inventory_levels/update` | Direct DB update | Inventory cache |
| `customers/create` | `buildCustomerData` | Tested partially |

### React Frontend (15 pages, 18 components)

| Area | Files | Priority |
|------|-------|----------|
| Order fulfillment UI | `Orders.tsx` (38KB), order components | **High** |
| Return processing UI | `Returns.tsx`, `ReturnInward.tsx` (103KB) | **High** |
| Production workflow | `Production.tsx`, `ProductionInward.tsx` (96KB) | Medium |
| Inventory management | `Inventory.tsx` (42KB) | Medium |
| Shared components | `Modal`, `Layout`, `ErrorBoundary` | Low |

### Critical Integration Tests Needed

| Flow | Components Involved | Complexity |
|------|---------------------|------------|
| Order fulfillment | Allocation → Pick → Pack → Ship → Inventory update | **High** |
| Return processing | Create ticket → Receive → QC → Restock or Damage | **High** |
| Shopify sync | Webhook → Cache → Process → Order/Product creation | **High** |
| Production cycle | Plan → Fabric consumption → Inward → Stock update | Medium |
| Inventory reconciliation | Physical count → Adjustment → Ledger | Medium |

### Utilities Already Tested (140 tests)

**Essential Tests (71):**
- ✅ `queryPatterns.js` - fabric consumption, inventory balance
- ✅ `validation.js` - password validation
- ✅ `tierUtils.js` - tier/LTV calculation
- ✅ `encryption.js` - encrypt/decrypt
- ✅ `productSyncService.js` - size normalization, variant mapping (partial)
- ✅ `customerSyncService.js` - buildCustomerData (partial)
- ✅ `shopify.js` - status mapping, gender, channel (partial)

**Integration Tests (69):**
- ✅ Order fulfillment status transitions (pending → allocated → picked → packed → shipped)
- ✅ Fulfillment stage calculation logic
- ✅ Shipping validation rules
- ✅ Order status rules (cancel, unship, uncancel)
- ✅ Tracking status calculation
- ✅ Return processing status transitions
- ✅ Return reason categories and item conditions
- ✅ Shopify order processing (status, payment, customer, order number)
- ✅ Inventory transaction rules (reserve on allocate, outward on ship)

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
