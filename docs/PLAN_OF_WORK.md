# Plan of Work

This document tracks feature requests, enhancements, and pending work items for the COH-ERP2 system.

---

## Ready for Implementation

### 1. Enhanced Customized Order Lines Display and Management (Open Orders)

- **Priority**: High
- **Source**: User feedback on existing customization feature
- **Problem Statement**: Currently, customized order lines in the Open Orders section don't clearly indicate what customization was applied, and there's no UI to edit or remove customizations after they've been added. Users need visibility into customization details and the ability to manage them without backend intervention.

- **Proposed Solution**: Enhance the Open Orders grid to:
  1. Visually distinguish customized lines from regular lines
  2. Display customization details (type, value, notes) inline or via tooltip/expandable row
  3. Add action buttons for editing and removing customizations
  4. Reuse/extend the existing `CustomizationModal.tsx` for editing
  5. Wire up to existing backend endpoints (`DELETE /lines/:lineId/customize` already exists)

- **Acceptance Criteria**:
  - [ ] Customized order lines are visually distinct in the grid (e.g., badge, icon, or highlighted row)
  - [ ] Customization details (type, value, notes) are visible without needing to inspect data manually
  - [ ] Users can click an "Edit Customization" action on a customized line
  - [ ] Edit action opens the customization modal pre-populated with existing data
  - [ ] Users can modify customization details and save changes
  - [ ] If customization value changes, custom SKU is regenerated with new suffix
  - [ ] Users can click a "Remove Customization" action on a customized line
  - [ ] Remove action reverts the line to the original SKU and clears customization flags
  - [ ] Grid refreshes properly after edit/delete operations
  - [ ] Actions respect order status (e.g., only editable if order is in `pending` or `allocated` status)

- **Affected Domains**: Orders (frontend), Orders/Mutations (backend)

- **Dependencies**: None - backend endpoints already exist

- **Technical Considerations**:

  **Frontend Files**:
  - `/Users/shantumgupta/Desktop/COH-ERP2/client/src/components/orders/OrdersGrid.tsx` - Add column renderer for customization badge/indicator, add action buttons in cell renderer
  - `/Users/shantumgupta/Desktop/COH-ERP2/client/src/components/orders/CustomizationModal.tsx` - Extend to support "edit mode" with pre-populated data
  - `/Users/shantumgupta/Desktop/COH-ERP2/client/src/pages/Orders.tsx` - Add handlers for edit/delete actions, manage modal state
  - `/Users/shantumgupta/Desktop/COH-ERP2/client/src/types/index.ts` - Verify `OrderLine` type includes customization fields

  **Backend Files**:
  - `/Users/shantumgupta/Desktop/COH-ERP2/server/src/routes/orders/mutations.js` - Verify existing endpoints:
    - `DELETE /lines/:lineId/customize` - Already exists for removing customization
    - May need `PATCH /lines/:lineId/customize` for editing (check if exists, or use delete + re-create pattern)

  **UI/UX Design Decisions Needed**:
  - How to display customization details? (Tooltip on hover, expandable row detail, inline badge with modal on click?)
  - Should edit be allowed on all order statuses, or only `pending`/`allocated`?
  - Icon/badge design for customized lines
  - Confirmation dialog before removing customization?

  **Data Flow**:
  - Edit: Fetch current customization data → populate modal → submit PATCH or (DELETE + POST) → refresh grid
  - Delete: Click remove → confirm → DELETE request → refresh grid

  **Grid Integration**:
  - AG-Grid cell renderers for custom display
  - Action column or row-level actions (kebab menu, inline buttons)
  - TanStack Query mutation hooks for edit/delete operations

- **Notes for Architect**:
  - Check if `PATCH /lines/:lineId/customize` endpoint exists, or if edit should be implemented as delete + re-create
  - Consider reusability: Can the customization modal handle both "create" and "edit" modes with a single component?
  - Status validation: Backend should prevent editing customized lines on shipped/packed orders
  - Custom SKU regeneration logic: If value changes, ensure new SKU suffix is generated and inventory transactions are handled correctly
  - Grid refresh strategy: Use TanStack Query invalidation to refresh the entire orders list after mutation

---

### 2. Production Queue Customization Display Enhancement

- **Priority**: High
- **Source**: User requirement - stacked with Open Orders customization enhancement
- **Problem Statement**: Custom SKUs created from order customizations (e.g., `10008552-C01`) are added to production batches, but the production queue/schedule doesn't clearly show what customization is required. Production staff need to know exactly what modifications to make (length adjustment, size modification, custom measurements, etc.) when producing these items.

- **Proposed Solution**: Enhance the Production Schedule page to:
  1. Clearly identify custom SKU batches (badge/indicator in batch rows)
  2. Display customization details prominently for custom batches:
     - Customization type (length, size, measurements, other)
     - Customization value (the specific modification)
     - Production notes (additional instructions)
  3. Link custom batches to their source order for context
  4. Ensure customization data flows from SKU table to production batch display
  5. Add customization details to the "Copy to Clipboard" functionality for production planning

- **Acceptance Criteria**:
  - [ ] Custom SKU batches are visually distinguished in the production schedule (icon, badge, or color)
  - [ ] Customization type, value, and notes are visible on each custom batch row
  - [ ] Production staff can see the linked order number/customer for custom batches
  - [ ] Custom batches show all three customization fields clearly:
    - `customizationType` (e.g., "Length Adjustment")
    - `customizationValue` (e.g., "-2 inches")
    - `customizationNotes` (e.g., "Customer requested shorter sleeves")
  - [ ] Copied production plan text includes customization details for custom SKUs
  - [ ] Custom batches are grouped/sorted appropriately (e.g., show custom batches separately or with clear indicators)
  - [ ] UI handles cases where customization fields may be null gracefully

- **Affected Domains**: Production (frontend and backend)

- **Dependencies**: None - customization data already stored in SKU table and enriched in backend response

- **Technical Considerations**:

  **Frontend Files**:
  - `/Users/shantumgupta/Desktop/COH-ERP2/client/src/pages/Production.tsx` - Main production schedule page (lines 496-586: batch table rendering)
    - Add customization badge/icon to batch rows where `batch.isCustomSku === true`
    - Display customization details in table (new column or expandable row)
    - Update `copyToClipboard` function (lines 53-106) to include customization info
    - Ensure proper null handling for customization fields

  **Backend Files**:
  - `/Users/shantumgupta/Desktop/COH-ERP2/server/src/routes/production.js` - Already enriches batches with customization data (lines 69-88)
    - `GET /batches` endpoint already includes:
      - `isCustomSku` flag
      - `customization` object with type, value, notes, sourceOrderLineId, linkedOrder
    - No backend changes needed - data is already available

  **Data Structure (from backend)**:
  ```javascript
  {
    ...batch,
    isCustomSku: true,
    customization: {
      type: "length",
      value: "-2 inches",
      notes: "Customer requested shorter sleeves",
      sourceOrderLineId: "line-id-123",
      linkedOrder: { id: "order-123", orderNumber: "ORD-2025-001", customerName: "John Doe" }
    }
  }
  ```

  **UI/UX Design Decisions Needed**:
  - Where to display customization details in the batch table?
    - Option A: New column "Customization" showing type + value
    - Option B: Icon/badge with tooltip showing full details
    - Option C: Expandable row detail showing all customization fields
  - Should custom batches be visually separated from regular batches?
  - How to format customization in the copied production plan text?

  **Display Format Examples**:
  - Inline badge: `[CUSTOM: Length -2"] 10008552-C01`
  - Separate column: `Type: Length | Value: -2 inches`
  - Tooltip: Hover over custom badge to see full details

  **Copy to Clipboard Enhancement**:
  - Current format: `1. Product - Size - Color - Qty - StyleCode`
  - Enhanced format for custom SKUs: `1. Product - Size - Color - Qty - StyleCode [CUSTOM: Length -2"] (Notes: shorter sleeves)`

- **Notes for Architect**:
  - Backend already provides all necessary data - this is primarily a frontend display enhancement
  - Ensure TypeScript types in frontend include the `customization` object structure
  - Production batch table is complex (consolidated view + individual rows) - consider where customization fits best
  - The `copyToClipboard` function consolidates batches by SKU - ensure customization details are preserved in consolidation
  - Consider how batches with different customizations but same base SKU should be handled
  - Test with batches that have null customization fields (regular production batches)

---

## In Progress

_No items currently in progress._

---

## Completed

_No completed items yet._

---

## Backlog / Ideas

_No backlog items yet._

---

## Document Conventions

### Status Definitions

- **Ready for Implementation**: Requirements are complete, clear, and approved. Can be handed off to architect/planning agents.
- **In Progress**: Actively being worked on by development team.
- **Completed**: Implementation done, tested, and deployed/merged.
- **Backlog/Ideas**: Captured for future consideration but not yet refined.

### Priority Levels

- **High**: Critical user need or blocking issue. Should be addressed in current sprint.
- **Medium**: Important feature or enhancement. Schedule for upcoming sprint.
- **Low**: Nice-to-have improvement. Address when capacity allows.

### Item Structure

Each work item should include:
- **Priority**: High/Medium/Low
- **Source**: Where the requirement came from (user feedback, bug report, etc.)
- **Problem Statement**: What issue this solves and why it matters
- **Proposed Solution**: High-level approach (not implementation details)
- **Acceptance Criteria**: Testable conditions for "done"
- **Affected Domains**: Which parts of the codebase will change
- **Dependencies**: Prerequisites or related work items
- **Technical Considerations**: File paths, design decisions, data structures
- **Notes for Architect**: Technical guidance and constraints

---

## Update Process

1. **Capture**: Add new requests to "Backlog/Ideas" section
2. **Refine**: Move to "In Progress" and work with stakeholders to clarify
3. **Ready**: Move to "Ready for Implementation" when all criteria are met
4. **Work**: Move to "In Progress" when development starts
5. **Complete**: Move to "Completed" when merged and deployed
6. **Archive**: Periodically move old completed items to archive file

---

**Last Updated**: 2026-01-07
**Maintained By**: Project Management Agent
