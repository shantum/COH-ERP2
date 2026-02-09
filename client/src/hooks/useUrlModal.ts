/**
 * URL-Driven Modal Hook
 *
 * Controls modal open/close state via URL search parameters.
 * This ensures:
 * - Modals are bookmarkable (/orders?modal=view&orderId=123)
 * - Modals are shareable (copy URL to share exact modal state)
 * - Browser back button closes modals
 * - Refreshing page reopens the modal
 *
 * @example
 * const { isOpen, openModal, closeModal, modalMode } = useUrlModal({
 *   modalKey: 'modal',
 *   idKey: 'orderId',
 *   modeKey: 'modalMode',
 * });
 *
 * // Open modal: /orders?modal=view&orderId=123
 * openModal('view', '123');
 *
 * // Close modal: /orders (removes modal params)
 * closeModal();
 */

import { useCallback, useMemo } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';

interface UseUrlModalOptions {
    /** Route ID for TanStack Router (e.g., '/_authenticated/orders') */
    routeId: string;
    /** URL param key for modal type (default: 'modal') */
    modalKey?: string;
    /** URL param key for selected item ID (default: 'orderId') */
    idKey?: string;
    /** URL param key for modal mode/sub-mode (default: 'modalMode') */
    modeKey?: string;
}

interface UseUrlModalReturn<TModalType extends string = string> {
    /** Whether any modal is open */
    isOpen: boolean;
    /** Current modal type (from URL) */
    modalType: TModalType | null;
    /** Selected item ID (from URL) */
    selectedId: string | null;
    /** Modal mode/sub-mode (from URL) */
    modalMode: string | null;
    /** Open a modal with specified type and optional ID */
    openModal: (type: TModalType, id?: string, mode?: string) => void;
    /** Close the modal (removes modal params from URL) */
    closeModal: () => void;
    /** Update modal mode without closing */
    setModalMode: (mode: string | null) => void;
    /** Check if a specific modal type is open */
    isModalType: (type: TModalType) => boolean;
}

export function useUrlModal<TModalType extends string = string>({
    routeId,
    modalKey = 'modal',
    idKey = 'orderId',
    modeKey = 'modalMode',
}: UseUrlModalOptions): UseUrlModalReturn<TModalType> {
    // Use strict: false to work with any route shape
    const search = useSearch({ strict: false }) as Record<string, unknown>;
    const navigate = useNavigate();

    // Extract modal state from URL
    const modalType = (search[modalKey] as TModalType) || null;
    const selectedId = (search[idKey] as string) || null;
    const modalMode = (search[modeKey] as string) || null;
    const isOpen = modalType !== null;

    // Open modal (updates URL)
    const openModal = useCallback((type: TModalType, id?: string, mode?: string) => {
        const newSearch = {
            ...search,
            [modalKey]: type,
            ...(id ? { [idKey]: id } : {}),
            ...(mode ? { [modeKey]: mode } : {}),
        };

        navigate({
            // Route ID is dynamic string — type-safe navigation not possible here
            to: routeId as '.',
            search: newSearch as Record<string, unknown>,
            replace: false, // Allow back button to close modal
        });
    }, [navigate, routeId, search, modalKey, idKey, modeKey]);

    // Close modal (removes modal params from URL)
    const closeModal = useCallback(() => {
        const newSearch = { ...search };
        delete newSearch[modalKey];
        delete newSearch[idKey];
        delete newSearch[modeKey];

        navigate({
            // Route ID is dynamic string — type-safe navigation not possible here
            to: routeId as '.',
            search: newSearch as Record<string, unknown>,
            replace: false, // Allow back button navigation
        });
    }, [navigate, routeId, search, modalKey, idKey, modeKey]);

    // Update modal mode without closing
    const setModalMode = useCallback((mode: string | null) => {
        const newSearch = {
            ...search,
            ...(mode ? { [modeKey]: mode } : {}),
        };
        if (!mode) {
            delete newSearch[modeKey];
        }

        navigate({
            // Route ID is dynamic string — type-safe navigation not possible here
            to: routeId as '.',
            search: newSearch as Record<string, unknown>,
            replace: true, // Don't add to history for mode changes
        });
    }, [navigate, routeId, search, modeKey]);

    // Check if specific modal type is open
    const isModalType = useCallback((type: TModalType) => {
        return modalType === type;
    }, [modalType]);

    return useMemo(() => ({
        isOpen,
        modalType,
        selectedId,
        modalMode,
        openModal,
        closeModal,
        setModalMode,
        isModalType,
    }), [isOpen, modalType, selectedId, modalMode, openModal, closeModal, setModalMode, isModalType]);
}

/**
 * Type-safe URL modal hook for Orders page
 */
export type OrderModalType = 'view' | 'edit' | 'ship' | 'create' | 'customer';

export function useOrdersUrlModal() {
    return useUrlModal<OrderModalType>({
        routeId: '/orders',
        modalKey: 'modal',
        idKey: 'orderId',
        modeKey: 'modalMode',
    });
}

/**
 * Type-safe URL modal hook for Products page
 */
export type ProductModalType = 'editProduct' | 'editVariation' | 'editSku' | 'addProduct';

export function useProductsUrlModal() {
    return useUrlModal<ProductModalType>({
        routeId: '/products',
        modalKey: 'modal',
        idKey: 'id',
        modeKey: 'type',
    });
}

/**
 * Type-safe URL modal hook for Customers page
 */
export type CustomerModalType = 'view' | 'orders';

export function useCustomersUrlModal() {
    return useUrlModal<CustomerModalType>({
        routeId: '/customers',
        modalKey: 'modal',
        idKey: 'customerId',
        modeKey: 'modalMode',
    });
}
