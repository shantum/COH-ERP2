/**
 * Orders components index
 * Re-exports all order-related components for clean imports
 */

// Table (TanStack Table implementation)
export { OrdersTable } from './OrdersTable';
export type { OrdersTableProps, OrderViewType } from './OrdersTable';
export { OrdersGridSkeleton } from './OrdersGridSkeleton';

// Modals
export { UnifiedOrderModal } from './UnifiedOrderModal';
export { CreateOrderModal } from './CreateOrderModal';
export { CustomerDetailModal } from './CustomerDetailModal';
export { CustomizationModal } from './CustomizationModal';
export type { CustomizationType } from './CustomizationModal';
export { TrackingModal } from './TrackingModal';

// Panels and Search
export { SummaryPanel } from './SummaryPanel';
export { OrdersAnalyticsBar } from './OrdersAnalyticsBar';
export { GlobalOrderSearch } from './GlobalOrderSearch';

// View Controls
export { OrderViewTabs } from './OrderViewTabs';
export type { OrderView, ViewCounts } from './OrderViewTabs';
