/**
 * Return Detail Route - /returns/:returnId
 *
 * Uses pathless layout escape (returns_) to avoid nesting under the returns layout.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const ReturnDetail = lazy(() => import('../../pages/returns/ReturnDetail'));

export const Route = createFileRoute('/_authenticated/returns_/$returnId')({
    component: ReturnDetail,
});
