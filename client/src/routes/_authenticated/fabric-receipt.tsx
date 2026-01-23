/**
 * Fabric Receipt Entry Route
 *
 * Page for recording fabric received from suppliers (inward transactions).
 */

import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { FabricReceiptSearchParams } from '@coh/shared';

const FabricReceipt = lazy(() => import('../../pages/FabricReceipt'));

export const Route = createFileRoute('/_authenticated/fabric-receipt')({
    validateSearch: (search) => FabricReceiptSearchParams.parse(search),
    component: FabricReceipt,
});
