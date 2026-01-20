/**
 * Inventory Count Route - /inventory-count
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const InventoryReconciliation = lazy(() => import('../../pages/InventoryReconciliation'));

export const Route = createFileRoute('/_authenticated/inventory-count')({
    component: InventoryReconciliation,
});
