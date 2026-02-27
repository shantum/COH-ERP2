/**
 * BOM (Bill of Materials) Route - /bom
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const Bom = lazy(() => import('../../pages/Bom'));

export const Route = createFileRoute('/_authenticated/bom')({
    component: Bom,
});
