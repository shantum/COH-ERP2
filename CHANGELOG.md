# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] - 2026-01-27

### Refactored
- **Order State Machine**: Extracted pure business logic from `server/src/utils/orderStateMachine.ts` to `@coh/shared/domain/orders/stateMachine.ts`
  - Types: `LineStatus`, `InventoryEffect`, `TimestampField`, `TimestampAction`, `TransitionDefinition`, `TransitionContext`, `TransitionResult`
  - Constants: `LINE_STATUS_TRANSITIONS`, `LINE_STATUSES`, `STATUSES_WITH_ALLOCATED_INVENTORY`, `STATUSES_SHOWING_INVENTORY_ALLOCATED`
  - Functions: `isValidTransition`, `getTransitionDefinition`, `getValidTargetStatuses`, `isValidLineStatus`, `transitionAffectsInventory`, `releasesInventory`, `allocatesInventory`, `hasAllocatedInventory`, `statusShowsInventoryAllocated`, `buildTransitionError`, `calculateInventoryDelta`
  - Server's `orderStateMachine.ts` now re-exports from shared and only retains DB-dependent `executeTransition`

- **Client Inventory Helpers**: `client/src/hooks/orders/optimistic/inventoryHelpers.ts` now re-exports from `@coh/shared/domain` instead of maintaining its own duplicate implementation

- **Order Mutations**: Removed duplicated constants (`STATUSES_WITH_ALLOCATED_INVENTORY`, `hasAllocatedInventory`) from `client/src/server/functions/orderMutations.ts`, now imports from `@coh/shared/domain`

### Fixed
- **setLineStatus Bug**: Fixed incomplete transition map in `orderMutations.ts` that was missing:
  - `packed -> shipped` transition (couldn't ship via setLineStatus endpoint)
  - `shipped -> packed` transition (couldn't unship)
  - `shipped` status was entirely absent from the validation map
  - Now uses shared `isValidTransition()` as single source of truth

- **Test Corrections**: Fixed 4 incorrect test assertions in `server/src/utils/__tests__/orderStateMachine.test.ts` that claimed `shipped -> packed` was invalid (it's a valid unship transition defined in the state machine)

### Added
- `shared/src/domain/orders/stateMachine.ts` - Pure domain state machine module
- `shared/src/domain/orders/__tests__/stateMachine.test.ts` - 72 tests for state machine logic
- `shared/jest.config.js` - Jest configuration for shared package
- Two distinct inventory allocation concepts with clear naming:
  - `hasAllocatedInventory()`: Server-side, excludes shipped (for transaction cleanup)
  - `statusShowsInventoryAllocated()`: Client-side, includes shipped (for display)

### Changed
- `server/jest.config.js` - Added `@coh/shared` module name mapper
- `client/tsconfig.app.json` - Excluded shared `__tests__` from type checking
- `shared/package.json` - Added test scripts and jest dev dependencies
