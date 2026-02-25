/**
 * Inventory Adjustments Route - /inventory-adjustments
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const InventoryAdjustments = lazy(() => import('../../pages/InventoryAdjustments'));

export const Route = createFileRoute('/_authenticated/inventory-adjustments')({
    component: InventoryAdjustments,
});
