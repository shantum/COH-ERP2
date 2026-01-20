/**
 * Fabrics Route - /fabrics
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const Fabrics = lazy(() => import('../../pages/Fabrics'));

export const Route = createFileRoute('/_authenticated/fabrics')({
    component: Fabrics,
});
