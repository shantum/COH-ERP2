/**
 * Audiences Route - /audiences
 *
 * Customer audience segments — create, manage, and use for campaigns.
 */
import { createFileRoute } from '@tanstack/react-router';
import Audiences from '../../pages/Audiences';

export const Route = createFileRoute('/_authenticated/audiences')({
    component: Audiences,
});
