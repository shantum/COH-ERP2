/**
 * UnifiedOrderModal - Consolidated modal for viewing, editing, and shipping orders
 *
 * Combines 5 existing modals:
 * - EditOrderModal (customer, items, addresses)
 * - OrderViewModal (read-only detailed view)
 * - ShipOrderModal (AWB verification, partial shipment)
 * - OrderDetailModal (quick view)
 * - NotesModal (notes editing)
 */

// eslint-disable-next-line react-refresh/only-export-components -- barrel file for module re-exports
export { UnifiedOrderModal, default } from './UnifiedOrderModal';
// eslint-disable-next-line react-refresh/only-export-components -- barrel file for module re-exports
export { useUnifiedOrderModal } from './hooks/useUnifiedOrderModal';
export type { ModalMode, EditFormState, ShipFormState, AddressData, CategorizedLines, NavigationEntry, NavigationState, OrderWithShopifyDetails, ShopifyLineItem } from './types';

// Export individual components for advanced use cases
export { ModalHeader } from './components/ModalHeader';
export { CustomerSection } from './components/CustomerSection';
export { CustomerTab } from './components/CustomerTab';
export { OrderHistoryCard } from './components/OrderHistoryCard';
export { ItemsSection } from './components/ItemsSection';
export { ShippingSection } from './components/ShippingSection';
export { TimelineSection } from './components/TimelineSection';
export { NotesSection } from './components/NotesSection';
