/**
 * Inventory Inward Route - /inventory-inward
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const InventoryInward = lazy(() => import('../../pages/InventoryInward'));

export const Route = createFileRoute('/_authenticated/inventory-inward')({
    component: InventoryInward,
});
