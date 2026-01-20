/**
 * Inventory Route - /inventory
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { InventorySearchParams } from '@coh/shared';

const Inventory = lazy(() => import('../../pages/Inventory'));

export const Route = createFileRoute('/_authenticated/inventory')({
    validateSearch: (search) => InventorySearchParams.parse(search),
    component: Inventory,
});
