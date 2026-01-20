/**
 * Fabric Reconciliation Route - /fabric-reconciliation
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const FabricReconciliation = lazy(() => import('../../pages/FabricReconciliation'));

export const Route = createFileRoute('/_authenticated/fabric-reconciliation')({
    component: FabricReconciliation,
});
