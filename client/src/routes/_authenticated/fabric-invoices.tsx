/**
 * Fabric Invoices Route
 *
 * Upload fabric supplier invoices, AI-parse them, review, and confirm.
 */

import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { FabricInvoiceSearchParams } from '@coh/shared';

const FabricInvoices = lazy(() => import('../../pages/FabricInvoices'));

export const Route = createFileRoute('/_authenticated/fabric-invoices')({
    validateSearch: (search) => FabricInvoiceSearchParams.parse(search),
    component: FabricInvoices,
});
