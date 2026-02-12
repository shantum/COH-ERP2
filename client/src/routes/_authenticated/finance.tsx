/**
 * Finance Route
 *
 * Ledger, invoices, payments, and financial dashboard.
 */

import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { FinanceSearchParams } from '@coh/shared';

const Finance = lazy(() => import('../../pages/Finance'));

export const Route = createFileRoute('/_authenticated/finance')({
  validateSearch: (search) => FinanceSearchParams.parse(search),
  component: Finance,
});
