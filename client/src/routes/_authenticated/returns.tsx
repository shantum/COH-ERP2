/**
 * Returns Route - /returns
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { ReturnsSearchParams } from '@coh/shared';

const Returns = lazy(() => import('../../pages/returns'));

export const Route = createFileRoute('/_authenticated/returns')({
    validateSearch: (search) => ReturnsSearchParams.parse(search),
    component: Returns,
});
