/**
 * Orders components index
 * Re-exports all order-related components for clean imports
 */

// Grids
export { OrdersGrid } from './OrdersGrid';
export type { OrderViewType } from './OrdersGrid';
// Note: ShippedOrdersGrid, ArchivedOrdersGrid, RtoOrdersGrid, CodPendingGrid, CancelledOrdersGrid
// are deprecated - use OrdersGrid with currentView prop instead

// Primary Modals
export { UnifiedOrderModal } from './UnifiedOrderModal';
export { CreateOrderModal } from './CreateOrderModal';
export { CustomerDetailModal } from './CustomerDetailModal';
export { CustomizationModal } from './CustomizationModal';
export { TrackingModal } from './TrackingModal';
export { ProcessShippedModal } from './ProcessShippedModal';

// Panels and Search
export { SummaryPanel } from './SummaryPanel';
export { OrdersAnalyticsBar } from './OrdersAnalyticsBar';
export { GlobalOrderSearch } from './GlobalOrderSearch';
