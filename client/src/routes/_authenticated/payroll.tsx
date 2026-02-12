/**
 * Payroll Route
 *
 * Employee management and monthly payroll runs.
 */

import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { PayrollSearchParams } from '@coh/shared';

const Payroll = lazy(() => import('../../pages/Payroll'));

export const Route = createFileRoute('/_authenticated/payroll')({
  validateSearch: (search) => PayrollSearchParams.parse(search),
  component: Payroll,
});
