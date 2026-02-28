/**
 * Fabric Stock Count Route - /fabric-count
 * Mobile-first page for warehouse staff to enter physical fabric counts.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const FabricCount = lazy(() => import('../../pages/FabricCount'));

export const Route = createFileRoute('/_authenticated/fabric-count')({
    component: FabricCount,
});
