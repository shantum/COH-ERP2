/**
 * Ledgers Route - /ledgers
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { LedgersSearchParams } from '@coh/shared';

const Ledgers = lazy(() => import('../../pages/Ledgers'));

export const Route = createFileRoute('/_authenticated/ledgers')({
    validateSearch: (search) => LedgersSearchParams.parse(search),
    component: Ledgers,
});
