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

export { UnifiedOrderModal, default } from './UnifiedOrderModal';
export { useUnifiedOrderModal } from './hooks/useUnifiedOrderModal';
export type { ModalMode, EditFormState, ShipFormState, AddressData, CategorizedLines, NavigationEntry, NavigationState } from './types';

// Export individual components for advanced use cases
export { ModalHeader } from './components/ModalHeader';
export { CustomerSection } from './components/CustomerSection';
export { CustomerTab } from './components/CustomerTab';
export { OrderHistoryCard } from './components/OrderHistoryCard';
export { ItemsSection } from './components/ItemsSection';
export { OrderSummary } from './components/OrderSummary';
export { ShippingSection } from './components/ShippingSection';
export { TimelineSection } from './components/TimelineSection';
export { NotesSection } from './components/NotesSection';
