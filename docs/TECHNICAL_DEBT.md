# Technical Debt & Maintenance Notes

> Tracked technical debt and areas for future improvement. **Last updated: January 10, 2026**

---

## Recent Features (Costing System)

### Observations from Costing Implementation

**Good Patterns Followed:**
- Cascading cost logic well-documented in code comments (fabric, labor, trims, lining, packaging)
- Null-safe fallbacks using nullish coalescing (`??`)
- Raw cascade values returned for UI editing transparency
- Batch queries for performance (`calculateAllInventoryBalances`)
- Proper separation of catalog pricing vs order pricing
- Labor cost cascade: SKU → Variation → Product.baseProductionTimeMins → 60 (default)

**Potential Improvements:**

1. **JSDoc Documentation** (Low priority)
   - `/server/src/routes/catalog.js` - Main endpoint could use detailed JSDoc explaining cascade logic
   - `/server/src/routes/products.js` - Cost config endpoints could document field meanings
   - Not urgent: Code has inline comments that are sufficient

2. **Catalog.tsx Complexity** (Medium priority)
   - 2243 lines - largest component in codebase
   - Aggregation logic duplicated for variation/product views
   - **Recommendation**: Extract aggregation functions to `/client/src/utils/catalogHelpers.ts` when adding new views
   - **Note**: Current inline implementation is acceptable - don't prematurely abstract

3. **GST Calculation Location** (Low priority)
   - GST calculated in catalog endpoint (lines 167-172 of catalog.js)
   - Works for catalog pricing, but order pricing may need different logic
   - **Recommendation**: Document that catalog GST is MRP-inclusive, order pricing calculated separately
   - **Action**: Already documented in DOMAINS.md gotchas

4. **Cost Config Single Row Pattern** (Low priority)
   - Uses `findFirst()` and assumes single row
   - No constraints enforce single row in schema
   - **Recommendation**: Add unique constraint or create singleton pattern if expanding
   - **Current state**: Acceptable - create default if missing handles edge case

---

## General Codebase Health

### Large Files Requiring Monitoring

| File | Lines | Status | Action if exceeds |
|------|-------|--------|-------------------|
| `Catalog.tsx` | 2243 | Monitor | Extract aggregation helpers at 2500 lines |
| `Orders.tsx` | ~40KB | Stable | Already modular (5 tab components) |
| `Returns.tsx` | ~114KB | Stable | Monitor - may split if features added |

### Performance Considerations

**Good:**
- Batch inventory calculations (`calculateAllInventoryBalances`)
- Map caching for O(1) lookups
- Chunked fabric processing (`chunkProcess` in fabrics.js)

**Watch:**
- Catalog endpoint loads all SKUs (limit=10000) - pagination exists but may need server-side filtering at scale
- Variation/Product aggregations happen in-memory - acceptable for <10k SKUs

---

## Documentation Maintenance

### Recent Updates (January 10, 2026)
- ✓ Added Catalog domain to DOMAINS.md
- ✓ Updated ARCHITECTURE.md changelog
- ✓ Added costing gotchas to CLAUDE.md
- ✓ Removed redundant LOGGING_ENHANCEMENTS.md

### Documentation Quality
- **DOMAINS.md**: Comprehensive, well-organized
- **CLAUDE.md**: Concise quick reference
- **ARCHITECTURE.md**: Good high-level overview
- **LOGGING.md**: Detailed, current

---

## Non-Breaking Improvements (Safe to Implement)

### Code Quality
1. Add JSDoc to catalog/products cost endpoints (when files stabilize)
2. Extract `aggregateByVariation`, `aggregateByProduct` to catalogHelpers.ts
3. Add JSDoc to cascading cost calculation functions

### Testing
- Unit tests for cascading cost logic
- Test fabric cost fallback chain
- Test GST threshold calculations

### Monitoring
- Track catalog endpoint response times if SKU count > 5000
- Monitor in-memory aggregation performance

---

## Breaking Change Candidates (Document Only)

**DO NOT IMPLEMENT - Document for future consideration:**

1. **Catalog Endpoint Pagination**
   - Current: limit=10000 (all SKUs by default)
   - Future: Force pagination at 1000 SKUs
   - Impact: Frontend needs pagination UI

2. **Cost Config Schema Constraint**
   - Current: No enforcement of single row
   - Future: Add unique constraint or use settings pattern
   - Impact: Migration needed

3. **Separate Order Pricing Logic**
   - Current: GST calculated in catalog (MRP-inclusive)
   - Future: May need separate order pricing if discounts/promotions added
   - Impact: New endpoint or calculation service

---

## Update Process

When adding new features:
1. Check if this file needs updates (complexity, debt, patterns)
2. Update relevant docs (DOMAINS.md, CLAUDE.md)
3. Add gotchas if cascade/fallback logic introduced
4. Note large file additions here if >1000 lines
